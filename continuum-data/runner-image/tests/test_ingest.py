import hashlib
import json

import polars as pl
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from conftest import ingest_params, put, run_cdata

META = ["_id", "_source", "_licence", "_split", "_flags"]


def read_version(store, rel="datasets/ds1/v1"):
    root = store / rel
    manifest = json.loads((root / "manifest.json").read_text())
    df = pl.concat([pl.read_parquet(root / f["path"]) for f in manifest["files"]])
    return manifest, df


def check_meta(df, manifest):
    for c in META:
        assert c in df.columns
    assert df.schema["_id"] == pl.String
    assert df.schema["_flags"] == pl.List(pl.String)
    assert df["_source"].unique().to_list() == ["abc123"]
    assert df["_licence"].unique().to_list() == ["cc-by-4.0"]
    assert all(len(x) == 16 for x in df["_id"].to_list())
    assert all(f == [] for f in df["_flags"].to_list())
    roles = {c["name"]: c["role"] for c in manifest["schema"]}
    for c in META:
        assert roles[c] == "meta"


def check_parquet_files(store, manifest, rel="datasets/ds1/v1"):
    for f in manifest["files"]:
        path = store / rel / f["path"]
        assert f["path"].startswith("data/part-") and f["path"].endswith(".parquet")
        assert hashlib.sha256(path.read_bytes()).hexdigest() == f["sha256"]
        assert path.stat().st_size == f["bytes"]
        md = pq.ParquetFile(path).metadata
        for rg in range(md.num_row_groups):
            for col in range(md.num_columns):
                assert md.row_group(rg).column(col).compression == "SNAPPY"


def test_tabular_iris(store):
    put(store, "iris.csv", "raw/r1")
    r = run_cdata("ingest", ingest_params("raw/r1"), store)
    assert r.code == 0, r.lines
    res = r.result
    assert res["rows"] == 30 and res["modality"] == "tabular" and res["task"] == "classify"
    assert res["labels"] == ["setosa", "versicolor", "virginica"]
    assert res["splits"] is None
    schema = {c["name"]: c for c in res["schema"]}
    assert schema["species"]["role"] == "label" and schema["species"]["type"] == "string"
    assert schema["sepal_length"]["type"] == "float" and schema["sepal_length"]["role"] == "input"
    manifest, df = read_version(store)
    check_meta(df, manifest)
    check_parquet_files(store, manifest)
    assert manifest["format"] == "continuum-data/1"
    assert manifest["dataset"] == "ds1" and manifest["version"] == "v1"
    assert manifest["licences"] == [{"spdx": "cc-by-4.0", "rows": 30}]
    assert res["bytes"] == sum(f["bytes"] for f in manifest["files"])
    assert r.kinds("progress") and r.kinds("metric")
    assert not (store / "datasets/ds1/v1.partial").exists()


def test_row_id_is_hash_of_source_and_row(store):
    put(store, "iris.csv", "raw/r1")
    assert run_cdata("ingest", ingest_params("raw/r1"), store).code == 0
    _, df = read_version(store)
    first = pl.read_csv(store / "raw/r1/iris.csv").head(1)
    row_json = first.select(pl.struct(pl.all()).struct.json_encode())[0, 0]
    assert df["_id"][0] == hashlib.sha256(("abc123\n" + row_json).encode()).hexdigest()[:16]


def test_text_classification(store):
    put(store, "text_cls.csv", "raw/r1")
    r = run_cdata("ingest", ingest_params("raw/r1"), store)
    res = r.result
    assert res["modality"] == "text" and res["task"] == "classify"
    assert res["labels"] == ["neg", "pos"]
    names = [c["name"] for c in res["schema"]]
    assert names == ["text", "label"] + META
    manifest, df = read_version(store)
    assert df.schema["text"] == pl.String and df.schema["label"] == pl.String
    assert df.height == 12
    check_meta(df, manifest)


