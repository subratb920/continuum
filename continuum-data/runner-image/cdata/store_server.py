"""The data store in the cloud: users' dataset folders on one disk, served to
continuum-api (which can't mount the disk itself).

Kubernetes only (DATA_RUNTIME=kubernetes): continuum-api starts this as the
pod "data-store" with the disk at CDATA_STORE_ROOT; each step's pod mounts the
same disk with only its user's folder as /store, on the same machine. Every
call but /health needs the token (CDATA_STORE_TOKEN). Paths are relative to a
user's folder and can't leave it.

    GET    /health
    POST   /u/<userId>/ensure             the user's folder exists
    GET    /u/<userId>/usage              {"bytes": n}
    GET    /u/<userId>/stat?path=…        {"size": n, "dir": bool} (404: none)
    GET    /u/<userId>/file?path=…        the file (Range: bytes=a-b → 206)
    PUT    /u/<userId>/file?path=…&max=n  writes the body (413 past max bytes)
    DELETE /u/<userId>/file?path=…        removes a file or folder
"""

import hmac
import json
import os
import re
import shutil
import sys
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.realpath(os.environ.get("CDATA_STORE_ROOT", "/data"))
TOKEN = os.environ.get("CDATA_STORE_TOKEN", "")
PORT = int(os.environ.get("CDATA_STORE_PORT", "45192"))
USER = re.compile(r"^[0-9a-f]{24}$")
ROUTE = re.compile(r"^/u/([^/]+)/(ensure|usage|stat|file)$")
RANGE = re.compile(r"^bytes=(\d+)-(\d*)$")
CHUNK = 1024 * 1024


class Refused(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def user_dir(user_id):
    if not USER.match(user_id):
        raise Refused(400, "bad user")
    return os.path.join(ROOT, user_id)


def inside(user_id, rel):
    """The full path of rel in the user's folder; refused when it would leave it."""
    base = user_dir(user_id)
    if not rel or rel.startswith("/") or "\\" in rel or "\0" in rel:
        raise Refused(400, "bad path")
    parts = rel.split("/")
    if any(p in ("", ".", "..") for p in parts):
        raise Refused(400, "bad path")
    full = os.path.join(base, *parts)
    # A link inside the folder mustn't lead out of it
    real = os.path.realpath(full)
    if real != base and not real.startswith(base + os.sep):
        raise Refused(400, "bad path")
    return full


def folder_size(path):
    total = 0
    for dirpath, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.lstat(os.path.join(dirpath, f)).st_size
            except OSError:
                pass
    return total


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "cdata-store"

    def log_message(self, *args):  # quiet: continuum-api logs what matters
        pass

    def reply(self, status, body=None):
        data = json.dumps(body if body is not None else {}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def route(self, method):
        url = urlparse(self.path)
        if method == "GET" and url.path == "/health":
            return self.reply(200, {"ok": True})
        auth = self.headers.get("Authorization", "")
        if not TOKEN or not hmac.compare_digest(auth.encode(), f"Bearer {TOKEN}".encode()):
            return self.reply(401, {"error": "unauthorised"})
        m = ROUTE.match(url.path)
        if not m:
            return self.reply(404, {"error": "not found"})
        user_id, what = m.group(1), m.group(2)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            getattr(self, f"do_{method.lower()}_{what}")(user_id, q)
        except AttributeError:
            self.reply(405, {"error": "method not allowed"})
        except Refused as e:
            self.reply(e.status, {"error": str(e)})
        except FileNotFoundError:
            self.reply(404, {"error": "not found"})

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_PUT(self):
        self.route("PUT")

    def do_DELETE(self):
        self.route("DELETE")

    # ---- calls ----

    def do_post_ensure(self, user_id, _q):
        os.makedirs(user_dir(user_id), exist_ok=True)
        self.reply(200, {"ok": True})

    def do_get_usage(self, user_id, _q):
        self.reply(200, {"bytes": folder_size(user_dir(user_id))})

    def do_get_stat(self, user_id, q):
        full = inside(user_id, q.get("path", ""))
        st = os.stat(full)
        is_dir = os.path.isdir(full)
        self.reply(200, {"size": folder_size(full) if is_dir else st.st_size, "dir": is_dir})

    def do_get_file(self, user_id, q):
        full = inside(user_id, q.get("path", ""))
        if os.path.isdir(full):
            raise Refused(400, "that is a folder")
        size = os.stat(full).st_size
        start, end = 0, size - 1
        status = 200
        r = RANGE.match(self.headers.get("Range", ""))
        if r:
            start = int(r.group(1))
            end = min(int(r.group(2)) if r.group(2) else size - 1, size - 1)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            status = 206
        length = end - start + 1 if size else 0
        with open(full, "rb") as f:
            self.send_response(status)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(length))
            self.send_header("Accept-Ranges", "bytes")
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            f.seek(start)
            left = length
            while left > 0:
                data = f.read(min(CHUNK, left))
                if not data:
                    break
                self.wfile.write(data)
                left -= len(data)

    def body_chunks(self):
        """The request body, plain or chunked."""
        if "chunked" in self.headers.get("Transfer-Encoding", "").lower():
            while True:
                line = self.rfile.readline().strip()
                n = int(line.split(b";")[0], 16)
                if n == 0:
                    while self.rfile.readline().strip():
                        pass  # trailers
                    return
                left = n
                while left > 0:
                    data = self.rfile.read(min(CHUNK, left))
                    if not data:
                        raise Refused(400, "body ended early")
                    left -= len(data)
                    yield data
                self.rfile.readline()  # the chunk's CRLF
        else:
            left = int(self.headers.get("Content-Length", "0"))
            while left > 0:
                data = self.rfile.read(min(CHUNK, left))
                if not data:
                    raise Refused(400, "body ended early")
                left -= len(data)
                yield data

    def do_put_file(self, user_id, q):
        full = inside(user_id, q.get("path", ""))
        most = int(q.get("max", "0")) or None
        os.makedirs(os.path.dirname(full), exist_ok=True)
        part = f"{full}.part-{uuid.uuid4().hex[:8]}"
        seen = 0
        too_big = False
        try:
            with open(part, "wb") as f:
                for data in self.body_chunks():
                    seen += len(data)
                    if most is not None and seen > most:
                        too_big = True
                        continue  # read the rest, so the connection stays usable
                    f.write(data)
            if too_big:
                raise Refused(413, "too big")
            os.replace(part, full)
        finally:
            if os.path.exists(part):
                os.remove(part)
        self.reply(200, {"bytes": seen})

    def do_delete_file(self, user_id, q):
        full = inside(user_id, q.get("path", ""))
        if os.path.isdir(full) and not os.path.islink(full):
            shutil.rmtree(full, ignore_errors=True)
        elif os.path.lexists(full):
            os.remove(full)
        self.reply(200, {"ok": True})


def main():
    if not TOKEN:
        print("CDATA_STORE_TOKEN isn't set", file=sys.stderr)
        sys.exit(2)
    os.makedirs(ROOT, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    print(json.dumps({"kind": "log", "message": f"data store on :{PORT}, root {ROOT}"}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
