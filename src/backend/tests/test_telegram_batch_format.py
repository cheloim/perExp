"""The saved-message format for a batch of expenses (#671)."""

from datetime import date
from types import SimpleNamespace

from app.telegram.formatting import _saved_batch_text


def _expense(
    *,
    id: int,
    amount: float,
    description: str,
    currency: str = "ARS",
    installment_number: int | None = None,
    installment_total: int | None = None,
):
    return SimpleNamespace(
        id=id,
        amount=amount,
        description=description,
        currency=currency,
        date=date(2026, 11, 21),
        installment_number=installment_number,
        installment_total=installment_total,
    )


def test_batch_text_shows_description_amount_date_category_and_total():
    text = _saved_batch_text(
        [
            (
                _expense(id=1, amount=15200, description="Supermercado Coto"),
                ["Alimentación", "Supermercado"],
            ),
            (_expense(id=2, amount=3200, description="Uber"), ["Transporte"]),
        ]
    )

    assert text == (
        "✅ 2 gastos guardados:\n\n"
        "1. 🍽️ Supermercado Coto\n"
        "   💰 $ 15.200,00 · 📅 21 de noviembre de 2026\n"
        "   🍽️ Alimentación > Supermercado\n\n"
        "2. 🚗 Uber\n"
        "   💰 $ 3.200,00 · 📅 21 de noviembre de 2026\n"
        "   🚗 Transporte\n\n"
        "💰 Total: $ 18.400,00"
    )


def test_batch_text_never_adds_ars_and_usd_together():
    text = _saved_batch_text(
        [
            (_expense(id=1, amount=15200, description="Supermercado Coto"), ["Alimentación"]),
            (_expense(id=2, amount=5, description="Netflix", currency="USD"), ["Suscripciones"]),
        ]
    )

    assert "💰 Total: $ 15.200,00 + U$S 5,00" in text
    assert "$ 15.205,00" not in text


def test_batch_text_keeps_the_installment_detail():
    text = _saved_batch_text(
        [
            (
                _expense(
                    id=1,
                    amount=10000,
                    description="TV",
                    installment_number=1,
                    installment_total=12,
                ),
                ["Tecnología"],
            )
        ]
    )

    assert "💰 $ 10.000,00 (Cuota 1 de 12) · 📅 21 de noviembre de 2026" in text


def test_batch_text_reports_partial_failures():
    text = _saved_batch_text(
        [(_expense(id=1, amount=100, description="Café"), ["Café"])],
        failed=1,
    )

    assert text.startswith("✅ 1 gasto guardado (1 no se pudo guardar):")


def test_batch_text_escapes_html_from_descriptions_and_categories():
    text = _saved_batch_text(
        [(_expense(id=1, amount=100, description="<script>alert(1)</script>"), ["A & B"])]
    )

    assert "<script>" not in text
    assert "&lt;script&gt;" in text
    assert "A &amp; B" in text
