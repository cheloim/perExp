"""Every LLM call leaves with a language anchor.

A short prompt without context does not pin a language and the model drifts:
"Deci hola." without a system turn answered in Romanian roughly a third of the
time, while any system turn at all kept it in Spanish. `_as_messages` injects
`DEFAULT_SYSTEM` when the call site passes none, and the prompts that emit
prose anchor it themselves.
"""

import os
import unittest

os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars-long-for-testing"

from app.prompts import AI_TRENDS_PROMPT  # noqa: E402
from app.services.llm.client import DEFAULT_SYSTEM, _as_messages  # noqa: E402
from app.services.llm.types import LLMMessage  # noqa: E402


class TestDefaultSystemAnchor(unittest.TestCase):
    def test_none_system_gets_the_default(self):
        turns = _as_messages([LLMMessage(role="user", text="Deci hola.")], None)

        self.assertEqual(turns[0], LLMMessage(role="system", text=DEFAULT_SYSTEM))

    def test_empty_system_gets_the_default(self):
        turns = _as_messages([LLMMessage(role="user", text="Deci hola.")], "")

        self.assertEqual(turns[0], LLMMessage(role="system", text=DEFAULT_SYSTEM))

    def test_provided_system_is_kept_untouched(self):
        own = "Sos un analista financiero."
        turns = _as_messages([LLMMessage(role="user", text="hola")], own)

        self.assertEqual(turns[0], LLMMessage(role="system", text=own))
        self.assertNotIn(DEFAULT_SYSTEM, [t.text for t in turns])

    def test_default_appears_exactly_once(self):
        turns = _as_messages(
            [LLMMessage(role="user", text="hola"), LLMMessage(role="assistant", text="hola")],
            None,
        )

        self.assertEqual([t.text for t in turns].count(DEFAULT_SYSTEM), 1)
        self.assertEqual(len([t for t in turns if t.role == "system"]), 1)

    def test_dict_messages_keep_the_anchor_first(self):
        turns = _as_messages([{"role": "user", "text": "Deci hola."}])

        self.assertEqual(turns[0].role, "system")
        self.assertEqual(turns[0].text, DEFAULT_SYSTEM)
        self.assertEqual([t.text for t in turns].count(DEFAULT_SYSTEM), 1)


class TestProsePromptsAnchorLanguage(unittest.TestCase):
    def test_ai_trends_prompt_anchors_the_prose_fields(self):
        self.assertIn("español rioplatense", AI_TRENDS_PROMPT)
        for field in ("trend_explanation", "alert", "recommendation"):
            self.assertIn(field, AI_TRENDS_PROMPT)


if __name__ == "__main__":
    unittest.main()
