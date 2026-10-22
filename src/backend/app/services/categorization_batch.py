"""Batch categorization: one LLM call per user for many uncategorized expenses.

The daily suggestion task used to call the LLM once per expense (up to 20 calls
per user). This module sends the whole batch in a single `complete_json` call and
validates the reply entry by entry: whatever the model invents is dropped with a
log entry, never breaking the rest of the batch.

If the batch call itself fails (exception, unparsable JSON, timeout) we fall back
to the deterministic keyword matcher (`auto_categorize`), which costs nothing —
never to per-expense LLM calls, which is exactly the cost being removed here.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models import Category, Expense, User
from app.services.categorization import auto_categorize
from app.services.llm import LLMMessage, get_client

logger = logging.getLogger(__name__)

# Metric label: distinct from "categorization" so the dashboard can show the
# saving of one batched call against the old per-expense calls.
FEATURE = "categorization_batch"

BATCH_CATEGORY_PROMPT = """Sos el asistente de categorización de Oikonomia, \
una app de finanzas personales.

Tu tarea: asignarle una categoría a cada gasto sin clasificar de la lista de abajo.

Categorías disponibles (usá únicamente estos IDs):
{categories}

Gastos a categorizar:
{expenses}

Respondé en español rioplatense y con UN SOLO array JSON válido, sin texto \
adicional ni markdown:
[{{"expense_id": <id del gasto>, "category_id": <id de la categoría>, \
"confidence": <número entre 0 y 1>}}]

