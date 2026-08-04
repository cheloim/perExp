"""Platform log handler — captures WARNING+ logs and writes to DB."""

import logging
import threading
from datetime import UTC, datetime


class PlatformLogHandler(logging.Handler):
    """Buffers WARNING+ log records and flushes to platform_logs table every 5 seconds."""

    def __init__(self, flush_interval: float = 5.0):
        super().__init__(level=logging.WARNING)
        self._buffer: list[dict] = []
        self._lock = threading.Lock()
        self._flush_interval = flush_interval
        self._stop_event = threading.Event()
        self._flush_thread = threading.Thread(target=self._flush_loop, daemon=True)
        self._flush_thread.start()

    def emit(self, record: logging.LogRecord):
        if record.levelno < logging.WARNING:
            return
        try:
            details = None
            if record.exc_info and record.exc_info[1]:
                details = self.format(record)

            entry = {
                "level": record.levelname,
                "module": record.name[:100],
                "message": record.getMessage()[:2000],
                "details": details,
                "created_at": datetime.now(UTC),
            }
            with self._lock:
                self._buffer.append(entry)
        except Exception:
            self.handleError(record)

    def _flush_loop(self):
        while not self._stop_event.wait(self._flush_interval):
            self._flush_to_db()

    def _flush_to_db(self):
        with self._lock:
            if not self._buffer:
                return
            batch = self._buffer[:]
            self._buffer.clear()

        try:
            from app.database import SessionLocal
            from app.models import PlatformLog

            db = SessionLocal()
            try:
                for entry in batch:
                    db.add(PlatformLog(**entry))
                db.commit()
            finally:
                db.close()
        except Exception:
            # If DB write fails, put entries back (avoid infinite loop)
            with self._lock:
                self._buffer = batch[:50] + self._buffer  # Keep max 50 retries

    def flush(self):
        self._flush_to_db()

    def stop(self):
        self._stop_event.set()
        self._flush_to_db()  # Final flush
        self._flush_thread.join(timeout=5)
