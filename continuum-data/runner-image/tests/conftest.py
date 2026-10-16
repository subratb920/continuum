import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"


class Run:
    def __init__(self, code: int, lines: list[dict], stderr: str):
        self.code = code
        self.lines = lines
        self.stderr = stderr

    def kinds(self, kind: str) -> list[dict]:
        return [line for line in self.lines if line["kind"] == kind]

    @property
    def result(self) -> dict:
        results = self.kinds("result")
        assert len(results) == 1, (self.lines, self.stderr)
        assert self.lines[-1]["kind"] == "result"
        return results[0]

    @property
    def error(self) -> dict:
        errors = self.kinds("error")
        assert len(errors) == 1, (self.lines, self.stderr)
        return errors[0]


def run_cdata(op: str, params: dict | None, store: Path, env: dict | None = None) -> Run:
    full_env = {**os.environ, "CDATA_STORE": str(store), "PYTHONPATH": str(ROOT), "CDATA_FETCH_BACKOFF": "0.05", "CDATA_TEST": "1"}
    if params is not None:
        full_env["CDATA_PARAMS"] = json.dumps(params)
    else:
        full_env.pop("CDATA_PARAMS", None)
    full_env.update(env or {})
    proc = subprocess.run([sys.executable, "-m", "cdata", op], env=full_env, capture_output=True, text=True, timeout=120)
    lines = []
    for raw in proc.stdout.splitlines():
        obj = json.loads(raw)  # anything that is not JSON fails the test
        assert isinstance(obj, dict) and obj.get("kind") in {"log", "progress", "metric", "result", "error"}, raw
        lines.append(obj)
    run = Run(proc.returncode, lines, proc.stderr)
    if proc.returncode == 0:
        assert run.kinds("result"), (lines, proc.stderr)
        assert not run.kinds("error")
    else:
        assert not run.kinds("result")
        assert len(run.kinds("error")) == 1, (lines, proc.stderr)
    return run


@pytest.fixture
def store(tmp_path) -> Path:
    s = tmp_path / "store"
    s.mkdir()
    return s


def put(store: Path, fixture: str, dest: str) -> str:
    """Copy a fixture file or folder into the store at ``dest``; return ``dest``."""
    src = FIXTURES / fixture
    target = store / dest
    if src.is_dir():
        shutil.copytree(src, target)
    else:
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy(src, target / src.name)
    return dest


def ingest_params(input_rel: str, output_rel: str = "datasets/ds1/v1", **kw) -> dict:
    return {"input": input_rel, "output": output_rel, "sourceId": "abc123", "licence": "cc-by-4.0",
            "modality": None, "task": None, "textColumn": None, "labelColumn": None, "labelNames": None,
            "maxRows": None, "keepSplits": True, **kw}
