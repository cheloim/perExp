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


def _clean_text_for_llm(text: str) -> str:
    """
    Pre-process text before sending to LLM to reduce token usage.
    1. Filter non-transaction lines (payments, totals, footers)
    2. Remove redundant headers/footers
    3. Strip TARJETA ADICIONAL sections
    4. Compress whitespace
    """
    lines = text.split("\n")
    cleaned = []
    in_adicional_section = False

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

    # Patterns for TARJETA ADICIONAL sections
    adicional_start = re.compile(
        r"tarjeta\s+adicional|adicional\s*[-:]|secci[oó]n\s+adicional", re.IGNORECASE
    )
    # Patterns for main card headers (to detect end of adicional section)
    main_card_header = re.compile(
        r"tarjeta\s+terminada|visa\s+terminada|mastercard\s+terminada|"
        r"t[uú]tarjeta\s+principal|titular\s+principal",
        re.IGNORECASE,
    )

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # Check for TARJETA ADICIONAL section
        if adicional_start.search(stripped):
            in_adicional_section = True
            continue

        # Check if we're back to main card section
        if in_adicional_section and main_card_header.search(stripped):
            in_adicional_section = False

        # Skip lines in adicional section
        if in_adicional_section:
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
