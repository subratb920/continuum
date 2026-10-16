"""Images and audio: ingest (folders, metadata, Parquet), profile, clean-up steps, export."""

import io
import json
import math
import struct
import wave
import zipfile

import polars as pl
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from conftest import ingest_params, run_cdata

PIL = pytest.importorskip("PIL.Image")
sf = pytest.importorskip("soundfile")
from PIL import Image  # noqa: E402


def png(color, size=(40, 30), pattern=0):
    im = Image.new("RGB", size, color)
    for x in range(0, size[0], 4 + pattern):
        for y in range(size[1]):
            im.putpixel((x, y), (255 - color[0], 255 - color[1], 255 - color[2]))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def wav(seconds=0.5, rate=22050, freq=440.0):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = b"".join(struct.pack("<hh", int(8000 * math.sin(2 * math.pi * freq * i / rate)), 0) for i in range(int(seconds * rate)))
        w.writeframes(frames)
    return buf.getvalue()


def table(store, v):
    m = json.loads((store / v / "manifest.json").read_text())
    return pl.concat([pl.read_parquet(store / v / f["path"]) for f in m["files"]]), m


def image_folder(store):
    root = store / "raw" / "imgs"
    for split, n in (("train", 6), ("test", 2)):
        for label, color in (("cat", (200, 30, 30)), ("dog", (30, 30, 200))):
            d = root / split / label
            d.mkdir(parents=True, exist_ok=True)
            for i in range(n):
                (d / f"{i}.png").write_bytes(png(color, pattern=i + (10 if split == "test" else 0)))
    (root / "train" / "cat" / "broken.png").write_bytes(b"not an image")
    (root / "train" / "cat" / "copy.png").write_bytes(png((200, 30, 30), pattern=0))  # an exact copy of 0.png
    return "raw/imgs"


def test_image_folder_ingest_profile_and_clean(store):
    r = run_cdata("ingest", ingest_params(image_folder(store)), store)
    assert r.code == 0, r.stderr
    res = r.result
    assert res["modality"] == "image" and res["task"] == "classify"
    assert res["labels"] == ["cat", "dog"] and res["unreadable"] == 1
    assert res["splits"] == {"train": 13, "test": 4}
    df, m = table(store, "datasets/ds1/v1")
    assert df["image"][0].startswith("media/") and (store / "datasets/ds1" / df["image"][0]).exists()
    assert set(df["width"].to_list()) == {40}
    p = run_cdata("profile", {"input": "datasets/ds1/v1"}, store).result
    assert p["media"]["kind"] == "image" and p["media"]["width"]["p50"] == 40
    d = run_cdata("dedupe", {"input": "datasets/ds1/v1", "output": "datasets/ds1/v2", "mode": "exact"}, store)
    assert d.code == 0, d.stderr
    assert d.result["changes"]["removed"] == 1, "the exact copy"
    z = run_cdata("resize", {"input": "datasets/ds1/v2", "output": "datasets/ds1/v3", "size": 16, "mode": "crop"}, store)
    assert z.code == 0, z.stderr
    df3, _ = table(store, "datasets/ds1/v3")
    assert set(df3["width"].to_list()) == {16} and set(df3["height"].to_list()) == {16}
    with Image.open(store / "datasets/ds1" / df3["image"][0]) as im:
        assert im.size == (16, 16)
    a = run_cdata("augment", {"input": "datasets/ds1/v3", "output": "datasets/ds1/v4", "copies": 2}, store)
    assert a.code == 0, a.stderr
    df4, _ = table(store, "datasets/ds1/v4")
    train_before = df3.filter(pl.col("_split") == "train").height
    assert df4.height == df3.height + 2 * train_before
    assert df4.filter(pl.col("_flags").list.contains("augmented"))["_split"].unique().to_list() == ["train"]
    f = run_cdata("filter", {"input": "datasets/ds1/v3", "output": "datasets/ds1/v5", "minWidth": 20, "dropMissingLabel": False}, store)
    assert f.code == 1 and f.error["code"] == "NO_ROWS_LEFT"
    for fmt in ("hf", "imagefolder"):
        e = run_cdata("export", {"input": "datasets/ds1/v3", "output": "exports/v3", "format": fmt}, store)
        assert e.code == 0, e.stderr
        names = zipfile.ZipFile(store / "exports/v3" / f"{fmt}.zip").namelist()
        if fmt == "hf":
            t = pq.read_table(io.BytesIO(zipfile.ZipFile(store / "exports/v3/hf.zip").read("data/train.parquet")))
            cell = t.column("image")[0].as_py()
            assert cell["bytes"][:4] == b"\xff\xd8\xff\xe0" or cell["bytes"][:2] == b"\xff\xd8"
            assert "dtype: image" in zipfile.ZipFile(store / "exports/v3/hf.zip").read("README.md").decode()
        else:
            assert any(n.startswith("train/cat/") for n in names) and any(n.startswith("test/dog/") for n in names)
    bad = run_cdata("export", {"input": "datasets/ds1/v3", "output": "exports/v3", "format": "csv"}, store)
    assert bad.code == 2


