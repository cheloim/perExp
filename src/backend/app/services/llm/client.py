"""The LLM facade: one call shape for every provider.

Callers build `LLMMessage` lists and call `complete` / `complete_json` /
`stream`. Everything vendor-specific — SDK, model id, message vocabulary, JSON
mode, streaming shape, token accounting — lives behind this module, so a
provider switch is a change to `LLM_PROVIDER` and `LLM_MODEL_NAME`, not a
rewrite.

Provider is resolved from `LLM_PROVIDER`, or inferred from the key shape when
that is unset (`sk-...` is OpenAI, anything else is Google). That is what makes
swapping the value of `LLM_API_KEY` enough to move providers.

Every call is checked against `LLM_MONTHLY_BUDGET_USD` before it goes out: when
the month's spend has already reached the budget, the call is recorded as
`budget_blocked` and raises `LLMBudgetExceededError`. No budget configured means
no limit.
"""

from __future__ import annotations

import logging
import math
import os
import time
from collections.abc import AsyncIterator, Iterator
from typing import Any

from .metrics import get_budget_state, record_llm_call
from .pricing import estimate_audio_cost_usd, estimate_cost_usd
from .types import LLMMessage, LLMResult, parse_json_block

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 30.0

#: Language anchor injected as the system turn when a call site passes none.
#: A short prompt without context does not pin a language and the model drifts
#: (measured: "Deci hola." answered in Romanian ~30% of the time), so no call
#: may ever leave without one.
DEFAULT_SYSTEM = "Respondé siempre en español rioplatense."

#: Env var names a call site may want instead of the default `LLM_API_KEY`.
KEY_ENV_VARS = ("LLM_API_KEY", "MESSAGES_BOT_LLM_API_KEY", "INVESTMENTS_LLM_API_KEY")


class LLMError(RuntimeError):
    """Raised when no LLM is configured for a call site."""


class LLMBudgetExceededError(LLMError):
    """Raised when the monthly LLM budget is spent and the call is blocked."""


class LLMUnsupportedCapabilityError(LLMError):
    """The configured provider cannot perform a requested operation."""

    def __init__(self, capability: str, provider: str):
        self.capability = capability
        self.provider = provider
        super().__init__(f"El proveedor {provider} no admite la capacidad {capability}.")


SUPPORTED_CAPABILITIES = {
    ("openai", "text"),
    ("openai", "vision"),
    ("openai", "audio"),
    ("google", "text"),
}


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


def resolve_model(provider: str, model: str | None = None, capability: str = "text") -> str:
    if model:
        return model
    if capability == "vision":
        return (
            os.getenv("LLM_VISION_MODEL", "").strip()
            or os.getenv("LLM_MODEL_NAME", "").strip()
            or ("gpt-6-luna" if provider == "openai" else "gemini-flash-latest")
        )
    if capability == "audio":
        return os.getenv("LLM_AUDIO_MODEL", "").strip() or "whisper-1"
    env_model = os.getenv("LLM_MODEL_NAME", "").strip()
    if env_model:
        return env_model
    return "gpt-6-luna" if provider == "openai" else "gemini-flash-latest"


