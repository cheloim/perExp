"""Unit tests for recurring expense detection and merchant matching."""

import os
import unittest
from datetime import date
from unittest.mock import MagicMock

os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars-long-for-testing"

from app.tasks.detect_recurring import _merchant_keys_match


def _make_recurring(merchant_key, is_active=True, source="auto"):
    rec = MagicMock()
    rec.merchant_key = merchant_key
    rec.is_active = is_active
    rec.source = source
    return rec


def _make_expense(description, amount=1000.0, expense_date=None, card_id=None):
    exp = MagicMock()
    exp.description = description
    exp.amount = amount
    exp.date = expense_date or date(2026, 8, 1)
    exp.card_id = card_id
    exp.category_id = None
    exp.account_id = None
    return exp


# ---------------------------------------------------------------------------
# _merchant_keys_match
# ---------------------------------------------------------------------------

class TestMerchantKeysMatch(unittest.TestCase):
    def test_exact_match(self):
        self.assertTrue(_merchant_keys_match("NETFLIX", "NETFLIX"))

    def test_token_subset_left(self):
        self.assertTrue(_merchant_keys_match("MAKRO", "MAKRO PILAR"))

    def test_token_subset_right(self):
        self.assertTrue(_merchant_keys_match("MAKRO PILAR", "MAKRO"))

    def test_disjoint(self):
        self.assertFalse(_merchant_keys_match("MAKRO", "SOUTHEX"))

    def test_empty_left(self):
        self.assertFalse(_merchant_keys_match("", "NETFLIX"))

    def test_empty_right(self):
        self.assertFalse(_merchant_keys_match("NETFLIX", ""))

    def test_single_token_superset(self):
        self.assertTrue(_merchant_keys_match("GAS", "GAS NATURAL"))

    def test_multi_token_subset(self):
        self.assertTrue(_merchant_keys_match("GAS NATURAL", "GAS NATURAL FLOWERS"))

    def test_not_subset_similar_tokens(self):
        self.assertFalse(_merchant_keys_match("GAS NATURAL", "GAS PROPANO"))

    def test_case_sensitive_keys(self):
        # Merchant keys are uppercase in _normalize_merchant_key
        self.assertTrue(_merchant_keys_match("MAKRO", "MAKRO PILAR"))
        self.assertFalse(_merchant_keys_match("makro", "MAKRO PILAR"))


# ---------------------------------------------------------------------------
# Tombstone + fuzzy dedup scenarios
# ---------------------------------------------------------------------------

