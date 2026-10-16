"""ingest for images and audio (D3).

Two layouts are understood:

- **Folders of files**: ``cat/001.jpg`` (the folder names the label), with
  ``train/`` / ``test/`` folders for splits, or Hugging Face's imagefolder /
  audiofolder layout with a ``metadata.csv`` or ``metadata.jsonl`` that has a
  ``file_name`` column (and the label or transcript in its other columns).
- **Parquet with the media inside** (Hugging Face Image and Audio columns: a
  struct of ``bytes`` and ``path``), plus label and text columns.

Each file is checked (unreadable ones are left out and counted), stored once
in the dataset's media folder, and becomes a row: ``image`` (its path),
``width``, ``height`` or ``audio``, ``sample_rate``, ``duration``,
``channels``, plus ``label`` and/or ``text``, and the usual ``_`` columns.
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
from typing import Optional

import polars as pl
import pyarrow as pa
import pyarrow.parquet as pq

from .. import protocol, readers
from ..protocol import CdataError, Progress, fmt_int
from ..schema import type_name
from . import media

FILE_COLUMNS = ("file_name", "filename", "file", "path", "image", "audio")
LABEL_COLUMNS = ("label", "labels", "class", "category", "target")
TEXT_COLUMNS = ("text", "transcription", "transcript", "sentence", "caption", "normalized_text")


def _media_column(schema: pa.Schema) -> Optional[str]:
    for f in schema:
        t = f.type
        if pa.types.is_struct(t) and any(c.name == "bytes" and (pa.types.is_binary(c.type) or pa.types.is_large_binary(c.type)) for c in t):
            return f.name
    return None


def detect(input_path: Path) -> Optional[str]:
    """'folder', 'parquet', or None when this isn't images or audio."""
    counts = {"image": 0, "audio": 0, "table": 0}
    first_parquet = None
    for dirpath, dirnames, filenames in os.walk(input_path):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d != "__MACOSX"]
        for name in filenames:
            if name.startswith("."):
                continue
            k = media.kind_of(name)
            if k:
                counts[k] += 1
            elif name.lower().endswith(".parquet"):
                first_parquet = first_parquet or Path(dirpath) / name
                counts["table"] += 1
            elif os.path.splitext(name.lower())[1] in readers.STRUCTURED and not name.lower().startswith("metadata"):
                counts["table"] += 1
    if counts["image"] + counts["audio"] > counts["table"]:
        return "folder"
    if first_parquet is not None:
        try:
            if _media_column(pq.read_schema(first_parquet)):
                return "parquet"
        except Exception:  # noqa: BLE001
            return None
    return None


def _pick(columns, names):
    low = {c.lower(): c for c in columns}
    return next((low[n] for n in names if n in low), None)


def _read_metadata(input_path: Path) -> dict:
    """metadata.csv / metadata.jsonl: file path (relative to the input) → its other columns."""
    out = {}
    for dirpath, _, filenames in os.walk(input_path):
        for name in filenames:
            low = name.lower()
            if low not in ("metadata.csv", "metadata.jsonl"):
                continue
            path = Path(dirpath) / name
            rows = []
            if low.endswith(".csv"):
                with open(path, newline="", encoding="utf-8", errors="replace") as f:
                    rows = list(csv.DictReader(f))
            else:
                with open(path, encoding="utf-8", errors="replace") as f:
                    rows = [json.loads(line) for line in f if line.strip()]
            for r in rows:
                key = _pick(r.keys(), FILE_COLUMNS)
                if key and r.get(key):
                    rel = (Path(dirpath) / str(r[key])).relative_to(input_path).as_posix()
                    out[rel] = {k: v for k, v in r.items() if k != key}
    return out


