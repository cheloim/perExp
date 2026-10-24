"""Tests for the miscategorization detector (issue #414).

Three layers, all internal-only:

* ``detect_expense`` — pure rule scoring (no DB, no LLM)
* ``analyze_expenses`` / ``persist_reviews`` — orchestration and idempotency
* ``accept_review`` / ``reject_review`` / ``investigate_review`` — resolution

The YENNY TORTUGAS case is a fixture here: the old substring matcher read
"gas" inside "TORTUGAS" and filed a bookstore purchase under
"Electricidad & Gas" (fixed in #453). The detector has to flag that legacy
damage when it appears on a categorized expense.
"""

import os
from collections import Counter
from datetime import date
from types import SimpleNamespace

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-that-is-at-least-32-chars-long-for-testing")

from app.models import CategorizationReview, Category, Expense, MerchantPreference
from app.services import categorization_review as review_service
from app.services.categorization_review import (
    PERSIST_SCORE,
    CategoryStats,
    UserContext,
    detect_expense,
)
from app.services.encryption import compute_hmac

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _cat(cat_id, name, keywords="", parent_id=None):
    return Category(id=cat_id, name=name, keywords=keywords, parent_id=parent_id)


def _expense(expense_id, category_id, description, amount=1000.0, user_id=1, is_income=False):
    return SimpleNamespace(
        id=expense_id,
        user_id=user_id,
        category_id=category_id,
        description=description,
        amount=amount,
        date=date(2026, 10, 13),
        is_income=is_income,
    )


def _stats(total=0, keyword_covered=0, amounts=None, merchants=None):
    return CategoryStats(
        total=total,
        keyword_covered=keyword_covered,
        amounts=amounts or [],
        merchants=Counter(merchants or {}),
    )


def _add_category(db, user, name, parent=None, keywords=""):
    cat = Category(
        name=name, keywords=keywords, user_id=user.id, parent_id=parent.id if parent else None
    )
    db.add(cat)
    db.flush()
    return cat


def _add_expense(db, user, category, description, amount=1000.0, on=None):
    exp = Expense(
        date=on or date.today(),
        description=description,
        description_hmac=compute_hmac(description),
        amount=amount,
        user_id=user.id,
        category_id=category.id if category else None,
        is_income=False,
    )
    db.add(exp)
    db.flush()
    return exp


class _FakeLLM:
    """Canned LLM reply; counts calls and keeps the prompts."""

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
        return self._payload


def _install(monkeypatch, fake):
    monkeypatch.setattr(review_service, "_llm_client", lambda: fake)
    return fake


# ---------------------------------------------------------------------------
# detect_expense — pure rules
# ---------------------------------------------------------------------------


def test_yenny_tortugas_en_electricidad_se_marca():
    """El caso del issue: una librería/shopping dentro de "Electricidad & Gas"."""
    electricidad = _cat(1, "Electricidad & Gas", "electricidad,gas,edenor,edesur,metrogas")
    accesorios = _cat(2, "Accesorios", "fravega,shopping,musimundo")
    ctx = UserContext(categories=[electricidad, accesorios])
    ctx.stats = {
        1: _stats(
            total=12,
            keyword_covered=11,
            amounts=[42119.33] * 12,
            merchants={"EDENOR": 6, "EDESUR": 5, "METROGAS": 1},
        ),
        2: _stats(),
    }
    exp = _expense(1, 1, "YENNY TORTUGAS OPEN MALL", amount=55479.67)

    candidate = detect_expense(exp, ctx)

    assert candidate is not None
    assert "category_keyword_miss" in candidate.evidence["signals"]
    assert "keyword_conflict" not in candidate.evidence["signals"]
    assert candidate.score >= PERSIST_SCORE
    assert "Electricidad & Gas" in candidate.reason or "palabra clave" in candidate.reason


def test_edenor_en_electricidad_no_se_marca():
    electricidad = _cat(1, "Electricidad & Gas", "electricidad,gas,edenor,edesur,metrogas")
    ctx = UserContext(categories=[electricidad])
    ctx.stats = {
        1: _stats(
            total=12,
            keyword_covered=11,
            amounts=[42119.33] * 12,
            merchants={"EDENOR": 6, "EDESUR": 5, "METROGAS": 1},
        )
    }
    exp = _expense(1, 1, "EDENOR SA", amount=42119.33)

    assert detect_expense(exp, ctx) is None