def test_text_column_param_and_unknown_column(store):
    put(store, "text_cls.csv", "raw/r1")
    r = run_cdata("ingest", ingest_params("raw/r1", textColumn="nope"), store)
    assert r.code == 2 and r.error["code"] == "BAD_PARAMS"


def test_alpaca_instruction_to_messages(store):
    put(store, "alpaca.jsonl", "raw/r1")
    r = run_cdata("ingest", ingest_params("raw/r1"), store)
    res = r.result
    assert res["modality"] == "text" and res["task"] == "chat" and res["labels"] is None
    _, df = read_version(store)
    assert df.schema["messages"] == pl.List(pl.Struct({"role": pl.String, "content": pl.String}))
    first = df["messages"][0].to_list()
    assert first == [{"role": "user", "content": "Translate the sentence to French.\n\nGood morning, my friend."},
                     {"role": "assistant", "content": "Bonjour, mon ami."}]
    second = df["messages"][1].to_list()
    assert second[0]["content"] == "Name three primary colours."  # empty input is not appended


def test_chat_messages(store):
    put(store, "chat.jsonl", "raw/r1")
    res = run_cdata("ingest", ingest_params("raw/r1"), store).result
    assert res["task"] == "chat"
    _, df = read_version(store)
    assert [m["role"] for m in df["messages"][0].to_list()] == ["system", "user", "assistant"]
    assert df.columns == ["messages"] + META


def test_sharegpt_conversations(store):
    put(store, "sharegpt.json", "raw/r1")
    res = run_cdata("ingest", ingest_params("raw/r1"), store).result
    assert res["task"] == "chat" and res["rows"] == 2
    _, df = read_version(store)
    msgs = df["messages"][1].to_list()
    assert msgs == [{"role": "system", "content": "Be brief."}, {"role": "user", "content": "Capital of France?"},
                    {"role": "assistant", "content": "Paris."}]


def _write_label_parquet(path, hf_metadata=False):
    table = pa.table({"text": ["good movie, really enjoyed it a lot", "bad movie, did not like it at all",
                               "no label here for this one, unknown", "great!"],
                      "label": pa.array([1, 0, -1, 1], type=pa.int64())})
    if hf_metadata:
        meta = {"info": {"features": {"text": {"dtype": "string", "_type": "Value"},
                                      "label": {"names": ["neg", "pos"], "_type": "ClassLabel"}}}}
        table = table.replace_schema_metadata({b"huggingface": json.dumps(meta).encode()})
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, path)


def test_parquet_integer_labels_with_names(store):
    _write_label_parquet(store / "raw/r1/train/0000.parquet")
    res = run_cdata("ingest", ingest_params("raw/r1", labelNames=["neg", "pos"]), store).result
    assert res["task"] == "classify" and res["labels"] == ["neg", "pos"]
    assert res["splits"] == {"train": 4}
    _, df = read_version(store)
    assert df["label"].to_list() == ["pos", "neg", None, "pos"]
    assert df["_split"].unique().to_list() == ["train"]


def test_parquet_label_names_from_hf_metadata(store):
    _write_label_parquet(store / "raw/r1/data/train-00000-of-00001.parquet", hf_metadata=True)
    res = run_cdata("ingest", ingest_params("raw/r1"), store).result
    assert res["labels"] == ["neg", "pos"]
    assert res["splits"] == {"train": 4}


def test_split_folders(store):
    put(store, "splits", "raw/r1")
    res = run_cdata("ingest", ingest_params("raw/r1"), store).result
    assert res["splits"] == {"test": 4, "train": 8} or res["splits"] == {"train": 8, "test": 4}
    _, df = read_version(store)
    assert sorted(df["_split"].unique().to_list()) == ["test", "train"]


def test_keep_splits_false(store):
    put(store, "splits", "raw/r1")
    res = run_cdata("ingest", ingest_params("raw/r1", keepSplits=False), store).result
    assert res["splits"] is None
    _, df = read_version(store)
    assert df["_split"].null_count() == df.height


