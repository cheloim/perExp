"""OpenAI adapter. The only file in the app that imports `openai`."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Iterator
from typing import Any

from .client import LLMClient
from .types import LLMMessage, LLMResult

logger = logging.getLogger(__name__)

#: OpenAI rejects JSON mode unless the word "JSON" appears in the conversation.
_JSON_HINT = "Respondé únicamente con JSON válido."


def _usage_of(response: Any) -> tuple[int, int, int]:
    usage = getattr(response, "usage", None)
    if usage is None:
        return 0, 0, 0
    details = getattr(usage, "prompt_tokens_details", None) or None
    cached = int(getattr(details, "cached_tokens", 0) or 0) if details else 0
    return (
        int(getattr(usage, "prompt_tokens", 0) or 0),
        int(getattr(usage, "completion_tokens", 0) or 0),
        cached,
    )


class OpenAIClient(LLMClient):
    provider = "openai"

    def __init__(self, api_key: str, model: str, timeout: float):
        super().__init__(api_key, model, timeout)
        from openai import AsyncOpenAI, OpenAI

        self._sync = OpenAI(api_key=api_key, timeout=timeout, max_retries=1)
        self._async = AsyncOpenAI(api_key=api_key, timeout=timeout, max_retries=1)

    def _payload(
        self, messages: list[LLMMessage], temperature: float | None, json_mode: bool
    ) -> dict[str, Any]:
        turns = [{"role": m.role, "content": m.text} for m in messages]
        if json_mode and not any("json" in t["content"].lower() for t in turns):
            turns.append({"role": "user", "content": _JSON_HINT})

        payload: dict[str, Any] = {"model": self.model, "messages": turns}
        if temperature is not None:
            payload["temperature"] = temperature
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        return payload

    @staticmethod
    def _create(create: Any, payload: dict[str, Any]) -> Any:
        """Send the request, dropping `temperature` if the model rejects it.

        Some model families only accept the default temperature. A missing
        temperature is a smaller surprise than a failed call.
        """
        try:
            return create(**payload)
        except Exception as exc:
            if "temperature" not in str(exc).lower():
                raise
            payload.pop("temperature", None)
            return create(**payload)

    @staticmethod
    def _result(response: Any) -> LLMResult:
        choice = response.choices[0] if response.choices else None
        input_tokens, output_tokens, cached = _usage_of(response)
        return LLMResult(
            text=(choice.message.content or "") if choice else "",
            model=getattr(response, "model", "") or "",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_input_tokens=cached,
            finish_reason=getattr(choice, "finish_reason", None) if choice else None,
            raw=response,
        )

    # ── non-streaming ────────────────────────────────────────────────────
    def _complete(self, messages, temperature, json_mode) -> LLMResult:
        payload = self._payload(messages, temperature, json_mode)
        return self._result(self._create(self._sync.chat.completions.create, payload))

    async def _acomplete(self, messages, temperature, json_mode) -> LLMResult:
        payload = self._payload(messages, temperature, json_mode)
        response = await self._create(self._async.chat.completions.create, payload)
        return self._result(response)

    # ── streaming ────────────────────────────────────────────────────────
    def _stream(self, messages, temperature) -> Iterator[dict]:
        payload = self._payload(messages, temperature, False)
        payload["stream"] = True
        payload["stream_options"] = {"include_usage": True}
        stream = self._create(self._sync.chat.completions.create, payload)
        result = LLMResult(model=self.model)
        for chunk in stream:
            usage = getattr(chunk, "usage", None)
            if usage is not None:
                i, o, c = _usage_of(chunk)
                result.input_tokens, result.output_tokens, result.cached_input_tokens = i, o, c
                result.model = getattr(chunk, "model", "") or result.model
                continue
            for choice in chunk.choices or []:
                delta = getattr(choice, "delta", None)
                if delta is not None and delta.content:
                    yield {"text": delta.content}
        yield {"result": result}

    async def _astream(self, messages, temperature) -> AsyncIterator[dict]:
        payload = self._payload(messages, temperature, False)
        payload["stream"] = True
        payload["stream_options"] = {"include_usage": True}
        stream = await self._create(self._async.chat.completions.create, payload)
        result = LLMResult(model=self.model)
        async for chunk in stream:
            usage = getattr(chunk, "usage", None)
            if usage is not None:
                i, o, c = _usage_of(chunk)
                result.input_tokens, result.output_tokens, result.cached_input_tokens = i, o, c
                result.model = getattr(chunk, "model", "") or result.model
                continue
            for choice in chunk.choices or []:
                delta = getattr(choice, "delta", None)
                if delta is not None and delta.content:
                    yield {"text": delta.content}
        yield {"result": result}
