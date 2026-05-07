import io
import re

SPANISH_MONTHS = {
    "ene": 1, "enero": 1,
    "feb": 2, "febr": 2, "febrero": 2,
    "mar": 3, "marzo": 3,
    "abr": 4, "abril": 4,
    "may": 5, "mayo": 5,
    "jun": 6, "junio": 6,
    "jul": 7, "julio": 7,
    "ago": 8, "agosto": 8,
    "set": 9, "seti": 9, "setiem": 9, "setiembre": 9,
    "sep": 9, "septi": 9, "septiem": 9, "septiembre": 9,
    "oct": 10, "octubr": 10, "octubre": 10,
    "nov": 11, "noviem": 11, "noviembre": 11,
    "dic": 12, "diciem": 12, "diciembre": 12,
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
                                w["text"]
                                for w in sorted(row_buckets[y], key=lambda w: w["x0"])
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
                    for table in (page.extract_tables() or []):
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

    month_header_pattern = re.compile(r'^(\d{2})\s+([a-zA-Záéíóúñ]+)\.?\s+(\d{2})\s+(.*)$')

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


def _inject_card_markers(text: str) -> str:
    _tarjeta_re = re.compile(r'\bTarjeta\s+(\d{4})\b', re.IGNORECASE)
    _socio_re = re.compile(r'(?:N[°º\xba]?\s*(?:°|º)?\s*)?(?:de\s+)?socio\s*:\s*([0-9][0-9\-]+[0-9])', re.IGNORECASE)
    _cuenta_re = re.compile(r'(?:N[°º\xba]?\s*(?:°|º)?\s*)?(?:de\s+)?[Cc]uenta\s*:\s*([0-9][0-9\-]+[0-9])')

    has_tarjeta_lines = bool(_tarjeta_re.search(text))

    lines = text.split('\n')
    out = []
    for line in lines:
        out.append(line)
        s = line.strip()

        m = _tarjeta_re.search(s)
        if m:
            out.append(f'[TARJETA_LAST4: {m.group(1)}]')
            continue

        if not has_tarjeta_lines:
            m = _socio_re.search(s)
            if not m:
                m = _cuenta_re.search(s)
            if m:
                digits = re.sub(r'\D', '', m.group(1))
                if len(digits) >= 4:
                    out.append(f'[TARJETA_LAST4: {digits[-4:]}]')

    return '\n'.join(out)


def _inject_csv_card_markers(text: str) -> str:
    _card_re = re.compile(r'terminada\s+en\s+(\d{4})', re.IGNORECASE)
    lines = text.split('\n')
    out = []
    current_last4 = None
    for line in lines:
        s = line.strip()
        m = _card_re.search(s)
        if m:
            current_last4 = m.group(1)
            out.append(line)
            out.append(f'[TARJETA_LAST4: {current_last4}]')
            continue
        marker_match = re.search(r'\[TARJETA_LAST4:\s*(\d{4})\]', s)
        if marker_match:
            current_last4 = marker_match.group(1)
            out.append(line)
            continue
        is_header = (
            not s
            or s == 'NaN'
            or 'NaN' in s and len(s) < 50
            or re.match(r'^(Fecha|Description|Monto|Tarjeta|Subtotal|Total Últimos|Total de|Total Pago|Unnamed)', s, re.IGNORECASE)
            or re.match(r'^(Unnamed:|\s)*$', s)
        )
        if current_last4 and not is_header:
            out.append(f'[CARD:{current_last4}] {line}')
        else:
            out.append(line)
    return '\n'.join(out)
