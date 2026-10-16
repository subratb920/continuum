"""balance and to_chat: reshaping a dataset for training."""

from __future__ import annotations

import math

import polars as pl

from .. import protocol
from ..protocol import ParamError, fmt_int, get_param
from ._version import add_flag, read_version, sample_rows, write_version


def run_balance(params: dict) -> None:
    v = read_version(params)
    label = v.label
    if not label or label not in v.df.columns or v.task != "classify":
        raise ParamError("Balancing needs a dataset sorted into labels.", "NO_LABEL")
    method = get_param(params, "method", str, "under")
    if method not in ("under", "over", "both"):
        raise ParamError("method must be 'under', 'over' or 'both'.")
    ratio = float(get_param(params, "targetRatio", (int, float), 1.0))
    if not 0.1 <= ratio <= 1.0:
        raise ParamError("targetRatio must be between 0.1 and 1.")
    seed = get_param(params, "seed", int, 42)

    df = v.df.with_row_index("__i")
    has_split = "_split" in df.columns and df["_split"].null_count() < df.height
    # Only training rows are balanced: validation and test keep the real mix
    pool = df.filter(pl.col("_split").fill_null("train") == "train") if has_split else df
    rest = df.filter(pl.col("_split").fill_null("train") != "train") if has_split else df.head(0)
    counts = dict(pool.group_by(label).len().drop_nulls(label).iter_rows())
    if len(counts) < 2:
        raise ParamError("There is only one label, so there is nothing to balance.", "ONE_LABEL")
    smallest, largest = min(counts.values()), max(counts.values())
    if method == "under":
        cap, floor = math.ceil(smallest / ratio), 0
    elif method == "over":
        cap, floor = largest, math.ceil(largest * ratio)
    else:  # both: meet in the middle
        middle = int(round(math.sqrt(smallest * largest)))
        cap, floor = max(math.ceil(middle / max(ratio, 1e-9)), middle), math.ceil(middle * ratio)
    parts, removed, added, notes = [], 0, 0, []
    for value, group in pool.group_by(label, maintain_order=True):
        n = group.height
        if n > cap:
            group = group.sample(n=cap, seed=seed)
            removed += n - cap
            notes.append(f"{value[0]}: {fmt_int(n)} → {fmt_int(cap)} (some left out)")
        elif n < floor:
            extra = group.sample(n=floor - n, with_replacement=True, seed=seed)
            extra = add_flag(extra, pl.Series([True] * extra.height), "oversampled")
            extra = extra.with_columns((pl.col("_id") + "-o" + pl.int_range(pl.len()).cast(pl.String)).alias("_id"))
            group = pl.concat([group, extra])
            added += floor - n
            notes.append(f"{value[0]}: {fmt_int(n)} → {fmt_int(floor)} (copies added)")
        parts.append(group)
    parts.append(pool.filter(pl.col(label).is_null()))
    out = pl.concat(parts + [rest]).sort("__i").drop("__i")
    if added:
        notes.append("Added copies are marked 'oversampled'. They stay in training only.")
    if has_split:
        notes.append("Only the train rows were balanced; validation and test keep the real mix.")
    elif added:
        notes.append("Split after balancing could put a copy in test. Split first for honest scores.")
    sample = sample_rows(pool.join(out.select("_id").unique(), on="_id", how="anti").drop("__i"), "left out to balance") if removed else []
    protocol.log(f"Balanced {len(counts)} labels.")
    write_version(v, out, params, op="balance", removed=removed, changed=added, sample=sample, notes=notes)


def run_to_chat(params: dict) -> None:
    v = read_version(params)
    mode = get_param(params, "mode", str, "columns")
    if mode not in ("columns", "classify"):
        raise ParamError("mode must be 'columns' or 'classify'.")
    system = get_param(params, "systemPrompt", str, "")
    df = v.df
    if mode == "columns":
        q = get_param(params, "promptColumn", str, required=True)
        a = get_param(params, "answerColumn", str, required=True)
        for c in (q, a):
            if c not in df.columns:
                raise ParamError(f"No such column: {c}.")
        user, assistant = pl.col(q).cast(pl.String), pl.col(a).cast(pl.String)
        used = {q, a}
    else:
        text = get_param(params, "textColumn", str, "text")
        if text not in df.columns or not v.label:
            raise ParamError("Turning labels into answers needs a text column and a label.", "NO_LABEL")
        instruction = get_param(params, "instruction", str, "Which label fits this text?")
        user = pl.concat_str([pl.lit(instruction + "\n\n"), pl.col(text).cast(pl.String)])
        assistant = pl.col(v.label).cast(pl.String)
        used = {text, v.label}
    struct = lambda role, content: pl.struct(pl.lit(role).alias("role"), content.fill_null("").alias("content"))  # noqa: E731
    turns = ([struct("system", pl.lit(system))] if system else []) + [struct("user", user), struct("assistant", assistant)]
    df = df.with_columns(pl.concat_list(turns).alias("messages"))
    keep = ["messages"] + [c for c in df.columns if c.startswith("_")] + [c for c in v.content_columns if c not in used and c != "messages" and not get_param(params, "dropOtherColumns", bool, True)]
    out = df.select(keep)
    empty = out.filter(pl.col("messages").list.last().struct.field("content") == "").height
    notes = [f"Each row is now a chat: {'a system message, ' if system else ''}the question, then the answer."]
    if empty:
        notes.append(f"{fmt_int(empty)} rows have an empty answer. Add a Filter step to remove them.")
    protocol.log(f"Made {fmt_int(out.height)} chats.")
    write_version(v, out, params, op="to_chat", changed=out.height, roles={"messages": "input"}, notes=notes, task="chat")
