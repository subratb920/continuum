"""ingest: turn the files in a folder into a canonical dataset version."""

from __future__ import annotations

import datetime as dt
import hashlib
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import polars as pl
import pyarrow as pa
import pyarrow.parquet as pq

from .. import protocol, readers
from ..protocol import CdataError, ParamError, Progress, fmt_int, get_param
from ..schema import META_COLUMNS, storable, supertype, type_name

PART_ROWS = int(os.environ.get("CDATA_PART_ROWS", "200000"))
SAMPLE_ROWS = 10_000

TEXT_NAMES = ("text", "sentence", "review", "content", "document", "comment", "tweet", "body")
LABEL_NAMES = ("label", "labels", "target", "class", "category", "sentiment", "y", "outcome")
CHAT_NAMES = ("messages", "conversations")
INSTRUCTION_PAIRS = (("instruction", "output"), ("prompt", "response"), ("prompt", "completion"), ("question", "answer"))
INPUT_NAMES = ("input", "context")
ROLE_MAP = {"human": "user", "gpt": "assistant", "bot": "assistant", "model": "assistant", "chatgpt": "assistant",
            "ai": "assistant", "function": "tool", "observation": "tool"}
MODALITIES = ("text", "tabular", "image", "audio")
TASKS = {"text": ("classify", "generate", "chat"), "tabular": ("classify", "regress"), "image": ("classify", "collect"), "audio": ("classify", "transcribe", "collect")}
MAX_LABELS = 10_000


# --------------------------------------------------------------------------
# Parameters
# --------------------------------------------------------------------------


@dataclass
class Params:
    input: str
    output: str
    source_id: str
    licence: str
    modality: Optional[str]
    task: Optional[str]
    text_column: Optional[str]
    label_column: Optional[str]
    label_names: Optional[list]
    max_rows: Optional[int]
    keep_splits: bool
    dataset: Optional[str]
    version: object


def _params(raw: dict) -> Params:
    p = Params(
        input=get_param(raw, "input", str, required=True),
        output=get_param(raw, "output", str, required=True),
        source_id=get_param(raw, "sourceId", str, required=True),
        licence=get_param(raw, "licence", str, default="unknown") or "unknown",
        modality=get_param(raw, "modality", str),
        task=get_param(raw, "task", str),
        text_column=get_param(raw, "textColumn", str),
        label_column=get_param(raw, "labelColumn", str),
        label_names=get_param(raw, "labelNames", list),
        max_rows=get_param(raw, "maxRows", int),
        keep_splits=get_param(raw, "keepSplits", bool, default=True),
        dataset=get_param(raw, "datasetId", str),
        version=raw.get("version"),
    )
    if p.modality is not None and p.modality not in MODALITIES:
        raise ParamError(f"'modality' must be one of {', '.join(MODALITIES)} (or null to detect it).")
    if p.task is not None and p.task not in {t for ts in TASKS.values() for t in ts}:
        raise ParamError(f"'task' {p.task!r} is not known.")
    if p.max_rows is not None and p.max_rows < 1:
        raise ParamError("'maxRows' must be at least 1.")
    if p.label_names is not None:
        if not p.label_names or not all(isinstance(n, (str, int, float)) and not isinstance(n, bool) for n in p.label_names):
            raise ParamError("'labelNames' must be a non-empty list of names.")
        p.label_names = [str(n) for n in p.label_names]
    return p


# --------------------------------------------------------------------------
# Plan: which columns become what
# --------------------------------------------------------------------------


@dataclass
class Plan:
    modality: str
    task: str
    exprs: list  # polars expressions from a raw batch to the canonical columns
    roles: dict  # canonical column -> role
    label: Optional[str] = None  # canonical label column
    label_names: Optional[list] = None
    dropped: list = field(default_factory=list)


def _finder(columns: list[str]) -> Callable:
    lower: dict[str, str] = {}
    for c in columns:
        lower.setdefault(c.lower(), c)

    def find(*names: str) -> Optional[str]:
        for n in names:
            if n in lower:
                return lower[n]
        return None

    return find


def _named(columns: list[str], name: Optional[str], what: str) -> Optional[str]:
    if name is None:
        return None
    if name in columns:
        return name
    matches = [c for c in columns if c.lower() == name.lower()]
    if len(matches) == 1:
        return matches[0]
    raise ParamError(f"'{what}' is {name!r}, but there is no such column. The columns are: {', '.join(columns)}.")


