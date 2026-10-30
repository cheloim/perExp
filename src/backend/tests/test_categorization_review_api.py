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
    BulkAcceptBody,
    ScanBody,
    accept,
    bulk_accept,
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


def _add_review(
    db,
    user,
    category,
    *,
    description="FARMACIA DEL PUEBLO",
    amount=15000.0,
    expense_date=date(2026, 10, 20),
    score=0.6,
    evidence='{"signals": {"history_conflict": {"weight": 0.4}}}',
    suggested=None,
    status="pending",
):
    expense = Expense(
        date=expense_date,
        description=description,
        description_hmac=compute_hmac(description),
        amount=amount,
        user_id=user.id,
        category_id=category.id,
        is_income=False,
    )
    db.add(expense)
    db.flush()
    review = CategorizationReview(
        expense_id=expense.id,
        user_id=user.id,
        current_category_id=category.id,
        suggested_category_id=(suggested or category).id,
        score=score,
        source="rules",
        reason="test",
        evidence=evidence,
        detector_version=review_service.DETECTOR_VERSION,
        status=status,
    )
    db.add(review)
    db.flush()
    return review


def test_list_sin_filtros_devuelve_lo_mismo_que_antes(db, setup):
    """The new filters are additive: omitting them must not change the response."""
    base = list_reviews(status="pending", db=db, admin=setup["admin"])
    explicit = list_reviews(
        status="pending",
        max_score=None,
        date_from=None,
        date_to=None,
        search=None,
        db=db,
        admin=setup["admin"],
    )
    assert base == explicit


def test_list_filtra_por_score_maximo(db, setup):
    admin = setup["admin"]
    _add_review(db, admin, setup["accesorios"], score=0.9)

    result = list_reviews(status="pending", max_score=0.8, db=db, admin=admin)

    assert result["total"] == 1
    assert result["items"][0]["score"] == 0.75


def test_list_filtra_por_rango_de_fechas(db, setup):
    admin = setup["admin"]
    _add_review(db, admin, setup["accesorios"], expense_date=date(2026, 10, 20))

    from_only = list_reviews(status="pending", date_from=date(2026, 10, 15), db=db, admin=admin)
    to_only = list_reviews(status="pending", date_to=date(2026, 10, 15), db=db, admin=admin)
    full_range = list_reviews(
        status="pending",
        date_from=date(2026, 10, 1),
        date_to=date(2026, 10, 31),
        db=db,
        admin=admin,
    )

    assert from_only["total"] == 1
    assert from_only["items"][0]["description"] == "FARMACIA DEL PUEBLO"
    assert to_only["total"] == 1
    assert to_only["items"][0]["description"] == "YENNY TORTUGAS OPEN MALL"
    assert full_range["total"] == 2


def test_list_busca_por_comercio_descifrado(db, setup):
    admin = setup["admin"]
    _add_review(db, admin, setup["accesorios"])

    assert list_reviews(status="pending", search="farmacia", db=db, admin=admin)["total"] == 1
    assert list_reviews(status="pending", search="tortugas", db=db, admin=admin)["total"] == 1
    # tokenize_description normalizes case and accents
    assert list_reviews(status="pending", search="TÓRTUGAS", db=db, admin=admin)["total"] == 1
    assert list_reviews(status="pending", search="inexistente", db=db, admin=admin)["total"] == 0


def test_list_search_vacio_no_filtra(db, setup):
    admin = setup["admin"]
    _add_review(db, admin, setup["accesorios"])

    assert list_reviews(status="pending", search="", db=db, admin=admin)["total"] == 2
    assert list_reviews(status="pending", search="   ", db=db, admin=admin)["total"] == 2


def test_list_combina_busqueda_senal_y_paginacion(db, setup):
    admin = setup["admin"]
    _add_review(db, admin, setup["accesorios"], score=0.6)
    _add_review(db, admin, setup["accesorios"], score=0.9)

    first = list_reviews(
        status="pending",
        signal="history_conflict",
        min_score=0.6,
        page=1,
        per_page=1,
        db=db,
        admin=admin,
    )
    second = list_reviews(
        status="pending",
        signal="history_conflict",
        min_score=0.6,
        page=2,
        per_page=1,
        db=db,
        admin=admin,
    )

    assert first["total"] == 2
    assert second["total"] == 2
    assert first["items"][0]["id"] != second["items"][0]["id"]


