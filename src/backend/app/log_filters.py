"""Logging filters for the uvicorn access log (wired up in ``main.py``).

One filter drops internal probe noise, the other keeps user content out of
the log: query values are user input that may be PII (free-text search,
person, bank filters) while the fields they match are stored encrypted —
see EXP-NF02 in ``docs/specs/features/expenses.spec.yaml``. Access lines
keep the path, method, status and format intact for operational debugging.
"""

from __future__ import annotations

import logging


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
