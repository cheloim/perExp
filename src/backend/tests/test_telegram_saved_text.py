from datetime import date

import pytest

from app import telegram_bot
from app.models import Expense, Tag


def _expense(
    *,
    amount: float = 3200.0,
    currency: str = "ARS",
    description: str = "Café Tortoni",
    installment_total: int | None = None,
    cat_levels: list[str] | None = None,
    tags: list[Tag] | None = None,
) -> Expense:
    expense = Expense(
        id=1,
        date=date(2026, 7, 12),
        description=description,
        amount=amount,
        currency=currency,
        installment_total=installment_total,
    )
    expense._cat_levels = cat_levels if cat_levels is not None else ["Café y snacks", "Café/Bar"]
    expense._tags = tags if tags is not None else []
    return expense


def test_saved_text_shows_the_category_tree_and_the_account_tag():
    expense = _expense(
        tags=[
            Tag(name="Visa Galicia", group_name="cuenta"),
            Tag(name="trabajo", group_name="otros"),
        ]
    )

    text = telegram_bot._saved_text(expense, payment_label="")

    assert text == (
        "✅ ¡Listo! Guardé el gasto.\n\n"
        "💰 $3.200\n"
        "💳 Visa Galicia\n"
        "📅 12 de julio de 2026\n\n"
        "☕ Café y snacks\n"
        "└ 📂 Café/Bar\n"
        "🏷️ trabajo"
    )


def test_saved_text_does_not_render_the_description_or_the_old_leaf_marker():
    text = telegram_bot._saved_text(_expense())

    assert "Café Tortoni" not in text
    assert "📝" not in text


def test_saved_text_puts_installments_in_the_amount_line():
    expense = _expense(amount=4000.0, installment_total=3)

    text = telegram_bot._saved_text(expense)

    assert "💰 $12.000 (3 cuotas de $4.000)" in text
    assert "💳 " not in text


def test_saved_text_indents_deeper_category_levels():
    expense = _expense(cat_levels=["Alimentación", "Supermercado", "Compras del hogar"])

    text = telegram_bot._saved_text(expense)

    assert "🍽️ Alimentación" in text
    assert "└ 📂 Supermercado" in text
    assert "    └ 📂 Compras del hogar" in text


def test_saved_text_escapes_html_in_categories_and_tags():
    expense = _expense(
        cat_levels=["<script>", "Café/Bar"],
        tags=[Tag(name="a & b", group_name="otros")],
    )

    text = telegram_bot._saved_text(expense)

    assert "&lt;script&gt;" in text
    assert "<script>" not in text
    assert "a &amp; b" in text


def test_saved_text_without_category_keeps_tags_readable():
    expense = _expense(cat_levels=[], tags=[Tag(name="trabajo", group_name="otros")])

    text = telegram_bot._saved_text(expense)

    assert "☕" not in text
    assert text.endswith("\n\n🏷️ trabajo")


def test_quick_saved_text_falls_back_to_the_leaf_category_name():
    expense = _expense(cat_levels=[])

    text = telegram_bot._quick_saved_text(expense, category_name="Supermercado")

    assert "🛒 Supermercado" in text


def test_cat_emoji_matches_partial_category_names():
    assert telegram_bot._cat_emoji("Café y snacks") == "☕"


def test_format_amount_uses_argentine_thousands_separator():
    assert telegram_bot._format_amount(3200, "ARS") == "$3.200"
    assert telegram_bot._format_amount(1234567, "ARS") == "$1.234.567"


@pytest.mark.parametrize(
    ("payment_label", "expected"),
    [("", ""), ("Efectivo", "💳 Efectivo")],
)
def test_saved_text_only_shows_a_payment_line_when_there_is_one(payment_label, expected):
    text = telegram_bot._saved_text(_expense(cat_levels=[]), payment_label=payment_label)

    if expected:
        assert f"\n{expected}\n" in text
    else:
        assert "💳 " not in text
