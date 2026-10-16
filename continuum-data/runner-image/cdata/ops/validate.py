"""validate: quality gates and a 0-100 score; writes ``<input>/quality.json``."""

from __future__ import annotations

import polars as pl

from .. import protocol
from ..protocol import fmt_int, get_param
from . import _similar
from ._version import read_version, text_of

UNKNOWN_LICENCES = {"unknown", "", None}


def _gate(gid, title, passed, reason, weight, fix=None):
    return {"id": gid, "title": title, "passed": bool(passed), "reason": reason, "weight": weight, "fix": fix}


def run(params: dict) -> None:
    v = read_version(params)
    df = v.df
    min_per_label = get_param(params, "minRowsPerLabel", int, 100)
    min_rows = get_param(params, "minRows", int, 1000 if v.modality == "text" else 100)
    max_missing = float(get_param(params, "maxMissingShare", (int, float), 0.2))
    gates = []

    n = df.height
    gates.append(_gate("enough_rows", "Enough rows", n >= min_rows,
                       f"{fmt_int(n)} rows." + ("" if n >= min_rows else f" Most models need at least {fmt_int(min_rows)}."), 20))

    label = v.label if v.label in df.columns else None
    if label and v.task == "classify":
        counts = df.group_by(pl.col(label).cast(pl.String)).len().drop_nulls(label)
        small = counts.filter(pl.col("len") < min_per_label)
        gates.append(_gate("enough_per_label", "Enough examples of each label", small.height == 0,
                           "Every label has at least " + fmt_int(min_per_label) + " rows." if small.height == 0
                           else f"{small.height} label(s) have fewer than {fmt_int(min_per_label)} rows: " + ", ".join(f"{a} ({fmt_int(b)})" for a, b in small.head(5).iter_rows()) + ".", 15))
        lo, hi = (counts["len"].min() or 0), (counts["len"].max() or 1)
        balance = lo / hi if hi else 0
        gates.append(_gate("balanced", "Labels are balanced", balance >= 0.1,
                           f"The smallest label has {round(balance*100)}% as many rows as the largest." + ("" if balance >= 0.1 else " The model may ignore the small ones."), 10, "balance"))
        missing_label = df[label].null_count()
        gates.append(_gate("labelled", "Every row has a label", missing_label == 0,
                           "All rows are labelled." if not missing_label else f"{fmt_int(missing_label)} rows have no label.", 10, "filter"))

    inputs = [c for c in v.content_columns if c != label]
    worst = None
    for c in inputs:
        share = df[c].null_count() / n if n else 0
        if worst is None or share > worst[1]:
            worst = (c, share)
    ok = worst is None or worst[1] <= max_missing
    gates.append(_gate("few_missing", "Few empty cells", ok,
                       "No input column is more than " + f"{round(max_missing*100)}% empty." if ok else f"{worst[0]} is {round(worst[1]*100)}% empty.", 10, "fill_missing"))

    exact = _similar.exact_groups(df, v.content_columns)
    dups = n - exact.n_unique()
    gates.append(_gate("no_copies", "No copies", dups == 0,
                       "No row is an exact copy of another." if not dups else f"{fmt_int(dups)} rows are exact copies.", 10, "dedupe"))

    has_split = "_split" in df.columns and df["_split"].null_count() < n
    splits = {k: int(c) for k, c in df.group_by("_split").len().drop_nulls("_split").iter_rows()} if has_split else {}
    test_side = splits.get("test", 0) + splits.get("validation", 0)
    gates.append(_gate("has_test_split", "Rows kept aside for testing", test_side > 0,
                       f"{fmt_int(test_side)} rows kept aside to check the model." if test_side else "Nothing is kept aside to check the model on. Add a Split step.", 10, "split"))
    if test_side:
        g = df.with_columns(exact.alias("__g")).group_by("__g").agg(pl.col("_split").n_unique().alias("k"))
        leaks = int((g["k"] > 1).sum())
        gates.append(_gate("no_leakage", "No copies across splits", leaks == 0,
                           "No row in test has a copy in train." if not leaks else f"{fmt_int(leaks)} rows have a copy on another side, so test scores would look better than they are.", 10, "split"))

    licences = df["_licence"].unique().to_list() if "_licence" in df.columns else []
    unknown = [l for l in licences if l in UNKNOWN_LICENCES]
    gates.append(_gate("licences_known", "Licences known", not unknown,
                       "Every row's licence is known." if not unknown else "Some rows have no licence. Fine for learning; ask the author before sharing what you make.", 5))

    text = text_of(v)
    if text is not None:
        empty = int(df.select((text.str.strip_chars() == "").sum().alias("e"))["e"][0])
        gates.append(_gate("no_empty_text", "No empty texts", empty == 0,
                           "Every row has text." if not empty else f"{fmt_int(empty)} rows have no text.", 10, "filter"))

    total = sum(g["weight"] for g in gates)
    score = round(100 * sum(g["weight"] for g in gates if g["passed"]) / total) if total else 0
    passed = sum(1 for g in gates if g["passed"])
    verdict = "Ready to train" if score >= 85 else "Nearly there" if score >= 60 else "Needs work"
    quality = {"score": score, "verdict": verdict, "passed": passed, "total": len(gates), "gates": gates}
    protocol.write_json_atomic(v.path / "quality.json", quality)
    protocol.log(f"Quality score {score}: {verdict.lower()} ({passed} of {len(gates)} checks passed).")
    protocol.result(**quality)
