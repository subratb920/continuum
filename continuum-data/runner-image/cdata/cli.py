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

OPS = ("fetch", "ingest", "profile", "dedupe", "filter", "fix_types", "fill_missing", "outliers", "split", "redact_pii", "safety", "balance", "to_chat", "resize", "resample", "augment", "validate", "export", "licences")

USAGE = "usage: cdata <op>   (ops: " + ", ".join(OPS) + "; parameters as JSON in CDATA_PARAMS)"


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
    elif op == "dedupe":
        from .ops.dedupe import run as fn
    elif op in ("filter", "fix_types", "fill_missing", "outliers"):
        from .ops import clean

        fn = getattr(clean, f"run_{op}")
    elif op in ("redact_pii", "safety"):
        from .ops import privacy

        fn = privacy.run_redact if op == "redact_pii" else privacy.run_safety
    elif op in ("balance", "to_chat"):
        from .ops import shape

        fn = shape.run_balance if op == "balance" else shape.run_to_chat
    elif op in ("resize", "resample", "augment"):
        from .ops import media_ops

        fn = getattr(media_ops, f"run_{op}")
    elif op == "split":
        from .ops.split import run as fn
    elif op == "validate":
        from .ops.validate import run as fn
    elif op == "export":
        from .ops.export import run as fn
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
    # Python's own file-handle notes are not for the build log
    warnings.filterwarnings("ignore", category=ResourceWarning)
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
