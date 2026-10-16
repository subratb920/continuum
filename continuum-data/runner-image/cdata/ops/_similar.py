"""Exact and near copies, found with polars only (no extra packages).

Exact: a hash of the row's content columns. Near (text): MinHash over word
5-grams with LSH banding (64 hashes in 16 bands of 4), so only likely pairs
are compared; a pair counts as a near copy when the share of equal hashes
(the estimated Jaccard similarity) reaches the threshold.
"""

from __future__ import annotations

from typing import Optional

import polars as pl

NUM_HASHES = 64
BANDS = 16
ROWS_PER_BAND = NUM_HASHES // BANDS
SHINGLE = 5


def content_hash(df: pl.DataFrame, columns: list[str]) -> pl.Series:
    """One 64-bit hash per row over ``columns`` (nested values through JSON)."""
    if not columns:
        return pl.Series("h", [0] * df.height, dtype=pl.UInt64)
    return df.select(pl.struct(columns).struct.json_encode().hash(seed=7).alias("h"))["h"]


def exact_groups(df: pl.DataFrame, columns: list[str]) -> pl.Series:
    """For each row, the index of the first row with the same content."""
    h = content_hash(df, columns)
    idx = pl.DataFrame({"h": h, "i": pl.arange(0, df.height, eager=True)})
    first = idx.group_by("h", maintain_order=True).agg(pl.col("i").min().alias("rep"))
    return idx.join(first, on="h", how="left").sort("i")["rep"]


def minhashes(text: pl.Series) -> pl.DataFrame:
    """MinHash signatures: one row per input row (``i``), columns h0 … h63."""
    words = (
        pl.DataFrame({"t": text.fill_null("")})
        .with_row_index("i")
        .with_columns(pl.col("t").str.to_lowercase().str.replace_all(r"[^\w\s]", " ").str.split(" ").alias("w"))
        .select("i", pl.col("w").list.eval(pl.element().filter(pl.element() != "")))
    )
    # Short texts (fewer than 5 words): the whole text is their one shingle
    short = words.filter(pl.col("w").list.len().is_between(1, SHINGLE - 1)).select("i", pl.col("w").list.join(" ").alias("g"))
    long = words.filter(pl.col("w").list.len() >= SHINGLE).explode("w", empty_as_null=True).drop_nulls("w")
    grams = long.with_columns(
        pl.concat_str([pl.col("w").shift(-k).over("i") for k in range(SHINGLE)], separator=" ").alias("g")
    ).drop_nulls("g").select("i", "g")
    grams = pl.concat([grams, short])
    sig = grams.group_by("i").agg([pl.col("g").hash(seed=s + 1).min().alias(f"h{s}") for s in range(NUM_HASHES)])
    all_rows = pl.DataFrame({"i": pl.arange(0, text.len(), eager=True, dtype=pl.UInt32)})
    return all_rows.join(sig, on="i", how="left").sort("i")


def _find(parent: dict, x: int) -> int:
    while parent.get(x, x) != x:
        parent[x] = parent.get(parent[x], parent[x])
        x = parent[x]
    return x


def near_groups(text: pl.Series, threshold: float = 0.8, rows: Optional[pl.Series] = None) -> list[int]:
    """For each row, the index of its group's first row (itself when unique)."""
    n = text.len()
    sig = minhashes(text)
    hcols = [f"h{s}" for s in range(NUM_HASHES)]
    bands = []
    for b in range(BANDS):
        cols = hcols[b * ROWS_PER_BAND:(b + 1) * ROWS_PER_BAND]
        bands.append(sig.select("i", pl.lit(b).alias("b"), pl.struct(cols).hash(seed=b).alias("k")).filter(pl.all_horizontal([sig[c].is_not_null() for c in cols])))
    buckets = pl.concat(bands).group_by("b", "k").agg(pl.col("i").sort()).filter(pl.col("i").list.len() > 1)
    signatures = {r[0]: r[1:] for r in sig.select(["i", *hcols]).iter_rows()}
    parent: dict = {}
    seen = set()
    for members in buckets["i"].to_list():
        rep = members[0]
        for other in members[1:]:
            pair = (rep, other)
            if pair in seen:
                continue
            seen.add(pair)
            a, b = signatures[rep], signatures[other]
            if a[0] is None or b[0] is None:
                continue
            same = sum(1 for x, y in zip(a, b) if x == y) / NUM_HASHES
            if same >= threshold:
                ra, rb = _find(parent, rep), _find(parent, other)
                if ra != rb:
                    parent[max(ra, rb)] = min(ra, rb)
    return [_find(parent, i) for i in range(n)]
