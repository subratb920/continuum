"""split: train / validation / test, with a leakage check."""

from __future__ import annotations

import polars as pl

from .. import protocol
from ..protocol import ParamError, fmt_int, get_param
from . import _similar
from ._version import read_version, text_of, write_version

MODES = ("stratified", "random", "group", "keep")
NAMES = ("train", "validation", "test")


def _assign(n: int, ratios: list[float]) -> list[str]:
    """Split positions 0..n-1 by ratio (largest remainder, so counts add up)."""
    counts = [int(n * r) for r in ratios]
    rest = sorted(range(3), key=lambda k: -(n * ratios[k] - counts[k]))
    for k in rest[: n - sum(counts)]:
        counts[k] += 1
    out = []
    for name, c in zip(NAMES, counts):
        out.extend([name] * c)
    return out


def run(params: dict) -> None:
    v = read_version(params)
    df = v.df
    mode = get_param(params, "mode", str, "stratified" if v.label and v.task == "classify" else "random")
    if mode not in MODES:
        raise ParamError(f"mode must be one of {', '.join(MODES)}.")
    ratios = [float(x) for x in get_param(params, "ratios", list, [0.8, 0.1, 0.1])]
    if len(ratios) != 3 or any(r < 0 for r in ratios) or abs(sum(ratios) - 1) > 1e-6 or ratios[0] == 0:
        raise ParamError("ratios must be three shares (train, validation, test) that add up to 1.")
    seed = get_param(params, "seed", int, 42)
    leakage = get_param(params, "leakageCheck", bool, True)
    notes = []

    df = df.with_row_index("__i")
    if mode == "keep":
        if df["_split"].null_count() == df.height:
            raise ParamError("This dataset has no splits to keep. Choose another way to split it.", "NO_SPLITS")
        df = df.with_columns(pl.col("_split").fill_null("train"))
        notes.append("Kept the splits the data came with.")
    else:
        if mode == "stratified" and not (v.label and v.label in df.columns):
            mode = "random"
        if mode == "group":
            gcol = get_param(params, "groupColumn", str, required=True)
            if gcol not in df.columns:
                raise ParamError(f"No such column: {gcol}.")
            groups = df.select(pl.col(gcol).cast(pl.String).fill_null("")).unique().sample(fraction=1.0, shuffle=True, seed=seed)[gcol]
            names = _assign(groups.len(), ratios)
            mapping = pl.DataFrame({gcol: groups, "_split_new": names})
            df = df.with_columns(pl.col(gcol).cast(pl.String).fill_null("").alias("__gk")).join(mapping.rename({gcol: "__gk"}), on="__gk", how="left").drop("__gk")
            notes.append(f"Rows with the same {gcol} stay on one side.")
        else:
            key = pl.col(v.label).cast(pl.String).fill_null("") if mode == "stratified" else pl.lit("all")
            df = df.with_columns(key.alias("__k"))
            parts = []
            for _, part in df.group_by("__k", maintain_order=True):
                part = part.sample(fraction=1.0, shuffle=True, seed=seed)
                parts.append(part.with_columns(pl.Series("_split_new", _assign(part.height, ratios))))
            df = pl.concat(parts).drop("__k")
            if mode == "stratified":
                notes.append("Every label is split in the same proportions.")
        df = df.with_columns(pl.col("_split_new").alias("_split")).drop("_split_new")
        notes.append(f"Shares {round(ratios[0]*100)} / {round(ratios[1]*100)} / {round(ratios[2]*100)}, shuffle seed {seed}.")

    moved = 0
    if leakage:
        protocol.log("Checking that no copy sits on both sides…")
        df = df.sort("__i")
        base = v.df
        groups = _similar.exact_groups(base, v.content_columns).to_list()
        text = base.select(text_of(v).alias("t"))["t"] if v.text_column else None
        if text is not None:
            near = _similar.near_groups(text, 0.8)
            groups = [min(g, near[i], near[g]) for i, g in enumerate(groups)]
        df = df.with_columns(pl.Series("__g", groups))
        spread = df.group_by("__g").agg(pl.col("_split").n_unique().alias("__n"))
        leaky = df.join(spread, on="__g").filter((pl.col("__n") > 1) & (pl.col("_split") != "train"))
        moved = leaky.height
        if moved:
            df = df.with_columns(pl.when(pl.col("__i").is_in(leaky["__i"].implode())).then(pl.lit("train")).otherwise(pl.col("_split")).alias("_split"))
            notes.append(f"{fmt_int(moved)} rows had a copy on another side and were moved to train, so test scores stay honest.")
        df = df.drop("__g")
    out = df.sort("__i").drop("__i")
    counts = {k: int(n) for k, n in out.group_by("_split").len().iter_rows()}
    protocol.log("Split: " + ", ".join(f"{k} {fmt_int(counts.get(k, 0))}" for k in NAMES if counts.get(k)))
    write_version(v, out, params, op="split", changed=out.height, notes=notes)
