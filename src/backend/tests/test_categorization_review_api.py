"""Tests for the internal admin API of miscategorization reviews (issue #414).

The endpoint functions are called directly with a db session and an admin
user, following the style of the other router tests. Admin-only by design:
there is no user-facing surface for these reviews.
"""

from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.models import CategorizationReview, Category, Expense
from app.routers.admin_categorization import (
    AcceptBody,
    ScanBody,
    accept,
    get_review_detail,
    investigate,
    list_reviews,
    reject,
    scan,
)
from app.services import categorization_review as review_service
from app.services.encryption import compute_hmac


@pytest.fixture
def admin(db, test_user):
    test_user.is_admin = True
    db.flush()
    return test_user


@pytest.fixture
def setup(db, admin):
    electricidad = Category(
        name="Electricidad & Gas", keywords="edenor,edesur,metrogas", user_id=admin.id
    )
    accesorios = Category(name="Accesorios", keywords="shopping,fravega", user_id=admin.id)
    db.add_all([electricidad, accesorios])
    db.flush()

    expense = Expense(
        date=date(2026, 10, 13),
        description="YENNY TORTUGAS OPEN MALL",
        description_hmac=compute_hmac("YENNY TORTUGAS OPEN MALL"),
        amount=55479.67,
        user_id=admin.id,
        category_id=electricidad.id,
        is_income=False,
    )
    db.add(expense)
    db.flush()

    review = CategorizationReview(
        expense_id=expense.id,
        user_id=admin.id,
        current_category_id=electricidad.id,
        suggested_category_id=accesorios.id,
        score=0.75,
        source="rules+llm",
        reason="no coincide con las palabras clave de la categoría",
        evidence='{"signals": {"category_keyword_miss": {"weight": 0.55}}}',
        detector_version=review_service.DETECTOR_VERSION,
        status="pending",
    )
    db.add(review)
    db.flush()
    return {
        "admin": admin,
        "electricidad": electricidad,
        "accesorios": accesorios,
        "expense": expense,
        "review": review,
    }


def test_list_devuelve_pendientes_con_resumen(db, setup):
    result = list_reviews(status="pending", db=db, admin=setup["admin"])

    assert result["total"] == 1
    assert len(result["items"]) == 1
    item = result["items"][0]
    assert item["description"] == "YENNY TORTUGAS OPEN MALL"
    assert item["current_category_name"] == "Electricidad & Gas"
    assert item["suggested_category_name"] == "Accesorios"
    assert result["summary"]["by_status"] == {"pending": 1}


def test_list_filtra_por_score_y_senal(db, setup):
    admin = setup["admin"]
    assert list_reviews(status="pending", min_score=0.8, db=db, admin=admin)["total"] == 0
    assert list_reviews(status="pending", min_score=0.7, db=db, admin=admin)["total"] == 1
    assert (
        list_reviews(status="pending", signal="category_keyword_miss", db=db, admin=admin)["total"]
        == 1
    )
    assert list_reviews(status="pending", signal="amount_outlier", db=db, admin=admin)["total"] == 0


def test_list_sin_resultados_para_otro_estado(db, setup):
    result = list_reviews(status="rejected", db=db, admin=setup["admin"])
    assert result["total"] == 0
    assert result["items"] == []


def test_detalle_incluye_evidencia(db, setup):
    detail = get_review_detail(setup["review"].id, db=db, admin=setup["admin"])

    assert detail.evidence["signals"]["category_keyword_miss"]["weight"] == 0.55


def test_detalle_inexistente_es_404(db, setup):
    with pytest.raises(HTTPException) as exc:
        get_review_detail(9999, db=db, admin=setup["admin"])
    assert exc.value.status_code == 404


def test_accept_aplica_la_categoria_sugerida(db, setup):
    result = accept(setup["review"].id, AcceptBody(), db=db, admin=setup["admin"])

    assert result["status"] == "accepted"
    assert setup["expense"].category_id == setup["accesorios"].id


def test_accept_con_categoria_explicita(db, setup):
    result = accept(
        setup["review"].id,
        AcceptBody(category_id=setup["electricidad"].id),
        db=db,
        admin=setup["admin"],
    )

    assert result["status"] == "accepted"
    assert setup["expense"].category_id == setup["electricidad"].id


def test_accept_con_categoria_ajena_es_400(db, setup):
    from app.models import User

    stranger = User(email="otra@test.com", full_name="Otra", hashed_password="x")
    db.add(stranger)
    db.flush()
    foreign = Category(name="Ropa", user_id=stranger.id)
    db.add(foreign)
    db.flush()

    with pytest.raises(HTTPException) as exc:
        accept(
            setup["review"].id,
            AcceptBody(category_id=foreign.id),
            db=db,
            admin=setup["admin"],
        )
    assert exc.value.status_code == 400


def test_accept_de_gasto_recatgorizado_es_409(db, setup):
    setup["expense"].category_id = setup["accesorios"].id
    db.flush()

    with pytest.raises(HTTPException) as exc:
        accept(setup["review"].id, AcceptBody(), db=db, admin=setup["admin"])
    assert exc.value.status_code == 409


def test_reject_e_investigate(db, setup):
    rejected = reject(setup["review"].id, db=db, admin=setup["admin"])
    assert rejected["status"] == "rejected"
    assert setup["expense"].category_id == setup["electricidad"].id

    setup["review"].status = "pending"
    db.flush()
    marked = investigate(setup["review"].id, db=db, admin=setup["admin"])
    assert marked["status"] == "investigated"


def _add_history(db, user, cat):
    """Six older imports: they belong to the history, not to the scan window."""
    for merchant in ["EDENOR", "EDESUR", "METROGAS", "EDENOR", "EDESUR", "EDENOR"]:
        exp = Expense(
            date=date(2026, 7, 1),
            description=f"{merchant} FACTURA",
            description_hmac=compute_hmac(f"{merchant} FACTURA"),
            amount=40000.0,
            user_id=user.id,
            category_id=cat.id,
            is_income=False,
            created_at=datetime.utcnow() - timedelta(days=90),
        )
        db.add(exp)
    db.flush()


def test_scan_forward_only_persiste_revisiones(db, setup):
    admin = setup["admin"]
    electricidad = setup["electricidad"]
    _add_history(db, admin, electricidad)
    nuevo = Expense(
        date=date(2026, 10, 13),
        description="YENNY LIBRERIA OPEN MALL",
        description_hmac=compute_hmac("YENNY LIBRERIA OPEN MALL"),
        amount=55479.67,
        user_id=admin.id,
        category_id=electricidad.id,
        is_income=False,
    )
    db.add(nuevo)
    db.flush()

    result = scan(ScanBody(user_id=admin.id, use_llm=False), db=db, admin=admin)

    assert result["scanned"] >= 1
    assert result["persisted"] == 1
    assert db.query(CategorizationReview).count() == 2


def test_scan_dry_run_no_persiste(db, setup):
    admin = setup["admin"]
    electricidad = setup["electricidad"]
    _add_history(db, admin, electricidad)
    nuevo = Expense(
        date=date(2026, 10, 13),
        description="YENNY LIBRERIA OPEN MALL",
        description_hmac=compute_hmac("YENNY LIBRERIA OPEN MALL"),
        amount=55479.67,
        user_id=admin.id,
        category_id=electricidad.id,
        is_income=False,
    )
    db.add(nuevo)
    db.flush()

    result = scan(ScanBody(user_id=admin.id, use_llm=False, persist=False), db=db, admin=admin)

    assert result["candidates"] >= 1
    assert result["persisted"] == 0
    assert db.query(CategorizationReview).count() == 1
