"""redact_pii, safety, balance, to_chat and the dataset card."""

import json
import zipfile

import polars as pl

from conftest import ingest_params, run_cdata


def make(store, rows, header="text,label"):
    d = store / "raw" / "t"
    d.mkdir(parents=True, exist_ok=True)
    (d / "r.csv").write_text("\n".join([header] + rows) + "\n")
    r = run_cdata("ingest", ingest_params("raw/t"), store)
    assert r.code == 0, r.stderr
    return "datasets/ds1/v1"


def table(store, v):
    m = json.loads((store / v / "manifest.json").read_text())
    return pl.concat([pl.read_parquet(store / v / f["path"]) for f in m["files"]]), m


def test_redact_pii(store):
    v1 = make(store, [
        '"Mail me at jo.bloggs@example.com today",a',
        '"Card 4111 1111 1111 1111 please",a',
        '"Not a card 1234 5678 9012 3456 though",a',
        '"Call +44 20 7946 0958 now",b',
        '"Server 192.168.1.20 is down",b',
        '"SSN 123-45-6789 and PAN ABCDE1234F",b',
        '"Aadhaar 2345 6789 0124 is mine",b',
        '"UK mobile 447801259231 here",b',
        '"Nothing private here at all",b',
    ])
    r = run_cdata("redact_pii", {"input": v1, "output": "datasets/ds1/v2"}, store)
    assert r.code == 0, r.stderr
    df, _ = table(store, "datasets/ds1/v2")
    t = df["text"].to_list()
    assert "[EMAIL]" in t[0] and "example.com" not in t[0]
    assert "[CARD]" in t[1]
    assert "[CARD]" not in t[2], "fails the Luhn check, so not a card"
    assert "[PHONE]" in t[3] and "[IP]" in t[4]
    assert "[ID]" in t[5] and "ABCDE1234F" not in t[5]
    assert "[ID]" in t[6], "a valid Aadhaar number (Verhoeff check digit)"
    assert "[PHONE]" in t[7] and "[ID]" not in t[7], "a 12-digit phone number is not an Aadhaar number"
    assert t[8] == "Nothing private here at all"
    assert "pii_redacted" in df["_flags"][0].to_list() and df["_flags"][8].to_list() == []
    notes = r.result["changes"]["notes"]
    assert any("Aadhaar" in n and n.startswith("1 ") for n in notes), notes
    d = run_cdata("redact_pii", {"input": v1, "output": "datasets/ds1/v3", "action": "drop"}, store)
    assert d.result["rows"] < 9


def test_safety_drops_and_never_repeats_text(store):
    v1 = make(store, ['"A lovely film for the family",a', '"what a fucking mess",b', '"Classic, though the word assassin is fine",a'])
    r = run_cdata("safety", {"input": v1, "output": "datasets/ds1/v2"}, store)
    assert r.code == 0, r.stderr
    assert r.result["rows"] == 2
    ch = json.loads((store / "datasets/ds1/v2/changes.json").read_text())
    assert ch["removed"] == 1 and "text" not in ch["sample"][0]["row"]
    f = run_cdata("safety", {"input": v1, "output": "datasets/ds1/v3", "action": "flag", "extraWords": ["family"]}, store)
    df, _ = table(store, "datasets/ds1/v3")
    assert df.height == 3 and sum("unsafe" in x.to_list() for x in df["_flags"]) == 2


def test_balance_under_and_over(store):
    rows = [f'"big text {i}",big' for i in range(90)] + [f'"small text {i}",small' for i in range(10)]
    v1 = make(store, rows)
    u = run_cdata("balance", {"input": v1, "output": "datasets/ds1/v2"}, store)
    assert u.code == 0, u.stderr
    df, _ = table(store, "datasets/ds1/v2")
    assert dict(df.group_by("label").len().iter_rows()) == {"big": 10, "small": 10}
    o = run_cdata("balance", {"input": v1, "output": "datasets/ds1/v3", "method": "over", "targetRatio": 0.5}, store)
    df, _ = table(store, "datasets/ds1/v3")
    c = dict(df.group_by("label").len().iter_rows())
    assert c["big"] == 90 and c["small"] == 45
    assert df["_id"].n_unique() == df.height, "added copies get their own ids"
    # with a split, only train is balanced
    run_cdata("split", {"input": v1, "output": "datasets/ds1/v4"}, store)
    run_cdata("balance", {"input": "datasets/ds1/v4", "output": "datasets/ds1/v5"}, store)
    a, _ = table(store, "datasets/ds1/v4")
    b, _ = table(store, "datasets/ds1/v5")
    assert a.filter(pl.col("_split") == "test").height == b.filter(pl.col("_split") == "test").height


def test_to_chat(store):
    v1 = make(store, ['"What is 2+2?","4"', '"Capital of France?","Paris"'], header="ask,reply")
    r = run_cdata("to_chat", {"input": v1, "output": "datasets/ds1/v2", "promptColumn": "ask", "answerColumn": "reply", "systemPrompt": "Be brief."}, store)
    assert r.code == 0, r.stderr
    df, m = table(store, "datasets/ds1/v2")
    assert m["task"] == "chat" and "ask" not in df.columns
    assert df["messages"][0].to_list() == [{"role": "system", "content": "Be brief."}, {"role": "user", "content": "What is 2+2?"}, {"role": "assistant", "content": "4"}]
    v3 = make(store, ['"great",pos', '"awful",neg'])
    c = run_cdata("to_chat", {"input": v3, "output": "datasets/ds1/v4", "mode": "classify"}, store)
    df, _ = table(store, "datasets/ds1/v4")
    assert df["messages"][0].to_list()[-1] == {"role": "assistant", "content": "pos"}


def test_card_in_export(store):
    v1 = make(store, [f'"text {i}",{"a" if i % 2 else "b"}' for i in range(20)])
    card = {"name": "My spam finder", "goal": "tell spam from normal texts",
            "sources": [{"title": "SMS spam", "ref": "ucirvine/sms_spam", "licence": {"name": "Unknown", "plain": "Fine for learning."}}],
            "history": [{"number": 1, "op": "ingest", "label": "Read and tidy up", "notes": []}, {"number": 2, "op": "dedupe", "label": "Remove copies", "notes": ["3 exact copies"]}],
            "quality": {"score": 70, "verdict": "Nearly there", "gates": [{"title": "Enough rows", "passed": False, "reason": "20 rows."}]}}
    e = run_cdata("export", {"input": v1, "output": "exports/v1", "format": "hf", "card": card}, store)
    assert e.code == 0, e.stderr
    readme = zipfile.ZipFile(store / "exports/v1/hf.zip").read("README.md").decode()
    for want in ("# My spam finder", "Goal: tell spam", "SMS spam (ucirvine/sms_spam)", "2. Remove copies (version 2): 3 exact copies.", "Score 70", "✗ Enough rows", "configs:"):
        assert want in readme, want
