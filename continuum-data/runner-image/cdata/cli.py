"""``cdata <op>``: entry point. Parameters come as JSON in ``CDATA_PARAMS``."""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
import traceback
import warnings

from . import protocol
from .protocol import CdataError, ParamError

OPS = ("fetch", "ingest", "profile", "licences")

USAGE = "usage: cdata <op>   (ops: fetch, ingest, profile, licences; parameters as JSON in CDATA_PARAMS)"


def _load_params() -> dict:
    raw = os.environ.get("CDATA_PARAMS")
    if raw is None or not raw.strip():
        return {}
    try:
        params = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ParamError(f"CDATA_PARAMS is not valid JSON: {exc}")
    if not isinstance(params, dict):
        raise ParamError("CDATA_PARAMS must be a JSON object.")
    return params


def _on_sigterm(signum, frame):  # noqa: ARG001
    raise CdataError("CANCELLED", "The step was stopped before it finished.")


def run(op: str, params: dict) -> None:
    if op == "fetch":
        from .ops.fetch import run as fn
    elif op == "ingest":
        from .ops.ingest import run as fn
    elif op == "profile":
        from .ops.profile import run as fn
    elif op == "licences":
        from .licences import run as fn
    else:
        raise ParamError(f"Unknown op '{op}'. {USAGE}", "UNKNOWN_OP")
    fn(params)


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    protocol.install_stdout_guard()
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    warnings.simplefilter("default")
    signal.signal(signal.SIGTERM, _on_sigterm)

    try:
        if len(argv) != 1 or argv[0] in ("-h", "--help"):
            raise ParamError(USAGE, "USAGE")
        run(argv[0], _load_params())
        return protocol.EXIT_OK
    except CdataError as exc:
        protocol.error(exc.code, exc.message)
        return exc.exit_code
    except KeyboardInterrupt:
        protocol.error("CANCELLED", "The step was stopped before it finished.")
        return protocol.EXIT_FAILURE
    except MemoryError:
        protocol.error("OUT_OF_MEMORY", "The step ran out of memory. Try a smaller maxRows or a bigger runner.")
        return protocol.EXIT_FAILURE
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc(file=sys.stderr)
        protocol.error("INTERNAL", f"Something went wrong inside the runner: {type(exc).__name__}: {exc}")
        return protocol.EXIT_FAILURE


def entry() -> None:
    sys.exit(main())
