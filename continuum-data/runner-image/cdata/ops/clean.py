"""Rule-based clean-up: filter, fix_types, fill_missing, outliers."""

from __future__ import annotations

import polars as pl

from .. import protocol
from ..protocol import CdataError, ParamError, fmt_int, get_param
from ._version import read_version, sample_rows, text_of, write_version

NUMERIC = (pl.Int8, pl.Int16, pl.Int32, pl.Int64, pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64, pl.Float32, pl.Float64)


def _is_num(dtype) -> bool:
    return dtype in NUMERIC


def _columns(v, params, pick) -> list[str]:
    chosen = get_param(params, "columns", list, None)
    cols = [c for c in v.content_columns if pick(c, v.df.schema[c])]
    if chosen is not None:
        unknown = [c for c in chosen if c not in v.df.columns]
        if unknown:
            raise ParamError(f"No such column: {', '.join(map(str, unknown))}.")
        cols = [c for c in chosen if c in cols]
    return cols


# ---------- filter ----------


def run_filter(params: dict) -> None:
    v = read_version(params)
    df = v.df
    rules: list[tuple[str, pl.Expr]] = []  # (reason, expression that is true for rows to DROP)
    text = text_of(v)
    if text is not None:
        t = text
        if get_param(params, "dropEmpty", bool, True):
            rules.append(("empty text", t.str.strip_chars() == ""))
        lo = get_param(params, "minChars", int, None)
        hi = get_param(params, "maxChars", int, None)
        if lo is not None:
            rules.append((f"shorter than {lo} characters", t.str.len_chars() < lo))
        if hi is not None:
            rules.append((f"longer than {hi} characters", t.str.len_chars() > hi))
        mw = get_param(params, "minWords", int, None)
        if mw is not None:
            rules.append((f"fewer than {mw} words", t.str.split(" ").list.len() < mw))
        sym = get_param(params, "maxSymbolShare", (int, float), None)
        if sym is not None:
            share = t.str.count_matches(r"[^\w\s]") / pl.max_horizontal(t.str.len_chars(), pl.lit(1))
            rules.append(("mostly symbols", share > float(sym)))
        rep = get_param(params, "maxRepeatedLineShare", (int, float), None)
        if rep is not None:
            lines = t.str.split("\n")
            share = 1 - lines.list.unique().list.len() / pl.max_horizontal(lines.list.len(), pl.lit(1))
            rules.append(("repeats the same lines", share > float(rep)))
    if get_param(params, "dropMissingLabel", bool, True) and v.label and v.label in df.columns:
        rules.append(("no label", pl.col(v.label).is_null()))
    for flag in get_param(params, "dropFlags", list, []):
        rules.append((f"flagged {flag}", pl.col("_flags").list.contains(str(flag))))
    where = get_param(params, "keepWhere", str, None)
    if where:
        try:
            keep_expr = pl.sql_expr(where)
            df.head(1).select(keep_expr)
        except Exception as exc:  # noqa: BLE001
            raise ParamError(f"The condition could not be understood: {exc}", "BAD_CONDITION")
        rules.append((f"doesn't match {where}", ~keep_expr.fill_null(False)))
    if not rules:
        raise ParamError("Choose at least one rule for this step.", "NO_RULES")

    reason = pl.lit(None, pl.String)
    for why, expr in reversed(rules):
        reason = pl.when(expr.fill_null(False)).then(pl.lit(why)).otherwise(reason)
    df = df.with_columns(reason.alias("__why"))
    dropped = df.filter(pl.col("__why").is_not_null())
    sample = []
    for why, part in dropped.head(200).group_by("__why", maintain_order=True):
        sample.extend(sample_rows(part.drop("__why"), why[0], 10))
    counts = {k: int(n) for k, n in dropped.group_by("__why").len().iter_rows()}
    out = df.filter(pl.col("__why").is_null()).drop("__why")
    notes = [f"{fmt_int(n)} {why}" for why, n in sorted(counts.items(), key=lambda x: -x[1])]
    protocol.log(f"Removed {fmt_int(dropped.height)} rows." if dropped.height else "No rows matched the rules.")
    write_version(v, out, params, op="filter", removed=dropped.height, sample=sample, notes=notes)


# ---------- fix_types ----------

TRUE = {"true", "yes", "y", "1"}
FALSE = {"false", "no", "n", "0"}


def run_fix_types(params: dict) -> None:
    v = read_version(params)
    df = v.df
    strip = get_param(params, "stripSpaces", bool, True)
    cols = _columns(v, params, lambda c, d: d == pl.String and c != "messages")
    changed_cols, notes = [], []
    for c in cols:
        s = df[c].str.strip_chars() if strip else df[c]
        filled = s.drop_nulls().filter(s.drop_nulls() != "")
        if filled.len() == 0:
            continue
        as_num = filled.str.replace_all(",", "").cast(pl.Float64, strict=False)
        lower = filled.str.to_lowercase()
        if as_num.null_count() == 0 and c != v.label:
            num = s.str.replace_all(",", "").cast(pl.Float64, strict=False)
            if (num.drop_nulls() % 1 == 0).all():
                num = num.cast(pl.Int64)
            df = df.with_columns(num.alias(c))
            changed_cols.append(c)
            notes.append(f"{c}: text → number")
        elif lower.is_in(list(TRUE | FALSE)).all() and c != v.label:
            low = s.str.to_lowercase()
            df = df.with_columns(pl.when(low.is_in(list(TRUE))).then(True).when(low.is_in(list(FALSE))).then(False).otherwise(None).alias(c))
            changed_cols.append(c)
            notes.append(f"{c}: text → yes/no")
        elif strip:
            df = df.with_columns(s.alias(c))
    changed = df.height if changed_cols else 0
    protocol.log(f"Fixed {len(changed_cols)} column(s)." if changed_cols else "Every column already had the right kind.")
    write_version(v, df, params, op="fix_types", changed=changed, notes=notes)


