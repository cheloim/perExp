"""Batch categorization: one LLM call per user instead of one per expense.

Covers the shape of the batch reply (what gets kept, what gets dropped), the
keyword fallback when the batch call fails, and that the daily task keeps its
per-user cap of MAX_EXPENSES_PER_USER.
"""

import json
import re
from datetime import date, timedelta

import pytest

from app.models import Category, CategorySuggestion, Expense, Notification
from app.services import categorization_batch
from app.services.encryption import compute_hmac

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FakeLLM:
    """Counts calls and keeps the prompts; returns a canned payload or raises."""

    def __init__(self, payload=None, error=None):
        self.calls = 0
        self.prompts: list[str] = []
        self.features: list[str] = []
        self._payload = payload
        self._error = error

    def complete_json(self, messages, *, feature, **kwargs):
        self.calls += 1
        self.prompts.append("\n".join(m.text for m in messages))
        self.features.append(feature)
        if self._error is not None:
            raise self._error
        if callable(self._payload):
            return self._payload(self.prompts[-1])
        return self._payload


def _install(monkeypatch, fake: _FakeLLM) -> _FakeLLM:
    monkeypatch.setattr(categorization_batch, "_llm_client", lambda: fake)
    return fake


def _add_category(db, user, name, parent=None, keywords=""):
    cat = Category(
        name=name, user_id=user.id, parent_id=parent.id if parent else None, keywords=keywords
    )
    db.add(cat)
    db.flush()
    return cat


def _add_expense(db, user, description, amount=1000.0, on=None):
    exp = Expense(
        date=on or date.today(),
        description=description,
        description_hmac=compute_hmac(description),
        amount=amount,
        user_id=user.id,
        is_income=False,
    )
    db.add(exp)
    db.flush()
    return exp


def _entry(expense_id, category_id, confidence):
    return {"expense_id": expense_id, "category_id": category_id, "confidence": confidence}


def _ids_in_prompt(prompt: str) -> set[int]:
    return {int(m) for m in re.findall(r"expense_id=(\d+)", prompt)}


@pytest.fixture
def cats(db, test_user):
    """A parent + two leaves, one of them with keywords for the fallback."""
    parent = _add_category(db, test_user, "Servicios")
    suscripciones = _add_category(
        db, test_user, "Suscripciones", parent=parent, keywords="netflix,spotify"
    )
    kiosco = _add_category(db, test_user, "Kiosco", keywords="kiosco")
    return {"parent": parent, "suscripciones": suscripciones, "kiosco": kiosco}


# ---------------------------------------------------------------------------
# One call per batch
# ---------------------------------------------------------------------------


def test_n_gastos_producen_una_sola_llamada(db, test_user, cats, monkeypatch):
    expenses = [_add_expense(db, test_user, f"Gasto {i}") for i in range(5)]
    payload = [_entry(e.id, cats["kiosco"].id, 0.9) for e in expenses]
    fake = _install(monkeypatch, _FakeLLM(payload=payload))

    result = categorization_batch.batch_categorize(db, test_user, expenses, list(cats.values()))

    assert fake.calls == 1
    assert fake.features == ["categorization_batch"]
    assert len(result) == 5
    assert {e.id for e in expenses} == set(result)
    assert _ids_in_prompt(fake.prompts[0]) == {e.id for e in expenses}
    assert "rioplatense" in fake.prompts[0]
    assert all(s.category_id == cats["kiosco"].id for s in result.values())


# ---------------------------------------------------------------------------
# Reply validation: bad entries are dropped, the batch survives
# ---------------------------------------------------------------------------


def test_expense_id_inventado_se_descarta(db, test_user, cats, monkeypatch):
    real = _add_expense(db, test_user, "Gasto real")
    fake = _install(
        monkeypatch,
        _FakeLLM(
            payload=[
                _entry(real.id, cats["kiosco"].id, 0.9),
                _entry(999999, cats["kiosco"].id, 0.9),
            ]
        ),
    )

    result = categorization_batch.batch_categorize(db, test_user, [real], list(cats.values()))

    assert fake.calls == 1
    assert set(result) == {real.id}


def test_category_id_inexistente_se_descarta(db, test_user, cats, monkeypatch):
    expenses = [_add_expense(db, test_user, f"Gasto {i}") for i in range(3)]
    fake = _install(
        monkeypatch,
        _FakeLLM(
            payload=[
                _entry(expenses[0].id, 424242, 0.9),  # no existe
                _entry(expenses[1].id, cats["parent"].id, 0.9),  # categoría padre, no hoja
                _entry(expenses[2].id, cats["kiosco"].id, 0.9),
            ]
        ),
    )

    result = categorization_batch.batch_categorize(db, test_user, expenses, list(cats.values()))

    assert fake.calls == 1
    assert set(result) == {expenses[2].id}


