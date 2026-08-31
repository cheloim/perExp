"""Unit tests for card matching logic in telegram_bot and smart_import_core."""

import os
import unittest
from unittest.mock import MagicMock

os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars-long-for-testing"

from app.telegram_bot import (
    _extract_card_from_text,
    _match_card_from_notification,
    _strip_accents,
)
from app.services.smart_import_core import _match_card_to_existing


def _make_card(card_name, bank="", card_type="credito", user_id=1):
    """Create a mock Card object."""
    card = MagicMock()
    card.card_name = card_name
    card.bank = bank
    card.card_type = card_type
    card.user_id = user_id
    return card


def _make_db(cards):
    """Create a mock DB that returns the given cards."""
    db = MagicMock()
    db.query.return_value.filter.return_value.all.return_value = cards
    return db


class TestStripAccents(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(_strip_accents("Visa Débito"), "visa debito")

    def test_no_accents(self):
        self.assertEqual(_strip_accents("Mastercard"), "mastercard")

    def test_empty(self):
        self.assertEqual(_strip_accents(""), "")

    def test_whitespace(self):
        self.assertEqual(_strip_accents("  Visa Débito  "), "visa debito")


class TestMatchCardFromNotification(unittest.TestCase):
    def test_single_card_exact_match(self):
        """Single card matches by card_name + bank."""
        visa = _make_card("Visa Débito", bank="Santander", card_type="debito")
        db = _make_db([visa])
        result = _match_card_from_notification(1, "Santander", "debito", "Visa Débito", db)
        self.assertEqual(result, visa)

    def test_card_name_substring_match(self):
        """card_name substring matches DB card_name."""
        mastercard = _make_card("Santander Mastercard", bank="Santander", card_type="credito")
        db = _make_db([mastercard])
        result = _match_card_from_notification(1, "Santander", None, "Mastercard", db)
        self.assertEqual(result, mastercard)

    def test_card_name_abbreviated_match(self):
        """'Visa' matches 'Santander Visa Débito'."""
        visa = _make_card("Santander Visa Débito", bank="Santander", card_type="debito")
        db = _make_db([visa])
        result = _match_card_from_notification(1, "Santander", "debito", "Visa", db)
        self.assertEqual(result, visa)

    def test_disambiguation_by_type(self):
        """Multiple cards match name+bank, card_type disambiguates."""
        visa_credito = _make_card("Santander Visa Crédito", bank="Santander", card_type="credito")
        visa_debito = _make_card("Santander Visa Débito", bank="Santander", card_type="debito")
        db = _make_db([visa_credito, visa_debito])

        # Request debito → should match Visa Débito
        result = _match_card_from_notification(1, "Santander", "debito", "Visa", db)
        self.assertEqual(result, visa_debito)

        # Request credito → should match Visa Crédito
        result = _match_card_from_notification(1, "Santander", "credito", "Visa", db)
        self.assertEqual(result, visa_credito)

    def test_no_card_name_uses_bank_type(self):
        """No card_name falls back to bank + type matching."""
        visa = _make_card("Santander Visa Débito", bank="Santander", card_type="debito")
        mastercard = _make_card("Santander Mastercard", bank="Santander", card_type="credito")
        db = _make_db([visa, mastercard])

        result = _match_card_from_notification(1, "Santander", "debito", None, db)
        self.assertEqual(result, visa)

    def test_bank_only_fallback(self):
        """Only bank matches, no card_name → returns first matching bank+type."""
        visa = _make_card("Visa", bank="Santander", card_type="credito")
        mastercard = _make_card("Mastercard", bank="Santander", card_type="debito")
        db = _make_db([visa, mastercard])

        result = _match_card_from_notification(1, "Santander", "credito", None, db)
        self.assertEqual(result, visa)

    def test_type_only_single_card(self):
        """No bank match, but single card of target type → auto-select."""
        visa = _make_card("Visa", bank="Galicia", card_type="debito")
        db = _make_db([visa])

        result = _match_card_from_notification(1, "Santander", "debito", None, db)
        self.assertEqual(result, visa)

    def test_type_only_multiple_cards_returns_none(self):
        """Multiple cards of target type, no bank match → None."""
        visa = _make_card("Visa", bank="Galicia", card_type="credito")
        mastercard = _make_card("Mastercard", bank="BBVA", card_type="credito")
        db = _make_db([visa, mastercard])

        result = _match_card_from_notification(1, "Santander", "credito", None, db)
        self.assertIsNone(result)

    def test_no_cards_returns_none(self):
        """Empty card list → None."""
        db = _make_db([])
        result = _match_card_from_notification(1, "Santander", "credito", "Visa", db)
        self.assertIsNone(result)

    def test_accent_insensitive_match(self):
        """Accent-insensitive matching works."""
        visa = _make_card("Santander Visa Débito", bank="Santander", card_type="debito")
        db = _make_db([visa])
        result = _match_card_from_notification(1, "Santander", "debito", "Visa Debito", db)
        self.assertEqual(result, visa)

    def test_swap_scenario_1(self):
        """Issue #161 Scenario 1: 'Santander Mastercard' → should match Mastercard, not Visa Débito."""
        visa_debito = _make_card("Santander Visa Débito", bank="Santander", card_type="debito")
        mastercard = _make_card("Santander Mastercard", bank="Santander", card_type="credito")
        db = _make_db([visa_debito, mastercard])

        # LLM returns card_type=None (no explicit type in "Santander Mastercard")
        result = _match_card_from_notification(1, "Santander", None, "Mastercard", db)
        self.assertEqual(result, mastercard)

    def test_swap_scenario_1_wrong_type(self):
        """Issue #161: Even if LLM returns wrong card_type, card_name should win."""
        visa_debito = _make_card("Santander Visa Débito", bank="Santander", card_type="debito")
        mastercard = _make_card("Santander Mastercard", bank="Santander", card_type="credito")
        db = _make_db([visa_debito, mastercard])

        # LLM returns card_type="debito" (WRONG for Mastercard) — card_name should still match
        result = _match_card_from_notification(1, "Santander", "debito", "Mastercard", db)
        self.assertEqual(result, mastercard)

    def test_swap_scenario_2(self):
        """Issue #161 Scenario 2: 'Visa Débito terminada en 3001' → should match Visa Débito."""
        visa_debito = _make_card("Santander Visa Débito", bank="Santander", card_type="debito")
        mastercard = _make_card("Santander Mastercard", bank="Santander", card_type="credito")
        db = _make_db([visa_debito, mastercard])

        result = _match_card_from_notification(1, "Santander", "debito", "Visa Débito", db)
        self.assertEqual(result, visa_debito)

    def test_swap_scenario_2_wrong_type(self):
        """Issue #161: Even if LLM returns wrong type for Visa Débito, card_name should win."""
        visa_debito = _make_card("Santander Visa Débito", bank="Santander", card_type="debito")
        mastercard = _make_card("Santander Mastercard", bank="Santander", card_type="credito")
        db = _make_db([visa_debito, mastercard])

        # LLM returns card_type="credito" (WRONG for Visa Débito)
        result = _match_card_from_notification(1, "Santander", "credito", "Visa Débito", db)
        self.assertEqual(result, visa_debito)


class TestMatchCardToExisting(unittest.TestCase):
    def test_exact_match(self):
        """Exact bank + franchise match."""
        visa = _make_card("Visa Débito", bank="Santander", card_type="debito")
        result = _match_card_to_existing("Santander", "Visa", [visa])
        self.assertEqual(result, visa)

    def test_substring_match(self):
        """Franchise substring matches card_name."""
        mastercard = _make_card("Santander Mastercard", bank="Santander", card_type="credito")
        result = _match_card_to_existing("Santander", "Mastercard", [mastercard])
        self.assertEqual(result, mastercard)

    def test_disambiguation_by_card_type(self):
        """Multiple matches, card_type disambiguates."""
        visa_credito = _make_card("Santander Visa Crédito", bank="Santander", card_type="credito")
        visa_debito = _make_card("Santander Visa Débito", bank="Santander", card_type="debito")

        result = _match_card_to_existing("Santander", "Visa", [visa_credito, visa_debito], "debito")
        self.assertEqual(result, visa_debito)

    def test_no_match(self):
        """No matching card."""
        visa = _make_card("Visa", bank="Galicia", card_type="credito")
        result = _match_card_to_existing("Santander", "Mastercard", [visa])
        self.assertIsNone(result)

    def test_missing_bank(self):
        """No bank detected → None."""
        visa = _make_card("Visa", bank="Santander", card_type="credito")
        result = _match_card_to_existing("", "Visa", [visa])
        self.assertIsNone(result)

    def test_missing_card(self):
        """No card detected → None."""
        visa = _make_card("Visa", bank="Santander", card_type="credito")
        result = _match_card_to_existing("Santander", "", [visa])
        self.assertIsNone(result)


class TestExtractCardFromText(unittest.TestCase):
    def test_visa_debito(self):
        card_name, bank, card_type = _extract_card_from_text("visa debito")
        self.assertEqual(card_name, "Visa Debito")
        self.assertIsNone(bank)
        self.assertEqual(card_type, "debito")

    def test_visa_debito_accented(self):
        card_name, bank, card_type = _extract_card_from_text("visa débito")
        self.assertEqual(card_name, "Visa Débito")
        self.assertIsNone(bank)
        self.assertEqual(card_type, "debito")

    def test_mastercard_santander(self):
        card_name, bank, card_type = _extract_card_from_text("santander mastercard")
        self.assertEqual(card_name, "Mastercard")
        self.assertEqual(bank, "Santander")
        self.assertIsNone(card_type)

    def test_visa_credito_galicia(self):
        card_name, bank, card_type = _extract_card_from_text("visa credito galicia")
        self.assertEqual(card_name, "Visa Credito")
        self.assertEqual(bank, "Galicia")
        self.assertEqual(card_type, "credito")

    def test_no_card_info(self):
        card_name, bank, card_type = _extract_card_from_text("farmacity 3200")
        self.assertIsNone(card_name)
        self.assertIsNone(bank)
        self.assertIsNone(card_type)

    def test_compound_form_visa_debito(self):
        card_name, bank, card_type = _extract_card_from_text("compre visa debito en farmacity")
        self.assertEqual(card_name, "Visa Debito")
        self.assertEqual(card_type, "debito")

    def test_compound_form_mastercard_debito(self):
        card_name, bank, card_type = _extract_card_from_text("pague mastercard debito supermercado")
        self.assertEqual(card_name, "Mastercard Debito")
        self.assertEqual(card_type, "debito")


if __name__ == "__main__":
    unittest.main()
