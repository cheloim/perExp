"""Render an assistant reply as a downloadable image.

The assistant streams markdown; the browser keeps the text. Exporting is an
application action, not a model action: the same text is rendered through the
existing Playwright report pipeline so the image matches the rest of the app.
"""

import threading
from datetime import datetime
from html import escape
from pathlib import Path

import markdown
from jinja2 import Environment, FileSystemLoader

from app.services.report_renderer import render_report_image

_TEMPLATE_DIR = Path(__file__).resolve().parent
_ENV = Environment(loader=FileSystemLoader(str(_TEMPLATE_DIR)))

_MARKDOWN_EXTENSIONS = ["tables", "fenced_code", "sane_lists"]

# Playwright launches a browser per render. The endpoint is rate-limited per
# day, but a burst could still start several Chromium instances at once.
_RENDER_LOCK = threading.Lock()


def _render_markdown(text: str) -> str:
    # Escape raw HTML before parsing markdown: model output is untrusted, and
    # Jinja renders this body unescaped by design. Only ``<`` and ``&`` are
    # escaped; ``>`` must survive so blockquotes keep working.
    safe = (text or "").replace("&", "&amp;").replace("<", "&lt;")
    return markdown.markdown(safe, extensions=_MARKDOWN_EXTENSIONS)


def _context(
    text: str,
    title: str | None,
    created_at: datetime | None,
) -> dict:
    return {
        "title": escape(title or "Análisis del asistente"),
        "body": _render_markdown(text),
        "date": (created_at or datetime.now()).strftime("%d/%m/%Y %H:%M"),
    }


def render_analysis_html(
    text: str,
    title: str | None = None,
    created_at: datetime | None = None,
) -> str:
    """The standalone HTML used for the image and for tests."""
    template = _ENV.get_template("analysis_report.html")
    return template.render(**_context(text, title, created_at))


def render_analysis_image(
    text: str,
    title: str | None = None,
    created_at: datetime | None = None,
) -> bytes:
    """Render the reply to a PNG using the shared Playwright renderer."""
    with _RENDER_LOCK:
        return render_report_image(
            "analysis_report.html",
            _context(text, title, created_at),
            width=900,
            block_external=True,
        )
