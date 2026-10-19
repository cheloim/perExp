"""Turn a client-side message thread into LLM conversation turns.

The assistant ships its whole thread on every request so the model knows what
has already been said. This is the only place that knows how that array maps
onto the model API's turn structure.
"""

from google.genai import types as genai_types

#: How many prior turns are forwarded. Big enough to keep a conversation
#: coherent, small enough that a long thread cannot grow the prompt without
#: bound — the thread lives in the browser and gets longer every message.
MAX_HISTORY_MESSAGES = 20


def to_genai_contents(history, final_user_text: str) -> list:
    """Build conversation turns from `{"role": "user" | "assistant", "text": ...}`.

    An assistant reply becomes a "model" turn. A role the model API does not
    accept is dropped rather than forwarded: passing it through would fail the
    whole request, and it is not a turn of the conversation anyway. The fresh
    question is appended last, always as a user turn.
    """
    if history is None:
        history = []
    if not isinstance(history, list):
        raise TypeError(f"history must be a list, got {type(history).__name__}")

    turns: list = []
    for message in history[-MAX_HISTORY_MESSAGES:]:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        if role not in ("user", "assistant"):
            continue
        text = str(message.get("text") or "").strip()
        if not text:
            continue
        turns.append(
            genai_types.Content(
                role="user" if role == "user" else "model",
                parts=[genai_types.Part(text=text)],
            )
        )

    turns.append(genai_types.Content(role="user", parts=[genai_types.Part(text=final_user_text)]))
    return turns
