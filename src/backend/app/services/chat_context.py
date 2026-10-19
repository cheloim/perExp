"""Turn a client-side message thread into LLM conversation turns.

The assistant ships its whole thread on every request so the model knows what
has already been said. This is the only place that knows how that array maps
onto the model API's turn structure, and the only place that bounds how much of
it travels to the model.

The client sends the same window (see `wireMessages` in
`frontend/src/components/assistant/configs.ts`), but the API is public and the
request is not trusted: the caps are enforced here too.
"""

from google.genai import types as genai_types

#: How many prior turns are forwarded. Big enough to keep a conversation
#: coherent, small enough that a long thread cannot grow the prompt without
#: bound — the thread lives in the browser and gets longer every message.
#: A turn is a question and its reply, so that is two messages per turn.
MAX_HISTORY_TURNS = 20

MAX_HISTORY_MESSAGES = MAX_HISTORY_TURNS * 2

#: Second, independent bound: long messages. Oldest turns go first, so the
#: newest question always fits.
MAX_HISTORY_CHARS = 16_000


def _usable(history) -> list[tuple[str, str]]:
    """Keep the turns the model API accepts, as `(role, text)` pairs.

    A role the model API does not accept is dropped rather than forwarded:
    passing it through would fail the whole request, and it is not a turn of
    the conversation anyway. Empty turns go too — they are placeholders, not
    content.
    """
    clean: list[tuple[str, str]] = []
    for message in history:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        if role not in ("user", "assistant"):
            continue
        text = str(message.get("text") or "").strip()
        if not text:
            continue
        clean.append((role, text))
    return clean


def _window(history) -> list[tuple[str, str]]:
    """The newest turns that fit in the budget, starting on a user turn.

    Newest first, so both bounds stop as soon as the window is full. The head
    is then aligned to a user turn: a thread is read as question/answer pairs,
    so a leading orphan reply would be read as the model talking to itself.
    """
    kept: list[tuple[str, str]] = []
    chars = 0
    for role, text in reversed(_usable(history)):
        if len(kept) >= MAX_HISTORY_MESSAGES:
            break
        if kept and chars + len(text) > MAX_HISTORY_CHARS:
            break
        kept.append((role, text))
        chars += len(text)
    kept.reverse()

    for i, (role, _) in enumerate(kept):
        if role == "user":
            return kept[i:]
    return kept


def to_genai_contents(history, final_user_text: str) -> list:
    """Build conversation turns from `{"role": "user" | "assistant", "text": ...}`.

    An assistant reply becomes a "model" turn. The fresh question is appended
    last, always as a user turn.
    """
    if history is None:
        history = []
    if not isinstance(history, list):
        raise TypeError(f"history must be a list, got {type(history).__name__}")

    turns: list = [
        genai_types.Content(
            role="user" if role == "user" else "model",
            parts=[genai_types.Part(text=text)],
        )
        for role, text in _window(history)
    ]

    turns.append(genai_types.Content(role="user", parts=[genai_types.Part(text=final_user_text)]))
    return turns