def _write_pdf(path, text):
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    w = PdfWriter()
    page = w.add_blank_page(width=300, height=200)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"),
                             NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): w._add_object(font)})})
    stream = DecodedStreamObject()
    stream.set_data(f"BT /F1 12 Tf 20 100 Td ({text}) Tj ET".encode())
    page[NameObject("/Contents")] = w._add_object(stream)
    with open(path, "wb") as f:
        w.write(f)


def test_documents(store):
    put(store, "docs", "raw/r1")
    _write_pdf(store / "raw/r1/d.pdf", "Hello from a PDF")
    res = run_cdata("ingest", ingest_params("raw/r1"), store).result
    assert res["modality"] == "text" and res["task"] == "generate" and res["rows"] == 4
    _, df = read_version(store)
    rows = {r["title"]: r["text"] for r in df.select("title", "text").to_dicts()}
    assert set(rows) == {"a.txt", "b.md", "c.html", "d.pdf"}  # hidden and __MACOSX skipped
    assert "two lines" in rows["a.txt"]
    assert rows["b.md"].startswith("# Notes")
    html = rows["c.html"]
    assert "Hello & welcome" in html and "visible text" in html and "One\n\nTwo" in html
    assert "hidden" not in html and "color" not in html and "Ignored title" not in html and "no script" not in html
    assert "Hello from a PDF" in rows["d.pdf"]


def test_max_rows_and_parts(store):
    put(store, "iris.csv", "raw/r1")
    r = run_cdata("ingest", ingest_params("raw/r1", maxRows=25), store,
                  env={"CDATA_PART_ROWS": "10", "CDATA_BATCH_ROWS": "7"})
    assert r.result["rows"] == 25
    manifest, df = read_version(store)
    assert [f["path"] for f in manifest["files"]] == ["data/part-00000.parquet", "data/part-00001.parquet", "data/part-00002.parquet"]
    assert df.height == 25
    check_parquet_files(store, manifest)


def test_path_escape_refused(store):
    put(store, "iris.csv", "raw/r1")
    for bad in ({"input": "../outside"}, {"input": "/etc"}, {"output": "datasets/../../x"}):
        r = run_cdata("ingest", {**ingest_params("raw/r1"), **bad}, store)
        assert r.code == 2, r.lines
        assert r.error["code"] == "PATH_OUTSIDE_STORE"


