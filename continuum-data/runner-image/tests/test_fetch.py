import hashlib
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from conftest import run_cdata

PAYLOAD = os.urandom(300_000)
SMALL = b"a,b\n1,2\n3,4\n"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    flaky_hits = {}

    def log_message(self, *args):  # keep test output quiet
        pass

    def _send(self, body: bytes, ranged: bool = True, cut: int | None = None):
        start = 0
        rng = self.headers.get("Range")
        if ranged and rng:
            m = re.match(r"bytes=(\d+)-", rng)
            start = int(m.group(1))
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{len(body) - 1}/{len(body)}")
        else:
            self.send_response(200)
        part = body[start:]
        self.send_header("Content-Length", str(len(part)))
        if ranged:
            self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        if cut is not None:
            self.wfile.write(part[:cut])
            self.wfile.flush()
            self.close_connection = True
            return
        self.wfile.write(part)

    def do_GET(self):  # noqa: N802
        if self.path == "/small.csv":
            return self._send(SMALL)
        if self.path == "/big.bin":
            return self._send(PAYLOAD)
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/small.csv")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.path.startswith("/flaky"):
            n = Handler.flaky_hits.get(self.path, 0)
            Handler.flaky_hits[self.path] = n + 1
            if n == 0:
                return self._send(PAYLOAD, ranged=self.path == "/flaky-ranged", cut=100_000)
            return self._send(PAYLOAD, ranged=self.path == "/flaky-ranged")
        if self.path == "/error500":
            self.send_response(500)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.path == "/auth":
            ok = self.headers.get("Authorization") == "Bearer t0k"
            if not ok:
                self.send_response(401)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            return self._send(SMALL)
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()


@pytest.fixture(scope="module")
def server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def fetch(store, files, **kw):
    params = {"output": "raw/run1", "files": files, "maxBytes": 10_000_000, "headers": {}, "allowHttp": True, "allowPrivate": True, **kw}
    return run_cdata("fetch", params, store)


def test_fetch_ok(store, server):
    sha = hashlib.sha256(SMALL).hexdigest()
    r = fetch(store, [{"url": f"{server}/small.csv", "path": "train/small.csv", "bytes": len(SMALL), "sha256": sha},
                      {"url": f"{server}/big.bin", "path": "big.bin", "bytes": None, "sha256": None}])
    assert r.code == 0, (r.lines, r.stderr)
    res = r.result
    assert res["bytes"] == len(SMALL) + len(PAYLOAD)
    assert res["files"][0] == {"path": "train/small.csv", "bytes": len(SMALL), "sha256": sha}
    assert res["files"][1]["sha256"] == hashlib.sha256(PAYLOAD).hexdigest()
    assert (store / "raw/run1/train/small.csv").read_bytes() == SMALL
    assert (store / "raw/run1/big.bin").read_bytes() == PAYLOAD
    assert not (store / "raw/run1.partial").exists()
    prog = r.kinds("progress")
    assert prog and all(p["unit"] == "bytes" for p in prog) and prog[-1]["done"] == res["bytes"]


def test_fetch_redirect_and_headers(store, server):
    r = fetch(store, [{"url": f"{server}/redirect", "path": "a.csv"},
                      {"url": f"{server}/auth", "path": "b.csv"}], headers={"Authorization": "Bearer t0k"})
    assert r.code == 0, r.lines
    assert (store / "raw/run1/a.csv").read_bytes() == SMALL


def test_fetch_size_mismatch(store, server):
    r = fetch(store, [{"url": f"{server}/small.csv", "path": "s.csv", "bytes": len(SMALL) + 5}])
    assert r.code == 1 and r.error["code"] == "SIZE_MISMATCH"
    assert not (store / "raw/run1").exists() and not (store / "raw/run1.partial").exists()


def test_fetch_checksum_mismatch(store, server):
    r = fetch(store, [{"url": f"{server}/small.csv", "path": "s.csv", "sha256": "0" * 64}])
    assert r.code == 1 and r.error["code"] == "CHECKSUM_MISMATCH"


def test_fetch_too_big_declared(store, server):
    r = fetch(store, [{"url": f"{server}/big.bin", "path": "b.bin", "bytes": len(PAYLOAD)}], maxBytes=1000)
    assert r.code == 1 and r.error["code"] == "TOO_BIG"


def test_fetch_too_big_undeclared(store, server):
    r = fetch(store, [{"url": f"{server}/small.csv", "path": "s.csv"}, {"url": f"{server}/big.bin", "path": "b.bin"}],
              maxBytes=200_000)
    assert r.code == 1 and r.error["code"] == "TOO_BIG"
    assert not (store / "raw/run1.partial").exists()


def test_fetch_resume_with_range(store, server):
    r = fetch(store, [{"url": f"{server}/flaky-ranged", "path": "f.bin", "bytes": len(PAYLOAD)}])
    assert r.code == 0, (r.lines, r.stderr)
    assert (store / "raw/run1/f.bin").read_bytes() == PAYLOAD
    assert r.result["files"][0]["sha256"] == hashlib.sha256(PAYLOAD).hexdigest()
    assert any("trying again" in line["message"] for line in r.kinds("log"))


def test_fetch_restart_without_range(store, server):
    r = fetch(store, [{"url": f"{server}/flaky-plain", "path": "f.bin"}])
    assert r.code == 0, (r.lines, r.stderr)
    assert (store / "raw/run1/f.bin").read_bytes() == PAYLOAD


def test_fetch_retries_then_fails(store, server):
    r = fetch(store, [{"url": f"{server}/error500", "path": "e.bin"}])
    assert r.code == 1 and r.error["code"] == "DOWNLOAD_FAILED"
    assert len([line for line in r.kinds("log") if "trying again" in line["message"]]) == 3


def test_fetch_404(store, server):
    r = fetch(store, [{"url": f"{server}/missing", "path": "m.bin"}])
    assert r.code == 1 and r.error["code"] == "HTTP_ERROR"


def test_fetch_http_refused_without_allow(store, server):
    r = fetch(store, [{"url": f"{server}/small.csv", "path": "s.csv"}], allowHttp=False)
    assert r.code == 2 and r.error["code"] == "BAD_URL"
    r = fetch(store, [{"url": "ftp://example.com/x", "path": "s.csv"}])
    assert r.code == 2


def test_fetch_path_escape(store, server):
    for bad in ("../x.csv", "/abs.csv", "a/../../x.csv"):
        r = fetch(store, [{"url": f"{server}/small.csv", "path": bad}])
        assert r.code == 2 and r.error["code"] == "PATH_OUTSIDE_STORE", bad
    r = run_cdata("fetch", {"output": "../out", "files": [{"url": f"{server}/small.csv", "path": "s"}], "allowHttp": True, "allowPrivate": True}, store)
    assert r.code == 2


def test_fetch_rerun_replaces(store, server):
    (store / "raw/run1.partial").mkdir(parents=True)
    (store / "raw/run1.partial/old").write_text("x")
    (store / "raw/run1").mkdir(parents=True)
    (store / "raw/run1/old").write_text("x")
    r = fetch(store, [{"url": f"{server}/small.csv", "path": "s.csv"}])
    assert r.code == 0
    assert sorted(p.name for p in (store / "raw").iterdir()) == ["run1"]
    assert sorted(p.name for p in (store / "raw/run1").iterdir()) == ["s.csv"]
