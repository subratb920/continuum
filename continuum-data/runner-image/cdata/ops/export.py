"""export: a ready-to-train zip of a version (parquet, csv, jsonl or hf)."""

from __future__ import annotations

import io
import json
import os
import zipfile

import polars as pl

from .. import protocol
from ..protocol import ParamError, get_param
from ._version import read_version

FORMATS = ("parquet", "csv", "jsonl", "hf", "imagefolder", "audiofolder")
MEDIA_FORMATS = {"image": ("hf", "imagefolder", "parquet"), "audio": ("hf", "audiofolder", "parquet")}


def _card(v, splits: dict, fmt: str, info: dict) -> str:
    """The dataset card (README.md): what it is, where it came from, how it was made, how good it is."""
    m = v.manifest
    head = ""
    if fmt == "hf":
        files = "\n".join(f"      - split: {s}\n        path: data/{s}.parquet" for s in splits)
        licences = sorted({l["spdx"] for l in m.get("licences", []) if l.get("spdx") and l["spdx"] not in ("unknown", "other")})
        lic = f"license: {licences[0]}\n" if len(licences) == 1 else ""
        features = ""
        if m.get("modality") in ("image", "audio"):
            feats = [f"    - name: {m['modality']}\n      dtype: {m['modality']}"]
            for c in m.get("schema", []):
                if c["name"] in ("label", "text"):
                    feats.append(f"    - name: {c['name']}\n      dtype: string")
            features = "dataset_info:\n  features:\n" + "\n".join(feats) + "\n"
        head = f"---\n{lic}{features}configs:\n  - config_name: default\n    data_files:\n{files}\n---\n\n"
    name = info.get("name") or "Dataset"
    out = [f"# {name}", ""]
    if info.get("goal"):
        out += [f"Goal: {info['goal']}", ""]
    out += ["Made with Continuum Data.", "", "## What's in it", ""]
    kinds = {"text": "Text", "tabular": "Table", "image": "Images", "audio": "Audio"}
    tasks = {"classify": "sorting into labels", "regress": "predicting a number", "chat": "answering and chatting",
             "generate": "writing text", "detect": "finding objects", "transcribe": "speech to text"}
    out.append(f"- Kind: {kinds.get(m.get('modality'), m.get('modality'))}, for {tasks.get(m.get('task'), m.get('task'))}")
    out.append(f"- Rows: {m.get('rows')}" + (" (" + ", ".join(f"{k}: {n}" for k, n in splits.items()) + ")" if splits else ""))
    if m.get("labels"):
        out.append(f"- Labels: {', '.join(map(str, m['labels'][:50]))}")
    cols = [c["name"] for c in m.get("schema", []) if not c["name"].startswith("_")]
    out.append(f"- Columns: {', '.join(cols)}")
    out += ["", "## Where it came from", ""]
    for src in info.get("sources") or []:
        lic = src.get("licence") or {}
        ref = f" ({src['ref']})" if src.get("ref") else ""
        out.append(f"- {src.get('title', 'Source')}{ref}: {lic.get('name', 'unknown licence')}. {lic.get('plain', '')}".rstrip())
    if not info.get("sources"):
        out.append("- " + ", ".join(f"{l['spdx']} ({l['rows']} rows)" for l in m.get("licences", [])) or "- Unknown")
    if info.get("history"):
        out += ["", "## How it was made", ""]
        for i, h in enumerate(info["history"], 1):
            notes = "; ".join(n.rstrip(".") for n in h.get("notes") or [])
            out.append(f"{i}. {h.get('label') or h.get('op')} (version {h.get('number')})" + (f": {notes}." if notes else ""))
    q = info.get("quality")
    if q:
        out += ["", "## Quality", "", f"Score {q.get('score')} of 100: {q.get('verdict')}.", ""]
        for g in q.get("gates", []):
            out.append(f"- {'✓' if g.get('passed') else '✗'} {g.get('title')}: {g.get('reason')}")
    out += ["", "## Use it with care", "",
            "Check the licences above before you share a model trained on this data. "
            "Rows were checked with simple rules; they can still hold mistakes or unfair patterns from where they came from.", ""]
    return head + "\n".join(out)


