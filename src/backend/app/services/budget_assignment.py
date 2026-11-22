"""Category-to-macro-group assignment for budgets (#569)."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Category

NECESIDADES_KEYWORDS = [
    "alimentación",
    "alimentos",
    "supermercado",
    "almacén",
    "verdulería",
    "transporte",
    "combustible",
    "nafta",
    "taxi",
    "uber",
    "subte",
    "colectivo",
    "salud",
    "farmacia",
    "médico",
    "médicos",
    "hospital",
    "obra social",
    "hogar",
    "alquiler",
    "expensas",
    "servicios",
    "luz",
    "gas",
    "agua",
    "internet",
    "celular",
    "teléfono",
    "impuestos",
    "seguros",
    "monotributo",
]

GUSTOS_KEYWORDS = [
    "entretenimiento",
    "cine",
    "teatro",
    "concierto",
    "streaming",
    "netflix",
    "spotify",
    "disney",
    "hbo",
    "ropa",
    "indumentaria",
    "calzado",
    "café",
    "cafetería",
    "bar",
    "restaurante",
    "resto",
    "comida",
    "gimnasio",
    "deporte",
    "fitness",
    "suscripciones",
    "revistas",
    "viajes",
    "hotel",
    "aerolínea",
    "turismo",
    "mascotas",
    "vacaciones",
]

AHORRO_KEYWORDS = [
    "inversiones",
    "inversión",
    "ahorro",
    "plazo fijo",
    "fci",
    "bonos",
    "acciones",
    "dólar",
    "crypto",
]


def auto_assign_budget_group(category_name: str) -> str:
    """Auto-assign a category to a macro group based on name keywords."""
    lower = category_name.lower()
    for kw in NECESIDADES_KEYWORDS:
        if kw in lower:
            return "necesidades"
    for kw in GUSTOS_KEYWORDS:
        if kw in lower:
            return "gustos"
    for kw in AHORRO_KEYWORDS:
        if kw in lower:
            return "ahorro"
    return "necesidades"  # default


def assign_category_group(db: Session, category_id: int, user_id: int, group_name: str) -> dict:
    """Assign a category to a macro group (necesidades/gustos/ahorro)."""
    if group_name not in ("necesidades", "gustos", "ahorro"):
        raise HTTPException(400, "Invalid group name. Must be: necesidades, gustos, ahorro")

    cat = db.query(Category).filter(Category.id == category_id, Category.user_id == user_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")

    cat.budget_group = group_name
    db.commit()
    return {"ok": True, "category_id": category_id, "budget_group": group_name}


def auto_assign_all_categories(db: Session, user_id: int) -> dict:
    """Auto-assign all user categories to macro groups based on name keywords."""
    categories = db.query(Category).filter(Category.user_id == user_id).all()
    updated = 0
    for cat in categories:
        new_group = auto_assign_budget_group(cat.name)
        if cat.budget_group != new_group:
            cat.budget_group = new_group
            updated += 1
    db.commit()
    return {"ok": True, "updated": updated, "total": len(categories)}
