"""The thread the assistant sends becomes real conversation turns for the LLM.

The stage-1 behaviour was to send only the current question, so the model had
no idea what had already been said. The client now ships the whole thread and
this module turns it into Gemini turns: "user" stays "user", an assistant reply
becomes a "model" turn, and the fresh question is the final user turn.
"""

import pytest

from app.services.chat_context import (
    MAX_HISTORY_CHARS,
    MAX_HISTORY_MESSAGES,
    MAX_HISTORY_TURNS,
    to_genai_contents,
)


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


def test_the_window_counts_turns_not_messages():
    history = [
        turn
        for i in range(MAX_HISTORY_TURNS)
        for turn in (
            {"role": "user", "text": f"pregunta {i}"},
            {"role": "assistant", "text": f"respuesta {i}"},
        )
    ]
    contents = to_genai_contents(history, "última")

    # Twenty turns is forty messages, and all of them fit in the window.
    assert len(contents) == MAX_HISTORY_MESSAGES + 1
    assert _texts(contents)[0] == "pregunta 0"


def test_the_window_starts_on_a_user_turn_never_on_an_orphan_reply():
    # 41 messages, so the cut lands mid-pair and the window would otherwise
    # start on a model turn — read by the model as talking to itself.
    history = [
        {"role": "user" if i % 2 == 0 else "assistant", "text": f"m{i}"} for i in range(41)
    ]
    contents = to_genai_contents(history, "última")

    assert _roles(contents)[0] == "user"
    assert _texts(contents)[0] == "m2"
    assert _texts(contents)[-2] == "m40"


def test_the_oldest_turns_go_first_when_the_window_is_too_big_in_characters():
    history = [
        {"role": "user", "text": "a" * 9_000},
        {"role": "assistant", "text": "b" * 9_000},
        {"role": "user", "text": "c" * 9_000},
    ]
    contents = to_genai_contents(history, "última")

    # 27.000 characters in, 9.000 out: only the newest question survives.
    assert _texts(contents) == ["c" * 9_000, "última"]
    assert MAX_HISTORY_CHARS == 16_000


def test_a_single_turn_bigger_than_the_budget_is_kept():
    # No prior turn means no context to lose; dropping it would send nothing.
    contents = to_genai_contents([{"role": "user", "text": "x" * 20_000}], "última")

    assert _texts(contents) == ["x" * 20_000, "última"]


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


def test_the_analysis_request_rejects_a_runaway_thread():
    from pydantic import ValidationError

    from app.schemas.analysis import AnalysisRequest

    with pytest.raises(ValidationError):
        AnalysisRequest(question="hola", messages=[{"role": "user", "text": "x"}] * 51)
