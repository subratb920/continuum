"""fetch with extract: archives are unpacked safely."""

import io
import tarfile
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from conftest import run_cdata


def _zip(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in entries:
            z.writestr(name, data)
    return buf.getvalue()


def _tgz(entries):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        for name, data in entries:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))
        link = tarfile.TarInfo("evil-link")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/passwd"
        t.addfile(link)
    return buf.getvalue()


FILES = {
    "/good.zip": _zip([("iris/iris.csv", b"a,b\n1,2\n"), ("iris/readme.txt", b"hello")]),
    "/slip.zip": _zip([("../../escape.csv", b"x\n")]),
    "/bomb.zip": _zip([("big.csv", b"0" * 200_000)]),
    "/good.tgz": _tgz([("data/train.csv", b"text,label\nhi,a\n")]),
}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):  # noqa: N802
        body = FILES.get(self.path)
        if body is None:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture(scope="module")
def base():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def fetch(store, base, name, **kw):
    return run_cdata("fetch", {"output": "raw/r1", "allowHttp": True, "allowPrivate": True, "extract": True,
                               "files": [{"url": base + "/" + name, "path": name}], **kw}, store)


def test_zip_and_tgz_unpack(store, base):
    r = fetch(store, base, "good.zip")
    assert r.code == 0, r.stderr
    assert (store / "raw/r1/good/iris/iris.csv").read_bytes() == b"a,b\n1,2\n"
    assert not (store / "raw/r1/good.zip").exists(), "the archive is removed once unpacked"
    assert r.result["files"][0]["unpacked"]["files"] == 2
    r = fetch(store, base, "good.tgz")
    assert r.code == 0, r.stderr
    assert (store / "raw/r1/good/data/train.csv").exists()
    assert not (store / "raw/r1/good/evil-link").exists(), "links are skipped"


def test_zip_slip_is_refused(store, base):
    r = fetch(store, base, "slip.zip")
    assert r.code == 1 and r.error["code"] == "UNSAFE_ARCHIVE"
    assert not (store / "escape.csv").exists() and not (store / "raw/escape.csv").exists()
    assert not (store / "raw/r1").exists(), "nothing is kept from a refused download"


def test_unpacked_size_is_capped(store, base):
    r = fetch(store, base, "bomb.zip", maxBytes=100_000)
    assert r.code == 1 and r.error["code"] == "TOO_BIG"


def test_without_extract_archives_stay(store, base):
    r = run_cdata("fetch", {"output": "raw/r2", "allowHttp": True, "allowPrivate": True, "files": [{"url": base + "/good.zip", "path": "good.zip"}]}, store)
    assert r.code == 0 and (store / "raw/r2/good.zip").exists()


def test_private_addresses_are_refused(store, base):
    r = run_cdata("fetch", {"output": "raw/r3", "allowHttp": True, "files": [{"url": base + "/good.zip", "path": "good.zip"}]}, store, env={"CDATA_TEST": "0"})
    assert r.code == 1 and r.error["code"] == "PRIVATE_ADDRESS"
