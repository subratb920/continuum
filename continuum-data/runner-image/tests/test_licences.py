import json
import sys
from pathlib import Path

import pytest

from conftest import ROOT, run_cdata

sys.path.insert(0, str(ROOT))
from cdata import licences  # noqa: E402


@pytest.mark.parametrize("expr,name,ok", [
    ("MIT", "x", True),
    ("Apache-2.0", "x", True),
    ("BSD-3-Clause", "x", True),
    ("MIT OR GPL-3.0-only", "x", True),
    ("MIT AND GPL-3.0-only", "x", False),
    ("(Apache-2.0 OR MIT) AND BSD-2-Clause", "x", True),
    ("Apache-2.0 WITH LLVM-exception", "x", True),
    ("GPL-3.0-or-later", "x", False),
    ("MPL-2.0", "certifi", True),
    ("MPL-2.0", "other", False),
    ("LGPL-2.1", "x", False),
    ("PSF-2.0", "x", True),
])
def test_spdx_expressions(expr, name, ok):
    assert licences._expr_ok(expr, name) is ok


class FakeDist:
    def __init__(self, meta, classifiers=()):
        self._meta = meta
        self._cls = list(classifiers)

    @property
    def metadata(self):
        outer = self

        class M:
            def get(self, k, d=None):
                return outer._meta.get(k, d)

            def get_all(self, k):
                return outer._cls if k == "Classifier" else None

        return M()


def test_classify_fallbacks():
    assert licences.classify(FakeDist({"Name": "a", "License": "BSD"})) == ("BSD-3-Clause", True)
    assert licences.classify(FakeDist({"Name": "a", "License": "GPL v3"}))[1] is False
    assert licences.classify(FakeDist({"Name": "a"}, ["License :: OSI Approved :: MIT License"])) == ("MIT", True)
    assert licences.classify(FakeDist({"Name": "a"}))[1] is False


def test_licences_command_passes_in_test_env(store):
    r = run_cdata("licences", None, store)
    # The test venv contains pytest and friends, all MIT; the runtime deps are MIT / Apache / BSD.
    assert r.code == 0, (r.lines, r.stderr)
    names = {p["name"] for p in r.result["packages"]}
    assert {"polars", "pyarrow", "pypdf", "fastexcel"} <= names


def test_licences_exception_file(store, tmp_path):
    bad = tmp_path / "ex.json"
    bad.write_text(json.dumps({"exceptions": [{"package": "x"}]}))
    r = run_cdata("licences", None, store, env={"CDATA_LICENCE_EXCEPTIONS": str(bad)})
    assert r.code == 1 and r.error["code"] == "BAD_EXCEPTIONS"


def test_exceptions_file_is_valid():
    data = json.loads((Path(ROOT) / "licence-exceptions.json").read_text())
    for e in data["exceptions"]:
        assert e["package"] and e["reason"]
