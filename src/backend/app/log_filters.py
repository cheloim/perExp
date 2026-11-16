"""Logging filters for the uvicorn access log (wired up in ``main.py``).

One filter drops internal probe noise, the other keeps user content out of
the log: query values are user input that may be PII (free-text search,
person, bank filters) while the fields they match are stored encrypted —
see EXP-NF02 in ``docs/specs/features/expenses.spec.yaml``. Access lines
keep the path, method, status and format intact for operational debugging.
"""

from __future__ import annotations

import logging
import re


class SuppressHealthFilter(logging.Filter):
    """Drop uvicorn access log lines for internal health/metrics probes."""

    _SUPPRESSED = ("/health", "/metrics")

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not any(path in msg for path in self._SUPPRESSED)


class RedactQueryFilter(logging.Filter):
    """Strip query strings from uvicorn access log lines.

    uvicorn logs ``%s - "%s %s HTTP/%s" %d`` with the full path plus query in
    ``args[2]``; this rewrites that slot to the bare path.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str):
            path = args[2]
            if "?" in path:
                record.args = (*args[:2], path.split("?", 1)[0], *args[3:])
        return True


_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_KV_RE = re.compile(r"(?i)\b(description|desc|amount|monto|email|user_email|notes)=([^&\s,;]+)")
_JSON_RE = re.compile(r'(?i)"(description|notes|email|amount)"\s*:\s*(?:"[^"]*"|[-\d.]+)')


class RedactPiiFilter(logging.Filter):
    """Defence in depth for application logs and ``platform_logs``.

    Query strings are already stripped from uvicorn access lines. Free-text
    application messages can still carry an email, an expense description or
    an amount; this filter replaces those values before any handler formats or
    persists the record.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        redacted = _EMAIL_RE.sub("[email]", message)
        redacted = _KV_RE.sub(r"\1=[redacted]", redacted)
        redacted = _JSON_RE.sub(lambda m: f'"{m.group(1)}":"[redacted]"', redacted)
        if redacted != message:
            record.msg = redacted
            record.args = ()
        return True
