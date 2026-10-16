"""profile: measure a dataset version and write ``<input>/profile.json``."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Optional

import polars as pl
import pyarrow.parquet as pq

from .. import protocol
from ..protocol import CdataError, ParamError, Progress, fmt_int, get_param
from ..schema import type_name

BATCH_ROWS = 50_000
MISSING_SHARE = 0.05
TOP_N = 10
TOP_CHARS = 200


def _load_manifest(version: Path) -> dict:
    path = version / "manifest.json"
    if not path.is_file():
        raise CdataError("NO_MANIFEST", "This folder is not a dataset version (manifest.json is missing).")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CdataError("BAD_MANIFEST", f"manifest.json could not be read: {exc}")
    if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), list):
        raise CdataError("BAD_MANIFEST", "manifest.json has no list of files.")
    return manifest


def _data_files(version: Path, manifest: dict) -> list[Path]:
    out = []
    for f in manifest["files"]:
        rel = f.get("path") if isinstance(f, dict) else None
        if not isinstance(rel, str) or not rel.endswith(".parquet"):
            continue
        try:
            path = protocol.resolve_in(version, rel, "manifest files[].path")
        except ParamError as exc:
            raise CdataError("BAD_MANIFEST", exc.message)
        if not path.is_file():
            raise CdataError("MISSING_FILE", f"The data file {rel} listed in manifest.json is missing.")
        out.append(path)
    if not out:
        raise CdataError("BAD_MANIFEST", "manifest.json lists no data files.")
    return out


def _blank(col: str, dtype) -> pl.Expr:
    """Null, or (for strings) only whitespace."""
    e = pl.col(col).is_null()
    if dtype == pl.String:
        e = e | (pl.col(col).str.strip_chars() == "")
    elif isinstance(dtype, pl.List):
        e = e | (pl.col(col).list.len() == 0)
    return e


def _text_expr(columns: dict) -> Optional[pl.Expr]:
    if "messages" in columns and isinstance(columns["messages"], pl.List):
        msgs = pl.col("messages").list.eval(pl.element().struct.field("content")).list.join("\n")
        if "system" in columns:
            return pl.concat_str([pl.col("system").fill_null(""), msgs], separator="\n").str.strip_chars().alias("_t")
        return msgs.alias("_t")
    if "text" in columns:
        return pl.col("text").cast(pl.String).alias("_t")
    return None


def _num(v):
    if v is None:
        return None
    if isinstance(v, float):
        if not math.isfinite(v):
            return None
        return round(v, 6)
    return v


def _histogram(s: pl.Series, lo: float, hi: float, integer: bool, bins: int = 10) -> list[dict]:
    if s.len() == 0 or lo is None or hi is None:
        return []
    if hi <= lo:
        return [{"from": _num(lo), "to": _num(hi), "count": int(s.len())}]
    width = (hi - lo) / bins
    if integer:
        width = max(1, math.ceil(width))
    idx = ((s.cast(pl.Float64) - lo) / width).floor().cast(pl.Int64).clip(0, bins - 1)
    counts = idx.value_counts().to_dict(as_series=False)
    by = dict(zip(counts[idx.name], counts["count"]))
    out = []
    for i in range(bins):
        a = lo + i * width
        b = hi if (i == bins - 1 and not integer) else lo + (i + 1) * width
        out.append({"from": _num(a), "to": _num(b), "count": int(by.get(i, 0))})
    return out


def _column_stats(name: str, dtype, role: str, sample: pl.DataFrame, missing: int) -> dict:
    s = sample[name]
    tname = type_name(dtype)
    col = {"name": name, "type": tname, "role": role, "missing": int(missing), "distinct": None,
           "min": None, "max": None, "mean": None, "p25": None, "p50": None, "p75": None,
           "histogram": None, "top": None}
    nn = s.drop_nulls()
    try:
        col["distinct"] = int(nn.n_unique())
    except Exception:  # noqa: BLE001 - some nested types cannot be compared
        col["distinct"] = None
    if tname in ("integer", "float"):
        if tname == "float":
            nn = nn.filter(nn.is_not_nan())
        if nn.len():
            lo, hi = nn.min(), nn.max()
            col.update(min=_num(lo), max=_num(hi), mean=_num(nn.mean()),
                       p25=_num(nn.quantile(0.25, "linear")), p50=_num(nn.quantile(0.5, "linear")),
                       p75=_num(nn.quantile(0.75, "linear")))
            col["histogram"] = _histogram(nn, float(lo), float(hi), tname == "integer")
    elif tname in ("date", "datetime"):
        if nn.len():
            col.update(min=str(nn.min()), max=str(nn.max()))
    if tname in ("string", "boolean", "date", "datetime") and nn.len():
        vc = nn.cast(pl.String).value_counts(sort=True).head(TOP_N)
        values, counts = vc[vc.columns[0]].to_list(), vc["count"].to_list()
        col["top"] = [{"value": (v[:TOP_CHARS] if isinstance(v, str) else v), "count": int(c)} for v, c in zip(values, counts)]
    return col


def _q(s: pl.Series, q: float):
    v = s.quantile(q, "linear")
    return None if v is None else round(float(v))


def _plural(n: int, one: str, many: str) -> str:
    return f"{fmt_int(n)} {one if n == 1 else many}"


def _findings(rows, modality, task, dup, columns, missing_cols, labels, text, splits, single) -> list[dict]:
    f = []
    if dup > 0:
        f.append({"id": "exact_duplicates", "severity": "warning",
                  "message": f"{_plural(dup, 'row is an exact copy', 'rows are exact copies')} of another row. "
                             "Copies make a model memorise them and can make test scores look better than they really are.",
                  "suggest": "dedupe"})
    if missing_cols:
        parts = [f"'{c}' is empty in {share:.0%} of rows" for c, share in missing_cols[:5]]
        more = f" (and {len(missing_cols) - 5} more columns)" if len(missing_cols) > 5 else ""
        f.append({"id": "missing_values", "severity": "warning",
                  "message": f"Some values are missing: {', '.join(parts)}{more}. Gaps can confuse a model; you can fill them in or drop those rows.",
                  "suggest": "fill_missing", "columns": [c for c, _ in missing_cols]})
    if labels and len(labels["counts"]) >= 2 and labels["balance"] < 0.5:
        top, low = labels["counts"][0], labels["counts"][-1]
        f.append({"id": "imbalanced_labels", "severity": "warning",
                  "message": f"The labels are uneven: '{top['value']}' has {fmt_int(top['count'])} rows but '{low['value']}' has only "
                             f"{fmt_int(low['count'])}. A model may learn to mostly guess '{top['value']}'.",
                  "suggest": "balance"})
    small = [c for c in (labels["counts"] if labels else []) if c["count"] < 100]
    if rows < 1000 or small:
        msgs = []
        if rows < 1000:
            msgs.append(f"This dataset has only {_plural(rows, 'row', 'rows')}; most models need at least 1,000 examples to learn well.")
        if small:
            names = ", ".join(f"'{c['value']}' ({fmt_int(c['count'])})" for c in small[:5])
            msgs.append(f"Some labels have fewer than 100 examples: {names}. Try to have at least 100 rows for each label.")
        f.append({"id": "few_rows", "severity": "warning", "message": " ".join(msgs), "suggest": None})
    if text and text["empty"] > 0:
        f.append({"id": "empty_text", "severity": "warning",
                  "message": f"{_plural(text['empty'], 'row has', 'rows have')} no text. Empty rows teach the model nothing and are best removed.",
                  "suggest": "filter"})
    if text and text["chars"]["p95"] is not None and text["chars"]["p95"] > 8000:
        f.append({"id": "very_long_text", "severity": "info",
                  "message": f"Some texts are very long: 5% are over {fmt_int(text['chars']['p95'])} characters. "
                             "Long texts may be cut short when a model is trained on them.",
                  "suggest": None})
    if single:
        names = ", ".join(f"'{c}'" for c in single[:5])
        f.append({"id": "single_value_column", "severity": "info",
                  "message": f"{'The column' if len(single) == 1 else 'The columns'} {names} {'has' if len(single) == 1 else 'have'} "
                             "the same value in every row, so it tells a model nothing and can be left out.",
                  "suggest": None, "columns": single})
    if labels is None and task != "chat" and modality in ("text", "tabular") and task != "regress":
        msg = ("There is no label column, so this data can teach a model to write text but not to sort texts into groups."
               if modality == "text" else "No column is marked as the thing to predict. Pick the label column before training.")
        f.append({"id": "no_label", "severity": "info", "message": msg, "suggest": None})
    if splits:
        names = {"train": "train", "validation": "validation", "test": "test"}
        parts = [f"{names.get(k, k)} ({fmt_int(v)})" for k, v in splits.items()]
        f.append({"id": "has_splits", "severity": "info",
                  "message": f"This data already comes split into {', '.join(parts)}. These splits will be kept.",
                  "suggest": None})
    return f


def run(raw: dict) -> None:
    rel = get_param(raw, "input", str, required=True)
    sample_rows = get_param(raw, "sampleRows", int, default=100_000)
    if sample_rows < 1:
        raise ParamError("'sampleRows' must be at least 1.")
    version = protocol.resolve(rel, "input")
    if not version.is_dir():
        raise ParamError(f"The input folder {rel} does not exist.", "NOT_FOUND")
    manifest = _load_manifest(version)
    paths = _data_files(version, manifest)

    rows = sum(pq.ParquetFile(p).metadata.num_rows for p in paths)
    step = max(1, math.ceil(rows / sample_rows))
    roles = {c.get("name"): c.get("role") for c in manifest.get("schema") or [] if isinstance(c, dict)}
    label_col = next((n for n, r in roles.items() if r == "label"), None)
    modality, task = manifest.get("modality"), manifest.get("task")

    progress = Progress("rows", rows)
    progress.update(0, force=True)

    schema: Optional[dict] = None
    data_cols: list[str] = []
    missing: dict[str, int] = {}
    missing_rows = 0
    hashes: list[pl.Series] = []
    label_counts: dict = {}
    split_counts: dict = {}
    text_empty = 0
    samples: list[pl.DataFrame] = []
    text_e = None
    seen = 0
    hash_by_json = False

    for path in paths:
        for b in pq.ParquetFile(path).iter_batches(batch_size=BATCH_ROWS):
            df = pl.from_arrow(b)
            if schema is None:
                schema = dict(df.schema)
                data_cols = [c for c in schema if not c.startswith("_")]
                missing = {c: 0 for c in data_cols}
                text_e = _text_expr(schema) if modality == "text" else None
                if label_col not in schema:
                    label_col = None
            n = df.height
            if data_cols:
                blanks = df.select([_blank(c, schema[c]).alias(c) for c in data_cols])
                for c, v in zip(data_cols, blanks.sum().row(0)):
                    missing[c] += int(v)
                missing_rows += int(blanks.select(pl.any_horizontal(pl.all())).to_series().sum())
                del blanks
                row = pl.struct(data_cols)
                try:
                    if hash_by_json:
                        raise pl.exceptions.InvalidOperationError("json")
                    h = df.select(row.hash(seed=7).alias("h"))["h"]
                except pl.exceptions.PolarsError:
                    hash_by_json = True
                    h = df.select(row.struct.json_encode().hash(seed=7).alias("h"))["h"]
                hashes.append(h)
            if label_col is not None and task != "regress":
                lc = df[label_col]
                if isinstance(lc.dtype, pl.List):
                    lc = lc.explode()
                for v, c in lc.drop_nulls().cast(pl.String).value_counts().iter_rows():
                    label_counts[v] = label_counts.get(v, 0) + c
            if "_split" in df.columns:
                for v, c in df["_split"].drop_nulls().value_counts().iter_rows():
                    split_counts[v] = split_counts.get(v, 0) + c
            if text_e is not None:
                t = df.select(text_e)["_t"]
                text_empty += int((t.is_null() | (t.str.strip_chars() == "")).sum())
            # Systematic sample: every step-th row of the whole dataset.
            first = (-seen) % step
            if first < n and sum(s.height for s in samples) < sample_rows:
                samples.append(df.gather_every(step, offset=first))
            seen += n
            progress.update(seen)
            del df
    progress.finish()
    if schema is None:
        raise CdataError("NO_ROWS", "This version has no rows.")

    sample = pl.concat(samples, how="vertical") if samples else pl.DataFrame(schema=schema)
    sample = sample.head(sample_rows)
    del samples
    sampled = sample.height

    dup = 0
    if hashes:
        all_h = pl.concat(hashes)
        dup = int(all_h.len() - all_h.n_unique())
        del all_h, hashes

    # Labels.
    labels = None
    if label_col is not None and label_counts:
        counts = sorted(({"value": v, "count": int(c)} for v, c in label_counts.items()), key=lambda x: (-x["count"], x["value"]))
        labels = {"column": label_col, "counts": counts,
                  "balance": round(counts[-1]["count"] / counts[0]["count"], 4) if counts[0]["count"] else None}

    # Text.
    text = None
    if text_e is not None and sampled:
        t = sample.select(text_e)["_t"].fill_null("")
        chars = t.str.len_chars()
        words = t.str.count_matches(r"\S+")
        p99 = chars.quantile(0.99, "linear") or 0
        text = {
            "column": "messages" if "messages" in schema else "text",
            "chars": {"mean": round(float(chars.mean())), "p50": _q(chars, 0.5), "p95": _q(chars, 0.95), "max": int(chars.max())},
            "words": {"mean": round(float(words.mean())), "p50": _q(words, 0.5)},
            "tokensApprox": int(round(float(words.sum()) * (rows / sampled) * 1.3)),
            "empty": int(text_empty),
            "histogram": _histogram(chars, 0.0, float(max(p99, 1)), True),
        }

    # Columns.
    columns = []
    for c in data_cols:
        columns.append(_column_stats(c, schema[c], roles.get(c, "input"), sample, missing[c]))
    missing_cols = sorted(((c, missing[c] / rows) for c in data_cols if rows and missing[c] / rows > MISSING_SHARE),
                          key=lambda x: -x[1])
    single = [col["name"] for col in columns if col["distinct"] == 1 and col["missing"] < rows and rows > 1]

    profile = {
        "rows": rows,
        "sampled": sampled,
        "modality": modality,
        "task": task,
        "duplicates": {"exact": dup},
        "missing": {"cells": int(sum(missing.values())), "rows": int(missing_rows)},
        "labels": labels,
        "splits": split_counts or None,
        "text": text,
        "columns": columns,
        "findings": _findings(rows, modality, task, dup, columns, missing_cols, labels, text, split_counts or None, single),
    }
    protocol.write_json_atomic(version / "profile.json", profile)
    protocol.metric("rows", rows)
    protocol.metric("duplicates", dup)
    protocol.metric("findings", len(profile["findings"]))
    protocol.log(f"Profiled {fmt_int(rows)} rows (sample of {fmt_int(sampled)}); {_plural(len(profile['findings']), 'finding', 'findings')}.")
    slim = dict(profile)
    slim["columns"] = [{k: v for k, v in col.items() if k not in ("histogram", "top")} for col in columns]
    protocol.result(**slim)