def test_symlink_escape_refused(store, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (store / "raw").mkdir()
    (store / "raw" / "link").symlink_to(outside)
    r = run_cdata("ingest", ingest_params("raw/link"), store)
    assert r.code == 2 and r.error["code"] == "PATH_OUTSIDE_STORE"


def test_bad_params_exit_2(store):
    r = run_cdata("ingest", {"input": "raw/x"}, store)
    assert r.code == 2
    r = run_cdata("ingest", None, store)
    assert r.code == 2
    r = run_cdata("nope", {}, store)
    assert r.code == 2
    import os, subprocess, sys
    env = {**os.environ, "CDATA_STORE": str(store), "CDATA_PARAMS": "{not json"}
    p = subprocess.run([sys.executable, "-m", "cdata", "ingest"], env=env, capture_output=True, text=True)
    assert p.returncode == 2 and json.loads(p.stdout.splitlines()[-1])["kind"] == "error"


def test_rerun_replaces_stale_output(store):
    put(store, "iris.csv", "raw/r1")
    out = store / "datasets/ds1/v1"
    stale_partial = store / "datasets/ds1/v1.partial"
    (out / "data").mkdir(parents=True)
    (out / "data" / "part-00009.parquet").write_text("stale")
    (out / "junk.txt").write_text("stale")
    stale_partial.mkdir(parents=True)
    (stale_partial / "half-written").write_text("crash")
    assert run_cdata("ingest", ingest_params("raw/r1"), store).code == 0
    assert not stale_partial.exists()
    assert not (out / "junk.txt").exists()
    assert sorted(p.name for p in (out / "data").iterdir()) == ["part-00000.parquet"]
    # And a second rerun still leaves exactly one result.
    assert run_cdata("ingest", ingest_params("raw/r1"), store).code == 0
    assert sorted(p.name for p in (store / "datasets/ds1").iterdir()) == ["v1"]


def test_failed_ingest_leaves_no_partial(store):
    (store / "raw/r1").mkdir(parents=True)
    (store / "raw/r1/readme.bin").write_bytes(b"\x00\x01")
    r = run_cdata("ingest", ingest_params("raw/r1"), store)
    assert r.code == 1 and r.error["code"] == "NO_DATA"
    assert not (store / "datasets/ds1/v1").exists() and not (store / "datasets/ds1/v1.partial").exists()


def test_regression_task(store):
    rows = ["x,y"] + [f"{i},{i * 1.5 + 0.1}" for i in range(80)]
    (store / "raw/r1").mkdir(parents=True)
    (store / "raw/r1/reg.csv").write_text("\n".join(rows) + "\n")
    res = run_cdata("ingest", ingest_params("raw/r1"), store).result
    assert res["modality"] == "tabular" and res["task"] == "regress" and res["labels"] is None


def test_underscore_columns_are_renamed(store):
    (store / "raw/r1").mkdir(parents=True)
    (store / "raw/r1/t.csv").write_text("_id,a,label\n1,2,x\n2,3,y\n")
    res = run_cdata("ingest", ingest_params("raw/r1"), store).result
    names = [c["name"] for c in res["schema"]]
    assert names == ["id", "a", "label"] + META


def _write_xlsx(path, header, rows):
    """A minimal .xlsx (inline strings) without extra libraries."""
    import zipfile
    from xml.sax.saxutils import escape

    def cell(ref, v):
        if isinstance(v, (int, float)):
            return f'<c r="{ref}"><v>{v}</v></c>'
        return f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(v))}</t></is></c>'

    xml_rows = []
    for i, row in enumerate([header] + rows, start=1):
        cells = "".join(cell(f"{chr(65 + j)}{i}", v) for j, v in enumerate(row))
        xml_rows.append(f'<row r="{i}">{cells}</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    files = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="rId1" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": f'<?xml version="1.0" encoding="UTF-8"?><workbook {ns} xmlns:r="{rel}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="rId1" Type="{rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml": f'<?xml version="1.0" encoding="UTF-8"?><worksheet {ns}><sheetData>{"".join(xml_rows)}</sheetData></worksheet>',
    }
    with zipfile.ZipFile(path, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)


def test_tsv(store):
    (store / "raw/r1").mkdir(parents=True)
    pl.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "x"]}).write_csv(store / "raw/r1/t.tsv", separator="\t")
    res = run_cdata("ingest", ingest_params("raw/r1"), store).result
    assert res["rows"] == 3 and res["task"] == "classify" and res["labels"] == ["x", "y"]


def test_xlsx(store):
    (store / "raw/r1").mkdir(parents=True)
    _write_xlsx(store / "raw/r1/sheet.xlsx", ["height", "weight", "label"], [[1.7, 60, "a"], [1.8, 80, "b"], [1.6, 55, "a"]])
    res = run_cdata("ingest", ingest_params("raw/r1"), store).result
    assert res["rows"] == 3 and res["modality"] == "tabular" and res["labels"] == ["a", "b"]
    _, df = read_version(store)
    assert df["height"].to_list() == [1.7, 1.8, 1.6]


def test_stdout_is_only_json_even_with_prints(store, monkeypatch):
    """A stray print inside an op must land on stderr, not stdout."""
    import os, subprocess, sys
    from conftest import ROOT
    code = ("import cdata.protocol as p, cdata.cli as c, sys\n"
            "def run(op, params):\n    print('noise'); p.result(ok=True)\n"
            "c.run = run\nsys.exit(c.main(['x']))\n")
    proc = subprocess.run([sys.executable, "-c", code], env={**os.environ, "PYTHONPATH": str(ROOT)}, capture_output=True, text=True)
    assert proc.returncode == 0
    assert [json.loads(line)["kind"] for line in proc.stdout.splitlines()] == ["result"]
    assert "noise" in proc.stderr