def test_gas_corto_no_matchea_tortugas():
    """'gas' es keyword corta: solo palabra completa, nunca dentro de otras."""
    electricidad = _cat(1, "Electricidad & Gas", "gas")
    ctx = UserContext(categories=[electricidad])
    exp = _expense(1, 1, "YENNY TORTUGAS OPEN MALL")

    candidate = detect_expense(exp, ctx)

    assert candidate is None or "keyword_conflict" not in candidate.evidence["signals"]


def test_keyword_conflict_proponiendo_otra_categoria():
    supermercado = _cat(3, "Supermercado", "coto,carrefour")
    streaming = _cat(4, "Streaming", "netflix,spotify")
    ctx = UserContext(categories=[supermercado, streaming])
    ctx.stats = {3: _stats(), 4: _stats()}
    exp = _expense(1, 3, "NETFLIX.COM", amount=1500.0)

    candidate = detect_expense(exp, ctx)

    assert candidate is not None
    assert candidate.evidence["signals"]["keyword_conflict"]["matched_category_id"] == 4
    assert candidate.suggested_category_id == 4


def test_history_conflict_con_comercio_recurrente():
    hogar = _cat(5, "Hogar", "")
    libreria = _cat(6, "Librería", "")
    ctx = UserContext(categories=[hogar, libreria])
    ctx.stats = {
        5: _stats(total=2, merchants={"BABYPOP": 1}),
        6: _stats(total=8, merchants={"BABYPOP": 7}),
    }
    ctx.merchant_categories = {"BABYPOP": Counter({6: 7, 5: 1})}
    exp = _expense(1, 5, "MERPAGO*BABYPOP", amount=2000.0)

    candidate = detect_expense(exp, ctx)

    assert candidate is not None
    assert candidate.evidence["signals"]["history_conflict"]["majority_category_id"] == 6
    assert candidate.suggested_category_id == 6


def test_amount_outlier_solo_no_alcanza_para_persistir():
    hogar = _cat(5, "Hogar", "")
    ctx = UserContext(categories=[hogar])
    ctx.stats = {
        5: _stats(
            total=10,
            amounts=[1000.0, 1100.0, 900.0, 1050.0, 950.0, 1000.0, 1150.0, 850.0, 1020.0, 980.0],
            merchants={"X": 10},
        )
    }
    exp = _expense(1, 5, "COMPRA DESCONOCIDA", amount=100000.0)

    candidate = detect_expense(exp, ctx)

    assert candidate is not None
    assert candidate.score < PERSIST_SCORE
    assert "amount_outlier" in candidate.evidence["signals"]


def test_gasto_sin_categoria_se_ignora():
    ctx = UserContext(categories=[_cat(1, "Hogar", "")])
    exp = _expense(1, None, "CUALQUIER COSA")
    assert detect_expense(exp, ctx) is None


def test_ingresos_y_pagos_se_ignoran():
    ctx = UserContext(categories=[_cat(1, "Ingresos", "sueldo")])
    income = _expense(1, 1, "SUELDO OCTUBRE", is_income=True)
    payment = _expense(2, 1, "SU PAGO EN PESOS")
    assert detect_expense(income, ctx) is None
    assert detect_expense(payment, ctx) is None


# ---------------------------------------------------------------------------
# analyze_expenses / persist_reviews
# ---------------------------------------------------------------------------


@pytest.fixture
def db_setup(db, test_user):
    """One user with two categories and a healthy keyword-covered history."""
    electricidad = _add_category(
        db, test_user, "Electricidad & Gas", keywords="edenor,edesur,metrogas"
    )
    accesorios = _add_category(db, test_user, "Accesorios", keywords="shopping,fravega")
    for merchant in ["EDENOR", "EDESUR", "METROGAS", "EDENOR", "EDESUR", "EDENOR"]:
        _add_expense(db, test_user, electricidad, f"{merchant} FACTURA", amount=40000.0)
    db.flush()
    return {"user": test_user, "electricidad": electricidad, "accesorios": accesorios}


