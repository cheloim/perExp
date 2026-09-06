"""Generalized report image renderer using Playwright + Jinja2.

Extracted from weekly_report.py to be reusable for on-demand bot report images.
"""

import logging
import os

from jinja2 import Environment, FileSystemLoader
from playwright.sync_api import sync_playwright

logger = logging.getLogger(__name__)


def render_report_image(template_name: str, context: dict, width: int = 800) -> bytes:
    """Render a Jinja2 template to PNG using Playwright.

    Args:
        template_name: Name of the HTML template file (e.g. 'report_template_budget.html')
        context: Dict of variables to pass to the template
        width: Viewport width in pixels (default 800)

    Returns:
        PNG image bytes

    Raises:
        RuntimeError: If Playwright rendering fails
    """
    template_dir = os.path.dirname(os.path.abspath(__file__))
    env = Environment(loader=FileSystemLoader(template_dir))
    template = env.get_template(template_name)
    html_content = template.render(**context)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        )
        page = browser.new_page(
            viewport={"width": width, "height": 600},
            device_scale_factor=2,  # Retina quality
        )
        page.set_content(html_content, wait_until="networkidle")
        page.emulate_media(media="screen")

        # Get actual content height and resize viewport
        content_height = page.evaluate("document.body.scrollHeight")
        page.set_viewport_size({"width": width, "height": content_height})

        # Take screenshot of the full page
        png_bytes = page.screenshot(full_page=True, type="png", timeout=60000)
        browser.close()

    return png_bytes
