"""JSON-lines output protocol, errors, and path safety for the runner.

Everything the worker sees on stdout goes through :func:`emit`. At start-up
:func:`install_stdout_guard` moves the real stdout to a private handle and
points file descriptor 1 (and ``sys.stdout``) at stderr, so a stray ``print``
or a native library writing to fd 1 can never break the protocol.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any, Optional

EXIT_OK = 0
EXIT_FAILURE = 1
EXIT_BAD_PARAMS = 2

_out = None  # the private handle to the real stdout


class CdataError(Exception):
    """A failure that is reported as an ``error`` line and a non-zero exit."""

    def __init__(self, code: str, message: str, exit_code: int = EXIT_FAILURE):
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code


class ParamError(CdataError):
    """Bad parameters: exit code 2."""

    def __init__(self, message: str, code: str = "BAD_PARAMS"):
        super().__init__(code, message, EXIT_BAD_PARAMS)


def install_stdout_guard() -> None:
    global _out
    if _out is not None:
        return
    sys.stdout.flush()
    real_fd = os.dup(1)
    _out = os.fdopen(real_fd, "w", encoding="utf-8", buffering=1, newline="\n")
    os.dup2(2, 1)
    sys.stdout = sys.stderr


def _clean(value: Any) -> Any:
    """Make a value JSON-safe (no NaN/Infinity, which are not valid JSON)."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    return value


def dumps(obj: Any, **kw: Any) -> str:
    return json.dumps(_clean(obj), ensure_ascii=False, allow_nan=False, default=str, **kw)


def emit(kind: str, **fields: Any) -> None:
    line = dumps({"kind": kind, **fields})
    target = _out if _out is not None else sys.stdout
    target.write(line + "\n")
    target.flush()


def log(message: str) -> None:
    emit("log", message=message)


def metric(name: str, value: Any) -> None:
    emit("metric", name=name, value=value)


def result(**fields: Any) -> None:
    emit("result", **fields)


def error(code: str, message: str) -> None:
    emit("error", code=code, message=message)


class Progress:
    """Emits ``progress`` lines at most every ``interval`` seconds."""

    def __init__(self, unit: str, total: Optional[int] = None, interval: float = 1.0):
        self.unit = unit
        self.total = total
        self.interval = interval
        self.done = 0
        self._last = 0.0

    def update(self, done: int, force: bool = False) -> None:
        self.done = done
        now = time.monotonic()
        if force or now - self._last >= self.interval:
            self._last = now
            emit("progress", done=int(done), total=self.total, unit=self.unit)

    def advance(self, n: int) -> None:
        self.update(self.done + n)

    def finish(self) -> None:
        self.update(self.done, force=True)


# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------


def store_root() -> Path:
    root = Path(os.environ.get("CDATA_STORE", "/store"))
    if not root.is_dir():
        raise CdataError("NO_STORE", f"The store folder {root} does not exist.")
    return Path(os.path.realpath(root))


def _within(path: str, root: str) -> bool:
    try:
        return os.path.commonpath([path, root]) == root
    except ValueError:
        return False


def check_relative(rel: Any, what: str) -> str:
    """Validate a relative path from the parameters (no absolute, no ``..``)."""
    if not isinstance(rel, str) or not rel.strip():
        raise ParamError(f"'{what}' must be a non-empty relative path.")
    if "\x00" in rel:
        raise ParamError(f"'{what}' contains a NUL character.", "PATH_OUTSIDE_STORE")
    if rel.startswith("/") or rel.startswith("\\") or os.path.isabs(rel) or (len(rel) > 1 and rel[1] == ":"):
        raise ParamError(f"'{what}' must be relative to the store, not an absolute path: {rel}", "PATH_OUTSIDE_STORE")
    parts = rel.replace("\\", "/").split("/")
    if any(p == ".." for p in parts):
        raise ParamError(f"'{what}' may not leave the store ('..' is not allowed): {rel}", "PATH_OUTSIDE_STORE")
    return rel


def resolve_in(base: Path, rel: Any, what: str) -> Path:
    """Resolve ``rel`` under ``base`` and refuse anything that ends up outside it
    (including through symlinks)."""
    check_relative(rel, what)
    base_real = os.path.realpath(base)
    candidate = os.path.realpath(os.path.join(base_real, rel))
    if not _within(candidate, base_real) or candidate == base_real:
        raise ParamError(f"'{what}' points outside the store: {rel}", "PATH_OUTSIDE_STORE")
    return Path(candidate)


def resolve(rel: Any, what: str) -> Path:
    return resolve_in(store_root(), rel, what)


def is_inside(path: Path, root: Path) -> bool:
    return _within(os.path.realpath(path), os.path.realpath(root))


# --------------------------------------------------------------------------
# All-or-nothing output folders
# --------------------------------------------------------------------------


def _remove(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def begin_output(output: Path) -> Path:
    """Remove a stale ``<output>.partial`` and create a fresh one."""
    partial = output.with_name(output.name + ".partial")
    _remove(partial)
    partial.mkdir(parents=True)
    return partial


def commit_output(output: Path, partial: Path) -> None:
    """Replace any earlier ``<output>`` with the finished ``<output>.partial``."""
    _remove(output)
    os.replace(partial, output)


def abandon_output(partial: Path) -> None:
    try:
        _remove(partial)
    except OSError:
        pass


def write_json_atomic(path: Path, obj: Any) -> None:
    tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(dumps(obj, indent=2))
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


# --------------------------------------------------------------------------
# Parameter helpers
# --------------------------------------------------------------------------


def get_param(params: dict, name: str, types, default=None, required: bool = False):
    if name not in params or params[name] is None:
        if required:
            raise ParamError(f"The parameter '{name}' is required.")
        return default
    value = params[name]
    if types is int and isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, bool) and types in (int, float, (int, float)):
        raise ParamError(f"The parameter '{name}' must be a number.")
    if not isinstance(value, types):
        expected = types.__name__ if isinstance(types, type) else " or ".join(t.__name__ for t in types)
        raise ParamError(f"The parameter '{name}' must be of type {expected}.")
    return value


def fmt_int(n: int | float) -> str:
    return f"{int(round(n)):,}"