def test_analyze_persiste_solo_lo_que_supera_el_umbral(db, db_setup):
    user = db_setup["user"]
    electricidad = db_setup["electricidad"]
    suspicious = _add_expense(db, user, electricidad, "YENNY TORTUGAS OPEN MALL", amount=55479.67)
    normal = _add_expense(db, user, electricidad, "EDENOR FACTURA", amount=41000.0)

    candidates = review_service.analyze_expenses(db, user, [suspicious, normal], use_llm=False)

    assert [c.expense_id for c in candidates] == [suspicious.id]
    created = review_service.persist_reviews(db, candidates)
    assert created == 1
    row = db.query(CategorizationReview).one()
    assert row.expense_id == suspicious.id
    assert row.status == "pending"
    assert row.current_category_id == electricidad.id
    assert row.detector_version == review_service.DETECTOR_VERSION


def test_persist_es_idempotente(db, db_setup):
    user = db_setup["user"]
    electricidad = db_setup["electricidad"]
    suspicious = _add_expense(db, user, electricidad, "YENNY TORTUGAS OPEN MALL", amount=55479.67)
    candidates = review_service.analyze_expenses(db, user, [suspicious], use_llm=False)

    review_service.persist_reviews(db, candidates)
    review_service.persist_reviews(db, candidates)

    assert db.query(CategorizationReview).count() == 1


# ---------------------------------------------------------------------------
# LLM second opinion
# ---------------------------------------------------------------------------


def test_llm_como_segunda_opinion(db, db_setup, monkeypatch):
    user = db_setup["user"]
    electricidad = db_setup["electricidad"]
    accesorios = db_setup["accesorios"]
    suspicious = _add_expense(db, user, electricidad, "YENNY TORTUGAS OPEN MALL", amount=55479.67)

    fake = _install(
        monkeypatch,
        _FakeLLM(
            payload=[
                {
                    "expense_id": suspicious.id,
                    "is_mismatch": True,
                    "suggested_category_id": accesorios.id,
                    "confidence": 0.9,
                    "reason": "es una librería/shopping, no un servicio público",
                }
            ]
        ),
    )

    candidates = review_service.analyze_expenses(db, user, [suspicious], use_llm=True)

    assert fake.calls == 1
    assert fake.features == ["categorization_review"]
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate.source == "rules+llm"
    assert candidate.suggested_category_id == accesorios.id
    assert "librería" in candidate.reason
    assert candidate.evidence["llm"]["is_mismatch"] is True


def test_llm_que_dice_que_esta_bien_baja_el_score(db, db_setup, monkeypatch):
    user = db_setup["user"]
    electricidad = db_setup["electricidad"]
    suspicious = _add_expense(db, user, electricidad, "YENNY TORTUGAS OPEN MALL", amount=55479.67)

    fake = _install(
        monkeypatch,
        _FakeLLM(
            payload=[
                {
                    "expense_id": suspicious.id,
                    "is_mismatch": False,
                    "suggested_category_id": None,
                    "confidence": 0.9,
                    "reason": "es un gasto legítimo de la categoría",
                }
            ]
        ),
    )

    candidates = review_service.analyze_expenses(db, user, [suspicious], use_llm=True)

    assert fake.calls == 1
    assert candidates == []


def test_llm_roto_no_rompe_el_batch(db, db_setup, monkeypatch):
    user = db_setup["user"]
    electricidad = db_setup["electricidad"]
    suspicious = _add_expense(db, user, electricidad, "YENNY TORTUGAS OPEN MALL", amount=55479.67)

    fake = _install(monkeypatch, _FakeLLM(error=RuntimeError("LLM caído")))

    candidates = review_service.analyze_expenses(db, user, [suspicious], use_llm=True)

    assert fake.calls == 1
    assert [c.expense_id for c in candidates] == [suspicious.id]


def test_llm_con_id_inventado_se_descarta(db, db_setup, monkeypatch):
    user = db_setup["user"]
    electricidad = db_setup["electricidad"]
    suspicious = _add_expense(db, user, electricidad, "YENNY TORTUGAS OPEN MALL", amount=55479.67)

    _install(
        monkeypatch,
        _FakeLLM(
            payload=[
                {
                    "expense_id": 999999,
                    "is_mismatch": True,
                    "suggested_category_id": None,
                    "confidence": 0.9,
                },
                {
                    "expense_id": suspicious.id,
                    "is_mismatch": True,
                    "suggested_category_id": 424242,
                    "confidence": 0.9,
                },
            ]
        ),
    )

    candidates = review_service.analyze_expenses(db, user, [suspicious], use_llm=True)

    assert [c.expense_id for c in candidates] == [suspicious.id]
    assert (
        candidates[0].suggested_category_id is None or candidates[0].suggested_category_id != 424242
    )


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------