def _chat_fields(dtype) -> Optional[tuple[str, str]]:
    if not isinstance(dtype, pl.List) or not isinstance(dtype.inner, pl.Struct):
        return None
    names = {f.name for f in dtype.inner.fields}
    if {"role", "content"} <= names:
        return "role", "content"
    if {"from", "value"} <= names:
        return "from", "value"
    return None


def _as_text(e: pl.Expr, dtype) -> pl.Expr:
    if isinstance(dtype, pl.Struct):
        return e.struct.json_encode()
    if isinstance(dtype, (pl.List, pl.Array)):
        return e.cast(pl.List(pl.String)).list.join("\n") if not isinstance(dtype.inner, (pl.List, pl.Struct)) else e.cast(pl.String)
    return e.cast(pl.String)


def _messages_expr(col: str, dtype) -> pl.Expr:
    rf, cf = _chat_fields(dtype)
    fields = {f.name: f.dtype for f in dtype.inner.fields}
    role = pl.element().struct.field(rf).cast(pl.String).str.strip_chars().str.to_lowercase().replace(ROLE_MAP)
    content = _as_text(pl.element().struct.field(cf), fields[cf])
    return pl.col(col).list.eval(pl.struct(role.alias("role"), content.alias("content"))).alias("messages")


def _instruction_expr(instr: str, inp: Optional[str], out: str) -> pl.Expr:
    user = pl.col(instr).cast(pl.String)
    if inp is not None:
        extra = pl.col(inp).cast(pl.String)
        has = extra.is_not_null() & (extra.str.strip_chars() != "")
        user = pl.when(has).then(pl.concat_str([user, pl.lit("\n\n"), extra])).otherwise(user)
    return pl.concat_list([
        pl.struct(pl.lit("user").alias("role"), user.alias("content")),
        pl.struct(pl.lit("assistant").alias("role"), pl.col(out).cast(pl.String).alias("content")),
    ]).alias("messages")


def _map_int_labels(e: pl.Expr, names: list[str]) -> pl.Expr:
    mapping = {i: n for i, n in enumerate(names)}
    as_int = e.cast(pl.Int64)
    return (pl.when(as_int < 0).then(pl.lit(None, pl.String))
            .otherwise(as_int.replace_strict(mapping, default=as_int.cast(pl.String), return_dtype=pl.String)))


def _label_expr(col: str, dtype, names: Optional[list], target: str) -> tuple[pl.Expr, bool]:
    """The label expression and whether ``names`` were applied."""
    if names is not None:
        if dtype.is_integer():
            return _map_int_labels(pl.col(col), names).alias(target), True
        if isinstance(dtype, pl.List) and dtype.inner.is_integer():
            return pl.col(col).list.eval(_map_int_labels(pl.element(), names)).alias(target), True
    if dtype == pl.Null:
        return pl.col(col).cast(pl.String).alias(target), False
    return pl.col(col).alias(target), False


def _longest_text_column(sample: pl.DataFrame, exclude: set) -> Optional[str]:
    best, best_len = None, 40.0
    for c, d in sample.schema.items():
        if c in exclude or d != pl.String or sample.height == 0:
            continue
        mean = sample[c].str.len_chars().mean()
        if mean is not None and mean > best_len:
            best, best_len = c, float(mean)
    return best


def _safe_name(name: str, taken: set) -> str:
    """User columns may not start with '_' (those are ours) and must have a name."""
    base = name.lstrip("_") or "column"
    out, i = base, 1
    while out in taken or out in META_COLUMNS:
        i += 1
        out = f"{base}_{i}"
    return out


