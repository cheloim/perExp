"""Provider-neutral LLM access.

The app talks to this package, never to a vendor SDK. Adding or changing a
provider touches `client.py` and one adapter; callers keep working.

    from app.services.llm import LLMMessage, get_client

    client = get_client()                      # provider from env/key shape
    result = client.complete(
        [LLMMessage(role="user", text="...")],
        feature="telegram_expense",
    )

`feature` is the metric label: which part of the app made the call.
"""

from .metrics import credit_days_remaining, record_llm_call, register_llm_metrics
from .pricing import estimate_cost_usd
from .types import LLMMessage, LLMResult, parse_json_block

__all__ = [
    "LLMError",
    "LLMMessage",
    "LLMResult",
    "credit_days_remaining",
    "estimate_cost_usd",
    "get_client",
    "is_configured",
    "parse_json_block",
    "record_llm_call",
    "register_llm_metrics",
    "resolve_api_key",
    "resolve_model",
    "resolve_provider",
]


def get_client(*args, **kwargs):
    """Build a client for the configured provider (see `client.get_client`)."""
    from .client import get_client as _get_client

    return _get_client(*args, **kwargs)


def is_configured(*args, **kwargs) -> bool:
    from .client import is_configured as _is_configured

    return _is_configured(*args, **kwargs)


def resolve_api_key(*args, **kwargs) -> str:
    from .client import resolve_api_key as _resolve_api_key

    return _resolve_api_key(*args, **kwargs)


def resolve_provider(*args, **kwargs) -> str:
    from .client import resolve_provider as _resolve_provider

    return _resolve_provider(*args, **kwargs)


def resolve_model(*args, **kwargs) -> str:
    from .client import resolve_model as _resolve_model

    return _resolve_model(*args, **kwargs)


def __getattr__(name: str):
    if name == "LLMError":
        from .client import LLMError

        return LLMError
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