def test_confidence_fuera_de_rango_se_descarta(db, test_user, cats, monkeypatch):
    expenses = [_add_expense(db, test_user, f"Gasto {i}") for i in range(3)]
    fake = _install(
        monkeypatch,
        _FakeLLM(
            payload=[
                _entry(expenses[0].id, cats["kiosco"].id, 1.5),
                _entry(expenses[1].id, cats["kiosco"].id, -0.2),
                _entry(expenses[2].id, cats["kiosco"].id, 0.85),
            ]
        ),
    )

    result = categorization_batch.batch_categorize(db, test_user, expenses, list(cats.values()))

    assert fake.calls == 1
    assert set(result) == {expenses[2].id}
    assert result[expenses[2].id].confidence == 0.85


def test_campos_no_numericos_se_descartan(db, test_user, cats, monkeypatch):
    expense = _add_expense(db, test_user, "Gasto")
    fake = _install(
        monkeypatch,
        _FakeLLM(
            payload=[
                {"expense_id": "abc", "category_id": cats["kiosco"].id, "confidence": 0.9},
                _entry(expense.id, cats["kiosco"].id, "alta"),
                _entry(expense.id, cats["kiosco"].id, 0.7),
            ]
        ),
    )

    result = categorization_batch.batch_categorize(db, test_user, [expense], list(cats.values()))

    assert fake.calls == 1
    assert set(result) == {expense.id}
    assert result[expense.id].confidence == 0.7


# ---------------------------------------------------------------------------
# Fallback: keyword matching, never more LLM calls
# ---------------------------------------------------------------------------


def test_llm_con_excepcion_cae_a_auto_categorize(db, test_user, cats, monkeypatch):
    con_match = _add_expense(db, test_user, "Netflix mensual")
    sin_match = _add_expense(db, test_user, "Kiosco el faro", on=date.today() - timedelta(days=1))
    fake = _install(monkeypatch, _FakeLLM(error=RuntimeError("boom")))

    result = categorization_batch.batch_categorize(
        db, test_user, [con_match, sin_match], list(cats.values())
    )

    assert fake.calls == 1  # sin reintento y sin llamadas por gasto
    assert set(result) == {con_match.id, sin_match.id}
    assert result[con_match.id].category_id == cats["suscripciones"].id
    assert result[sin_match.id].category_id == cats["kiosco"].id
    assert all(s.confidence == 1.0 for s in result.values())


def test_json_invalido_cae_a_auto_categorize(db, test_user, cats, monkeypatch):
    con_match = _add_expense(db, test_user, "Spotify premium")
    fake = _install(monkeypatch, _FakeLLM(payload={"suggestions": "no es una lista"}))

    result = categorization_batch.batch_categorize(db, test_user, [con_match], list(cats.values()))

    assert fake.calls == 1
    assert set(result) == {con_match.id}
    assert result[con_match.id].category_id == cats["suscripciones"].id
    assert result[con_match.id].confidence == 1.0


# ---------------------------------------------------------------------------
# The daily task keeps its cap and its bookkeeping
# ---------------------------------------------------------------------------


def test_tarea_respeta_el_cap_de_max_expenses_per_user(db, test_user, cats, monkeypatch):
    from app.tasks import suggest_uncategorized

    class _SessionProxy:
        def __init__(self, session):
            self._session = session

        def __getattr__(self, name):
            return getattr(self._session, name)

        def close(self):
            pass

    runs = []
    monkeypatch.setattr(suggest_uncategorized, "SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(
        suggest_uncategorized, "record_task_run", lambda *a, **k: runs.append((a, k))
    )

    for i in range(suggest_uncategorized.MAX_EXPENSES_PER_USER + 5):
        _add_expense(db, test_user, f"Gasto {i}", on=date.today() - timedelta(days=i % 7))

    def _payload(prompt):
        return [_entry(int(eid), cats["kiosco"].id, 0.9) for eid in sorted(_ids_in_prompt(prompt))]

    fake = _install(monkeypatch, _FakeLLM(payload=_payload))

    suggest_uncategorized.suggest_uncategorized_categories()

    assert fake.calls == 1
    assert len(_ids_in_prompt(fake.prompts[0])) == suggest_uncategorized.MAX_EXPENSES_PER_USER

    saved = db.query(CategorySuggestion).filter(CategorySuggestion.user_id == test_user.id).all()
    assert len(saved) == suggest_uncategorized.MAX_EXPENSES_PER_USER
    assert all(s.suggested_category_id == cats["kiosco"].id for s in saved)

    notif = (
        db.query(Notification)
        .filter(
            Notification.user_id == test_user.id,
            Notification.type == "category_suggestions",
        )
        .one()
    )
    assert json.loads(notif.data)["count"] == suggest_uncategorized.MAX_EXPENSES_PER_USER
    assert runs == [(("suggest-uncategorized-categories-daily",), {"success": True})]
