"""Reading one dataset version and writing the next one.

Every clean-up op reads a version (``input``) and writes a new one
(``output``), all-or-nothing, with the same manifest shape as ``ingest`` plus
``changes.json``: how many rows went in and out, and a sample of what was
removed or changed and why, for the before-and-after view.
"""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import polars as pl

from .. import protocol
from ..protocol import CdataError, get_param
from ..schema import type_name
from .ingest import PartWriter
from .profile import _data_files, _load_manifest

META = ("_id", "_source", "_licence", "_split", "_flags")
SAMPLE = 50
SAMPLE_CHARS = 300


@dataclass
class Version:
    path: Path
    rel: str
    manifest: dict
    df: pl.DataFrame
    roles: dict = field(default_factory=dict)

    @property
    def modality(self) -> Optional[str]:
        return self.manifest.get("modality")

    @property
    def task(self) -> Optional[str]:
        return self.manifest.get("task")

    @property
    def label(self) -> Optional[str]:
        return next((c for c, r in self.roles.items() if r == "label"), None)

    @property
    def content_columns(self) -> list[str]:
        return [c for c in self.df.columns if not c.startswith("_")]

    @property
    def text_column(self) -> Optional[str]:
        if "messages" in self.df.columns and self.modality == "text":
            return "messages"
        if "text" in self.df.columns:
            return "text"
        return None


def read_version(params: dict, name: str = "input") -> Version:
    rel = get_param(params, name, str, required=True)
    path = protocol.resolve(rel, name)
    manifest = _load_manifest(path)
    files = _data_files(path, manifest)
    try:
        df = pl.concat([pl.read_parquet(f) for f in files], how="diagonal_relaxed")
    except pl.exceptions.PolarsError as exc:
        raise CdataError("READ_FAILED", f"The dataset's files could not be read: {exc}")
    roles = {c["name"]: c.get("role", "input") for c in manifest.get("schema", []) if isinstance(c, dict)}
    return Version(path=path, rel=rel, manifest=manifest, df=df, roles=roles)


def text_of(v: Version) -> Optional[pl.Expr]:
    """The row's text: the text column, or all chat message contents joined."""
    col = v.text_column
    if col is None:
        return None
    if col == "messages":
        return pl.col("messages").list.eval(pl.element().struct.field("content").cast(pl.String)).list.join("\n").fill_null("")
    return pl.col(col).cast(pl.String).fill_null("")


def _short(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if k in ("_source", "_licence", "_flags"):
            continue
        if isinstance(v, str) and len(v) > SAMPLE_CHARS:
            v = v[:SAMPLE_CHARS] + "…"
        elif isinstance(v, list) and v and isinstance(v[0], dict):
            v = [{kk: (vv[:SAMPLE_CHARS] + "…" if isinstance(vv, str) and len(vv) > SAMPLE_CHARS else vv) for kk, vv in m.items()} for m in v[:4]]
        out[k] = v
    return out


def sample_rows(df: pl.DataFrame, reason: str, n: int = SAMPLE) -> list[dict]:
    return [{"_id": r.get("_id"), "reason": reason, "row": _short(r)} for r in df.head(n).to_dicts()]


def labels_of(df: pl.DataFrame, label: Optional[str], task: Optional[str]) -> Optional[list]:
    if not label or task != "classify" or label not in df.columns:
        return None
    col = df[label]
    if isinstance(col.dtype, pl.List):
        col = col.explode()
    values = sorted({str(v) for v in col.drop_nulls().unique().to_list()})
    return values if len(values) <= 1000 else None


def write_version(
    v: Version,
    df: pl.DataFrame,
    params: dict,
    *,
    op: str,
    removed: int = 0,
    changed: int = 0,
    sample: Optional[list] = None,
    roles: Optional[dict] = None,
    notes: Optional[list] = None,
) -> dict:
    """Writes ``df`` as the new version at ``params.output`` and reports the result line."""
    out_rel = get_param(params, "output", str, required=True)
    output = protocol.resolve(out_rel, "output")
    if df.height == 0:
        raise CdataError("NO_ROWS_LEFT", "This step would remove every row. Loosen its settings and try again.")
    roles = {**v.roles, **(roles or {})}
    partial = protocol.begin_output(output)
    try:
        writer = PartWriter(partial / "data", partial)
        for i in range(0, df.height, 50_000):
            writer.write(df.slice(i, 50_000))
        files = writer.close()
        schema_out = [{"name": c, "type": type_name(d), "role": "meta" if c.startswith("_") else roles.get(c, "input")}
                      for c, d in df.schema.items()]
        label = next((c for c, r in roles.items() if r == "label" and c in df.columns), None)
        splits = None
        if "_split" in df.columns and df["_split"].null_count() < df.height:
            splits = {k: int(n) for k, n in df.group_by("_split").len().drop_nulls("_split").iter_rows()}
        licences = [{"spdx": k, "rows": int(n)} for k, n in df.group_by("_licence").len().iter_rows()] if "_licence" in df.columns else []
        parts = Path(out_rel).parts
        manifest = {
            "format": "continuum-data/1",
            "dataset": parts[-2] if len(parts) >= 3 and parts[-3] == "datasets" else v.manifest.get("dataset"),
            "version": parts[-1] if len(parts) >= 3 and parts[-3] == "datasets" else None,
            "parent": v.manifest.get("version"),
            "madeBy": op,
            "modality": v.modality,
            "task": v.task,
            "schema": schema_out,
            "labels": labels_of(df, label, v.task),
            "splits": splits,
            "rows": df.height,
            "files": files,
            "licences": licences,
            "source": v.manifest.get("source"),
            "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        }
        changes = {
            "op": op,
            "before": v.df.height,
            "after": df.height,
            "removed": removed,
            "changed": changed,
            "notes": notes or [],
            "sample": (sample or [])[:SAMPLE],
        }
        protocol.write_json_atomic(partial / "manifest.json", manifest)
        protocol.write_json_atomic(partial / "changes.json", changes)
        protocol.commit_output(output, partial)
    except BaseException:
        protocol.abandon_output(partial)
        raise
    data_bytes = sum(f["bytes"] for f in files)
    protocol.metric("rows_in", v.df.height)
    protocol.metric("rows_out", df.height)
    if removed:
        protocol.metric("removed", removed)
    if changed:
        protocol.metric("changed", changed)
    result = dict(rows=df.height, bytes=data_bytes, modality=v.modality, task=v.task, schema=schema_out,
                  labels=manifest["labels"], splits=splits, changes={"before": v.df.height, "after": df.height, "removed": removed, "changed": changed, "notes": notes or []})
    protocol.result(**result)
    return result


def add_flag(df: pl.DataFrame, mask: pl.Series, flag: str) -> pl.DataFrame:
    """Adds a flag to ``_flags`` where ``mask`` is true (once)."""
    flags = pl.when(pl.Series(mask) & ~pl.col("_flags").list.contains(flag)).then(pl.col("_flags").list.concat(pl.lit([flag]))).otherwise(pl.col("_flags"))
    return df.with_columns(flags.alias("_flags"))


def read_json(path: Path) -> Optional[dict]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
