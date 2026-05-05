from typing import Optional
from sqlalchemy.orm import Session
from app.models import Category

PAYMENT_SKIP_KEYWORDS = [
    "su pago en pesos", "su pago en usd", "su pago en dolares",
    "pago en pesos", "pago en usd", "pago minimo", "pago mínimo",
]
TAX_REFUND_KEYWORDS = [
    "percepcion", "percepción", "iibb", "ingresos brutos",
    "devolucion imp", "reintegro imp", "imp. ", "imp iva", "impuesto",
]


def _leaf_cats(cats: list) -> list:
    parent_ids = {c.parent_id for c in cats if c.parent_id is not None}
    return [c for c in cats if c.id not in parent_ids]


def auto_categorize(description: str, categories: list) -> Optional[int]:
    desc_lower = description.lower()
    for cat in _leaf_cats(categories):
        if cat.keywords:
            for kw in cat.keywords.split(","):
                kw = kw.strip()
                if kw and kw in desc_lower:
                    return cat.id
    return None


def _should_skip(description: str) -> bool:
    desc_lower = description.lower()
    return any(kw in desc_lower for kw in PAYMENT_SKIP_KEYWORDS)


def _resolve_category(db: Session, amount: float, description: str, cats: list) -> Optional[int]:
    desc_lower = description.lower()
    if amount < 0:
        if any(kw in desc_lower for kw in TAX_REFUND_KEYWORDS):
            cat = next((c for c in cats if c.name == "Devolución Impuestos"), None)
        else:
            cat = next((c for c in cats if c.name == "Bonificación"), None)
        return cat.id if cat else None
    return auto_categorize(description, cats)
