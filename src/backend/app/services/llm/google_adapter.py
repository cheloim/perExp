"""Google Gemini adapter. Kept so a provider switch back is a config change."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Iterator
from typing import Any

from google import genai
from google.genai import types as genai_types

from .client import LLMClient
from .types import LLMMessage, LLMResult

logger = logging.getLogger(__name__)


def _usage_of(response: Any) -> tuple[int, int, int]:
    meta = getattr(response, "usage_metadata", None)
    if meta is None:
        return 0, 0, 0
    return (
        int(getattr(meta, "prompt_token_count", 0) or 0),
        int(getattr(meta, "candidates_token_count", 0) or 0),
        int(getattr(meta, "cached_content_token_count", 0) or 0),
    )


class GoogleClient(LLMClient):
    provider = "google"

    def __init__(self, api_key: str, model: str, timeout: float):
        super().__init__(api_key, model, timeout)
        self._client = genai.Client(api_key=api_key)

    # `client.aio` must not be created inside one event loop and reused in
    # another (Celery tasks run their own), so it is resolved per access.
    @property
    def _async(self):
        return self._client.aio

    @staticmethod
    def _config(messages: list[LLMMessage], temperature: float | None, json_mode: bool):
        system = "\n\n".join(m.text for m in messages if m.role == "system") or None
        kwargs: dict[str, Any] = {"system_instruction": system}
        if temperature is not None:
            kwargs["temperature"] = temperature
        if json_mode:
            kwargs["response_mime_type"] = "application/json"
        return genai_types.GenerateContentConfig(**kwargs)

    @staticmethod
    def _contents(messages: list[LLMMessage]) -> list:
        turns = []
        for m in messages:
            if m.role == "system":
                continue
            role = "model" if m.role == "assistant" else "user"
            turns.append(genai_types.Content(role=role, parts=[genai_types.Part(text=m.text)]))
        return turns

    def _result(self, response: Any) -> LLMResult:
        input_tokens, output_tokens, cached = _usage_of(response)
        return LLMResult(
            text=(getattr(response, "text", "") or "").strip(),
            model=self.model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_input_tokens=cached,
            raw=response,
        )

    # ── non-streaming ────────────────────────────────────────────────────
    def _complete(self, messages, temperature, json_mode) -> LLMResult:
        response = self._client.models.generate_content(
            model=self.model,
            contents=self._contents(messages),
            config=self._config(messages, temperature, json_mode),
        )
        return self._result(response)

    async def _acomplete(self, messages, temperature, json_mode) -> LLMResult:
        response = await self._async.models.generate_content(
            model=self.model,
            contents=self._contents(messages),
            config=self._config(messages, temperature, json_mode),
        )
        return self._result(response)

    # ── streaming ────────────────────────────────────────────────────────
    def _stream(self, messages, temperature) -> Iterator[dict]:
        result = LLMResult(model=self.model)
        for chunk in self._client.models.generate_content_stream(
            model=self.model,
            contents=self._contents(messages),
            config=self._config(messages, temperature, False),
        ):
            text = getattr(chunk, "text", "")
            if text:
                yield {"text": text}
            if getattr(chunk, "usage_metadata", None) is not None:
                i, o, c = _usage_of(chunk)
                result.input_tokens, result.output_tokens, result.cached_input_tokens = i, o, c
        yield {"result": result}

    async def _astream(self, messages, temperature) -> AsyncIterator[dict]:
        result = LLMResult(model=self.model)
        stream = await self._async.models.generate_content_stream(
            model=self.model,
            contents=self._contents(messages),
            config=self._config(messages, temperature, False),
        )
        async for chunk in stream:
            text = getattr(chunk, "text", "")
            if text:
                yield {"text": text}
            if getattr(chunk, "usage_metadata", None) is not None:
                i, o, c = _usage_of(chunk)
                result.input_tokens, result.output_tokens, result.cached_input_tokens = i, o, c
        yield {"result": result}
