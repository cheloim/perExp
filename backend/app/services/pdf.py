import io
import re

SPANISH_MONTHS = {
    "ene": 1,
    "enero": 1,
    "feb": 2,
    "febr": 2,
    "febrero": 2,
    "mar": 3,
    "marzo": 3,
    "abr": 4,
    "abril": 4,
    "may": 5,
    "mayo": 5,
    "jun": 6,
    "junio": 6,
    "jul": 7,
    "julio": 7,
    "ago": 8,
    "agosto": 8,
    "set": 9,
    "seti": 9,
    "setiem": 9,
    "setiembre": 9,
    "sep": 9,
    "septi": 9,
    "septiem": 9,
    "septiembre": 9,
    "oct": 10,
    "octubr": 10,
    "octubre": 10,
    "nov": 11,
    "noviem": 11,
    "noviembre": 11,
    "dic": 12,
    "diciem": 12,
    "diciembre": 12,
}


def _extract_pdf_text(content: bytes) -> str:
    import pdfplumber

    pages_text = []
    try:
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                page_lines: list[str] = []
                try:
                    words = page.extract_words(x_tolerance=3, y_tolerance=3)
                    if words:
                        row_buckets: dict = {}
                        for w in words:
                            y_key = round(w["top"] / 5) * 5
                            row_buckets.setdefault(y_key, []).append(w)
                        for y in sorted(row_buckets):
                            line = " ".join(
                                w["text"] for w in sorted(row_buckets[y], key=lambda w: w["x0"])
                            )
                            if line.strip():
                                page_lines.append(line)
                except Exception:
                    pass

                if not page_lines:
                    try:
                        text = page.extract_text()
                        if text:
                            page_lines.append(text)
                    except Exception:
                        pass

                try:
                    for table in page.extract_tables() or []:
                        for row in table:
                            if row:
                                cells = [str(c or "").strip() for c in row if str(c or "").strip()]
                                if cells:
                                    page_lines.append(" | ".join(cells))
                except Exception:
                    pass

                pages_text.extend(page_lines)
    except Exception as e:
        raise ValueError(f"pdfplumber failed: {e}")

    return "\n".join(pages_text)


def _normalize_santander_dates(text: str) -> str:
    lines = text.split("\n")
    result_lines = []
    current_year = None
    current_month = None

    month_header_pattern = re.compile(r"^(\d{2})\s+([a-zA-Záéíóúñ]+)\.?\s+(\d{2})\s+(.*)$")

    for line in lines:
        stripped = line.strip()
        if not stripped:
            result_lines.append(line)
            continue

        match = month_header_pattern.match(stripped)
        if match:
            year_part = match.group(1)
            month_abbr = match.group(2).lower()
            day_part = match.group(3)
            rest = match.group(4)

            current_year = 2000 + int(year_part)
            current_month = SPANISH_MONTHS.get(month_abbr)
            if current_month:
                normalized_date = f"{int(day_part):02d}-{current_month:02d}-{current_year}"
                result_lines.append(f"{normalized_date} {rest}")
                continue

        parts = stripped.split()
        if len(parts) >= 2 and current_year and current_month:
            try:
                first_num = int(parts[0])
                if 1 <= first_num <= 31:
                    normalized_date = f"{int(parts[0]):02d}-{current_month:02d}-{current_year}"
                    rest = " ".join(parts[1:])
                    result_lines.append(f"{normalized_date} {rest}")
                    continue
            except ValueError:
                pass

        result_lines.append(line)

    return "\n".join(result_lines)


_tarjeta_re = re.compile(r"TARJETA\s+TERMINADA\s+EN\s+(\d{4})", re.IGNORECASE)
_socio_re = re.compile(r"SOCIO\s*N[°]?\s*(\d+)", re.IGNORECASE)
_cuenta_re = re.compile(r"CUENTA\s*N[°]?\s*(\d+)", re.IGNORECASE)


def _inject_card_markers(text: str) -> str:
    """Inyecta marcadores temporales de last4 para el parsing del LLM.
    Estos marcadores se usan SOLO durante el parseo y NO se guardan en la DB."""
    lines = text.split("\n")
    out = []
    has_tarjeta_lines = bool(_tarjeta_re.search(text))

    for line in lines:
        out.append(line)
        s = line.strip()

        m = _tarjeta_re.search(s)
        if m:
            out.append(f"[TARJETA_LAST4: {m.group(1)}]")
            continue

        if not has_tarjeta_lines:
            m = _socio_re.search(s)
            if not m:
                m = _cuenta_re.search(s)
            if m:
                digits = re.sub(r"\D", "", m.group(1))
                if len(digits) >= 4:
                    out.append(f"[TARJETA_LAST4: {digits[-4:]}]")

    return "\n".join(out)


def _inject_csv_card_markers(text: str) -> str:
    """Eliminado - markers de ultimos 4 digitos ya no necesarios"""
    return text


