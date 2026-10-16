"""dedupe, filter, fix_types, fill_missing, outliers, split, validate, export."""

import json
import zipfile

import pyarrow.parquet as pq
import pytest

from conftest import ingest_params, put, run_cdata

BASE = "Movies are wonderful and this one has a story about a brave dog who finds the way home through the snowy mountains"


def make_text(store, rows, name="reviews.csv"):
    d = store / "raw" / "t"
    d.mkdir(parents=True, exist_ok=True)
    lines = ["text,label"] + [f'"{t}",{l}' for t, l in rows]
    (d / name).write_text("\n".join(lines) + "\n")
    r = run_cdata("ingest", ingest_params("raw/t"), store)
    assert r.code == 0, r.stderr
    return "datasets/ds1/v1"


def rows_of(store, version):
    m = json.loads((store / version / "manifest.json").read_text())
    import polars as pl
    return pl.concat([pl.read_parquet(store / version / f["path"]) for f in m["files"]]), m


def test_dedupe_exact_and_near(store):
    rows = [(f"Review number {i} says the film was {'good' if i % 2 else 'bad'} in its own words {i * 7}", "pos" if i % 2 else "neg") for i in range(40)]
    rows += [rows[0], rows[1]]  # two exact copies
    rows += [(BASE, "pos"), (BASE + " again", "pos"), (BASE.replace("brave", "brave"), "pos")]  # one exact + one near
    v1 = make_text(store, rows)
    r = run_cdata("dedupe", {"input": v1, "output": "datasets/ds1/v2"}, store)
    assert r.code == 0, r.stderr
    df, m = rows_of(store, "datasets/ds1/v2")
    assert r.result["changes"]["removed"] == 4
    assert df.height == 41
    ch = json.loads((store / "datasets/ds1/v2/changes.json").read_text())
    assert ch["before"] == 45 and ch["after"] == 41 and ch["removed"] == 4
    assert {s["reason"] for s in ch["sample"]} == {"exact copy", "near copy"}
    assert m["parent"] == "v1" and m["madeBy"] == "dedupe"
    # exact only keeps the near copy
    r = run_cdata("dedupe", {"input": v1, "output": "datasets/ds1/v3", "mode": "exact"}, store)
    assert r.result["changes"]["removed"] == 3


def test_filter_rules_and_condition(store):
    rows = [("ok text that is long enough to keep", "a")] * 1 + [("short", "a"), ("!!!! ???? ####", "b"), (" ", "b")] + [(f"another good text number {i}", "b") for i in range(5)]
    v1 = make_text(store, rows)
    r = run_cdata("filter", {"input": v1, "output": "datasets/ds1/v2", "minChars": 10, "maxSymbolShare": 0.5}, store)
    assert r.code == 0, r.stderr
    df, _ = rows_of(store, "datasets/ds1/v2")
    assert df.height == 6
    ch = json.loads((store / "datasets/ds1/v2/changes.json").read_text())
    assert ch["removed"] == 3 and any("empty" in n for n in ch["notes"])
    bad = run_cdata("filter", {"input": v1, "output": "datasets/ds1/v3", "keepWhere": "label = = 'a'"}, store)
    assert bad.code == 2 and bad.error["code"] == "BAD_CONDITION"
    good = run_cdata("filter", {"input": v1, "output": "datasets/ds1/v4", "dropEmpty": False, "keepWhere": "label = 'a'"}, store)
    assert good.result["rows"] == 2


def test_table_fixes(store):
    put(store, "messy.csv", "raw/m")
    assert run_cdata("ingest", ingest_params("raw/m"), store).code == 0
    r = run_cdata("fill_missing", {"input": "datasets/ds1/v1", "output": "datasets/ds1/v2"}, store)
    assert r.code == 0, r.stderr
    df, _ = rows_of(store, "datasets/ds1/v2")
    assert df["age"].null_count() == 0 and df["city"].null_count() == 0
    assert r.result["changes"]["changed"] == 18
    o = run_cdata("outliers", {"input": "datasets/ds1/v2", "output": "datasets/ds1/v3", "action": "drop", "columns": ["income"]}, store)
    assert o.code == 0, o.stderr
    t = run_cdata("fix_types", {"input": "datasets/ds1/v1", "output": "datasets/ds1/v4"}, store)
    assert t.code == 0, t.stderr


def test_split_stratified_without_leakage(store):
    rows = [(f"text {i} about {'cats' if i % 4 else 'dogs'} with words {i}", "cat" if i % 4 else "dog") for i in range(200)]
    rows += [rows[5]] * 3
    v1 = make_text(store, rows)
    r = run_cdata("split", {"input": v1, "output": "datasets/ds1/v2", "keepSplits": False}, store)
    assert r.code == 0, r.stderr
    df, m = rows_of(store, "datasets/ds1/v2")
    s = m["splits"]
    assert sum(s.values()) == 203 and s["validation"] > 0 and s["test"] > 0
    # copies all end up on one side
    copies = df.filter(df["text"] == rows[5][0])
    assert copies["_split"].n_unique() == 1
    # stratified: dog share similar in train and test
    import polars as pl
    share = df.group_by("_split").agg((pl.col("label") == "dog").mean().alias("d"))
    vals = dict(share.iter_rows())
    assert abs(vals["train"] - vals["test"]) < 0.08
    again = run_cdata("split", {"input": v1, "output": "datasets/ds1/v3"}, store)
    df2, _ = rows_of(store, "datasets/ds1/v3")
    assert df2["_split"].to_list() == df["_split"].to_list(), "same seed, same split"


def test_validate_and_export(store):
    rows = [(f"text {i} {'cats' if i % 2 else 'dogs'} {i}", "cat" if i % 2 else "dog") for i in range(300)]
    v1 = make_text(store, rows)
    q1 = run_cdata("validate", {"input": v1}, store).result
    assert not next(g for g in q1["gates"] if g["id"] == "has_test_split")["passed"]
    run_cdata("split", {"input": v1, "output": "datasets/ds1/v2"}, store)
    q2 = run_cdata("validate", {"input": "datasets/ds1/v2"}, store).result
    assert q2["score"] > q1["score"]
    assert json.loads((store / "datasets/ds1/v2/quality.json").read_text())["score"] == q2["score"]
    for fmt in ("parquet", "csv", "jsonl", "hf"):
        e = run_cdata("export", {"input": "datasets/ds1/v2", "output": "exports/v2", "format": fmt}, store)
        assert e.code == 0, e.stderr
        z = zipfile.ZipFile(store / "exports/v2" / f"{fmt}.zip")
        names = z.namelist()
        assert "README.md" in names and "manifest.json" in names
        if fmt == "hf":
            assert "data/train.parquet" in names and "configs:" in z.read("README.md").decode()
            z.extract("data/test.parquet", store / "x")
            t = pq.read_table(store / "x/data/test.parquet")
            assert set(t.column_names) == {"text", "label"}


def test_no_rows_left_is_refused(store):
    v1 = make_text(store, [("tiny", "a"), ("wee", "b")])
    r = run_cdata("filter", {"input": v1, "output": "datasets/ds1/v2", "minChars": 100}, store)
    assert r.code == 1 and r.error["code"] == "NO_ROWS_LEFT"
    assert not (store / "datasets/ds1/v2").exists()