# ---------- fill_missing ----------

STRATEGIES = ("auto", "mean", "median", "mode", "constant", "drop")


def run_fill_missing(params: dict) -> None:
    v = read_version(params)
    df = v.df
    strategy = get_param(params, "strategy", str, "auto")
    if strategy not in STRATEGIES:
        raise ParamError(f"strategy must be one of {', '.join(STRATEGIES)}.")
    value = params.get("value")
    if strategy == "constant" and value is None:
        raise ParamError("Give a value to fill in.", "VALUE_REQUIRED")
    cols = _columns(v, params, lambda c, d: c != v.label and not isinstance(d, (pl.List, pl.Struct)))
    before = df.height
    notes, filled_total = [], 0
    if v.label and v.label in df.columns and get_param(params, "dropMissingLabel", bool, True):
        df = df.filter(pl.col(v.label).is_not_null())
        if before - df.height:
            notes.append(f"{fmt_int(before - df.height)} rows without a label removed")
    if strategy == "drop":
        start = df.height
        df = df.drop_nulls(subset=cols) if cols else df
        notes.append(f"{fmt_int(start - df.height)} rows with empty cells removed")
    else:
        for c in cols:
            n = df[c].null_count()
            if not n:
                continue
            dtype = df.schema[c]
            how = strategy
            if how == "auto":
                how = "median" if _is_num(dtype) else "mode"
            if how in ("mean", "median") and not _is_num(dtype):
                how = "mode"
            if how == "mean":
                fill = df[c].mean()
            elif how == "median":
                fill = df[c].median()
            elif how == "mode":
                modes = df[c].drop_nulls().mode()
                fill = modes.sort()[0] if modes.len() else None
            else:
                fill = value
            if fill is None:
                continue
            if dtype in (pl.Int8, pl.Int16, pl.Int32, pl.Int64) and isinstance(fill, float) and not float(fill).is_integer():
                df = df.with_columns(pl.col(c).cast(pl.Float64))
            try:
                df = df.with_columns(pl.col(c).fill_null(pl.lit(fill).cast(df.schema[c])))
            except pl.exceptions.PolarsError as exc:
                raise CdataError("FILL_FAILED", f"Couldn't fill {c} with {fill!r}: {exc}")
            filled_total += n
            shown = round(fill, 4) if isinstance(fill, float) else fill
            words = {"mean": "the average", "median": "the middle value", "mode": "the most common value", "constant": "your value"}[how]
            notes.append(f"{c}: {fmt_int(n)} empty cells filled with {words} ({shown})")
    removed = before - df.height
    protocol.log(f"Filled {fmt_int(filled_total)} empty cells; removed {fmt_int(removed)} rows.")
    write_version(v, df, params, op="fill_missing", removed=removed, changed=filled_total, notes=notes)


# ---------- outliers ----------


def run_outliers(params: dict) -> None:
    v = read_version(params)
    df = v.df
    factor = float(get_param(params, "factor", (int, float), 1.5))
    action = get_param(params, "action", str, "clip")
    if action not in ("clip", "drop"):
        raise ParamError("action must be 'clip' or 'drop'.")
    cols = _columns(v, params, lambda c, d: _is_num(d) and c != v.label)
    if not cols:
        raise ParamError("There are no number columns to check.", "NO_COLUMNS")
    notes, drop_mask, changed = [], pl.Series([False] * df.height), 0
    for c in cols:
        q1, q3 = df[c].quantile(0.25), df[c].quantile(0.75)
        if q1 is None or q3 is None:
            continue
        lo, hi = q1 - factor * (q3 - q1), q3 + factor * (q3 - q1)
        outside = ((df[c] < lo) | (df[c] > hi)).fill_null(False)
        n = int(outside.sum())
        if not n:
            continue
        if action == "clip":
            df = df.with_columns(pl.col(c).clip(lo, hi).cast(df.schema[c] if df.schema[c] in (pl.Float32, pl.Float64) else pl.Float64))
            changed += n
            notes.append(f"{c}: {fmt_int(n)} values pulled into {lo:g} – {hi:g}")
        else:
            drop_mask = drop_mask | outside
            notes.append(f"{c}: {fmt_int(n)} rows outside {lo:g} – {hi:g}")
    sample = []
    if action == "drop":
        sample = sample_rows(df.filter(drop_mask), "unusual value")
        df = df.filter(~drop_mask)
    removed = v.df.height - df.height
    protocol.log(f"{'Removed' if action == 'drop' else 'Adjusted'} {fmt_int(removed or changed)} unusual values." if (removed or changed) else "No unusual values found.")
    write_version(v, df, params, op="outliers", removed=removed, changed=changed, sample=sample, notes=notes)
