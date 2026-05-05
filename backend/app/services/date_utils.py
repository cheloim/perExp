import re
import calendar as cal_module
from datetime import date

_SPANISH_MONTHS = {
    "ENERO": "01", "FEBRERO": "02", "MARZO": "03", "ABRIL": "04",
    "MAYO": "05", "JUNIO": "06", "JULIO": "07", "AGOSTO": "08",
    "SEPTIEMBRE": "09", "SETIEMBRE": "09",
    "OCTUBRE": "10", "NOVIEMBRE": "11", "DICIEMBRE": "12",
    "ENE": "01", "FEB": "02", "MAR": "03", "ABR": "04",
    "MAY": "05", "JUN": "06", "JUL": "07", "AGO": "08",
    "SEP": "09", "OCT": "10", "NOV": "11", "DIC": "12",
    "FEBR": "02", "SEPT": "09", "AGOS": "08",
    "SETIEM": "09", "SEPTIEM": "09",
    "NOVIEM": "11", "DICIEM": "12",
    "OCTUBR": "10",
}

_SPANISH_MONTHS_SORTED = sorted(_SPANISH_MONTHS.keys(), key=len, reverse=True)


def _normalize_date_str(raw: str) -> str:
    raw_upper = raw.upper().strip()
    raw_upper = re.sub(r'(?<=[A-Z])\.', '', raw_upper)

    for es in _SPANISH_MONTHS_SORTED:
        if es in raw_upper:
            raw_upper = raw_upper.replace(es, _SPANISH_MONTHS[es])
            break

    m = re.match(r'^(\d{2})[\s\-/](\d{2})[\s\-/](\d{1,2})$', raw_upper.strip())
    if m:
        yy, mm, dd = m.group(1), m.group(2), m.group(3).zfill(2)
        return f"20{yy}-{mm}-{dd}"

    m_ddmm = re.match(r'^(\d{1,2})[\s\-/](\d{1,2})[\s\-/](\d{4})$', raw_upper.strip())
    if m_ddmm:
        dd, mm, yyyy = m_ddmm.group(1).zfill(2), m_ddmm.group(2).zfill(2), m_ddmm.group(3)
        return f"{yyyy}-{mm}-{dd}"

    m2 = re.match(r'^(\d{2})-(\d{2})-(\d{2})$', raw_upper.strip())
    if m2:
        return f"20{m2.group(1)}-{m2.group(2)}-{m2.group(3)}"

    return raw_upper


def add_months(dt: date, months: int) -> date:
    month = dt.month - 1 + months
    year = dt.year + month // 12
    month = month % 12 + 1
    day = min(dt.day, cal_module.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)
