"""Access-log hygiene (issue #478): query strings are user content and must
not reach the logs in plaintext, even though the fields they filter are
stored encrypted (EXP-NF02).
"""

import logging

from app.log_filters import RedactQueryFilter, SuppressHealthFilter


def _access_record(path: str) -> logging.LogRecord:
    """Build a record shaped like uvicorn's access log line."""
    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, "uvicorn/access.py", 123, None, None, None
    )
    record.msg = '%s - "%s %s HTTP/%s" %d'
    record.args = ("127.0.0.1:50212", "GET", path, "1.1", 200)
    return record


class TestRedactQueryFilter:
    def test_search_query_value_is_not_logged(self):
        record = _access_record("/expenses?search=farmacia%20central&person=maria")

        assert RedactQueryFilter().filter(record) is True

        message = record.getMessage()
        assert message == '127.0.0.1:50212 - "GET /expenses HTTP/1.1" 200'
        assert "farmacia" not in message
        assert "search=" not in message

    def test_path_without_query_is_untouched(self):
        record = _access_record("/expenses")

        RedactQueryFilter().filter(record)

        assert record.getMessage() == '127.0.0.1:50212 - "GET /expenses HTTP/1.1" 200'

    def test_bare_question_mark_keeps_path(self):
        record = _access_record("/expenses?")

        RedactQueryFilter().filter(record)

        assert record.getMessage() == '127.0.0.1:50212 - "GET /expenses HTTP/1.1" 200'


class TestSuppressHealthFilter:
    def test_health_probe_lines_are_dropped(self):
        assert SuppressHealthFilter().filter(_access_record("/health")) is False
        assert SuppressHealthFilter().filter(_access_record("/metrics")) is False

    def test_other_lines_pass(self):
        assert SuppressHealthFilter().filter(_access_record("/expenses")) is True
