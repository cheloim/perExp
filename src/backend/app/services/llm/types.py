"""Provider-neutral LLM value types.

Everything the app knows about a model call passes through here: what goes in
(`LLMMessage`), what comes out (`LLMResult`), and how a JSON reply is unwrapped.
Nothing in this module imports a vendor SDK — that is the point of the package.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Literal

Role = Literal["system", "user", "assistant"]


@dataclass(frozen=True)
class LLMMedia:
    """A short-lived media attachment; callers own its lifetime."""

    kind: Literal["image", "audio"]
    mime_type: str
    data: bytes


@dataclass(frozen=True)
class LLMMessage:
    """One conversation turn. `role` is the OpenAI vocabulary; the Google
    adapter maps `assistant` onto its `model` role."""

    role: Role
    text: str = ""
    media: tuple[LLMMedia, ...] = ()


@dataclass
class LLMResult:
    """A completed, non-streaming call. `text` is empty until the model answers."""

    text: str = ""
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    finish_reason: str | None = None
    duration_seconds: float | None = None
    raw: Any = field(default=None, repr=False)


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def parse_json_block(text: str) -> Any:
    """Parse a model reply that should be JSON.

    Tolerates the two things models do even when told not to: wrapping the
    payload in a markdown fence, and leading/trailing chatter around it.
    Raises `ValueError` when nothing parses, so the caller can fall back.
    """
    if not text or not text.strip():
        raise ValueError("Respuesta vacía del modelo")

    cleaned = text.strip()

    fence = _FENCE_RE.search(cleaned)
    if fence:
        cleaned = fence.group(1).strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Last resort: the outermost balanced {...} or [...] block.
    for opener, closer in (("{", "}"), ("[", "]")):
        start, end = cleaned.find(opener), cleaned.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(cleaned[start : end + 1])
            except json.JSONDecodeError:
                continue

    raise ValueError(f"Respuesta no es JSON válido: {cleaned[:200]}")
