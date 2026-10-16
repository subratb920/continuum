"""``cdata licences``: refuse installed packages that are not permissively licensed.

Allowed (runner contract, section 4): MIT, Apache-2.0, BSD, ISC, PSF, and
MPL-2.0 for certifi only, plus the entries of ``licence-exceptions.json``.
"""

from __future__ import annotations

import json
import os
import re
from importlib import metadata
from pathlib import Path

from . import protocol
from .protocol import CdataError

ALLOWED_SPDX = {
    "MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "BSD-3-Clause-Clear", "0BSD", "ISC",
    "PSF-2.0", "Python-2.0", "Python-2.0.1",
}
MPL_ONLY_FOR = {"certifi"}
SELF = {"cdata", "continuum-data-runner"}

_CLASSIFIERS = {
    "License :: OSI Approved :: MIT License": "MIT",
    "License :: OSI Approved :: MIT No Attribution License (MIT-0)": "MIT-0",
    "License :: OSI Approved :: Apache Software License": "Apache-2.0",
    "License :: OSI Approved :: BSD License": "BSD-3-Clause",
    "License :: OSI Approved :: ISC License (ISCL)": "ISC",
    "License :: OSI Approved :: Python Software Foundation License": "PSF-2.0",
    "License :: OSI Approved :: Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
}

# Free-text "License:" fields, matched in order.
_TEXT = [
    (re.compile(r"^\s*(the\s+)?mit(\s+license)?\s*$", re.I), "MIT"),
    (re.compile(r"^\s*apache(\s+license)?[\s,-]*(version\s*)?2(\.0)?\s*$", re.I), "Apache-2.0"),
    (re.compile(r"^\s*apache(\s+software)?(\s+license)?\s*$", re.I), "Apache-2.0"),
    (re.compile(r"^\s*(new\s+|modified\s+|simplified\s+|3-clause\s+|2-clause\s+)?bsd([\s-]*(3|2)[\s-]*clause)?(\s+license)?\s*$", re.I), "BSD-3-Clause"),
    (re.compile(r"^\s*isc(\s+license)?\s*$", re.I), "ISC"),
    (re.compile(r"^\s*(psf|python software foundation)(\s+license)?\s*$", re.I), "PSF-2.0"),
    (re.compile(r"^\s*(mpl[\s-]*2(\.0)?|mozilla public license 2\.0.*)\s*$", re.I), "MPL-2.0"),
]


def _exceptions_file() -> Path | None:
    env = os.environ.get("CDATA_LICENCE_EXCEPTIONS")
    candidates = [Path(env)] if env else []
    candidates += [Path(__file__).resolve().parent.parent / "licence-exceptions.json",
                   Path("/opt/cdata/licence-exceptions.json")]
    for c in candidates:
        if c.is_file():
            return c
    return None


def load_exceptions() -> dict[str, dict]:
    path = _exceptions_file()
    if path is None:
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CdataError("BAD_EXCEPTIONS", f"{path.name} could not be read: {exc}")
    entries = data.get("exceptions", []) if isinstance(data, dict) else data
    out = {}
    for e in entries:
        if not isinstance(e, dict) or not e.get("package") or not e.get("reason"):
            raise CdataError("BAD_EXCEPTIONS", f"Every entry in {path.name} needs a 'package' and a 'reason'.")
        out[_norm(e["package"])] = e
    return out


def _norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _expr_ok(expr: str, name: str) -> bool:
    """Evaluate an SPDX expression: OR needs one allowed side, AND needs all."""
    tokens = re.findall(r"\(|\)|[A-Za-z0-9.+:-]+", expr)
    pos = 0

    def allowed(lic: str) -> bool:
        lic = lic.rstrip("+")
        if lic in ALLOWED_SPDX or lic.upper() in {a.upper() for a in ALLOWED_SPDX}:
            return True
        if lic.upper().startswith(("BSD-2-CLAUSE", "BSD-3-CLAUSE")):
            return True
        return lic.upper() == "MPL-2.0" and name in MPL_ONLY_FOR

    def parse_or():
        nonlocal pos
        v = parse_and()
        while pos < len(tokens) and tokens[pos].upper() == "OR":
            pos += 1
            v = parse_and() or v
        return v

    def parse_and():
        nonlocal pos
        v = parse_atom()
        while pos < len(tokens) and tokens[pos].upper() == "AND":
            pos += 1
            v = parse_atom() and v
        return v

    def parse_atom():
        nonlocal pos
        if pos >= len(tokens):
            return False
        t = tokens[pos]
        pos += 1
        if t == "(":
            v = parse_or()
            if pos < len(tokens) and tokens[pos] == ")":
                pos += 1
            return v
        ok = allowed(t)
        if pos < len(tokens) and tokens[pos].upper() == "WITH":
            pos += 2  # an exception only adds permissions
        return ok

    try:
        result = parse_or()
    except IndexError:
        return False
    return bool(result) and pos == len(tokens)


def classify(dist: metadata.Distribution) -> tuple[str, bool]:
    """The licence we found for a distribution and whether it is allowed."""
    name = _norm(dist.metadata.get("Name", ""))
    expr = dist.metadata.get("License-Expression")
    if expr:
        return expr, _expr_ok(expr, name)
    text = (dist.metadata.get("License") or "").strip()
    first = text.splitlines()[0].strip() if text else ""
    if first and len(text) < 200:
        for rx, spdx in _TEXT:
            if rx.match(first):
                return spdx, _expr_ok(spdx, name)
        if re.fullmatch(r"[A-Za-z0-9.+\-() ]+", first) and _expr_ok(first, name):
            return first, True
    found = [_CLASSIFIERS[c] for c in dist.metadata.get_all("Classifier") or [] if c in _CLASSIFIERS]
    if found:
        # Several licence classifiers mean a choice; one allowed one is enough.
        ok = [f for f in found if _expr_ok(f, name)]
        return (" OR ".join(found), bool(ok))
    if text and len(text) >= 200:
        head = text[:400].lower()
        if "permission is hereby granted, free of charge" in head:
            return "MIT", True
        if "apache license" in head and "version 2.0" in head:
            return "Apache-2.0", True
        if "redistribution and use in source and binary forms" in head:
            return "BSD-3-Clause", True
    return first or "unknown", False


def run(params: dict) -> None:  # noqa: ARG001
    exceptions = load_exceptions()
    packages, denied = [], []
    seen = set()
    for dist in sorted(metadata.distributions(), key=lambda d: _norm(d.metadata.get("Name") or "")):
        name = _norm(dist.metadata.get("Name") or "")
        if not name or name in seen:
            continue
        seen.add(name)
        version = dist.version
        if name in SELF:
            continue
        licence, ok = classify(dist)
        via = None
        if not ok and name in exceptions:
            ok, via = True, exceptions[name]["reason"]
        entry = {"name": name, "version": version, "licence": licence, "allowed": ok}
        if via:
            entry["exception"] = via
        packages.append(entry)
        if not ok:
            denied.append(entry)
    for p in denied:
        protocol.log(f"Not allowed: {p['name']} {p['version']} ({p['licence']}).")
    if denied:
        raise CdataError("LICENCE_NOT_ALLOWED",
                         f"{len(denied)} installed package(s) are not under an allowed licence: "
                         + ", ".join(f"{p['name']} ({p['licence']})" for p in denied))
    protocol.log(f"All {len(packages)} installed packages have an allowed licence.")
    protocol.result(packages=packages, denied=[])