def test_image_near_copies(store):
    root = store / "raw" / "near"
    root.mkdir(parents=True)
    base = Image.new("RGB", (64, 64))
    for x in range(64):
        for y in range(64):
            base.putpixel((x, y), (x * 4, y * 4, (x + y) * 2))
    for name, im in (("a", base), ("b", base.copy().point(lambda v: min(255, v + 3))), ("c", base.transpose(Image.Transpose.FLIP_LEFT_RIGHT))):
        buf = io.BytesIO()
        im.save(buf, "PNG")
        (root / f"{name}.png").write_bytes(buf.getvalue())
    assert run_cdata("ingest", ingest_params("raw/near"), store).code == 0
    d = run_cdata("dedupe", {"input": "datasets/ds1/v1", "output": "datasets/ds1/v2"}, store)
    assert d.code == 0, d.stderr
    assert d.result["changes"]["removed"] == 1, "b is a slightly lighter a; c is a mirror image, so different"


def test_hf_style_image_parquet(store):
    d = store / "raw" / "hf" / "train"
    d.mkdir(parents=True)
    schema = pa.schema([("image", pa.struct([("bytes", pa.binary()), ("path", pa.string())])), ("label", pa.int64())],
                       metadata={b"huggingface": json.dumps({"info": {"features": {"label": {"_type": "ClassLabel", "names": ["zero", "one"]}}}}).encode()})
    t = pa.table({"image": [{"bytes": png((i * 20, 0, 0)), "path": f"{i}.png"} for i in range(4)], "label": [0, 1, 0, 1]}, schema=schema)
    pq.write_table(t, d / "0000.parquet")
    r = run_cdata("ingest", ingest_params("raw/hf"), store)
    assert r.code == 0, r.stderr
    assert r.result["modality"] == "image" and r.result["labels"] == ["one", "zero"] and r.result["splits"] == {"train": 4}


def test_audio_folder_with_transcripts_resample_and_export(store):
    root = store / "raw" / "speech"
    root.mkdir(parents=True)
    (root / "a.wav").write_bytes(wav(0.5, 22050, 440))
    (root / "b.wav").write_bytes(wav(0.3, 22050, 660))
    (root / "c.wav").write_bytes(b"RIFFbroken")
    (root / "metadata.csv").write_text("file_name,transcription\na.wav,hello there\nb.wav,good morning\n")
    r = run_cdata("ingest", ingest_params("raw/speech"), store)
    assert r.code == 0, r.stderr
    assert r.result["modality"] == "audio" and r.result["task"] == "transcribe" and r.result["unreadable"] == 1
    df, _ = table(store, "datasets/ds1/v1")
    assert sorted(df["text"].to_list()) == ["good morning", "hello there"]
    assert set(df["sample_rate"].to_list()) == {22050} and set(df["channels"].to_list()) == {2}
    p = run_cdata("profile", {"input": "datasets/ds1/v1"}, store).result
    assert p["media"]["kind"] == "audio" and any(f["id"] == "mixed_rates" for f in p["findings"])
    s = run_cdata("resample", {"input": "datasets/ds1/v1", "output": "datasets/ds1/v2"}, store)
    assert s.code == 0, s.stderr
    df2, _ = table(store, "datasets/ds1/v2")
    assert set(df2["sample_rate"].to_list()) == {16000} and set(df2["channels"].to_list()) == {1}
    data, rate = sf.read(str(store / "datasets/ds1" / df2.sort("text")["audio"][1]))
    assert rate == 16000 and abs(len(data) / rate - 0.5) < 0.01
    f = run_cdata("filter", {"input": "datasets/ds1/v2", "output": "datasets/ds1/v3", "minSeconds": 0.4}, store)
    assert f.result["rows"] == 1
    a = run_cdata("augment", {"input": "datasets/ds1/v2", "output": "datasets/ds1/v4", "copies": 1}, store)
    assert a.code == 0 and a.result["rows"] == 4
    e = run_cdata("export", {"input": "datasets/ds1/v2", "output": "exports/v2", "format": "audiofolder"}, store)
    assert e.code == 0, e.stderr
    z = zipfile.ZipFile(store / "exports/v2/audiofolder.zip")
    meta = z.read("data/metadata.csv").decode()
    assert "file_name" in meta and "hello there" in meta
