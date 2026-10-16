"""Pick the newest release of each package that is at least two weeks old, and
download its wheels for the image (CPython 3.12, Linux, this machine's
architecture) into wheels/. For slow networks: retries each request.

Usage: python3 tools/pick_wheels.py wheels <cutoff YYYY-MM-DD> <arch> name ...
"""
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
import urllib.request

out, cutoff, arch, names = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
cut = dt.datetime.fromisoformat(cutoff).replace(tzinfo=dt.timezone.utc)
os.makedirs(out, exist_ok=True)


def get(url, accept=None, timeout=60):
    for i in range(6):
        try:
            req = urllib.request.Request(url, headers={"Accept": accept} if accept else {})
            return urllib.request.urlopen(req, timeout=timeout).read()
        except Exception as e:  # noqa: BLE001
            print("retry", url, e, file=sys.stderr)
            time.sleep(5 * (i + 1))
    raise SystemExit(f"failed {url}")


def fits(fn):
    if fn.endswith("-none-any.whl"):
        return True
    m = re.match(r".+-(cp\d+|py3|py2\.py3)-(cp\d+|abi3|none)-(.+)\.whl$", fn)
    if not m:
        return False
    py, abi, plat = m.groups()
    return (py == "cp312" or abi in ("abi3", "none")) and "manylinux" in plat and arch in plat and "musl" not in plat


for name in names:
    idx = json.loads(get(f"https://pypi.org/simple/{name}/", "application/vnd.pypi.simple.v1+json"))
    by_version = {}
    for f in idx["files"]:
        fn = f["filename"]
        m = re.match(rf"{re.escape(name.replace('-', '_'))}-([0-9][0-9.]*)-", fn, re.I)
        if not m or not f.get("upload-time") or f.get("yanked"):
            continue
        t = dt.datetime.fromisoformat(f["upload-time"].replace("Z", "+00:00"))
        by_version.setdefault(m.group(1).rstrip("."), []).append((t, f))
    ok = [v for v, fs in by_version.items() if max(t for t, _ in fs) < cut and re.fullmatch(r"\d+(\.\d+)*", v) and any(fits(f["filename"]) for _, f in fs)]
    best = max(ok, key=lambda v: [int(x) for x in v.split(".")])
    for _, f in by_version[best]:
        if not fits(f["filename"]):
            continue
        dest = os.path.join(out, f["filename"])
        if not os.path.exists(dest):
            data = get(f["url"], timeout=180)
            assert hashlib.sha256(data).hexdigest() == f["hashes"]["sha256"], f["filename"]
            open(dest, "wb").write(data)
        print(f"{name}=={best}", f["filename"])
