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
    _account(db, test_user, "USD")

    result = _match_account_from_text("pagué 5 usd en netflix", test_user.id, db)

    assert result is None


def test_account_bank_wins_over_a_usd_account_in_the_same_message(db, test_user):
    _account(db, test_user, "USD")
    galicia = _account(db, test_user, "Caja de Ahorro Galicia")

    result = _match_account_from_text("pagué con la cuenta de galicia 5 usd", test_user.id, db)

    assert result is galicia


def test_two_cards_with_the_same_name_and_no_bank_are_not_assigned(db, test_user):
    _card(db, test_user, name="Visa", bank="Galicia")
    _card(db, test_user, name="Visa", bank="Santander")

    result = _match_card_from_text(
        db.query(Card).filter(Card.user_id == test_user.id).all(), "Visa", None, None
    )

    assert result is None


def test_two_cards_of_the_same_bank_and_type_are_not_assigned(db, test_user):
    _card(db, test_user, name="Visa", bank="Santander")
    _card(db, test_user, name="Mastercard", bank="Santander")

    assert _match_card_from_notification(test_user.id, "Santander", "credito", None, db) is None


def test_bank_notification_without_bank_does_not_pick_a_card(db, test_user):
    _card(db, test_user, name="Visa", bank="Galicia")
    _card(db, test_user, name="Mastercard", bank="Santander")

    assert _match_card_from_notification(test_user.id, None, "credito", None, db) is None
    assert _match_card_from_notification(test_user.id, None, "credito", "Naranja", db) is None


def test_tag_with_another_bank_is_rejected(db, test_user):
    _tag(db, test_user, "Galicia Visa Crédito")

    result = _match_cuenta_tag_from_text("Visa Crédito", "Santander", test_user.id, db)

    assert result is None


def test_tag_with_another_franchise_is_rejected(db, test_user):
    _tag(db, test_user, "Santander Mastercard Crédito")

    result = _match_cuenta_tag_from_text("Visa Crédito", "Santander", test_user.id, db)

    assert result is None


def test_tag_with_the_opposite_card_type_is_rejected(db, test_user):
    _tag(db, test_user, "Santander Visa Crédito")

    result = _match_cuenta_tag_from_text("Visa", "Santander", test_user.id, db, card_type="debito")

    assert result is None


def test_ambiguous_hmac_tags_are_disambiguated_by_franchise(db, test_user):
    card = _card(db, test_user)
    _tag(db, test_user, "Santander")
    visa = _tag(db, test_user, "Santander Visa", card=card)

    result = _match_cuenta_tag_from_text("Visa", "Santander", test_user.id, db)

    assert result is visa


def test_hmac_tag_linked_to_another_bank_is_rejected(db, test_user):
    galicia_card = _card(db, test_user, name="Visa", bank="Galicia")
    _tag(db, test_user, "Visa", card=galicia_card)

    result = _match_cuenta_tag_from_text("Visa", "Santander", test_user.id, db)

    assert result is None


def test_text_tokens_complete_a_partial_card_extraction(db, test_user):
    tag = _tag(db, test_user, "Galicia Visa")

    result = _match_cuenta_tag_from_text(
        "Visa",
        None,
        test_user.id,
        db,
        text="pagué con visa galicia 5000",
    )

    assert result is tag


def test_two_tags_with_the_same_bank_and_type_are_not_assigned(db, test_user):
    _tag(db, test_user, "Santander Visa Crédito")
    _tag(db, test_user, "Santander Amex Crédito")

    result = _match_cuenta_tag_from_text(None, "Santander", test_user.id, db, card_type="credito")

    assert result is None


def test_two_accounts_of_the_same_type_without_a_bank_are_not_assigned(db, test_user):
    _account(db, test_user, "Caja de Ahorro Galicia")
    _account(db, test_user, "Caja de Ahorro Santander")

    result = _match_account_from_text("pagué con la caja de ahorro 5000", test_user.id, db)

    assert result is None


def test_account_type_keyword_c_c_matches_a_cuenta_corriente(db, test_user):
    account = _account(db, test_user, "Cuenta Corriente", account_type="cuenta_corriente")

    result = _match_account_from_text("pagué con c/c 5000", test_user.id, db)

    assert result is account


def test_account_type_keyword_c_a_matches_a_caja_de_ahorro(db, test_user):
    account = _account(db, test_user, "Caja de Ahorro")

    result = _match_account_from_text("pagué con c/a 5000", test_user.id, db)

    assert result is account


def test_tag_can_match_from_the_text_when_bank_extraction_misses_it(db, test_user):
    tag = _tag(db, test_user, "Nación")

    result = _match_cuenta_tag_from_text(
        None,
        None,
        test_user.id,
        db,
        text="pagué con la tarjeta nación 5000",
    )

    assert result is tag


def test_amex_and_american_express_share_the_franchise(db, test_user):
    card = _card(db, test_user, name="American Express", bank="Santander")

    result = _match_card_from_text([card], "Amex", "Santander", None)

    assert result is card


def test_compra_does_not_look_like_mercadopago(db, test_user):
    _account(db, test_user, "MercadoPago", account_type="mercadopago")

    result = _match_account_from_text("compra de supermercado 5000", test_user.id, db)

    assert result is None


def test_mercado_pago_keyword_matches_the_wallet_account(db, test_user):
    account = _account(db, test_user, "MercadoPago", account_type="mercadopago")

    result = _match_account_from_text("pagué con mercado pago 5000", test_user.id, db)

    assert result is account