class Rows:
    """Collects rows and writes the version (the same files and manifest as ingest)."""

    def __init__(self, p, modality):
        self.p = p
        self.modality = modality
        self.rows: list[dict] = []
        self.unreadable = 0
        self.skipped_other = 0

    def add(self, ds_dir: Path, data: bytes, name: str, split: Optional[str], label=None, text=None, key: str = ""):
        if self.modality == "image":
            info = media.image_info(data)
            if info is None:
                self.unreadable += 1
                return
            ext = media.IMAGE_FORMATS.get(info["format"], os.path.splitext(name)[1].lower() or ".img")
            row = {"image": media.put(ds_dir, data, ext), "width": info["width"], "height": info["height"]}
        else:
            info = media.audio_info(data)
            if info is None:
                self.unreadable += 1
                return
            ext = os.path.splitext(name)[1].lower() if os.path.splitext(name)[1].lower() in media.AUDIO_EXT else ".wav"
            row = {"audio": media.put(ds_dir, data, ext), "sample_rate": info["sample_rate"], "duration": info["duration"], "channels": info["channels"]}
        if label is not None:
            row["label"] = str(label)
        if text is not None:
            row["text"] = str(text)
        row["_id"] = hashlib.sha256(f"{self.p.source_id}\n{key or name}".encode()).hexdigest()[:16]
        row["_source"] = self.p.source_id
        row["_licence"] = self.p.licence
        row["_split"] = split
        row["_flags"] = []
        self.rows.append(row)


def _write(rows: Rows, output: Path, out_rel: str) -> None:
    from .ingest import PartWriter

    if not rows.rows:
        raise CdataError("NO_ROWS", f"No {rows.modality} file could be read ({fmt_int(rows.unreadable)} were damaged or in an unknown format).")
    df = pl.DataFrame(rows.rows, infer_schema_length=None)
    for c in ("label", "text"):
        if c in df.columns:
            df = df.with_columns(pl.col(c).cast(pl.String))
    df = df.with_columns(pl.col("_split").cast(pl.String), pl.col("_flags").cast(pl.List(pl.String)))
    has_label = "label" in df.columns and df["label"].null_count() < df.height
    has_text = "text" in df.columns and df["text"].null_count() < df.height
    task = "classify" if has_label else "transcribe" if (rows.modality == "audio" and has_text) else "collect"
    roles = {"image": "input", "audio": "input", "width": "meta", "height": "meta", "sample_rate": "meta", "duration": "meta", "channels": "meta", "label": "label", "text": "label" if task == "transcribe" else "input"}
    order = [c for c in ("image", "audio", "label", "text", "width", "height", "sample_rate", "duration", "channels") if c in df.columns] + [c for c in df.columns if c.startswith("_")]
    df = df.select(order)
    partial = protocol.begin_output(output)
    try:
        writer = PartWriter(partial / "data", partial)
        for i in range(0, df.height, 50_000):
            writer.write(df.slice(i, 50_000))
        files = writer.close()
        schema_out = [{"name": c, "type": type_name(d), "role": "meta" if c.startswith("_") else roles.get(c, "input")} for c, d in df.schema.items()]
        labels = sorted(df["label"].drop_nulls().unique().to_list()) if has_label else None
        splits = {k: int(n) for k, n in df.group_by("_split").len().drop_nulls("_split").iter_rows()} or None
        parts = Path(out_rel).parts
        manifest = {
            "format": "continuum-data/1",
            "dataset": parts[-2],
            "version": parts[-1],
            "modality": rows.modality,
            "task": task,
            "schema": schema_out,
            "labels": labels,
            "splits": splits,
            "rows": df.height,
            "files": files,
            "media": {"folder": "../media", "kind": rows.modality},
            "licences": [{"spdx": rows.p.licence, "rows": df.height}],
            "source": rows.p.source_id,
            "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        }
        protocol.write_json_atomic(partial / "manifest.json", manifest)
        protocol.commit_output(output, partial)
    except BaseException:
        protocol.abandon_output(partial)
        raise
    if rows.unreadable:
        protocol.log(f"Left out {fmt_int(rows.unreadable)} damaged or unreadable file(s).")
    data_bytes = sum(f["bytes"] for f in files)
    protocol.metric("rows_written", df.height)
    protocol.log(f"Stored {fmt_int(df.height)} {rows.modality} file(s) with their details.")
    protocol.result(rows=df.height, bytes=data_bytes, modality=rows.modality, task=task, schema=schema_out, labels=labels, splits=splits,
                    unreadable=rows.unreadable)


def run_folder(p, input_path: Path, output: Path) -> None:
    ds_dir = media.dataset_dir(p.output)
    meta = _read_metadata(input_path)
    files = []
    for dirpath, dirnames, filenames in os.walk(input_path):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and d != "__MACOSX")
        for name in sorted(filenames):
            if not name.startswith(".") and media.kind_of(name):
                path = Path(dirpath) / name
                if protocol.is_inside(path, protocol.store_root()):
                    files.append((path, path.relative_to(input_path)))
    kinds = {"image": 0, "audio": 0}
    for _, rel in files:
        kinds[media.kind_of(rel.name)] += 1
    modality = p.modality if p.modality in ("image", "audio") else max(kinds, key=kinds.get)
    media.require(modality)
    other = [f for f in files if media.kind_of(f[1].name) != modality]
    files = [f for f in files if media.kind_of(f[1].name) == modality]
    if other:
        protocol.log(f"Left out {fmt_int(len(other))} {'audio' if modality == 'image' else 'image'} file(s): this dataset is {modality}.")
    if p.max_rows:
        files = files[: p.max_rows]
    rows = Rows(p, modality)
    progress = Progress("files", len(files))
    progress.update(0, force=True)
    for i, (path, rel) in enumerate(files, 1):
        m = meta.get(rel.as_posix(), {})
        label = m.get(_pick(m.keys(), LABEL_COLUMNS)) if m else None
        text = m.get(_pick(m.keys(), TEXT_COLUMNS)) if m else None
        if label is None:
            # The folder names the label (unless it is a split folder or the top)
            parents = [x for x in rel.parts[:-1] if x.lower() not in readers.SPLIT_DIRS]
            label = parents[-1] if parents else None
        split = readers.split_for(rel) if p.keep_splits else None
        rows.add(ds_dir, path.read_bytes(), rel.name, split, label, text, key=rel.as_posix())
        progress.update(i)
    progress.finish()
    _write(rows, output, p.output)


