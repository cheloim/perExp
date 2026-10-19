"""The thread the assistant sends becomes real conversation turns for the LLM.

The stage-1 behaviour was to send only the current question, so the model had
no idea what had already been said. The client now ships the whole thread and
this module turns it into Gemini turns: "user" stays "user", an assistant reply
becomes a "model" turn, and the fresh question is the final user turn.
"""

import pytest

from app.services.chat_context import MAX_HISTORY_MESSAGES, to_genai_contents


def _texts(contents):
    return [c.parts[0].text for c in contents]


def _roles(contents):
    return [c.role for c in contents]


def test_assistant_replies_become_model_turns():
    history = [
        {"role": "user", "text": "¿cuánto gasté?"},
        {"role": "assistant", "text": "$10.000"},
    ]
    contents = to_genai_contents(history, "¿Y el mes pasado?")

    assert _roles(contents) == ["user", "model", "user"]
    assert _texts(contents) == ["¿cuánto gasté?", "$10.000", "¿Y el mes pasado?"]


def test_unknown_roles_are_never_sent_to_the_model_api():
    contents = to_genai_contents([{"role": "system", "text": "ignorame"}], "hola")

    assert _roles(contents) == ["user"]


def test_empty_and_whitespace_turns_are_dropped():
    history = [
        {"role": "user", "text": "   "},
        {"role": "assistant", "text": ""},
        {"role": "user", "text": "gasté 100"},
    ]
    contents = to_genai_contents(history, "¿cuánto?")

    assert _texts(contents) == ["gasté 100", "¿cuánto?"]


def test_no_history_still_produces_the_final_turn():
    assert _texts(to_genai_contents([], "pregunta")) == ["pregunta"]
    assert _texts(to_genai_contents(None, "pregunta")) == ["pregunta"]


def test_the_thread_is_capped_so_the_prompt_cannot_grow_without_bound():
    history = [{"role": "user", "text": f"turno {i}"} for i in range(MAX_HISTORY_MESSAGES * 3)]
    contents = to_genai_contents(history, "última")

    # Only the newest turns survive, and the fresh question is always last.
    assert len(contents) == MAX_HISTORY_MESSAGES + 1
    assert _texts(contents)[0] == f"turno {MAX_HISTORY_MESSAGES * 3 - MAX_HISTORY_MESSAGES}"
    assert _texts(contents)[-1] == "última"


def test_roles_survive_a_long_thread_in_order():
    history = [
        {"role": "user", "text": "uno"},
        {"role": "assistant", "text": "dos"},
        {"role": "user", "text": "tres"},
    ]
    assert _roles(to_genai_contents(history, "cuatro")) == ["user", "model", "user", "user"]


def test_rejects_a_history_that_is_not_a_list():
    with pytest.raises(TypeError):
        to_genai_contents({"role": "user"}, "pregunta")


def test_the_analysis_request_carries_the_thread():
    from app.schemas.analysis import AnalysisRequest

    req = AnalysisRequest(question="¿y el mes pasado?", messages=[{"role": "user", "text": "hola"}])

    assert [m.model_dump() for m in req.messages] == [{"role": "user", "text": "hola"}]
    # Omitting it must stay valid — an older client asking a single question.
    assert AnalysisRequest(question="hola").messages is None