Reglas:
- Incluí una entrada por cada gasto de la lista, con el mismo expense_id.
- Usá únicamente los category_id de la lista de categorías; no inventes \
categorías ni IDs.
- confidence es tu seguridad en la asignación: 1 es "estoy seguro", 0 es \
"adivinanza pura". Si no reconocés el gasto, usá un valor bajo.
- No cambies los expense_id ni agregues gastos que no estén en la lista.
"""


@dataclass(frozen=True)
class BatchSuggestion:
    """One validated suggestion for one expense."""

    category_id: int
    category_name: str
    parent_name: str | None
    confidence: float


def _leaf_cats(categories: Sequence[Category]) -> list[Category]:
    """Categories that can hold expenses: those without children."""
    parent_ids = {c.parent_id for c in categories if c.parent_id is not None}
    return [c for c in categories if c.id not in parent_ids]


def _parent_name(cat: Category, categories: Sequence[Category]) -> str | None:
    if not cat.parent_id:
        return None
    parent = next((c for c in categories if c.id == cat.parent_id), None)
    return parent.name if parent else None


def _format_categories(categories: Sequence[Category]) -> str:
    """Category list for the prompt: leaves only, `ID` first so the model copies it."""
    lines = []
    for cat in _leaf_cats(categories):
        parent = _parent_name(cat, categories)
        name = f"{parent} > {cat.name}" if parent else cat.name
        kw = f" [{cat.keywords}]" if cat.keywords else ""
        lines.append(f"- ID:{cat.id} {name}{kw}")
    return "\n".join(lines)


def _format_expenses(expenses: Sequence[Expense]) -> str:
    """Expense list for the prompt: one line per expense, id first."""
    lines = []
    for exp in expenses:
        amount = f"${exp.amount:,.2f}" if exp.amount is not None else "no especificado"
        day = exp.date.isoformat() if exp.date else "sin fecha"
        lines.append(f"- expense_id={exp.id} | {day} | {amount} | {exp.description}")
    return "\n".join(lines)


def _llm_client():
    return get_client()


def _validate_entries(
    data: object,
    expenses: Sequence[Expense],
    categories: Sequence[Category],
) -> dict[int, BatchSuggestion]:
    """Filter the model reply down to entries we can trust.

    `expense_id` must be one we sent, `category_id` one of the user's leaf
    categories and `confidence` a number in [0, 1]. Everything else is dropped
    silently (with a log) so one bad entry can't spoil the batch.
    """
    if not isinstance(data, list):
        raise ValueError(f"Respuesta del modelo no es una lista: {type(data).__name__}")

    sent_ids = {exp.id for exp in expenses}
    leaves = _leaf_cats(categories)
    cat_by_id = {c.id: c for c in leaves}

    out: dict[int, BatchSuggestion] = {}
    for raw in data:
        if not isinstance(raw, dict):
            logger.warning("[AI-CAT-BATCH] Entrada descartada (no es un objeto): %r", raw)
            continue
        try:
            expense_id = int(raw.get("expense_id"))
            category_id = int(raw.get("category_id"))
            confidence = float(raw.get("confidence"))
        except (TypeError, ValueError):
            logger.warning("[AI-CAT-BATCH] Entrada descartada (campos inválidos): %r", raw)
            continue
        if expense_id not in sent_ids:
            logger.warning(
                "[AI-CAT-BATCH] Entrada descartada (expense_id inventado): %s", expense_id
            )
            continue
        cat = cat_by_id.get(category_id)
        if cat is None:
            logger.warning(
                "[AI-CAT-BATCH] Entrada descartada (category_id inválido): %s", category_id
            )
            continue
        if not 0.0 <= confidence <= 1.0:
            logger.warning(
                "[AI-CAT-BATCH] Entrada descartada (confidence fuera de [0,1]): %s", confidence
            )
            continue
        if expense_id in out:
            logger.warning(
                "[AI-CAT-BATCH] Entrada descartada (expense_id duplicado): %s", expense_id
            )
            continue
        out[expense_id] = BatchSuggestion(
            category_id=cat.id,
            category_name=cat.name,
            parent_name=_parent_name(cat, categories),
            confidence=confidence,
        )
    return out


def _keyword_fallback(
    expenses: Sequence[Expense], categories: Sequence[Category]
) -> dict[int, BatchSuggestion]:
    """Deterministic, free fallback: keyword matching, one try per expense."""
    out: dict[int, BatchSuggestion] = {}
    for exp in expenses:
        cat_id = auto_categorize(exp.description, categories)
        if cat_id is None:
            continue
        cat = next((c for c in categories if c.id == cat_id), None)
        if cat is None:
            continue
        out[exp.id] = BatchSuggestion(
            category_id=cat.id,
            category_name=cat.name,
            parent_name=_parent_name(cat, categories),
            confidence=1.0,
        )
    return out


def batch_categorize(
    db: Session,
    user: User,
    expenses: Sequence[Expense],
    categories: Sequence[Category],
    temperature: float = 0.7,
) -> dict[int, BatchSuggestion]:
    """Suggest a category for every expense in one LLM call.

    Returns a map of expense_id → BatchSuggestion. Expenses the model skipped or
    answered badly are simply absent from the map. Never raises: on any failure
    of the batch call it falls back to `auto_categorize`, which may return an
    empty map when no keyword matches.
    """
    if not expenses:
        return {}
    if not _leaf_cats(categories):
        logger.info("[AI-CAT-BATCH] Sin categorías hoja para el usuario %s", user.id)
        return {}

    prompt = BATCH_CATEGORY_PROMPT.format(
        categories=_format_categories(categories),
        expenses=_format_expenses(expenses),
    )

    try:
        data = _llm_client().complete_json(
            [LLMMessage(role="user", text=prompt)],
            feature=FEATURE,
            temperature=temperature,
        )
        result = _validate_entries(data, expenses, categories)
    except Exception as e:
        logger.warning(
            "[AI-CAT-BATCH] Lote falló (%s) — fallback a keywords para %s gastos",
            e,
            len(expenses),
        )
        return _keyword_fallback(expenses, categories)

    logger.info(
        "[AI-CAT-BATCH] Lote para usuario %s: %s/%s sugerencias válidas",
        user.id,
        len(result),
        len(expenses),
    )
    return result