def run_parquet(p, input_path: Path, output: Path) -> None:
    ds_dir = media.dataset_dir(p.output)
    found, _ = readers.discover(input_path, protocol.store_root())
    parquets = [f for f in found if f.kind == "parquet"]
    first = pq.ParquetFile(parquets[0].path)
    col = _media_column(first.schema_arrow)
    hf_names = readers._hf_label_names(first.schema_arrow.metadata)
    names = first.schema_arrow.names
    label_col = p.label_column if p.label_column in names else _pick(names, LABEL_COLUMNS)
    text_col = p.text_column if p.text_column in names else _pick(names, TEXT_COLUMNS)
    # The media column's name says image or audio; else the first file decides
    modality = p.modality if p.modality in ("image", "audio") else "audio" if "audio" in col.lower() else "image"
    media.require(modality)
    label_names = p.label_names or hf_names.get(label_col)
    total = sum(pq.ParquetFile(f.path).metadata.num_rows for f in parquets)
    if p.max_rows:
        total = min(total, p.max_rows)
    rows = Rows(p, modality)
    progress = Progress("rows", total)
    progress.update(0, force=True)
    n = 0
    for f in parquets:
        split = readers.split_for(f.rel) if p.keep_splits else None
        pf = pq.ParquetFile(f.path)
        cols = [c for c in (col, label_col, text_col) if c]
        for batch in pf.iter_batches(batch_size=1000, columns=cols):
            for r in batch.to_pylist():
                if p.max_rows and n >= p.max_rows:
                    break
                cell = r.get(col) or {}
                data = cell.get("bytes")
                if not data:
                    rows.unreadable += 1
                    continue
                label = r.get(label_col) if label_col else None
                if label_names and isinstance(label, int):
                    label = label_names[label] if 0 <= label < len(label_names) else None
                rows.add(ds_dir, data, cell.get("path") or "", split, label, r.get(text_col) if text_col else None, key=f"{f.rel.as_posix()}#{n}")
                n += 1
                progress.update(n)
        if p.max_rows and n >= p.max_rows:
            break
    progress.finish()
    _write(rows, output, p.output)