def make_plan(schema: dict, sample: pl.DataFrame, p: Params, hf_names: dict) -> Plan:
    columns = list(schema)
    find = _finder(columns)
    text_col = _named(columns, p.text_column, "textColumn")
    label_col = _named(columns, p.label_column, "labelColumn")
    modality = p.modality
    if modality is None and text_col is not None:
        modality = "text"

    def names_for(col: Optional[str]) -> Optional[list]:
        if col is None:
            return None
        return p.label_names if p.label_names is not None else hf_names.get(col)

    def finish(plan: Plan, used: set) -> Plan:
        plan.dropped = [c for c in columns if c not in used]
        if p.task is not None:
            if p.task not in TASKS[plan.modality]:
                raise ParamError(f"Task '{p.task}' does not fit {plan.modality} data (allowed: {', '.join(TASKS[plan.modality])}).")
            if p.task in ("classify", "regress") and plan.label is None:
                raise ParamError(f"Task '{p.task}' needs a label column; none was found. Set 'labelColumn'.")
            if p.task == "chat" and "messages" not in plan.roles:
                raise ParamError("Task 'chat' needs conversation data (messages, or instruction and output columns).")
            plan.task = p.task
        return plan

    def extra_text_cols(used: set, exprs: list, roles: dict, keep: dict):
        for canon, role in keep.items():
            c = find(canon)
            if c is not None and c not in used and canon not in roles:
                exprs.append(_as_text(pl.col(c), schema[c]).alias(canon))
                roles[canon] = role
                used.add(c)

    if modality in (None, "text") and text_col is None:
        # Chat: a messages / conversations column.
        chat = next((c for c in (find(n) for n in CHAT_NAMES) if c and _chat_fields(schema[c])), None)
        instr = None
        if chat is None:
            for a, b in INSTRUCTION_PAIRS:
                if find(a) and find(b):
                    instr = (find(a), find(b))
                    break
        if chat or instr:
            exprs, roles, used = [], {}, set()
            if chat:
                exprs.append(_messages_expr(chat, schema[chat]))
                used.add(chat)
            else:
                inp = find(*INPUT_NAMES) if instr[0].lower() == "instruction" else None
                exprs.append(_instruction_expr(instr[0], inp, instr[1]))
                used.update(c for c in (instr[0], instr[1], inp) if c)
            roles["messages"] = "input"
            extra_text_cols(used, exprs, roles, {"system": "input"})
            plan = Plan("text", "chat", exprs, roles)
            if label_col is not None:
                e, applied = _label_expr(label_col, schema[label_col], names_for(label_col), "label")
                exprs.append(e)
                roles["label"] = "label"
                used.add(label_col)
                plan.label, plan.label_names = "label", (names_for(label_col) if applied else None)
            return finish(plan, used)

    if modality in (None, "text"):
        if text_col is None:
            text_col = find(*TEXT_NAMES)
            if text_col is not None and schema[text_col] not in (pl.String, pl.Null):
                text_col = None
        if text_col is None:
            text_col = _longest_text_column(sample, {c for c in columns if c.lower() in LABEL_NAMES} | {label_col})
        if text_col is None and modality == "text":
            raise ParamError("No text column was found. Set 'textColumn' to the column that holds the text.")
        if text_col is not None:
            if label_col is None:
                label_col = find(*LABEL_NAMES)
                if label_col == text_col:
                    label_col = None
            exprs = [_as_text(pl.col(text_col), schema[text_col]).alias("text")]
            roles = {"text": "input"}
            used = {text_col}
            plan = Plan("text", "generate", exprs, roles)
            if label_col is not None:
                e, applied = _label_expr(label_col, schema[label_col], names_for(label_col), "label")
                exprs.append(e)
                roles["label"] = "label"
                used.add(label_col)
                plan.label, plan.label_names, plan.task = "label", (names_for(label_col) if applied else None), "classify"
            extra_text_cols(used, exprs, roles, {"title": "meta", "url": "meta"})
            return finish(plan, used)

    # Tabular.
    if label_col is None:
        label_col = find(*LABEL_NAMES)
        if label_col is None and len(columns) > 1:
            label_col = columns[-1]
    exprs, roles, taken = [], {}, set()
    plan = Plan("tabular", "classify", exprs, roles)
    for c in columns:
        name = c if (c and not c.startswith("_")) else _safe_name(c, taken | set(columns))
        taken.add(name)
        if c == label_col:
            e, applied = _label_expr(c, schema[c], names_for(c), name)
            exprs.append(e)
            roles[name] = "label"
            plan.label, plan.label_names = name, (names_for(c) if applied else None)
        else:
            exprs.append(pl.col(c).alias(name))
            roles[name] = "input"
    if plan.label is not None:
        dtype = schema[label_col]
        if plan.label_names is not None or dtype in (pl.String, pl.Boolean, pl.Null) or not dtype.is_numeric():
            plan.task = "classify"
        else:
            distinct = sample[label_col].drop_nulls().n_unique() if sample.height else 0
            plan.task = "classify" if distinct <= 50 else "regress"
    if plan.label is None and p.task in ("classify", "regress"):
        raise ParamError(f"Task '{p.task}' needs a label column; none was found. Set 'labelColumn'.")
    return finish(plan, set(columns))


