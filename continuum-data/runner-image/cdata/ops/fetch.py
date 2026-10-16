"""fetch: download files into ``<output>/<path>`` (stdlib urllib only)."""

from __future__ import annotations

import hashlib
import http.client
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .. import protocol
from ..protocol import CdataError, ParamError, Progress, fmt_int, get_param

RETRIES = 3  # retries after the first attempt
CHUNK = 1024 * 1024
TIMEOUT = float(os.environ.get("CDATA_FETCH_TIMEOUT", "60"))
USER_AGENT = "continuum-data-runner/0.1 (+urllib)"
_SENSITIVE = {"authorization", "cookie", "proxy-authorization"}


def _backoff(attempt: int) -> float:
    base = float(os.environ.get("CDATA_FETCH_BACKOFF", "2"))
    return base * (2 ** (attempt - 1))


class _Redirects(urllib.request.HTTPRedirectHandler):
    """Follows redirects, refuses a downgrade to a scheme that is not allowed,
    and drops credentials when the redirect goes to another host."""

    def __init__(self, allow_http: bool):
        super().__init__()
        self.allow_http = allow_http

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        scheme = urllib.parse.urlsplit(newurl).scheme.lower()
        if scheme not in (("https", "http") if self.allow_http else ("https",)):
            raise CdataError("BAD_REDIRECT", f"The server redirected to a URL that is not allowed: {newurl}")
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and urllib.parse.urlsplit(newurl).hostname != urllib.parse.urlsplit(req.full_url).hostname:
            for name in list(new.headers):
                if name.lower() in _SENSITIVE:
                    del new.headers[name]
            for name in list(new.unredirected_hdrs):
                if name.lower() in _SENSITIVE:
                    del new.unredirected_hdrs[name]
        return new


class _Transient(Exception):
    """A failure worth retrying."""

    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class _Budget:
    def __init__(self, max_bytes: int | None):
        self.max_bytes = max_bytes
        self.used = 0

    def check(self, extra: int) -> None:
        if self.max_bytes is not None and self.used + extra > self.max_bytes:
            raise CdataError(
                "TOO_BIG",
                f"The download would be bigger than the allowed {fmt_int(self.max_bytes)} bytes, so it was stopped.",
            )


def _validate(params: dict):
    output = get_param(params, "output", str, required=True)
    files = get_param(params, "files", list, required=True)
    if not files:
        raise ParamError("'files' must list at least one file.")
    max_bytes = get_param(params, "maxBytes", int)
    if max_bytes is not None and max_bytes < 0:
        raise ParamError("'maxBytes' must not be negative.")
    headers = get_param(params, "headers", dict, default={})
    for k, v in headers.items():
        if not isinstance(v, str) or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", str(k)) or "\n" in v or "\r" in v:
            raise ParamError(f"Header '{k}' is not a valid HTTP header.")
    allow_http = get_param(params, "allowHttp", bool, default=False)

    seen = set()
    clean = []
    for i, f in enumerate(files):
        if not isinstance(f, dict):
            raise ParamError(f"files[{i}] must be an object.")
        url = get_param(f, "url", str, required=True)
        scheme = urllib.parse.urlsplit(url).scheme.lower()
        if scheme != "https" and not (scheme == "http" and allow_http):
            raise ParamError(f"files[{i}].url must be an https:// URL: {url}", "BAD_URL")
        if not urllib.parse.urlsplit(url).hostname:
            raise ParamError(f"files[{i}].url has no host: {url}", "BAD_URL")
        path = protocol.check_relative(get_param(f, "path", str, required=True), f"files[{i}].path")
        norm = os.path.normpath(path)
        if norm in seen:
            raise ParamError(f"files[{i}].path is listed twice: {path}")
        seen.add(norm)
        size = get_param(f, "bytes", int)
        if size is not None and size < 0:
            raise ParamError(f"files[{i}].bytes must not be negative.")
        sha = get_param(f, "sha256", str)
        if sha is not None and not re.fullmatch(r"[0-9a-fA-F]{64}", sha):
            raise ParamError(f"files[{i}].sha256 must be 64 hex characters.")
        clean.append({"url": url, "path": path, "bytes": size, "sha256": sha.lower() if sha else None})
    return output, clean, max_bytes, headers, allow_http


def _parse_content_range(value: str | None):
    m = re.match(r"bytes (\d+)-(\d+)/(\d+|\*)", value or "")
    if not m:
        return None
    return int(m.group(1)), (None if m.group(3) == "*" else int(m.group(3)))


