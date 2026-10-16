"""redact_pii and safety: personal details and unsafe words in text."""

from __future__ import annotations

import re

import polars as pl

from .. import protocol
from ..protocol import ParamError, fmt_int, get_param
from ._version import add_flag, read_version, sample_rows, write_version

# Order matters: longer, more specific patterns first, so a card number is not
# also taken for a phone number.
PATTERNS = [
    ("email", "[EMAIL]", re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")),
    ("iban", "[IBAN]", re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b")),
    ("card", "[CARD]", re.compile(r"\b(?:\d[ -]?){12,18}\d\b")),
    ("aadhaar", "[ID]", re.compile(r"\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b")),
    ("ssn", "[ID]", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    ("pan", "[ID]", re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")),
    ("ip", "[IP]", re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b")),
    ("phone", "[PHONE]", re.compile(r"(?<![\w+])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?)?\d{2,4}(?:[ .-]?\d{2,4}){2,4}(?!\w)")),
]
KINDS = {k for k, _, _ in PATTERNS}
WORDS = {"email": "email addresses", "iban": "bank account numbers", "card": "card numbers", "aadhaar": "Aadhaar numbers",
         "ssn": "social security numbers", "pan": "PAN numbers", "ip": "IP addresses", "phone": "phone numbers"}


def _luhn(digits: str) -> bool:
    total, alt = 0, False
    for ch in reversed(digits):
        d = int(ch)
        if alt:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
        alt = not alt
    return total % 10 == 0


_VERHOEFF_D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
               [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
               [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
               [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
_VERHOEFF_P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
               [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
               [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]]


def _verhoeff(digits: str) -> bool:
    """Aadhaar numbers end in a Verhoeff check digit; other 12-digit numbers rarely pass."""
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _VERHOEFF_D[c][_VERHOEFF_P[i % 8][int(ch)]]
    return c == 0


def _redactor(kinds: set, counts: dict):
    def redact(text):
        if not isinstance(text, str) or not text:
            return text
        for kind, mark, rx in PATTERNS:
            if kind not in kinds:
                continue

            def sub(m, kind=kind, mark=mark):
                found = m.group(0)
                digits = re.sub(r"\D", "", found)
                if kind == "card" and not (13 <= len(digits) <= 19 and _luhn(digits)):
                    return found
                if kind == "aadhaar" and not _verhoeff(digits):
                    return found
                if kind == "phone" and not (8 <= len(digits) <= 15):
                    return found
                counts[kind] = counts.get(kind, 0) + 1
                return mark

            text = rx.sub(sub, text)
        return text

    return redact


def _as_text(series: pl.Series, col: str) -> pl.Series:
    """A column as plain text (chat messages: their contents joined)."""
    if col == "messages":
        return series.list.eval(pl.element().struct.field("content")).list.join("\n")
    return series.cast(pl.String)


def _text_columns(v) -> list[str]:
    return [c for c in v.content_columns if c != v.label and (v.df.schema[c] == pl.String or c == "messages")]


def _apply(df: pl.DataFrame, col: str, fn) -> pl.Series:
    if col == "messages":
        return df[col].map_elements(lambda msgs: [{**m, "content": fn(m.get("content"))} for m in msgs] if msgs is not None else None,
                                    return_dtype=df.schema[col])
    return df[col].map_elements(fn, return_dtype=pl.String, skip_nulls=True)


def run_redact(params: dict) -> None:
    v = read_version(params)
    kinds = set(get_param(params, "kinds", list, sorted(KINDS)))
    unknown = kinds - KINDS
    if unknown:
        raise ParamError(f"Unknown kinds of personal details: {', '.join(sorted(unknown))}.")
    action = get_param(params, "action", str, "replace")
    if action not in ("replace", "drop", "flag"):
        raise ParamError("action must be 'replace', 'drop' or 'flag'.")
    cols = _text_columns(v)
    if not cols:
        raise ParamError("There are no text columns to check.", "NO_COLUMNS")
    counts: dict = {}
    fn = _redactor(kinds, counts)
    df = v.df
    new = {c: _apply(df, c, fn) for c in cols}
    hit = pl.Series([False] * df.height)
    for c in cols:
        hit = hit | (_as_text(new[c], c) != _as_text(df[c], c)).fill_null(False)
    found = int(hit.sum())
    sample = sample_rows(df.filter(hit), "personal details")
    notes = [f"{fmt_int(n)} {WORDS[k]}" for k, n in sorted(counts.items(), key=lambda x: -x[1])]
    removed = changed = 0
    if action == "replace":
        df = df.with_columns([new[c].alias(c) for c in cols])
        df = add_flag(df, hit, "pii_redacted")
        changed = found
        if found:
            notes.append("Replaced with markers like [EMAIL].")
        notes.append("Names aren't looked for yet; that comes with AI help.")
        sample = sample_rows(df.filter(hit), "personal details replaced")
    elif action == "drop":
        df = df.filter(~hit)
        removed = found
    else:
        df = add_flag(df, hit, "pii")
        changed = found
    protocol.log(f"Found personal details in {fmt_int(found)} rows." if found else "No personal details found.")
    write_version(v, df, params, op="redact_pii", removed=removed, changed=changed, sample=sample, notes=notes)


# A short list of clearly adult or abusive words, matched as whole words.
# It catches the obvious cases; a smarter checker comes with AI help (D4).
UNSAFE = [
    "fuck", "fucking", "fucked", "motherfucker", "shit", "bullshit", "cunt", "bitch", "bastard", "asshole", "dick",
    "cock", "pussy", "whore", "slut", "porn", "porno", "pornography", "nude", "nudes", "blowjob", "handjob",
    "dildo", "orgasm", "masturbate", "masturbation", "rape", "rapist", "molest", "pedophile", "incest",
    "kill yourself", "kys", "suicide method", "behead", "bomb making",
]


def run_safety(params: dict) -> None:
    v = read_version(params)
    action = get_param(params, "action", str, "drop")
    if action not in ("drop", "flag"):
        raise ParamError("action must be 'drop' or 'flag'.")
    extra = [str(w).strip().lower() for w in get_param(params, "extraWords", list, []) if str(w).strip()]
    words = sorted(set(UNSAFE + extra), key=len, reverse=True)
    rx = r"(?i)\b(?:" + "|".join(re.escape(w) for w in words) + r")\b"
    cols = _text_columns(v)
    if not cols:
        raise ParamError("There are no text columns to check.", "NO_COLUMNS")
    hit = pl.Series([False] * v.df.height)
    for c in cols:
        hit = hit | _as_text(v.df[c], c).str.contains(rx).fill_null(False)
    found = int(hit.sum())
    df = v.df
    notes = ["A simple word check. A smarter check comes with AI help."]
    if action == "drop":
        df = df.filter(~hit)
        removed, changed = found, 0
    else:
        df = add_flag(df, hit, "unsafe")
        removed, changed = 0, found
    protocol.log(f"Found unsafe words in {fmt_int(found)} rows." if found else "No unsafe words found.")
    # The sample says why, but never repeats the unsafe text itself
    sample = [{"_id": r, "reason": "unsafe words", "row": {"_id": r}} for r in v.df.filter(hit)["_id"].head(50).to_list()]
    write_version(v, df, params, op="safety", removed=removed, changed=changed, sample=sample, notes=notes)