def test_detalle_incluye_categorias_del_usuario(db, setup):
    from app.models import User

    stranger = User(email="ajena@test.com", full_name="Ajena", hashed_password="x")
    db.add(stranger)
    db.flush()
    db.add(Category(name="Ropa", user_id=stranger.id))
    db.flush()

    detail = get_review_detail(setup["review"].id, db=db, admin=setup["admin"])

    names = [category.name for category in detail.available_categories]
    assert names == ["Accesorios", "Electricidad & Gas"]
    assert "Ropa" not in names


def test_detalle_sin_categorias_devuelve_lista_vacia(db, setup):
    from app.models import User

    other = User(email="sin-cats@test.com", full_name="Sin Cats", hashed_password="x")
    db.add(other)
    db.flush()
    review = _add_review(db, other, setup["accesorios"], suggested=setup["accesorios"])
    review.current_category_id = None
    db.flush()

    detail = get_review_detail(review.id, db=db, admin=setup["admin"])

    assert detail.available_categories == []


def test_bulk_respeta_el_umbral(db, setup):
    admin = setup["admin"]

    below = bulk_accept(BulkAcceptBody(min_score=0.8), db=db, admin=admin)
    above = bulk_accept(BulkAcceptBody(min_score=0.7), db=db, admin=admin)

    assert below["candidates"] == 0
    assert above["accepted"] == 1
    assert setup["review"].status == "accepted"
    assert setup["review"].bulk_applied is True


def test_bulk_dry_run_no_escribe(db, setup):
    result = bulk_accept(BulkAcceptBody(min_score=0.5, dry_run=True), db=db, admin=setup["admin"])

    assert result["candidates"] == 1
    assert result["accepted"] == 0
    assert setup["review"].status == "pending"


def test_bulk_no_toca_reviews_ya_resueltas(db, setup):
    admin = setup["admin"]
    setup["review"].status = "rejected"
    pending = _add_review(db, admin, setup["accesorios"], score=0.9)
    db.flush()

    result = bulk_accept(BulkAcceptBody(min_score=0.5), db=db, admin=admin)

    assert result["candidates"] == 1
    assert result["accepted"] == 1
    assert setup["review"].status == "rejected"
    assert pending.status == "accepted"


def test_bulk_respeta_max_items(db, setup):
    admin = setup["admin"]
    _add_review(db, admin, setup["accesorios"], score=0.9)

    result = bulk_accept(BulkAcceptBody(min_score=0.5, max_items=1), db=db, admin=admin)

    assert result["candidates"] == 1
    assert result["accepted"] == 1
    assert db.query(CategorizationReview).filter_by(status="pending").count() == 1


def test_bulk_cuenta_las_obsoletas_y_sigue(db, setup):
    admin = setup["admin"]
    setup["expense"].category_id = setup["accesorios"].id  # makes the fixture review stale
    _add_review(db, admin, setup["accesorios"], score=0.9)
    db.flush()

    result = bulk_accept(BulkAcceptBody(min_score=0.5), db=db, admin=admin)

    assert result["candidates"] == 2
    assert result["accepted"] == 1
    assert result["skipped_stale"] == 1


def test_bulk_saltea_reviews_sin_categoria_sugerida(db, setup):
    admin = setup["admin"]
    no_suggestion = _add_review(db, admin, setup["accesorios"], score=0.9)
    no_suggestion.suggested_category_id = None
    db.flush()

    result = bulk_accept(BulkAcceptBody(min_score=0.5), db=db, admin=admin)

    assert result["skipped_without_suggestion"] == 1
    assert result["candidates"] == 1
    assert result["accepted"] == 1


def test_bulk_valida_parametros(db, setup):
    admin = setup["admin"]
    for body in (BulkAcceptBody(min_score=1.5), BulkAcceptBody(min_score=0.5, max_items=0)):
        with pytest.raises(HTTPException) as exc:
            bulk_accept(body, db=db, admin=admin)
        assert exc.value.status_code == 400


def test_la_precision_manual_no_cuenta_las_aceptadas_en_bulk(db, setup):
    admin = setup["admin"]
    _add_review(db, admin, setup["accesorios"], score=0.9)
    _add_review(db, admin, setup["accesorios"], score=0.8, status="rejected")
    bulk_accept(BulkAcceptBody(min_score=0.7), db=db, admin=admin)

    summary = review_service.summary(db)

    assert summary["bulk_accepted"] == 2
    assert summary["observed_precision"] == 0.67
    assert summary["manual_precision"] == 0.0


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