def _as_messages(messages: Any, system: str | None = None) -> list[LLMMessage]:
    """Accept a list of `LLMMessage`, or `{"role": ..., "text": ...}` dicts.

    When `system` is missing or empty, `DEFAULT_SYSTEM` goes in as the first
    turn so no call leaves without a language anchor. A caller-supplied
    `system` is kept as-is — it already anchors the reply.
    """
    out: list[LLMMessage] = []
    out.append(LLMMessage(role="system", text=system or DEFAULT_SYSTEM))
    for m in messages or []:
        if isinstance(m, LLMMessage):
            if m.text or m.media:
                out.append(m)
            continue
        role = m.get("role", "user")
        if role not in ("system", "user", "assistant"):
            role = "user"
        text = str(m.get("text") or m.get("content") or "")
        media = tuple(m.get("media") or ())
        if text or media:
            out.append(LLMMessage(role=role, text=text, media=media))
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

    def _transcribe(
        self, audio, *, filename, mime_type, language, duration_hint
    ):  # pragma: no cover
        raise LLMUnsupportedCapabilityError("audio", self.provider)

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
        self._check_budget(feature)
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
        self._check_budget(feature)
        turns = _as_messages(messages, system)
        start = time.perf_counter()
        try:
            result = await self._acomplete(turns, temperature, json_mode)
        except Exception:
            self._record(feature, start, "error")
            raise
        self._record(feature, start, "ok", result)
        return result

    def transcribe(
        self,
        audio: bytes,
        *,
        filename: str,
        mime_type: str,
        feature: str,
        language: str = "es",
        duration_hint: float | None = None,
    ) -> LLMResult:
        self._check_budget(feature)
        start = time.perf_counter()
        try:
            result = self._transcribe(
                audio,
                filename=filename,
                mime_type=mime_type,
                language=language,
                duration_hint=duration_hint,
            )
        except Exception:
            self._record(feature, start, "error")
            raise
        duration = result.duration_seconds if result.duration_seconds is not None else duration_hint
        if duration is not None and (not math.isfinite(duration) or duration < 0):
            duration = (
                duration_hint
                if duration_hint is not None and math.isfinite(duration_hint) and duration_hint >= 0
                else None
            )
        if duration is None or (duration <= 0 and audio):
            duration = len(audio) / 2000 if audio else duration
        if duration is not None and (
            result.duration_seconds is None
            or not math.isfinite(result.duration_seconds)
            or result.duration_seconds < 0
            or (result.duration_seconds == 0 and audio)
        ):
            result.duration_seconds = duration
        cost = estimate_audio_cost_usd(self.model, duration or 0)
        self._record(feature, start, "ok", result, cost_usd=cost)
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
        # Deliberately not a generator: the budget check must fire when the call
        # is made, not when the caller starts iterating the reply.
        self._check_budget(feature)
        return self._stream_recorded(_as_messages(messages, system), feature, temperature)

    def _stream_recorded(
        self, turns: list[LLMMessage], feature: str, temperature: float | None
    ) -> Iterator[str]:
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

    def astream(
        self,
        messages: Any,
        *,
        feature: str,
        system: str | None = None,
        temperature: float | None = None,
    ) -> AsyncIterator[str]:
        # Same as `stream`: the check runs before the first `__anext__`, and the
        # call shape `async for chunk in client.astream(...)` is unchanged.
        self._check_budget(feature)
        return self._astream_recorded(_as_messages(messages, system), feature, temperature)

    async def _astream_recorded(
        self, turns: list[LLMMessage], feature: str, temperature: float | None
    ) -> AsyncIterator[str]:
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

    def _check_budget(self, feature: str) -> None:
        """Block the call when this month's spend already reached the budget.

        Only an explicit `LLM_MONTHLY_BUDGET_USD` above 0 sets a limit; unset or
        0 keeps the unlimited behaviour. Anything that stops us from reading the
        spend — Redis down, a malformed value — fails open and lets the call
        through: the app must not break because the accounting is unreachable.
        """
        try:
            state = get_budget_state()
        except Exception as exc:  # pragma: no cover — get_budget_state never raises
            logger.warning("No se pudo leer el gasto mensual de LLM; la llamada sigue: %s", exc)
            return
        if state.budget_usd <= 0 or state.spend_usd < state.budget_usd:
            return
        record_llm_call(
            provider=self.provider,
            model=self.model,
            feature=feature,
            status="budget_blocked",
        )
        raise LLMBudgetExceededError(
            f"Presupuesto mensual de LLM agotado: este mes ya gastaste USD {state.spend_usd:.2f} "
            f"de un presupuesto de USD {state.budget_usd:.2f}."
        )

    def _record(
        self,
        feature: str,
        start: float,
        status: str,
        result: LLMResult | None = None,
        *,
        cost_usd: float | None = None,
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
            cost_usd=(
                cost_usd
                if cost_usd is not None
                else estimate_cost_usd(model, input_tokens, output_tokens)
            ),
        )


def get_client(
    *,
    capability: str = "text",
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
    if (provider, capability) not in SUPPORTED_CAPABILITIES:
        raise LLMUnsupportedCapabilityError(capability, provider)
    resolved_model = resolve_model(provider, model, capability)
    timeout = timeout or float(os.getenv("LLM_TIMEOUT_SECONDS", "") or DEFAULT_TIMEOUT_SECONDS)

    if provider == "openai":
        from .openai_adapter import OpenAIClient

        return OpenAIClient(key, resolved_model, timeout)

    from .google_adapter import GoogleClient

    return GoogleClient(key, resolved_model, timeout)
