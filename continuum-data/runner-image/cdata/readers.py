"""Readers: find supported files and stream them as polars DataFrames."""

from __future__ import annotations

import html
import json
import os
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable, Iterator, Optional

import polars as pl

from .protocol import CdataError, is_inside

BATCH_ROWS = int(os.environ.get("CDATA_BATCH_ROWS", "50000"))
INFER_ROWS = 10_000

STRUCTURED = {".csv": "csv", ".tsv": "tsv", ".json": "json", ".jsonl": "jsonl", ".ndjson": "jsonl",
              ".parquet": "parquet", ".xlsx": "xlsx"}
DOCUMENTS = {".txt": "txt", ".md": "md", ".markdown": "md", ".html": "html", ".htm": "html", ".pdf": "pdf"}

# Metadata files that ship next to datasets (Hugging Face, our own versions) and are not data.
METADATA_NAMES = {"dataset_info.json", "dataset_infos.json", "dataset_dict.json", "state.json",
                  "manifest.json", "profile.json", "config.json", "metadata.json"}

SPLIT_DIRS = {"train": "train", "training": "train", "validation": "validation", "valid": "validation",
              "val": "validation", "dev": "validation", "test": "test", "testing": "test"}
_SPLIT_FILE_RE = re.compile(r"^(train|training|validation|valid|val|dev|test|testing)(?:$|[-_.])", re.I)


def split_for(rel: Path) -> Optional[str]:
    """The split a file belongs to: a folder named train / validation / test, or
    (Hugging Face and Kaggle style) a file named ``train.csv`` / ``train-00000-of-00001.parquet``."""
    for part in rel.parts[:-1]:
        s = SPLIT_DIRS.get(part.lower())
        if s:
            return s
    m = _SPLIT_FILE_RE.match(rel.name.split(".")[0] if "." in rel.name else rel.name)
    if m:
        return SPLIT_DIRS[m.group(1).lower()]
    return None


@dataclass
class Found:
    path: Path
    rel: Path
    kind: str
    size: int


def discover(root: Path, store: Path) -> tuple[list[Found], list[str]]:
    """Every supported file under ``root`` (or ``root`` itself), sorted, plus skipped names."""
    found: list[Found] = []
    skipped: list[str] = []

    def consider(p: Path, rel: Path):
        if any(part.startswith(".") or part == "__MACOSX" for part in rel.parts):
            return
        if not is_inside(p, store):
            skipped.append(f"{rel} (points outside the store)")
            return
        ext = p.suffix.lower()
        kind = STRUCTURED.get(ext) or DOCUMENTS.get(ext)
        if kind is None:
            skipped.append(str(rel))
            return
        if ext == ".json" and p.name.lower() in METADATA_NAMES:
            skipped.append(str(rel))
            return
        found.append(Found(p, rel, kind, p.stat().st_size))

    if root.is_file():
        consider(root, Path(root.name))
    else:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and d != "__MACOSX")
            for name in sorted(filenames):
                p = Path(dirpath) / name
                consider(p, p.relative_to(root))
    return found, skipped


# --------------------------------------------------------------------------
# Structured sources
# --------------------------------------------------------------------------


@dataclass
class Source:
    found: Found
    schema: dict  # column -> polars dtype
    batches: Callable[[], Iterator[pl.DataFrame]]
    rows: Optional[int] = None
    label_names: dict = field(default_factory=dict)  # from Hugging Face ClassLabel metadata


def _lazy_batches(lf: pl.LazyFrame) -> Iterator[pl.DataFrame]:
    if hasattr(lf, "collect_batches"):
        try:
            it = lf.collect_batches(chunk_size=BATCH_ROWS)
        except TypeError:
            it = lf.collect_batches()
        for df in it:
            if df.height:
                yield df
        return
    # Fallback for older polars: slice the lazy frame.
    offset = 0
    while True:
        df = lf.slice(offset, BATCH_ROWS).collect()
        if df.height == 0:
            return
        yield df
        offset += df.height


def _rebatch(df: pl.DataFrame) -> Iterator[pl.DataFrame]:
    for off in range(0, df.height, BATCH_ROWS):
        yield df.slice(off, BATCH_ROWS)


def _hf_label_names(meta: dict | None) -> dict:
    """ClassLabel names from Hugging Face parquet metadata."""
    out = {}
    if not meta or b"huggingface" not in meta:
        return out
    try:
        info = json.loads(meta[b"huggingface"])
        feats = info.get("info", {}).get("features", {})
        for name, feat in feats.items():
            if isinstance(feat, dict) and feat.get("_type") == "ClassLabel" and isinstance(feat.get("names"), list):
                out[name] = [str(n) for n in feat["names"]]
    except (ValueError, AttributeError, TypeError):
        pass
    return out


def _csv_scan(path: Path, sep: str, schema: Optional[dict] = None) -> pl.LazyFrame:
    kw = {"schema": schema} if schema is not None else {"infer_schema_length": None}
    return pl.scan_csv(path, separator=sep, encoding="utf8-lossy", try_parse_dates=True,
                       truncate_ragged_lines=True, raise_if_empty=False, **kw)