def extract_card_sections(text: str) -> list[dict]:
    """
    Identify card sections in text by [TARJETA_LAST4: XXXX] markers.
    Returns a list of sections: [{ last4: str, start: int, end: int }]
    where start/end are line numbers (0-indexed).
    """
    lines = text.split("\n")
    sections = []
    marker_re = re.compile(r"\[TARJETA_LAST4:\s*(\d{4})\]")

    for i, line in enumerate(lines):
        m = marker_re.search(line)
        if m:
            sections.append({"last4": m.group(1), "start": i, "end": None})

    # Set end for each section
    for idx in range(len(sections)):
        if idx + 1 < len(sections):
            sections[idx]["end"] = sections[idx + 1]["start"]
        else:
            sections[idx]["end"] = len(lines)

    return sections


def filter_text_by_section(text: str, section_start: int, section_end: int) -> str:
    """
    Keep only lines within a specific section (by line numbers).
    section_start is inclusive, section_end is exclusive.
    """
    lines = text.split("\n")
    return "\n".join(lines[section_start:section_end])


def extract_holder_from_header(header_text: str) -> str:
    """
    Extract holder name from card section header text.
    Examples:
      "TARJETA ADICIONAL - PEREZ, JUAN - Mastercard terminada en 1108" → "PEREZ, JUAN"
      "Visa terminada en 8130 - MARCELO MENDOZA" → "MARCELO MENDOZA"
      "Visa terminada en 8130" → ""
    """
    if not header_text:
        return ""

    # Pattern 1: "TARJETA ADICIONAL - NAME - ..."
    m = re.search(r"adicional\s*[-:]\s*(.+?)\s*[-:]", header_text, re.IGNORECASE)
    if m:
        name = m.group(1).strip()
        # Skip if it's just "TARJETA" or a card type
        if name.lower() not in ("tarjeta", "visa", "mastercard", "amex", "naranja", "cabal"):
            return name

    # Pattern 2: "CardType terminada en XXXX - NAME" or "CardType terminada en XXXX NAME"
    m = re.search(r"terminad[oa]\s+en\s+\d{4}\s*[-:]\s*(.+)", header_text, re.IGNORECASE)
    if m:
        name = m.group(1).strip()
        # Skip if it's just a card type or bank
        if name.lower() not in ("", "visa", "mastercard", "amex", "naranja", "cabal"):
            return name

    # Pattern 3: "CardType terminada en XXXX NAME" (no separator)
    m = re.search(r"terminad[oa]\s+en\s+\d{4}\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)", header_text)
    if m:
        name = m.group(1).strip()
        if name.lower() not in ("visa", "mastercard", "amex", "naranja", "cabal"):
            return name

    return ""


def get_section_headers(text: str) -> list[str]:
    """
    Get the header text for each card section.
    Returns list of header texts in order of appearance.
    """
    lines = text.split("\n")
    marker_re = re.compile(r"\[TARJETA_LAST4:\s*(\d{4})\]")
    headers = []

    for i, line in enumerate(lines):
        if marker_re.search(line):
            # Look back for the header (up to 5 lines before the marker)
            header_lines = []
            for j in range(max(0, i - 5), i):
                stripped = lines[j].strip()
                if stripped and not marker_re.search(stripped):
                    header_lines.insert(0, stripped)
            headers.append(" ".join(header_lines) if header_lines else "")

    return headers


def _clean_text_for_llm(text: str) -> str:
    """
    Pre-process text before sending to LLM to reduce token usage.
    1. Filter non-transaction lines (payments, totals, footers)
    2. Remove redundant headers/footers
    3. Compress whitespace

    Note: TARJETA ADICIONAL filtering is now handled by section-based
    filtering before this function is called.
    """
    lines = text.split("\n")
    cleaned = []

    # Patterns to skip (non-transaction lines)
    skip_patterns = [
        r"^su\s+pago",
        r"^pago\s+m[ií]nimo",
        r"^total\s+consumos",
        r"^total\s+del\s+per[ií]odo",
        r"^total\s+en\s+pesos",
        r"^total\s+en\s+d[oó]lares",
        r"^total\s+usd",
        r"^subtotal",
        r"^saldo\s+anterior",
        r"^cr[eé]ditos",
        r"^pagos\s+realizados",
        r"^consumos\s+que\s+se\s+debitar[aá]n",
        r"^saldo\s+de\s+cuotas\s+a\s+vencer",
        r"^consumos\s+futuros",
        r"^resumen\s+de\s+cuenta",
        r"^extracto\s+mensual",
        r"^extracto\s+bancario",
        r"^website:",
        r"^email:",
        r"^tel[eé]fono:",
        r"^CUIT:",
        r"^ingresos\s+brutos:",
    ]

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # Skip non-transaction lines
        skip = False
        for pattern in skip_patterns:
            if re.match(pattern, stripped, re.IGNORECASE):
                skip = True
                break
        if skip:
            continue

        # Skip lines that are only decorative characters
        if re.match(r"^[\s\-=─│╔╗╚╝═╠╣╦╩╬]+$", stripped):
            continue

        # Skip lines that are only numbers (page numbers, etc.)
        if re.match(r"^\d+$", stripped):
            continue

        # Skip lines that look like URLs or email addresses
        if re.match(r"^(https?://|www\.|[\w.-]+@[\w.-]+\.\w+)", stripped, re.IGNORECASE):
            continue

        # Compress multiple spaces to single space
        compressed = re.sub(r"\s+", " ", stripped)
        cleaned.append(compressed)

    return "\n".join(cleaned)
