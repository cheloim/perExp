"""USD prices per 1M tokens, used to turn `usage` into money.

Only models the app may actually call are listed. Unknown models fall back to
`DEFAULT_PRICE`, which overestimates on purpose: a budget gauge that runs high
is safer than one that runs low.

Input is billed at the full rate even when the provider bills a discounted
cached-input rate. Our prompts are mostly under the caching threshold, so the
overestimate stays small and it keeps the arithmetic honest.
"""

from __future__ import annotations

# USD per 1_000_000 tokens.
PRICES: dict[str, dict[str, float]] = {
    # OpenAI
    "gpt-6-luna": {"input": 0.10, "output": 0.50},
    "gpt-6.1-sol": {"input": 2.00, "output": 10.00},
    "gpt-6-astra": {"input": 10.00, "output": 50.00},
    # Google Gemini (kept so a provider switch stays possible)
    "gemini-3.8-flash": {"input": 0.75, "output": 3.75},
    "gemini-3.5-flash-lite": {"input": 0.30, "output": 2.50},
    "gemini-3.1-flash-lite": {"input": 0.25, "output": 1.50},
    # Anthropic (comparison/rollback option)
    "claude-haiku-5.5": {"input": 0.10, "output": 0.50},
}

#: Conservative stand-in for an unknown model.
DEFAULT_PRICE = {"input": 10.00, "output": 50.00}


def price_for(model: str) -> dict[str, float]:
    return PRICES.get((model or "").strip().lower(), DEFAULT_PRICE)


def estimate_cost_usd(model: str, input_tokens: int, output: int) -> float:
    """Estimated USD for one call. Returns 0.0 for zero usage."""
    p = price_for(model)
    return (input_tokens * p["input"] + output * p["output"]) / 1_000_000
