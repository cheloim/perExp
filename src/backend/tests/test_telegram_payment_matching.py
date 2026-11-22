"""Payment-method detection for Telegram messages.

The bot receives the card/account in the message but has to resolve it against
the user's data. These tests cover the names the platform actually stores:
bank prefixes, accents, card-type words and payment tags without a Card row.
"""

from app.models import Account, Card, Tag
from app.services.encryption import compute_hmac
from app.telegram.parsing import (
    _match_account_from_text,
    _match_card_from_notification,
    _match_card_from_text,
    _match_cuenta_tag_from_text,
)


def _card(db, user, name="Mastercard", bank="Santander", card_type="credito"):
    card = Card(
        card_name=name,
        card_name_hmac=compute_hmac(name.lower()),
        bank=bank,
        bank_hmac=compute_hmac(bank.lower()) if bank else None,
        card_type=card_type,
        user_id=user.id,
    )
    db.add(card)
    db.flush()
    return card


def _account(db, user, name, account_type="caja_ahorro"):
    account = Account(
        name=name,
        name_hmac=compute_hmac(name.strip().lower()),
        type=account_type,
        user_id=user.id,
    )
    db.add(account)
    db.flush()
    return account


def _tag(db, user, name, card=None, account=None):
    tag = Tag(
        name=name,
        name_hmac=compute_hmac(name.strip().lower()),
        color="#3584e4",
        group_name="cuenta",
        user_id=user.id,
        card_id=card.id if card else None,
        account_id=account.id if account else None,
    )
    db.add(tag)
    db.flush()
    return tag


def test_card_with_banco_prefix_in_the_stored_name_still_matches(db, test_user):
    card = _card(db, test_user, bank="Banco Santander")

    result = _match_card_from_text([card], "Mastercard Crédito", "Santander", "credito")

    assert result is card


def test_bank_notification_card_type_with_accent_matches(db, test_user):
    card = _card(db, test_user)

    result = _match_card_from_notification(test_user.id, "Santander", "crédito", None, db)

    assert result is card


def test_cuenta_tag_matches_when_it_contains_the_card_type(db, test_user):
    card = _card(db, test_user)
    tag = _tag(db, test_user, "Santander Mastercard Crédito", card=card)

    result = _match_cuenta_tag_from_text("Mastercard Credito", "Santander", test_user.id, db)

    assert result is tag


def test_account_matches_by_bank_and_account_word(db, test_user):
    account = _account(db, test_user, "Caja de Ahorro Galicia")

    result = _match_account_from_text("pagué con la cuenta de galicia 5000", test_user.id, db)

    assert result is account


def test_cuenta_tag_matches_account_name_without_card_row(db, test_user):
    account = _account(db, test_user, "Caja de Ahorro Galicia")
    tag = _tag(db, test_user, "Caja de Ahorro Galicia", account=account)

    result = _match_cuenta_tag_from_text(None, "Galicia", test_user.id, db)

    assert result is tag


def test_account_does_not_match_only_because_the_amount_is_in_usd(db, test_user):
    _account(db, test_user, "Cuenta USD")

    result = _match_account_from_text("pagué 5 usd en netflix", test_user.id, db)

    assert result is None


def test_compra_does_not_look_like_mercadopago(db, test_user):
    _account(db, test_user, "MercadoPago", account_type="mercadopago")

    result = _match_account_from_text("compra de supermercado 5000", test_user.id, db)

    assert result is None


def test_mercado_pago_keyword_matches_the_wallet_account(db, test_user):
    account = _account(db, test_user, "MercadoPago", account_type="mercadopago")

    result = _match_account_from_text("pagué con mercado pago 5000", test_user.id, db)

    assert result is account
