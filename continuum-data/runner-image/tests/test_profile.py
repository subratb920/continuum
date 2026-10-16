import json

from conftest import ingest_params, put, run_cdata


def ingest(store, fixture, **kw):
    put(store, fixture, "raw/r1")
    r = run_cdata("ingest", ingest_params("raw/r1", **kw), store)
    assert r.code == 0, (r.lines, r.stderr)
    return r.result


def profile(store, sample_rows=100000):
    r = run_cdata("profile", {"input": "datasets/ds1/v1", "sampleRows": sample_rows}, store)
    assert r.code == 0, (r.lines, r.stderr)
    on_disk = json.loads((store / "datasets/ds1/v1/profile.json").read_text())
    return r.result, on_disk


def findings(p):
    return {f["id"]: f for f in p["findings"]}


def test_profile_messy_tabular(store):
    ingest(store, "messy.csv")
    res, disk = profile(store)
    assert res["rows"] == 42 and res["sampled"] == 42
    assert res["modality"] == "tabular"
    assert res["duplicates"] == {"exact": 2}  # row 1 appears three times: two extra copies
    f = findings(res)
    for fid in ("exact_duplicates", "missing_values", "imbalanced_labels", "few_rows", "single_value_column"):
        assert fid in f, f
    assert f["exact_duplicates"]["suggest"] == "dedupe"
    assert f["missing_values"]["suggest"] == "fill_missing"
    assert set(f["missing_values"]["columns"]) == {"age", "city"}
    assert f["imbalanced_labels"]["suggest"] == "balance"
    assert f["single_value_column"]["columns"] == ["country"]
    assert "no_label" not in f and "has_splits" not in f
    assert res["labels"]["column"] == "label"
    assert res["labels"]["counts"][0] == {"value": "yes", "count": 38}
    assert res["labels"]["balance"] == round(4 / 38, 4)
    assert res["missing"]["cells"] == 8 + 10
    assert res["text"] is None and res["splits"] is None
    # The result has no histogram/top; profile.json does.
    cols = {c["name"]: c for c in res["columns"]}
    assert "histogram" not in cols["income"] and "top" not in cols["city"]
    dcols = {c["name"]: c for c in disk["columns"]}
    assert len(dcols["income"]["histogram"]) == 10
    assert sum(b["count"] for b in dcols["income"]["histogram"]) == 42
    assert dcols["city"]["top"][0]["count"] >= 1
    assert cols["income"]["min"] == 1000 and cols["income"]["max"] == 1390
    assert cols["income"]["p50"] is not None and cols["income"]["type"] == "integer"
    assert cols["age"]["missing"] == 8
    assert {k: v for k, v in disk.items() if k != "columns"} == {k: v for k, v in res.items() if k not in ("columns", "kind")}
    for item in res["findings"]:
        assert item["message"].endswith(".") and item["severity"] in ("warning", "info")


def test_profile_text_with_splits(store):
    ingest(store, "splits")
    res, disk = profile(store)
    assert res["splits"] in ({"train": 8, "test": 4}, {"test": 4, "train": 8})
    t = res["text"]
    assert t["column"] == "text" and t["empty"] == 0
    assert t["chars"]["p50"] > 40 and t["words"]["mean"] > 5
    assert t["tokensApprox"] > 0
    assert sum(b["count"] for b in t["histogram"]) == 12 and len(t["histogram"]) == 10
    f = findings(res)
    assert "has_splits" in f and "few_rows" in f
    assert "train (8)" in f["has_splits"]["message"]


def test_profile_text_no_label_and_empty(store):
    (store / "raw/r1").mkdir(parents=True)
    rows = [{"text": "a reasonably long piece of text, long enough to count as text data " * 2}] * 3 + [{"text": ""}, {"text": None}]
    (store / "raw/r1/t.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    r = run_cdata("ingest", ingest_params("raw/r1"), store)
    assert r.result["task"] == "generate"
    res, _ = profile(store)
    f = findings(res)
    assert f["empty_text"]["suggest"] == "filter" and res["text"]["empty"] == 2
    assert "no_label" in f
    assert f["exact_duplicates"]["message"].startswith("2 rows are exact copies")


def test_profile_chat(store):
    ingest(store, "alpaca.jsonl")
    res, _ = profile(store)
    assert res["text"]["column"] == "messages" and res["text"]["chars"]["max"] > 10
    assert "no_label" not in findings(res)


def test_profile_sampling(store):
    ingest(store, "iris.csv")
    res, _ = profile(store, sample_rows=10)
    assert res["rows"] == 30 and res["sampled"] == 10
    assert sum(c["count"] for c in res["labels"]["counts"]) == 30  # label counts use every row


def test_profile_very_long_text(store):
    (store / "raw/r1").mkdir(parents=True)
    rows = [{"text": ("word " * 2000) + str(i)} for i in range(20)]
    (store / "raw/r1/t.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    assert run_cdata("ingest", ingest_params("raw/r1"), store).code == 0
    res, _ = profile(store)
    assert findings(res)["very_long_text"]["severity"] == "info"


def test_profile_errors(store):
    r = run_cdata("profile", {"input": "../x"}, store)
    assert r.code == 2
    r = run_cdata("profile", {"input": "datasets/missing"}, store)
    assert r.code == 2
    (store / "datasets/empty").mkdir(parents=True)
    r = run_cdata("profile", {"input": "datasets/empty"}, store)
    assert r.code == 1 and r.error["code"] == "NO_MANIFEST"


def test_profile_rerun_overwrites(store):
    ingest(store, "iris.csv")
    (store / "datasets/ds1/v1/profile.json").write_text("stale")
    profile(store)
    profile(store)
    names = sorted(p.name for p in (store / "datasets/ds1/v1").iterdir())
    assert names == ["data", "manifest.json", "profile.json"]
