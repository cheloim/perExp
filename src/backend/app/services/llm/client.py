"""The LLM facade: one call shape for every provider.

Callers build `LLMMessage` lists and call `complete` / `complete_json` /
`stream`. Everything vendor-specific — SDK, model id, message vocabulary, JSON
mode, streaming shape, token accounting — lives behind this module, so a
provider switch is a change to `LLM_PROVIDER` and `LLM_MODEL_NAME`, not a
rewrite.

Provider is resolved from `LLM_PROVIDER`, or inferred from the key shape when
that is unset (`sk-...` is OpenAI, anything else is Google). That is what makes
swapping the value of `LLM_API_KEY` enough to move providers.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import AsyncIterator, Iterator
from typing import Any

from .metrics import record_llm_call
from .pricing import estimate_cost_usd
from .types import LLMMessage, LLMResult, parse_json_block

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 30.0

#: Env var names a call site may want instead of the default `LLM_API_KEY`.
KEY_ENV_VARS = ("LLM_API_KEY", "MESSAGES_BOT_LLM_API_KEY", "INVESTMENTS_LLM_API_KEY")


class LLMError(RuntimeError):
    """Raised when no LLM is configured for a call site."""


def resolve_api_key(api_key: str | None = None, api_key_env: str = "LLM_API_KEY") -> str:
    """The key to use: explicit, then `api_key_env`, then `LLM_API_KEY`."""
    if api_key:
        return api_key
    return os.getenv(api_key_env, "") or os.getenv("LLM_API_KEY", "") or ""


def is_configured(api_key_env: str = "LLM_API_KEY") -> bool:
    """Whether a call site can reach any model at all."""
    return bool(resolve_api_key(api_key_env=api_key_env))


def resolve_provider(api_key: str) -> str:
    explicit = os.getenv("LLM_PROVIDER", "").strip().lower()
    if explicit in ("openai",):
        return "openai"
    if explicit in ("google", "gemini"):
        return "google"
    return "openai" if api_key.startswith("sk-") else "google"


def resolve_model(provider: str, model: str | None = None) -> str:
    if model:
        return model
    env_model = os.getenv("LLM_MODEL_NAME", "").strip()
    if env_model:
        return env_model
    return "gpt-6-luna" if provider == "openai" else "gemini-flash-latest"


def _as_messages(messages: Any, system: str | None = None) -> list[LLMMessage]:
    """Accept a list of `LLMMessage`, or `{"role": ..., "text": ...}` dicts."""
    out: list[LLMMessage] = []
    if system:
        out.append(LLMMessage(role="system", text=system))
    for m in messages or []:
        if isinstance(m, LLMMessage):
            out.append(m)
            continue
        role = m.get("role", "user")
        if role not in ("system", "user", "assistant"):
            role = "user"
        text = str(m.get("text") or m.get("content") or "")
        if text:
            out.append(LLMMessage(role=role, text=text))
    return out


class LLMClient:
    """Provider-agnostic client. Subclasses implement the four raw calls."""

    provider = ""

    def __init__(self, api_key: str, model: str, timeout: float = DEFAULT_TIMEOUT_SECONDS):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    # ── raw calls (implemented per provider) ─────────────────────────────
    def _complete(self, messages, temperature, json_mode) -> LLMResult:  # pragma: no cover
        raise NotImplementedError

    async def _acomplete(self, messages, temperature, json_mode) -> LLMResult:  # pragma: no cover
        raise NotImplementedError

    def _stream(self, messages, temperature) -> Iterator[Any]:  # pragma: no cover
        raise NotImplementedError

    def _astream(self, messages, temperature) -> AsyncIterator[Any]:  # pragma: no cover
        raise NotImplementedError

    # ── public, instrumented ─────────────────────────────────────────────
    def complete(
        self,
        messages: Any,
        *,
        feature: str,
        system: str | None = None,
        temperature: float | None = None,
        json_mode: bool = False,
    ) -> LLMResult:
        turns = _as_messages(messages, system)
        start = time.perf_counter()
        try:
            result = self._complete(turns, temperature, json_mode)
        except Exception:
            self._record(feature, start, "error")
            raise
        self._record(feature, start, "ok", result)
        return result

    async def acomplete(
        self,
        messages: Any,
        *,
        feature: str,
        system: str | None = None,
        temperature: float | None = None,
        json_mode: bool = False,
    ) -> LLMResult:
        turns = _as_messages(messages, system)
        start = time.perf_counter()
        try:
            result = await self._acomplete(turns, temperature, json_mode)
        except Exception:
            self._record(feature, start, "error")
            raise
        self._record(feature, start, "ok", result)
        return result

    def complete_json(self, messages: Any, *, feature: str, **kwargs: Any) -> Any:
        """`complete` + parse. Sets JSON mode and unwraps fences for free."""
        kwargs["json_mode"] = True
        return parse_json_block(self.complete(messages, feature=feature, **kwargs).text)

    async def acomplete_json(self, messages: Any, *, feature: str, **kwargs: Any) -> Any:
        kwargs["json_mode"] = True
        result = await self.acomplete(messages, feature=feature, **kwargs)
        return parse_json_block(result.text)

    def stream(
        self,
        messages: Any,
        *,
        feature: str,
        system: str | None = None,
        temperature: float | None = None,
    ) -> Iterator[str]:
        turns = _as_messages(messages, system)
        start = time.perf_counter()
        final: list[LLMResult] = []
        try:
            for chunk in self._stream(turns, temperature):
                if chunk.get("text"):
                    yield chunk["text"]
                if chunk.get("result"):
                    final.append(chunk["result"])
        except Exception:
            self._record(feature, start, "error", final[0] if final else None)
            raise
        self._record(feature, start, "ok", final[0] if final else None)

    async def astream(
        self,
        messages: Any,
        *,
        feature: str,
        system: str | None = None,
        temperature: float | None = None,
    ) -> AsyncIterator[str]:
        turns = _as_messages(messages, system)
        start = time.perf_counter()
        final: list[LLMResult] = []
        try:
            async for chunk in self._astream(turns, temperature):
                if chunk.get("text"):
                    yield chunk["text"]
                if chunk.get("result"):
                    final.append(chunk["result"])
        except Exception:
            self._record(feature, start, "error", final[0] if final else None)
            raise
        self._record(feature, start, "ok", final[0] if final else None)

    def _record(
        self, feature: str, start: float, status: str, result: LLMResult | None = None
    ) -> None:
        model = (result.model if result else "") or self.model
        input_tokens = result.input_tokens if result else 0
        output_tokens = result.output_tokens if result else 0
        record_llm_call(
            provider=self.provider,
            model=model,
            feature=feature,
            status=status,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_input_tokens=result.cached_input_tokens if result else 0,
            latency_seconds=time.perf_counter() - start,
            cost_usd=estimate_cost_usd(model, input_tokens, output_tokens),
        )


def get_client(
    *,
    api_key: str | None = None,
    api_key_env: str = "LLM_API_KEY",
    model: str | None = None,
    timeout: float | None = None,
) -> LLMClient:
    """Build a client for the configured provider.

    Raises `LLMError` when no key is available, so call sites can degrade the
    same way they did before: catch it, or check `is_configured()` first.
    """
    key = resolve_api_key(api_key, api_key_env)
    if not key:
        raise LLMError(f"{api_key_env} no está configurada. Creá un archivo .env con tu API key.")

    provider = resolve_provider(key)
    resolved_model = resolve_model(provider, model)
    timeout = timeout or float(os.getenv("LLM_TIMEOUT_SECONDS", "") or DEFAULT_TIMEOUT_SECONDS)

    if provider == "openai":
        from .openai_adapter import OpenAIClient

        return OpenAIClient(key, resolved_model, timeout)

    from .google_adapter import GoogleClient

    return GoogleClient(key, resolved_model, timeout)
