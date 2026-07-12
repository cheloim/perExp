import json
import logging
import os

from google import genai
from sqlalchemy.orm import Session

from app.models import Category, Setting

logger = logging.getLogger(__name__)

PAYMENT_SKIP_KEYWORDS = [
    "su pago en pesos",
    "su pago en usd",
    "su pago en dolares",
    "pago en pesos",
    "pago en usd",
    "pago minimo",
    "pago mínimo",
]
TAX_REFUND_KEYWORDS = [
    "percepcion",
    "percepción",
    "iibb",
    "ingresos brutos",
    "devolucion imp",
    "reintegro imp",
    "imp. ",
    "imp iva",
    "impuesto",
]
BONIFICATION_KEYWORDS = [
    "bonif",
    "bonificacion",
    "bonificación",
    "descuento",
    "reintegro",
    "cashback",
    "devolucion",
    "devolución",
    "promocion",
    "promoción",
]


def _leaf_cats(cats: list) -> list:
    parent_ids = {c.parent_id for c in cats if c.parent_id is not None}
    return [c for c in cats if c.id not in parent_ids]


def auto_categorize(description: str, categories: list) -> int | None:
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


def is_income_category(category_id: int | None, db: Session) -> bool:
    """Check if category or its parent is 'Ingresos'"""
    if not category_id:
        return False

    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        return False

    # Check if category itself is "Ingresos"
    if cat.name == "Ingresos":
        return True

    # Check parent
    if cat.parent_id:
        parent = db.query(Category).filter(Category.id == cat.parent_id).first()
        if parent and parent.name == "Ingresos":
            return True

    return False


def _resolve_category(db: Session, amount: float, description: str, cats: list) -> int | None:
    desc_lower = description.lower()
    if amount < 0:
        # Tax refunds
        if any(kw in desc_lower for kw in TAX_REFUND_KEYWORDS):
            cat = next((c for c in cats if c.name == "Devolución Impuestos"), None)
            if cat:
                return cat.id

        # Bonifications/cashback
        if any(kw in desc_lower for kw in BONIFICATION_KEYWORDS):
            cat = next((c for c in cats if c.name == "Bonificación"), None)
            if cat:
                return cat.id

    return auto_categorize(description, cats)


def _get_setting(db: Session, key: str, user_id: int) -> str | None:
    row = db.query(Setting).filter(Setting.key == f"{user_id}:{key}").first()
    return row.value if row else None


def _build_formatted_categories(cats: list) -> str:
    """Build formatted category list for the LLM prompt."""
    children_map: dict[int | None, list[Category]] = {}
    for cat in cats:
        children_map.setdefault(cat.parent_id, []).append(cat)

    lines = []
    for parent in children_map.get(None, []):
        children = children_map.get(parent.id, [])
        for child in children:
            kw = f" [{child.keywords}]" if child.keywords else ""
            lines.append(f"- ID:{child.id} {parent.name} > {child.name}{kw}")
    return "\n".join(lines)


def _llm_client() -> genai.Client:
    return genai.Client(api_key=os.getenv("LLM_API_KEY", ""))


def _get_parent_name(cat: Category, categories: list) -> str:
    """Get parent category name for a child category."""
    if not cat.parent_id:
        return ""
    parent = next((c for c in categories if c.id == cat.parent_id), None)
    return parent.name if parent else ""


def llm_categorize(
    description: str, amount: float | None, categories: list, user_id: int, db: Session,
    temperature: float = 0.3,
) -> dict | None:
    """Use Gemini Flash to suggest a category. Falls back to keyword matching on failure."""
    from app.prompts import CATEGORY_SUGGEST_PROMPT

    _app_env = os.getenv("APP_ENV", "development")
    debug = _app_env != "production" or os.getenv("DEBUG_CATEGORIZATION") == "1"

    try:
        enabled = _get_setting(db, "ai_suggestions_enabled", user_id)
        if enabled == "false":
            if debug:
                logger.info("[AI-CAT] Disabled for user %s", user_id)
            return None

        min_confidence = float(_get_setting(db, "ai_suggestions_min_confidence", user_id) or "0.5")

        formatted = _build_formatted_categories(categories)
        if not formatted.strip():
            if debug:
                logger.info("[AI-CAT] No leaf categories found")
            return None

        amount_str = f"${amount:,.2f}" if amount is not None else "no especificado"
        prompt = CATEGORY_SUGGEST_PROMPT.format(
            formatted_categories=formatted,
            description=description,
            amount=amount_str,
        )

        if debug:
            logger.info("[AI-CAT] Calling LLM: desc=%s, amount=%s", description, amount_str)

        client = _llm_client()
        response = client.models.generate_content(
            model="gemini-flash-latest", contents=prompt,
            config={"temperature": temperature},
        )
        text = response.text.strip()

        # Extract JSON from response (handle markdown code blocks)
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()

        data = json.loads(text)
        category_id = data.get("category_id")
        confidence = float(data.get("confidence", 0))

        if debug:
            logger.info("[AI-CAT] LLM response: id=%s, confidence=%.2f, min=%.2f", category_id, confidence, min_confidence)

        if category_id is None or confidence < min_confidence:
            if debug:
                logger.info("[AI-CAT] Rejected: id=%s, confidence below threshold", category_id)
            return None

        # Validate category exists — try numeric ID first, then name fallback
        cat = None
        if isinstance(category_id, (int, float)):
            cat = next((c for c in categories if c.id == int(category_id)), None)
        elif isinstance(category_id, str):
            # LLM sometimes returns the name instead of ID — try matching by name
            cat = next((c for c in categories if c.name.lower() == category_id.lower()), None)
            if not cat:
                # Try "Parent > Child" format
                cat = next(
                    (c for c in categories if f"{_get_parent_name(c, categories)} > {c.name}".lower() == category_id.lower()),
                    None,
                )
        if not cat:
            if debug:
                logger.info("[AI-CAT] Category id=%s not found in user categories", category_id)
            return None

        # Build hierarchy
        parent_name = None
        if cat.parent_id:
            parent = next((c for c in categories if c.id == cat.parent_id), None)
            parent_name = parent.name if parent else None

        if debug:
            logger.info("[AI-CAT] Accepted: %s > %s (%.2f)", parent_name or "?", cat.name, confidence)

        return {
            "category_id": cat.id,
            "category_name": cat.name,
            "parent_name": parent_name,
            "confidence": confidence,
        }
    except Exception as e:
        if debug:
            logger.warning("[AI-CAT] LLM failed: %s — falling back to keywords", e)
        else:
            logger.debug("LLM categorization failed, falling back to keywords")
        cat_id = auto_categorize(description, categories)
        if cat_id:
            cat = next((c for c in categories if c.id == cat_id), None)
            if cat:
                parent_name = None
                if cat.parent_id:
                    parent = next((c for c in categories if c.id == cat.parent_id), None)
                    parent_name = parent.name if parent else None
                return {
                    "category_id": cat.id,
                    "category_name": cat.name,
                    "parent_name": parent_name,
                    "confidence": 1.0,
                }
        return None