def _media_export(v, fmt, z, parts, keep) -> None:
    """Images or audio: the files go inside (embedded in Parquet, or as files in folders)."""
    from . import media

    kind = v.modality
    ds = v.path.parent
    for s, g in parts.items():
        g = g.select(keep)
        if fmt in ("hf", "parquet"):
            data = []
            for rel in g[kind].to_list():
                data.append({"bytes": media.resolve(ds, rel).read_bytes(), "path": rel.rsplit("/", 1)[-1]})
            g = g.with_columns(pl.Series(kind, data, dtype=pl.Struct({"bytes": pl.Binary, "path": pl.String})))
            buf = io.BytesIO()
            g.write_parquet(buf, compression="snappy")
            z.writestr(f"data/{s}.parquet" if fmt == "hf" else f"{s}.parquet", buf.getvalue())
        else:
            meta_rows = []
            for row in g.iter_rows(named=True):
                rel = row[kind]
                name = rel.rsplit("/", 1)[-1]
                label = row.get("label")
                folder = f"{s}/{label}" if kind == "image" and label is not None else s
                safe = folder.replace("..", "_")
                z.write(media.resolve(ds, rel), f"{safe}/{name}")
                extra = {k: v_ for k, v_ in row.items() if k != kind and not isinstance(v_, (list, dict))}
                meta_rows.append({"file_name": name if kind == "audio" or label is None else f"{label}/{name}", **extra})
            if kind == "audio" or any("text" in r for r in meta_rows):
                z.writestr(f"{s}/metadata.csv", pl.DataFrame(meta_rows).write_csv())


def run(params: dict) -> None:
    v = read_version(params)
    fmt = get_param(params, "format", str, "hf" if v.modality in ("image", "audio") else "parquet")
    if fmt not in FORMATS:
        raise ParamError(f"format must be one of {', '.join(FORMATS)}.")
    if v.modality in MEDIA_FORMATS and fmt not in MEDIA_FORMATS[v.modality]:
        raise ParamError(f"For {v.modality} datasets choose one of {', '.join(MEDIA_FORMATS[v.modality])}.", "BAD_FORMAT")
    if v.modality not in MEDIA_FORMATS and fmt in ("imagefolder", "audiofolder"):
        raise ParamError("Folders of files are for images and audio.", "BAD_FORMAT")
    include_meta = get_param(params, "includeMeta", bool, False)
    out_rel = get_param(params, "output", str, required=True)
    out_dir = protocol.resolve(out_rel, "output")
    out_dir.mkdir(parents=True, exist_ok=True)

    df = v.df
    # Training needs the content columns; where each row came from is kept on request
    keep = [c for c in df.columns if not c.startswith("_") or (include_meta and c in ("_id", "_source", "_licence"))]
    has_split = "_split" in df.columns and df["_split"].null_count() < df.height
    parts = {s: g for (s,), g in df.with_columns(pl.col("_split").fill_null("train")).group_by("_split", maintain_order=True)} if has_split else {"train" if fmt == "hf" else "data": df}
    splits = {s: g.height for s, g in parts.items()}

    target = out_dir / f"{fmt}.zip"
    tmp = out_dir / f".{fmt}.zip.tmp-{os.getpid()}"
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as z:
        media_kind = v.modality in MEDIA_FORMATS
        if media_kind:
            keep = [c for c in keep if c not in ("width", "height", "sample_rate", "duration", "channels") or fmt in ("imagefolder", "audiofolder")]
            _media_export(v, fmt, z, parts, keep)
        for s, g in ({} if media_kind else parts).items():
            g = g.select(keep)
            buf = io.BytesIO()
            if fmt in ("parquet", "hf"):
                g.write_parquet(buf, compression="snappy")
                name = f"data/{s}.parquet" if fmt == "hf" else f"{s}.parquet"
            elif fmt == "csv":
                flat = g.with_columns([pl.col(c).map_elements(lambda x: json.dumps(x, ensure_ascii=False) if x is not None else None, return_dtype=pl.String) for c, d in g.schema.items() if isinstance(d, (pl.List, pl.Struct))])
                flat.write_csv(buf)
                name = f"{s}.csv"
            else:
                g.write_ndjson(buf)
                name = f"{s}.jsonl"
            z.writestr(name, buf.getvalue())
        z.writestr("README.md", _card(v, splits, fmt, get_param(params, "card", dict, {})))
        z.writestr("manifest.json", json.dumps({**v.manifest, "export": {"format": fmt, "splits": splits, "columns": keep}}, indent=2, default=str))
    os.replace(tmp, target)
    size = target.stat().st_size
    protocol.log(f"Packed {sum(splits.values())} rows as {fmt} ({len(parts)} file(s)).")
    protocol.result(path=f"{out_rel}/{fmt}.zip", format=fmt, bytes=size, splits=splits)