def _download(opener, item: dict, dest: Path, headers: dict, budget: _Budget, progress: Progress) -> tuple[int, str]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()
    have = 0
    expected = item["bytes"]
    attempt = 0
    with open(dest, "wb") as out:
        while True:
            attempt += 1
            try:
                req = urllib.request.Request(item["url"], headers={"User-Agent": USER_AGENT, **headers})
                if have:
                    req.add_header("Range", f"bytes={have}-")
                try:
                    resp = opener.open(req, timeout=TIMEOUT)
                except urllib.error.HTTPError as exc:
                    if exc.code == 416 and have and expected is not None and have == expected:
                        break  # already complete
                    if exc.code in (408, 425, 429) or exc.code >= 500:
                        ra = exc.headers.get("Retry-After") if exc.headers else None
                        raise _Transient(f"HTTP {exc.code}", float(ra) if ra and ra.isdigit() else None)
                    raise CdataError("HTTP_ERROR", f"The server answered {exc.code} {exc.reason} for {item['url']}.")
                with resp:
                    status = resp.status
                    if have and status == 206:
                        cr = _parse_content_range(resp.headers.get("Content-Range"))
                        if not cr or cr[0] != have:
                            status = -1  # unusable partial response: start again
                    if have and status != 206:
                        # The server ignored the Range: start the file again.
                        budget.used -= have
                        progress.advance(-have)
                        out.seek(0)
                        out.truncate()
                        hasher = hashlib.sha256()
                        have = 0
                        if status == -1:
                            raise _Transient("unusable partial response")
                    length = resp.headers.get("Content-Length")
                    remaining = int(length) if length and length.isdigit() else None
                    if remaining is not None:
                        if expected is not None and have + remaining != expected:
                            raise CdataError(
                                "SIZE_MISMATCH",
                                f"{item['path']}: expected {fmt_int(expected)} bytes but the server says it has {fmt_int(have + remaining)}.",
                            )
                        budget.check(remaining)
                    got = 0
                    while True:
                        try:
                            chunk = resp.read(CHUNK)
                        except http.client.IncompleteRead as exc:
                            chunk = exc.partial
                            if chunk:
                                out.write(chunk)
                                hasher.update(chunk)
                                have += len(chunk)
                                budget.used += len(chunk)
                                progress.advance(len(chunk))
                            raise _Transient("connection closed early")
                        if not chunk:
                            break
                        budget.check(len(chunk))
                        if expected is not None and have + len(chunk) > expected:
                            raise CdataError(
                                "SIZE_MISMATCH",
                                f"{item['path']}: expected {fmt_int(expected)} bytes but the server sent more.",
                            )
                        out.write(chunk)
                        hasher.update(chunk)
                        have += len(chunk)
                        got += len(chunk)
                        budget.used += len(chunk)
                        progress.advance(len(chunk))
                    if remaining is not None and got < remaining:
                        raise _Transient("connection closed early")
                    if remaining is None and expected is not None and have < expected:
                        raise _Transient("connection closed early")
                break
            except (_Transient, urllib.error.URLError, http.client.HTTPException, socket.timeout, ConnectionError, TimeoutError) as exc:
                if isinstance(exc, urllib.error.URLError) and isinstance(exc.reason, CdataError):
                    raise exc.reason
                if attempt > RETRIES:
                    reason = getattr(exc, "reason", None) or exc
                    raise CdataError("DOWNLOAD_FAILED", f"Could not download {item['url']} after {RETRIES + 1} tries: {reason}")
                wait = _backoff(attempt)
                if isinstance(exc, _Transient) and exc.retry_after is not None:
                    wait = min(max(wait, exc.retry_after), 60.0)
                protocol.log(f"Download of {item['path']} was interrupted ({exc}); trying again in {wait:g} s.")
                time.sleep(wait)
        out.flush()
        os.fsync(out.fileno())

    if expected is not None and have != expected:
        raise CdataError("SIZE_MISMATCH", f"{item['path']}: expected {fmt_int(expected)} bytes but got {fmt_int(have)}.")
    digest = hasher.hexdigest()
    if item["sha256"] and digest != item["sha256"]:
        raise CdataError("CHECKSUM_MISMATCH", f"{item['path']}: the file's SHA-256 does not match the expected value.")
    return have, digest


def run(params: dict) -> None:
    output_rel, files, max_bytes, headers, allow_http = _validate(params)
    output = protocol.resolve(output_rel, "output")
    for f in files:  # check every target before touching the disk
        protocol.resolve_in(output, f["path"], "files[].path")

    budget = _Budget(max_bytes)
    declared = [f["bytes"] for f in files]
    if all(b is not None for b in declared):
        budget.check(sum(declared))
        total = sum(declared)
    else:
        total = None

    opener = urllib.request.build_opener(_Redirects(allow_http))
    partial = protocol.begin_output(output)
    progress = Progress("bytes", total)
    progress.update(0, force=True)
    done = []
    try:
        for f in files:
            dest = protocol.resolve_in(partial, f["path"], "files[].path")
            protocol.log(f"Downloading {f['path']}.")
            size, digest = _download(opener, f, dest, headers, budget, progress)
            done.append({"path": f["path"], "bytes": size, "sha256": digest})
        progress.finish()
        protocol.commit_output(output, partial)
    except BaseException:
        protocol.abandon_output(partial)
        raise
    total_bytes = sum(d["bytes"] for d in done)
    protocol.metric("files", len(done))
    protocol.metric("bytes", total_bytes)
    protocol.log(f"Downloaded {len(done)} file(s), {fmt_int(total_bytes)} bytes.")
    protocol.result(files=done, bytes=total_bytes)