def _pending_review(db, user, electricidad, accesorios):
    expense = _add_expense(db, user, electricidad, "YENNY TORTUGAS OPEN MALL", amount=55479.67)
    review = CategorizationReview(
        expense_id=expense.id,
        user_id=user.id,
        current_category_id=electricidad.id,
        suggested_category_id=accesorios.id,
        score=0.75,
        source="rules+llm",
        reason="no coincide con las palabras clave de la categoría",
        evidence='{"signals": {"category_keyword_miss": {}}}',
        detector_version=review_service.DETECTOR_VERSION,
        status="pending",
    )
    db.add(review)
    db.flush()
    return review, expense


def test_accept_aplica_categoria_tag_y_preferencia(db, db_setup):
    user = db_setup["user"]
    electricidad = db_setup["electricidad"]
    accesorios = db_setup["accesorios"]
    review, expense = _pending_review(db, user, electricidad, accesorios)

    review_service.accept_review(db, review.id, reviewer_id=user.id)

    db.refresh(expense)
    assert expense.category_id == accesorios.id
    assert review.status == "accepted"
    assert review.reviewed_by == user.id
    pref = db.query(MerchantPreference).one()
    assert pref.merchant_key == "YENNY TORTUGAS OPEN MALL"
    assert pref.category_id == accesorios.id


def test_accept_con_categoria_explicita(db, db_setup):
    user = db_setup["user"]
    electricidad = db_setup["electricidad"]
    accesorios = db_setup["accesorios"]
    review, expense = _pending_review(db, user, electricidad, accesorios)

    review_service.accept_review(db, review.id, category_id=electricidad.id)

    db.refresh(expense)
    assert expense.category_id == electricidad.id


def test_accept_sin_categoria_sugerida_falla(db, db_setup):
    user = db_setup["user"]
    electricidad = db_setup["electricidad"]
    accesorios = db_setup["accesorios"]
    review, _ = _pending_review(db, user, electricidad, accesorios)
    review.suggested_category_id = None

    with pytest.raises(review_service.MissingCategoryError):
        review_service.accept_review(db, review.id)


def test_accept_sobre_gasto_recatgorizado_falla(db, db_setup):
    user = db_setup["user"]
    electricidad = db_setup["electricidad"]
    accesorios = db_setup["accesorios"]
    review, expense = _pending_review(db, user, electricidad, accesorios)
    expense.category_id = accesorios.id

    with pytest.raises(review_service.StaleReviewError):
        review_service.accept_review(db, review.id)


def test_reject_no_toca_el_gasto(db, db_setup):
    user = db_setup["user"]
    electricidad = db_setup["electricidad"]
    accesorios = db_setup["accesorios"]
    review, expense = _pending_review(db, user, electricidad, accesorios)

    review_service.reject_review(db, review.id, reviewer_id=user.id)

    db.refresh(expense)
    assert expense.category_id == electricidad.id
    assert review.status == "rejected"
    assert db.query(MerchantPreference).count() == 0


def test_investigate_marca_sin_cambios(db, db_setup):
    user = db_setup["user"]
    electricidad = db_setup["electricidad"]
    accesorios = db_setup["accesorios"]
    review, expense = _pending_review(db, user, electricidad, accesorios)

    review_service.investigate_review(db, review.id)

    db.refresh(expense)
    assert expense.category_id == electricidad.id
    assert review.status == "investigated"


def test_resumen_reporta_precision(db, db_setup):
    user = db_setup["user"]
    electricidad = db_setup["electricidad"]
    accesorios = db_setup["accesorios"]
    review, _ = _pending_review(db, user, electricidad, accesorios)
    review_service.accept_review(db, review.id)

    data = review_service.summary(db)

    assert data["total"] == 1
    assert data["by_status"] == {"accepted": 1}
    assert data["observed_precision"] == 1.0
    assert data["by_signal"] == {"category_keyword_miss": 1}
