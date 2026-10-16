"""dedupe: remove exact copies, and near copies of text."""

from __future__ import annotations

import polars as pl

from .. import protocol
from ..protocol import ParamError, fmt_int, get_param
from . import _similar
from ._version import read_version, sample_rows, text_of, write_version

KEEP = ("first", "longest", "shortest")


def run(params: dict) -> None:
    v = read_version(params)
    can_near = v.modality == "image" or (v.text_column is not None and v.modality != "audio")
    mode = get_param(params, "mode", str, "near" if can_near else "exact")
    if mode not in ("exact", "near"):
        raise ParamError("mode must be 'exact' or 'near'.")
    if mode == "near" and not can_near:
        mode = "exact"
    threshold = float(get_param(params, "threshold", (int, float), 0.97 if v.modality == "image" else 0.8))
    if not 0.5 <= threshold <= 1.0:
        raise ParamError("threshold must be between 0.5 and 1.")
    keep = get_param(params, "keep", str, "first")
    if keep not in KEEP:
        raise ParamError(f"keep must be one of {', '.join(KEEP)}.")

    protocol.log("Looking for exact copies…")
    content = [c for c in v.content_columns if v.roles.get(c) != "meta"]
    exact = _similar.exact_groups(v.df, content).to_list()
    if v.modality == "image" and mode == "near":
        protocol.log("Looking for near copies (pictures that look almost the same)…")
        labels = v.df[v.label].cast(pl.String).to_list() if v.label and v.label in v.df.columns else None
        near = _similar.image_groups(v.path.parent, v.df["image"].to_list(), threshold, labels)
    group = exact
    text = v.df.select(text_of(v).alias("t"))["t"] if v.text_column else None
    if mode == "near":
        if v.modality != "image":
            protocol.log("Looking for near copies (texts that say almost the same)…")
            near = _similar.near_groups(text, threshold)
        # One group per row: its exact group's first row, joined through near copies
        parent = list(range(len(exact)))

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for i, (e, n) in enumerate(zip(exact, near)):
            for other in (e, n):
                a, b = find(i), find(other)
                if a != b:
                    parent[max(a, b)] = min(a, b)
        group = [find(i) for i in range(len(exact))]

    df = v.df.with_columns(pl.Series("__g", group), pl.arange(0, v.df.height, eager=True).alias("__i"),
                           pl.Series("__exact", [e != i for i, e in enumerate(exact)]))
    if keep != "first" and text is not None:
        df = df.with_columns(text.str.len_chars().alias("__len"))
        df = df.with_columns(pl.col("__len").rank("ordinal", descending=(keep == "longest")).over("__g").alias("__rank"))
        kept = pl.col("__rank") == 1
    else:
        kept = pl.col("__i") == pl.col("__i").min().over("__g")
    df = df.with_columns(kept.alias("__keep"))
    dropped = df.filter(~pl.col("__keep"))
    sample = []
    for row in dropped.head(50).iter_rows(named=True):
        why = "exact copy" if row["__exact"] else "near copy"
        sample.extend(sample_rows(pl.DataFrame([{k: row[k] for k in v.df.columns}], schema=v.df.schema), why, 1))
    out = df.filter(pl.col("__keep")).select(v.df.columns)
    removed = v.df.height - out.height
    exact_removed = int(dropped["__exact"].sum()) if removed else 0
    notes = []
    if removed:
        notes.append(f"{fmt_int(exact_removed)} exact copies")
        if mode == "near":
            notes.append(f"{fmt_int(removed - exact_removed)} near copies (at least {round(threshold * 100)}% the same)")
        notes.append(f"Kept the {keep} row of each group.")
    if v.modality == "audio":
        notes.append("For audio, only exact copies are found so far.")
    protocol.log(f"Removed {fmt_int(removed)} copies; {fmt_int(out.height)} rows left." if removed else "No copies found.")
    write_version(v, out, params, op="dedupe", removed=removed, sample=sample, notes=notes)