def open_structured(found: Found) -> Optional[Source]:
    """Open a structured file. Returns None when the file holds no table (e.g. a JSON config)."""
    p, kind = found.path, found.kind
    try:
        if kind == "parquet":
            import pyarrow.parquet as pq

            pf = pq.ParquetFile(p)
            empty = pl.from_arrow(pf.schema_arrow.empty_table())
            names = _hf_label_names(pf.schema_arrow.metadata)

            def batches():
                f = pq.ParquetFile(p)
                for b in f.iter_batches(batch_size=BATCH_ROWS):
                    df = pl.from_arrow(b)
                    if isinstance(df, pl.Series):
                        df = df.to_frame()
                    if df.height:
                        yield df

            return Source(found, dict(empty.schema), batches, pf.metadata.num_rows, names)

        if kind in ("csv", "tsv"):
            sep = "\t" if kind == "tsv" else ","
            # Full-file type inference: a streaming read must not meet a value that
            # does not fit the type guessed from the first rows.
            schema = dict(_csv_scan(p, sep).collect_schema())
            if not schema:
                return None
            return Source(found, schema, lambda: _lazy_batches(_csv_scan(p, sep, schema)))

        if kind == "jsonl":
            lf = pl.scan_ndjson(p, infer_schema_length=INFER_ROWS, ignore_errors=False)
            schema = dict(lf.collect_schema())
            return Source(found, schema, lambda: _lazy_batches(pl.scan_ndjson(p, schema=schema)))

        if kind == "json":
            df = _read_json_table(p)
            if df is None:
                return None
            return Source(found, dict(df.schema), lambda: _rebatch(df), df.height)

        if kind == "xlsx":
            df = pl.read_excel(p, engine="calamine")
            return Source(found, dict(df.schema), lambda: _rebatch(df), df.height)
    except CdataError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise CdataError("UNREADABLE_FILE", f"Could not read {found.rel}: {exc}")
    return None


def _read_json_table(p: Path) -> Optional[pl.DataFrame]:
    """A JSON file holding an array of records, an object with one such array,
    or (mislabelled) JSON lines."""
    with open(p, "rb") as f:
        head = f.read(4096).lstrip()
    if head.startswith(b"["):
        try:
            return pl.read_json(p, infer_schema_length=INFER_ROWS)
        except Exception:  # noqa: BLE001
            data = json.loads(p.read_bytes())
            return _records(data)
    if head.startswith(b"{"):
        try:  # JSON lines saved as .json
            df = pl.read_ndjson(p, infer_schema_length=INFER_ROWS)
            if df.height > 1:
                return df
        except Exception:  # noqa: BLE001
            pass
        data = json.loads(p.read_bytes())
        if isinstance(data, dict):
            lists = [v for v in data.values() if isinstance(v, list) and v and all(isinstance(x, dict) for x in v[:100])]
            if len(lists) == 1:
                return _records(lists[0])
            if all(not isinstance(v, (list, dict)) for v in data.values()):
                return None  # a config object, not a table
        return None
    return None


def _records(data) -> Optional[pl.DataFrame]:
    if not isinstance(data, list) or not data or not all(isinstance(x, dict) for x in data):
        return None
    return pl.from_dicts(data, infer_schema_length=INFER_ROWS)


# --------------------------------------------------------------------------
# Documents
# --------------------------------------------------------------------------

_SKIP_TAGS = {"script", "style", "noscript", "template", "svg", "head", "iframe", "object", "canvas"}
_BLOCK_TAGS = {"p", "div", "br", "li", "ul", "ol", "tr", "table", "section", "article", "header", "footer",
               "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "hr", "dd", "dt", "dl", "main",
               "aside", "nav", "figure", "figcaption", "form", "address", "td", "th"}


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP_TAGS:
            self.skip += 1
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_startendtag(self, tag, attrs):
        if tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS:
            self.skip = max(0, self.skip - 1)
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def html_to_text(markup: str) -> str:
    parser = _TextExtractor()
    try:
        parser.feed(markup)
        parser.close()
    except Exception:  # noqa: BLE001 - html.parser is lenient; be safe anyway
        pass
    text = html.unescape("".join(parser.parts))
    lines = [re.sub(r"[ \t\r\f\v ]+", " ", line).strip() for line in text.split("\n")]
    out, blank = [], False
    for line in lines:
        if line:
            out.append(line)
            blank = False
        elif not blank and out:
            out.append("")
            blank = True
    return "\n".join(out).strip()


def _decode(raw: bytes) -> str:
    for enc in ("utf-8-sig",):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("cp1252", errors="replace")


def pdf_to_text(path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(path)
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception as exc:  # noqa: BLE001
            raise CdataError("UNREADABLE_FILE", f"{path.name} is password protected.") from exc
    pages = []
    for page in reader.pages:
        try:
            pages.append((page.extract_text() or "").strip())
        except Exception:  # noqa: BLE001 - one bad page should not lose the file
            pages.append("")
    return "\n\n".join(p for p in pages if p)


def read_document(found: Found) -> str:
    try:
        if found.kind == "pdf":
            return pdf_to_text(found.path)
        text = _decode(found.path.read_bytes())
        if found.kind == "html":
            return html_to_text(text)
        return text.replace("\r\n", "\n")
    except CdataError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise CdataError("UNREADABLE_FILE", f"Could not read {found.rel}: {exc}")