class TestTombstoneFuzzyDedup(unittest.TestCase):
    """Integration-style tests using mocked db queries in _detect_for_user."""

    def test_tombstone_exact_key_blocks_recreation(self):
        """Same merchant_key tombstone prevents re-creation."""
        from app.tasks.detect_recurring import _detect_for_user

        db = MagicMock()
        user_id = 1

        # Expenses: 3 identical charges within tolerance
        exps = [
            _make_expense("NETFLIX", 1500, date(2026, 6, 1)),
            _make_expense("NETFLIX", 1500, date(2026, 7, 1)),
            _make_expense("NETFLIX", 1500, date(2026, 8, 1)),
        ]
        db.query.return_value.filter.return_value.all.return_value = exps

        # Existing: NETFLIX tombstone
        existing = [_make_recurring("NETFLIX", is_active=False)]
        db.query.return_value.filter.return_value.all.side_effect = [
            exps,  # first call: expenses
            existing,  # second call: all existing recurring
        ]

        created, updated, skipped = _detect_for_user(user_id, db)
        self.assertEqual(created, 0)
        self.assertEqual(skipped, 1)

    def test_tombstone_fuzzy_key_blocks_variant(self):
        """Tombstone 'MAKRO' blocks creation of 'MAKRO PILAR'."""
        from app.tasks.detect_recurring import _detect_for_user

        db = MagicMock()
        user_id = 1

        exps = [
            _make_expense("MAKRO PILAR", 5000, date(2026, 6, 1)),
            _make_expense("MAKRO PILAR", 5000, date(2026, 7, 1)),
            _make_expense("MAKRO PILAR", 5000, date(2026, 8, 1)),
        ]
        db.query.return_value.filter.return_value.all.side_effect = [
            exps,
            [_make_recurring("MAKRO", is_active=False)],
        ]

        created, updated, skipped = _detect_for_user(user_id, db)
        self.assertEqual(created, 0)
        self.assertEqual(skipped, 1)

    def test_active_record_gets_updated(self):
        """Active record is updated, not duplicated."""
        from app.tasks.detect_recurring import _detect_for_user

        db = MagicMock()
        user_id = 1

        exps = [
            _make_expense("NETFLIX", 1500, date(2026, 6, 1)),
            _make_expense("NETFLIX", 1500, date(2026, 7, 1)),
            _make_expense("NETFLIX", 1500, date(2026, 8, 1)),
        ]
        active_rec = _make_recurring("NETFLIX", is_active=True)
        db.query.return_value.filter.return_value.all.side_effect = [
            exps,
            [active_rec],
        ]

        created, updated, skipped = _detect_for_user(user_id, db)
        self.assertEqual(created, 0)
        self.assertEqual(updated, 1)
        self.assertEqual(active_rec.amount, 1500.0)

    def test_active_takes_precedence_over_tombstone(self):
        """When both active and tombstone fuzzy-match, prefer active (update, not skip)."""
        from app.tasks.detect_recurring import _detect_for_user

        db = MagicMock()
        user_id = 1

        exps = [
            _make_expense("MAKRO PILAR", 5000, date(2026, 6, 1)),
            _make_expense("MAKRO PILAR", 5000, date(2026, 7, 1)),
            _make_expense("MAKRO PILAR", 5000, date(2026, 8, 1)),
        ]
        active_rec = _make_recurring("MAKRO", is_active=True)
        tombstone = _make_recurring("MAKRO PILAR", is_active=False)
        db.query.return_value.filter.return_value.all.side_effect = [
            exps,
            [active_rec, tombstone],
        ]

        created, updated, skipped = _detect_for_user(user_id, db)
        self.assertEqual(created, 0)
        self.assertEqual(updated, 1)

    def test_no_match_creates_record(self):
        """No existing match → new record created."""
        from app.tasks.detect_recurring import _detect_for_user

        db = MagicMock()
        user_id = 1

        exps = [
            _make_expense("NEW MERCHANT", 2000, date(2026, 6, 1)),
            _make_expense("NEW MERCHANT", 2000, date(2026, 7, 1)),
            _make_expense("NEW MERCHANT", 2000, date(2026, 8, 1)),
        ]
        db.query.return_value.filter.return_value.all.side_effect = [
            exps,
            [],
        ]

        created, updated, skipped = _detect_for_user(user_id, db)
        self.assertEqual(created, 1)
        self.assertEqual(updated, 0)
        self.assertEqual(skipped, 0)


# ---------------------------------------------------------------------------
# Notification throttle
# ---------------------------------------------------------------------------

class TestNotificationThrottle(unittest.TestCase):
    def test_skip_if_last_notification_unread(self):
        """Skip notification if previous auto_recurring_detected is unread."""
        from app.tasks.detect_recurring import _send_notification

        db = MagicMock()
        last_notif = MagicMock()
        last_notif.read = False

        db.query.return_value.filter.return_value.order_by.return_value.first.return_value = (
            last_notif
        )

        _send_notification(user_id=1, count=3, db=db)
        # No Notification should be added
        db.add.assert_not_called()

    def test_send_if_last_notification_read(self):
        """Send notification if previous auto_recurring_detected is read."""
        from app.tasks.detect_recurring import _send_notification

        db = MagicMock()
        last_notif = MagicMock()
        last_notif.read = True

        auto_item = MagicMock()
        auto_item.merchant_key = "NETFLIX"
        auto_item.id = 1

        def side_effect(*args, **kwargs):
            q = MagicMock()
            q.filter.return_value = q
            q.order_by.return_value = q
            q.first.return_value = last_notif
            q.all.return_value = [auto_item]
            return q

        db.query.side_effect = side_effect

        _send_notification(user_id=1, count=1, db=db)
        db.add.assert_called_once()

    def test_send_if_no_previous_notification(self):
        """Send notification if no previous auto_recurring_detected exists."""
        from app.tasks.detect_recurring import _send_notification

        db = MagicMock()

        auto_item = MagicMock()
        auto_item.merchant_key = "NETFLIX"
        auto_item.id = 1

        def side_effect(*args, **kwargs):
            q = MagicMock()
            q.filter.return_value = q
            q.order_by.return_value = q
            q.first.return_value = None  # no previous notification
            q.all.return_value = [auto_item]
            return q

        db.query.side_effect = side_effect

        _send_notification(user_id=1, count=1, db=db)
        db.add.assert_called_once()


if __name__ == "__main__":
    unittest.main()