# --------------------------------------------------------------------------
# Parquet parts
# --------------------------------------------------------------------------


class PartWriter:
    def __init__(self, data_dir: Path, base: Path, max_rows: int = PART_ROWS):
        self.data_dir = data_dir
        self.base = base
        self.max_rows = max_rows
        self.schema: Optional[pa.Schema] = None
        self.pl_schema: Optional[dict] = None
        self.writer: Optional[pq.ParquetWriter] = None
        self.rows_in_part = 0
        self.paths: list[Path] = []
        self.pending: list[pa.Table] = []
        self.pending_rows = 0

    def _open(self):
        path = self.data_dir / f"part-{len(self.paths):05d}.parquet"
        self.paths.append(path)
        self.writer = pq.ParquetWriter(path, self.schema, compression="snappy", use_dictionary=True,
                                       write_statistics=True, data_page_version="1.0", version="2.6")
        self.rows_in_part = 0

    def write(self, df: pl.DataFrame) -> None:
        table = df.to_arrow(compat_level=pl.CompatLevel.oldest())
        if self.schema is None:
            self.schema = table.schema
            self.pl_schema = dict(df.schema)
            self.data_dir.mkdir(parents=True, exist_ok=True)
        elif table.schema != self.schema:
            table = table.cast(self.schema)
        # Small batches (one per document) are gathered into bigger row groups.
        self.pending.append(table)
        self.pending_rows += table.num_rows
        if self.pending_rows >= readers.BATCH_ROWS:
            self._flush()

    def _flush(self) -> None:
        if not self.pending:
            return
        table = pa.concat_tables(self.pending) if len(self.pending) > 1 else self.pending[0]
        self.pending, self.pending_rows = [], 0
        offset = 0
        while offset < table.num_rows:
            if self.writer is None:
                self._open()
            n = min(self.max_rows - self.rows_in_part, table.num_rows - offset)
            self.writer.write_table(table.slice(offset, n))
            self.rows_in_part += n
            offset += n
            if self.rows_in_part >= self.max_rows:
                self.writer.close()
                self.writer = None

    def close(self) -> list[dict]:
        self._flush()
        if self.writer is not None:
            self.writer.close()
            self.writer = None
        files = []
        for path in self.paths:
            h = hashlib.sha256()
            with open(path, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            files.append({"path": path.relative_to(self.base).as_posix(), "sha256": h.hexdigest(),
                          "bytes": path.stat().st_size})
        return files


# --------------------------------------------------------------------------
# Running
# --------------------------------------------------------------------------


def _conform(df: pl.DataFrame, schema: dict) -> pl.DataFrame:
    """Cast a batch to the group's schema; add missing columns as nulls."""
    cols = []
    for c, d in schema.items():
        if c in df.columns:
            cols.append(pl.col(c) if df.schema[c] == d else pl.col(c).cast(d))
        else:
            cols.append(pl.lit(None, d).alias(c))
    return df.select(cols)


def _row_ids(df: pl.DataFrame, source_id: str) -> pl.Series:
    """First 16 hex characters of SHA-256 over sourceId, a newline and the row's JSON."""
    prefix = source_id + "\n"
    rows = df.select(pl.struct(pl.all()).struct.json_encode().alias("j"))["j"].to_list()
    return pl.Series("_id", [hashlib.sha256((prefix + j).encode()).hexdigest()[:16] for j in rows], dtype=pl.String)


def _group_sources(sources: list[readers.Source]) -> tuple[list[readers.Source], dict, list[str]]:
    """Pick the main group of files (same columns) and add files whose columns are a subset."""
    groups: dict[frozenset, list[readers.Source]] = {}
    for s in sources:
        groups.setdefault(frozenset(s.schema), []).append(s)
    main_key = max(groups, key=lambda k: (sum(s.found.size for s in groups[k]), len(k)))
    chosen, skipped = [], []
    for s in sources:
        key = frozenset(s.schema)
        if key == main_key or key <= main_key:
            chosen.append(s)
        else:
            skipped.append(str(s.found.rel))
    order = list(next(s for s in sources if frozenset(s.schema) == main_key).schema)
    schema = {}
    for c in order:
        t = None
        for s in chosen:
            if c in s.schema:
                t = s.schema[c] if t is None else supertype(t, s.schema[c])
                if t is None:
                    raise CdataError("MIXED_TYPES", f"The column '{c}' holds different kinds of values in different files, so they cannot be stacked.")
        schema[c] = storable(t)
    return chosen, schema, skipped


def _documents_source(docs: list[readers.Found]) -> tuple[list[readers.Source], dict]:
    schema = {"title": pl.String, "text": pl.String}
    sources = []
    for f in docs:
        def batches(f=f):
            yield pl.DataFrame({"title": [f.rel.name], "text": [readers.read_document(f)]}, schema=schema)
        sources.append(readers.Source(f, schema, batches, 1))
    return sources, schema


def run(raw: dict) -> None:
    p = _params(raw)
    store = protocol.store_root()
    input_path = protocol.resolve(p.input, "input")
    output = protocol.resolve(p.output, "output")
    if not input_path.exists():
        raise ParamError(f"The input folder {p.input} does not exist.", "NOT_FOUND")
    if protocol.is_inside(output, input_path) or protocol.is_inside(input_path, output):
        raise ParamError("'input' and 'output' must be separate folders.")

    # Images and audio (D3): folders of files, or Parquet with the media inside
    from . import media_ingest

    layout = media_ingest.detect(input_path) if p.modality in (None, "image", "audio") else None
    if layout == "folder":
        return media_ingest.run_folder(p, input_path, output)
    if layout == "parquet":
        return media_ingest.run_parquet(p, input_path, output)

    found, skipped = readers.discover(input_path, store)
    structured = [f for f in found if f.kind in readers.STRUCTURED.values()]
    docs = [f for f in found if f.kind in readers.DOCUMENTS.values()]
    if structured and docs:
        skipped.extend(str(f.rel) for f in docs)
        protocol.log(f"Left out {len(docs)} document file(s) (such as {docs[0].rel}) because the folder also holds table files.")
    if skipped:
        protocol.log(f"Skipped {len(skipped)} file(s) that are not data: {', '.join(skipped[:10])}{' …' if len(skipped) > 10 else ''}")

    hf_names: dict = {}
    if structured:
        sources = []
        for f in structured:
            s = readers.open_structured(f)
            if s is None:
                protocol.log(f"Skipped {f.rel}: it does not hold a table.")
            elif not s.schema:
                protocol.log(f"Skipped {f.rel}: it is empty.")
            else:
                sources.append(s)
                hf_names.update(s.label_names)
        if not sources:
            raise CdataError("NO_DATA", "No table could be read from the input files.")
        sources, schema, left_out = _group_sources(sources)
        if left_out:
            protocol.log(f"Left out {len(left_out)} file(s) with different columns: {', '.join(left_out[:10])}.")
    elif docs:
        sources, schema = _documents_source(docs)
    else:
        raise CdataError("NO_DATA", "The input folder holds no supported files (csv, tsv, json, jsonl, parquet, xlsx, txt, md, html, pdf).")

    protocol.log(f"Reading {len(sources)} file(s).")
    protocol.metric("files_read", len(sources))

    # Sample the first rows to detect the kind of data.
    sample = pl.DataFrame(schema=schema)
    for b in sources[0].batches():
        sample = _conform(b.head(SAMPLE_ROWS), schema)
        break
    if docs and not structured:
        plan = make_plan(schema, sample, Params(**{**p.__dict__, "text_column": "text", "modality": "text"}), {})
    else:
        plan = make_plan(schema, sample, p, hf_names)
    del sample
    if plan.label_names is None and p.label_names is not None:
        protocol.log("labelNames was not used because the label column does not hold whole numbers.")
    protocol.log(f"This looks like {plan.modality} data for the task '{plan.task}'.")
    if plan.dropped and plan.modality == "text":
        protocol.log(f"Left out {len(plan.dropped)} column(s) not used for text data: {', '.join(plan.dropped[:20])}.")

    total = None
    if all(s.rows is not None for s in sources):
        total = sum(s.rows for s in sources)
        if p.max_rows is not None:
            total = min(total, p.max_rows)
    progress = Progress("rows", total)
    progress.update(0, force=True)

    partial = protocol.begin_output(output)
    try:
        writer = PartWriter(partial / "data", partial)
        rows = 0
        splits: dict[str, int] = {}
        labels: set = set()
        too_many_labels = False
        lit_source = pl.lit(p.source_id, pl.String).alias("_source")
        lit_licence = pl.lit(p.licence, pl.String).alias("_licence")
        done = False
        for s in sources:
            split = readers.split_for(s.found.rel) if p.keep_splits else None
            for batch in s.batches():
                if p.max_rows is not None:
                    batch = batch.head(p.max_rows - rows)
                if batch.height == 0:
                    continue
                batch = _conform(batch, schema)
                ids = _row_ids(batch, p.source_id)
                try:
                    canon = batch.select(plan.exprs)
                except pl.exceptions.PolarsError as exc:
                    raise CdataError("CONVERT_FAILED", f"Could not convert rows of {s.found.rel}: {exc}")
                del batch
                n = canon.height
                casts = [pl.col(c).cast(storable(d)) for c, d in canon.schema.items() if d != storable(d)]
                if casts:
                    canon = canon.with_columns(casts)
                canon = canon.with_columns(
                    ids, lit_source, lit_licence,
                    pl.lit(split, pl.String).alias("_split"),
                    pl.Series("_flags", [[] for _ in range(n)], dtype=pl.List(pl.String)),
                )
                if plan.label is not None and plan.task == "classify" and not too_many_labels:
                    col = canon[plan.label]
                    if isinstance(col.dtype, pl.List):
                        col = col.explode()
                    labels.update(str(v).lower() if isinstance(v, bool) else str(v) for v in col.drop_nulls().unique().to_list())
                    if len(labels) > MAX_LABELS:
                        too_many_labels = True
                        labels = set()
                if split is not None:
                    splits[split] = splits.get(split, 0) + n
                writer.write(canon)
                del canon
                rows += n
                progress.update(rows)
                if p.max_rows is not None and rows >= p.max_rows:
                    done = True
                    break
            if done:
                protocol.log(f"Stopped after {fmt_int(rows)} rows (maxRows).")
                break
        progress.finish()
        if rows == 0:
            raise CdataError("NO_ROWS", "The input files hold no rows.")

        files = writer.close()
        schema_out = [{"name": c, "type": type_name(d), "role": "meta" if c.startswith("_") else plan.roles.get(c, "input")}
                      for c, d in writer.pl_schema.items()]
        if plan.label is None or plan.task != "classify" or too_many_labels:
            label_list = None
        elif plan.label_names is not None:
            label_list = list(plan.label_names)
        else:
            label_list = sorted(labels)
        dataset_id, version = _dataset_version(p)
        manifest = {
            "format": "continuum-data/1",
            "dataset": dataset_id,
            "version": version,
            "modality": plan.modality,
            "task": plan.task,
            "schema": schema_out,
            "labels": label_list,
            "splits": splits or None,
            "rows": rows,
            "files": files,
            "licences": [{"spdx": p.licence, "rows": rows}],
            "source": p.source_id,
            "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        }
        protocol.write_json_atomic(partial / "manifest.json", manifest)
        protocol.commit_output(output, partial)
    except BaseException:
        protocol.abandon_output(partial)
        raise

    data_bytes = sum(f["bytes"] for f in files)
    protocol.metric("rows_written", rows)
    protocol.metric("bytes", data_bytes)
    protocol.log(f"Wrote {fmt_int(rows)} rows in {len(files)} file(s).")
    protocol.result(rows=rows, bytes=data_bytes, modality=plan.modality, task=plan.task, schema=schema_out,
                    labels=label_list, splits=splits or None)


def _dataset_version(p: Params):
    parts = Path(p.output).parts
    dataset = p.dataset
    version = p.version
    if len(parts) >= 3 and parts[-3] == "datasets":
        dataset = dataset or parts[-2]
        version = version if version is not None else parts[-1]
    return dataset, version
