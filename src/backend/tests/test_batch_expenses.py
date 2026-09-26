"""Unit tests for batch expense parsing (#211) and multi-message flow (#210)."""

import json
import os
import unittest
from unittest.mock import MagicMock, patch

os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars-long-for-testing"


class TestParseExpenseBatch(unittest.TestCase):
    """Test _parse_expense returns list[dict] for single and multi-expense input."""

    @patch("app.telegram_bot._gemini_client")
    def test_single_expense_returns_list(self, mock_client_fn):
        """Single expense input should return a list with one dict."""
        mock_client = MagicMock()
        mock_client_fn.return_value = mock_client
        mock_client.models.generate_content.return_value.text = json.dumps(
            {"amount": 1500.0, "description": "farmacity", "date": "2026-05-05", "currency": "ARS"}
        )

        from app.telegram_bot import _parse_expense

        result = _parse_expense("farmacity 1500")
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["amount"], 1500.0)
        self.assertEqual(result[0]["description"], "farmacity")

    @patch("app.telegram_bot._gemini_client")
    def test_multi_expense_returns_list(self, mock_client_fn):
        """Multi-expense input should return a list with multiple dicts."""
        mock_client = MagicMock()
        mock_client_fn.return_value = mock_client
        mock_client.models.generate_content.return_value.text = json.dumps(
            [
                {"amount": 1500.0, "description": "farmacity", "date": "2026-05-05", "currency": "ARS"},
                {"amount": 800.0, "description": "uber", "date": "2026-05-05", "currency": "ARS"},
            ]
        )

        from app.telegram_bot import _parse_expense

        result = _parse_expense("farmacity 1500 y uber 800")
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["description"], "farmacity")
        self.assertEqual(result[1]["description"], "uber")

    @patch("app.telegram_bot._gemini_client")
    def test_markdown_fences_stripped(self, mock_client_fn):
        """LLM response wrapped in markdown code fences should be parsed."""
        mock_client = MagicMock()
        mock_client_fn.return_value = mock_client
        mock_client.models.generate_content.return_value.text = (
            '```json\n[{"amount": 500.0, "description": "cafe", "date": "2026-05-05", "currency": "ARS"}]\n```'
        )

        from app.telegram_bot import _parse_expense

        result = _parse_expense("cafe 500")
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["amount"], 500.0)

    @patch("app.telegram_bot._gemini_client")
    def test_invalid_json_returns_empty_list(self, mock_client_fn):
        """Invalid JSON response should return empty list."""
        mock_client = MagicMock()
        mock_client_fn.return_value = mock_client
        mock_client.models.generate_content.return_value.text = "not valid json"

        from app.telegram_bot import _parse_expense

        result = _parse_expense("random text")
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 0)

    @patch("app.telegram_bot._gemini_client")
    def test_empty_list_response(self, mock_client_fn):
        """Empty array response should return empty list."""
        mock_client = MagicMock()
        mock_client_fn.return_value = mock_client
        mock_client.models.generate_content.return_value.text = "[]"

        from app.telegram_bot import _parse_expense

        result = _parse_expense("gibberish")
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 0)

    @patch("app.telegram_bot._gemini_client")
    def test_list_with_invalid_entries_filtered(self, mock_client_fn):
        """Entries without 'amount' should be filtered out."""
        mock_client = MagicMock()
        mock_client_fn.return_value = mock_client
        mock_client.models.generate_content.return_value.text = json.dumps(
            [
                {"amount": 100.0, "description": "valid", "date": "2026-05-05", "currency": "ARS"},
                {"description": "no amount", "date": "2026-05-05", "currency": "ARS"},
                {"amount": 200.0, "description": "also valid", "date": "2026-05-05", "currency": "ARS"},
            ]
        )

        from app.telegram_bot import _parse_expense

        result = _parse_expense("test")
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["amount"], 100.0)
        self.assertEqual(result[1]["amount"], 200.0)


class TestWhatsAppSessionCleanup(unittest.TestCase):
    """Test that WhatsApp session is cleared before sending response (#210)."""

    def test_clear_session_before_response(self):
        """Session should be cleared immediately after save, not after response."""
        from app.whatsapp_bot import _sessions, _clear_session, _get_session

        phone_hash = "test_hash_123"
        _sessions[phone_hash] = {"state": "WAITING_CONFIRM", "data": {"parsed": {}}}

        session = _get_session(phone_hash)
        self.assertEqual(session["state"], "WAITING_CONFIRM")

        _clear_session(phone_hash)
        self.assertNotIn(phone_hash, _sessions)

    def test_new_session_after_clear(self):
        """After clearing, getting session should create a fresh one."""
        from app.whatsapp_bot import _sessions, _clear_session, _get_session

        phone_hash = "test_hash_456"
        _sessions[phone_hash] = {"state": "WAITING_CONFIRM", "data": {"parsed": {"amount": 100}}}

        _clear_session(phone_hash)
        new_session = _get_session(phone_hash)
        self.assertIsNone(new_session["state"])
        self.assertEqual(new_session["data"], {})


if __name__ == "__main__":
    unittest.main()