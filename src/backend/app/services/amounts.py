"""Parse money amounts from bank statements.

Bank exports mix es-AR (``1.234,56``) and en-US (``1,234.56``) formats. The
previous ``float(value.replace(",", "."))`` discarded the first form entirely.
The rule: with both separators the rightmost is decimal; with one separator and
exactly three digits after it, treat it as a thousands separator (money rarely
has three decimals); otherwise it is decimal.
"""

from __future__ import annotations

import re


def parse_amount(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)

    text = str(value).strip()
    if not text:
        return None

    negative = (text.startswith("(") and text.endswith(")")) or text.lstrip().startswith("-")
    text = text.strip().strip("()").replace("−", "-")
    text = re.sub(r"[^\d,.\-]", "", text)
    if not text or text in {"-", ".", ","}:
        return None

    sign = ""
    if text.startswith("-"):
        sign = "-"
        text = text[1:]

    if "," in text and "." in text:
        decimal = "," if text.rfind(",") > text.rfind(".") else "."
        thousands = "." if decimal == "," else ","
        text = text.replace(thousands, "").replace(decimal, ".")
    elif text.count(",") > 1:
        text = text.replace(",", "")
    elif text.count(".") > 1:
        text = text.replace(".", "")
    elif "," in text:
        left, right = text.rsplit(",", 1)
        text = (
            left + right
            if len(right) == 3 and left.isdigit() and len(left) <= 3
            else f"{left}.{right}"
        )
    elif "." in text:
        left, right = text.rsplit(".", 1)
        if len(right) == 3 and left.isdigit() and len(left) <= 3:
            text = left + right

    try:
        parsed = float(f"{sign}{text}")
    except (TypeError, ValueError):
        return None
    return -parsed if negative and parsed > 0 else parsed
