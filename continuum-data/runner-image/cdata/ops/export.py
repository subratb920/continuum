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

FORMATS = ("parquet", "csv", "jsonl", "hf")


def _card(v, splits: dict, fmt: str) -> str:
    m = v.manifest
    configs = ""
    if fmt == "hf":
        files = "\n".join(f"      - split: {s}\n        path: data/{s}.parquet" for s in splits)
        configs = f"configs:\n  - config_name: default\n    data_files:\n{files}\n"
    licences = ", ".join(f"{l['spdx']} ({l['rows']} rows)" for l in m.get("licences", []))
    lines = [
        "---",
        configs.rstrip("\n") if configs else "",
        "---" if configs else "",
    ]
    head = "\n".join(l for l in lines if l) + "\n" if configs else ""
    body = [
        "# Dataset",
        "",
        "Made with Continuum Data.",
        "",
        f"- Kind: {m.get('modality')} · task: {m.get('task')}",
        f"- Rows: {m.get('rows')}" + (" (" + ", ".join(f"{k} {n}" for k, n in splits.items()) + ")" if splits else ""),
        f"- Labels: {', '.join(m.get('labels') or []) or '—'}",
        f"- Licences: {licences or 'unknown'}",
        "",
        "Every row's source and licence are in the `_source` and `_licence` columns when they are included.",
        "",
    ]
    return head + "\n".join(body)


def run(params: dict) -> None:
    v = read_version(params)
    fmt = get_param(params, "format", str, "parquet")
    if fmt not in FORMATS:
        raise ParamError(f"format must be one of {', '.join(FORMATS)}.")
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
        for s, g in parts.items():
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
        z.writestr("README.md", _card(v, splits, fmt))
        z.writestr("manifest.json", json.dumps({**v.manifest, "export": {"format": fmt, "splits": splits, "columns": keep}}, indent=2, default=str))
    os.replace(tmp, target)
    size = target.stat().st_size
    protocol.log(f"Packed {sum(splits.values())} rows as {fmt} ({len(parts)} file(s)).")
    protocol.result(path=f"{out_rel}/{fmt}.zip", format=fmt, bytes=size, splits=splits)
