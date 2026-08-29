import re

from sqlalchemy import func
from sqlalchemy.orm import Session

BANK_NORM_MAP: dict[str, str] = {
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
    "icbc argentina": "ICBC",
    "banco icbc": "ICBC",
    "banco ciudad": "Ciudad",
    "banco patagonia": "Patagonia",
    "banco supervielle": "Supervielle",
    "banco credicoop": "Credicoop",
}


def normalize_bank(name: str) -> str:
    raw = (name or "").strip()
    key = raw.lower()
    if key in BANK_NORM_MAP:
        return BANK_NORM_MAP[key]
    cleaned = re.sub(r"(?i)^banco\s+", "", raw).strip()
    return cleaned.title() if cleaned else "Banco"


def _normalize_person(person: str, db: Session) -> str:
    from app.models import Card

    val = person.strip()
    if not val:
        return val
    val_lower = val.lower()
    rows = (
        db.query(Card.holder, func.count(Card.id).label("cnt"))
        .filter(Card.holder != "")
        .group_by(Card.holder)
        .all()
    )
    candidates = [
        (r.holder, r.cnt)
        for r in rows
        if r.holder.lower().startswith(val_lower) and len(r.holder) > len(val)
    ]
    if not candidates:
        return val
    return max(candidates, key=lambda x: (x[1], len(x[0])))[0]


def _norm_holder(name: str) -> str:
    name = (name or "").strip().upper()
    name = re.sub(r",\s*", ", ", name)
    name = re.sub(r"\s+", " ", name)
    return name


def first_card_word(card: str) -> str:
    """Extract first word from card name: 'Visa Galicia' -> 'Visa', 'Mastercard HSBC' -> 'Mastercard'"""
    raw = (card or "").strip()
    if not raw:
        return ""
    return raw.split()[0]


def title_case_single(text: str) -> str:
    """Title case: first letter of each word uppercase: 'JUAN PEREZ' -> 'Juan Perez', 'maria' -> 'Maria'"""
    raw = (text or "").strip()
    if not raw:
        return ""
    words = raw.split()
    return " ".join(w[0].upper() + w[1:].lower() if len(w) > 1 else w.upper() for w in words)
