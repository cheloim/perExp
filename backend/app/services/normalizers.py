import re
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func

# Used in smart import / rows-confirm
_BANK_NORM_MAP: dict[str, str] = {
    "santander río": "Santander",
    "santander rio": "Santander",
    "banco santander río": "Santander",
    "banco santander rio": "Santander",
    "banco santander": "Santander",
    "banco galicia": "Galicia",
    "galicia": "Galicia",
    "bbva francés": "BBVA",
    "bbva frances": "BBVA",
    "banco bbva": "BBVA",
    "banco nación": "Nación",
    "banco nacion": "Nación",
    "banco provincia": "Provincia",
    "banco macro": "Macro",
    "hsbc bank": "HSBC",
    "banco icbc": "ICBC",
    "banco ciudad": "Ciudad",
    "banco patagonia": "Patagonia",
}


def _normalize_bank(bank: str) -> str:
    return _BANK_NORM_MAP.get(bank.strip().lower(), bank.strip())


def _normalize_person(person: str, db: Session) -> str:
    from app.models import Expense
    val = person.strip()
    if not val:
        return val
    val_lower = val.lower()
    rows = (
        db.query(Expense.person, func.count(Expense.id).label("cnt"))
        .filter(Expense.person != "")
        .group_by(Expense.person)
        .all()
    )
    candidates = [
        (r.person, r.cnt) for r in rows
        if r.person.lower().startswith(val_lower) and len(r.person) > len(val)
    ]
    if not candidates:
        return val
    return max(candidates, key=lambda x: (x[1], len(x[0])))[0]


# Used in dashboard card-summary / card-options / card-category-breakdown
_BANK_ALIASES: dict[str, str] = {
    "santander río": "Santander",
    "santander rio": "Santander",
    "bbva francés": "BBVA",
    "bbva frances": "BBVA",
    "hsbc bank": "HSBC",
    "icbc argentina": "ICBC",
    "banco nación": "Nación",
    "banco nacion": "Nación",
    "banco provincia": "Provincia",
    "banco ciudad": "Ciudad",
    "banco macro": "Macro",
    "banco supervielle": "Supervielle",
    "banco patagonia": "Patagonia",
    "banco credicoop": "Credicoop",
}


def _norm_bank(name: str) -> str:
    raw = (name or "").strip()
    key = raw.lower()
    if key in _BANK_ALIASES:
        return _BANK_ALIASES[key]
    cleaned = re.sub(r'(?i)^banco\s+', '', raw).strip()
    return cleaned.title() if cleaned else "Banco"


def _norm_holder(name: str) -> str:
    name = (name or "").strip().upper()
    name = re.sub(r',\s*', ', ', name)
    name = re.sub(r'\s+', ' ', name)
    return name
