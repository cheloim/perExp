"""LLM usage accounting, exported to Prometheus.

Every call records four things: requests, tokens, latency and estimated cost.
The records live in Redis rather than in process memory on purpose — Celery
tasks call the LLM from a worker process whose Prometheus registry is never
scraped, and a per-feature breakdown that silently lost the scheduled jobs
would be worse than none. Redis is already shared between both processes, so a
custom collector reading it gives one truthful series for all callers.

Nothing here raises: monitoring must never break the call it is monitoring.
"""

from __future__ import annotations

import contextlib
import logging
import os
import time
from datetime import date

logger = logging.getLogger(__name__)

from prometheus_client import Counter
from prometheus_client.core import (
    CounterMetricFamily,
    GaugeMetricFamily,
    SummaryMetricFamily,
)

# Redis key schema (all fields are "provider|model|feature|...").
_TOKENS_KEY = "llm:tokens"
_REQUESTS_KEY = "llm:requests"
_COST_KEY = "llm:cost"
_LAT_SUM_KEY = "llm:latency_sum"
_LAT_COUNT_KEY = "llm:latency_count"
_SPEND_PREFIX = "llm:spend:"  # + "YYYY-MM", one float per calendar month

_FIELD_SEP = "|"

# Failures are counted in-process, so a dead Redis is visible even when it is
# the thing that would have carried the rest of the metrics.
_RECORD_FAILURES = Counter(
    "oikonomia_llm_metrics_record_failures_total",
    "LLM usage records that could not be written to Redis",
)

#: Created per process and recreated after a fork: a socket inherited from the
#: parent would be shared by the Celery children.
_redis_client = None
_redis_pid = 0


def _redis():
    """Lazy Redis client. Returns None when Redis is unavailable or absent."""
    global _redis_client, _redis_pid
    pid = os.getpid()
    if _redis_client is not None and _redis_pid == pid:
        return _redis_client
    try:
        import redis

        url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        _redis_client = redis.Redis.from_url(url, socket_timeout=1.0, socket_connect_timeout=1.0)
        _redis_pid = pid
        return _redis_client
    except Exception:  # pragma: no cover — no Redis in unit tests
        _redis_client = None
        return None


def _note_failure() -> None:
    with contextlib.suppress(Exception):  # pragma: no cover — defensive
        _RECORD_FAILURES.inc()


def _field(*parts: str) -> str:
    return _FIELD_SEP.join(p or "-" for p in parts)


def record_llm_call(
    *,
    provider: str,
    model: str,
    feature: str,
    status: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cached_input_tokens: int = 0,
    latency_seconds: float | None = None,
    cost_usd: float = 0.0,
) -> None:
    """Record one call. `status` is ok | error | timeout | budget_blocked."""
    r = _redis()
    if r is None:
        _note_failure()
        return

    try:
        pipe = r.pipeline()
        req_f = _field(provider, model, feature, status)
        pipe.hincrby(_REQUESTS_KEY, req_f, 1)

        if input_tokens:
            pipe.hincrby(_TOKENS_KEY, _field(provider, model, feature, "input"), input_tokens)
        if output_tokens:
            pipe.hincrby(_TOKENS_KEY, _field(provider, model, feature, "output"), output_tokens)
        if cached_input_tokens:
            pipe.hincrby(
                _TOKENS_KEY, _field(provider, model, feature, "cached"), cached_input_tokens
            )

        if latency_seconds is not None:
            lat_f = _field(provider, model, feature)
            pipe.hincrbyfloat(_LAT_SUM_KEY, lat_f, latency_seconds)
            pipe.hincrby(_LAT_COUNT_KEY, lat_f, 1)

        if cost_usd:
            cost_f = _field(provider, model, feature)
            pipe.hincrbyfloat(_COST_KEY, cost_f, cost_usd)
            pipe.incrbyfloat(f"{_SPEND_PREFIX}{date.today().strftime('%Y-%m')}", cost_usd)

        pipe.execute()
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("LLM metrics record failed: %s", exc)
        _note_failure()


def _split(field: str, want: int) -> tuple[str, ...]:
    parts = field.split(_FIELD_SEP)
    return tuple(parts[:want]) if len(parts) >= want else ()


def _read_hash(key: str) -> dict[str, float]:
    r = _redis()
    if r is None:
        return {}
    try:
        raw = r.hgetall(key)
        out: dict[str, float] = {}
        for k, v in raw.items():
            fk = k.decode() if isinstance(k, bytes) else str(k)
            fv = v.decode() if isinstance(v, bytes) else str(v)
            try:
                out[fk] = float(fv)
            except ValueError:
                continue
        return out
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("LLM metrics read failed for %s: %s", key, exc)
        return {}


def _budget_state() -> tuple[float, float, float, float]:
    """(spend_this_month, budget, credit_amount, expires_ts). Zeros when unset."""
    spend = 0.0
    r = _redis()
    if r is not None:
        try:
            raw = r.get(f"{_SPEND_PREFIX}{date.today().strftime('%Y-%m')}")
            if raw is not None:
                spend = float(raw)
        except Exception:  # pragma: no cover
            pass

    def _f(name: str) -> float:
        try:
            return float(os.getenv(name, "0") or 0)
        except ValueError:
            return 0.0

    budget = _f("LLM_MONTHLY_BUDGET_USD")
    credit = _f("LLM_CREDIT_AMOUNT_USD")

    expires_ts = 0.0
    raw_exp = os.getenv("LLM_CREDIT_EXPIRES_AT", "").strip()
    if raw_exp:
        from datetime import datetime

        for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                expires_ts = datetime.strptime(raw_exp, fmt).timestamp()
                break
            except ValueError:
                continue

    return spend, budget, credit, expires_ts


class _LLMCollector:
    """Reads the Redis records and turns them into Prometheus series."""

    def collect(self):  # pragma: no cover — exercised through /metrics
        families: list = []

        requests = CounterMetricFamily(
            "oikonomia_llm_requests",
            "LLM calls by provider, model, feature and status",
            labels=["provider", "model", "feature", "status"],
        )
        for field, value in _read_hash(_REQUESTS_KEY).items():
            p = _split(field, 4)
            if p:
                requests.add_metric(list(p), value)
        families.append(requests)

        tokens = CounterMetricFamily(
            "oikonomia_llm_tokens",
            "LLM tokens by direction (input | output | cached)",
            labels=["provider", "model", "feature", "direction"],
        )
        for field, value in _read_hash(_TOKENS_KEY).items():
            p = _split(field, 4)
            if p:
                tokens.add_metric(list(p), value)
        families.append(tokens)

        cost = CounterMetricFamily(
            "oikonomia_llm_cost_usd",
            "Estimated LLM spend in USD",
            labels=["provider", "model", "feature"],
        )
        for field, value in _read_hash(_COST_KEY).items():
            p = _split(field, 3)
            if p:
                cost.add_metric(list(p), value)
        families.append(cost)

        latency = SummaryMetricFamily(
            "oikonomia_llm_latency_seconds",
            "LLM call latency in seconds",
            labels=["provider", "model", "feature"],
        )
        sums = _read_hash(_LAT_SUM_KEY)
        counts = _read_hash(_LAT_COUNT_KEY)
        for field, sum_value in sums.items():
            p = _split(field, 3)
            if p:
                latency.add_metric(list(p), int(counts.get(field, 0)), sum_value)
        families.append(latency)

        spend, budget, credit, expires_ts = _budget_state()

        spend_gauge = GaugeMetricFamily(
            "oikonomia_llm_spend_usd_month_to_date",
            "Estimated LLM spend for the current calendar month in USD",
        )
        spend_gauge.add_metric([], spend)
        families.append(spend_gauge)

        budget_ratio = GaugeMetricFamily(
            "oikonomia_llm_budget_used_ratio",
            "Fraction of the monthly LLM budget consumed (0 when no budget is set)",
        )
        budget_ratio.add_metric([], (spend / budget) if budget > 0 else 0.0)
        families.append(budget_ratio)

        budget_gauge = GaugeMetricFamily(
            "oikonomia_llm_budget_usd",
            "Configured monthly LLM budget in USD (0 when not set)",
        )
        budget_gauge.add_metric([], budget)
        families.append(budget_gauge)

        credit_amount = GaugeMetricFamily(
            "oikonomia_llm_credit_amount_usd",
            "Prepaid credit purchased in USD (0 when not configured)",
        )
        credit_amount.add_metric([], credit)
        families.append(credit_amount)

        credit_gauge = GaugeMetricFamily(
            "oikonomia_llm_credit_balance_usd",
            "Remaining prepaid credit, from the configured purchase minus recorded spend",
        )
        credit_gauge.add_metric([], max(credit - spend, 0.0) if credit > 0 else 0.0)
        families.append(credit_gauge)

        expiry = GaugeMetricFamily(
            "oikonomia_llm_credit_expires_timestamp_seconds",
            "Unix time the prepaid credit expires at (0 when not configured)",
        )
        expiry.add_metric([], expires_ts)
        families.append(expiry)

        return families


_registered = False


def register_llm_metrics() -> None:
    """Attach the collector to the default registry. Idempotent."""
    global _registered
    if _registered:
        return
    try:
        from prometheus_client import REGISTRY

        REGISTRY.register(_LLMCollector())
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("LLM collector registration failed: %s", exc)
    _registered = True


def credit_days_remaining() -> float | None:
    """Days until the prepaid credit expires, for the admin panel."""
    _, _, _, expires_ts = _budget_state()
    if not expires_ts:
        return None
    return round((expires_ts - time.time()) / 86400, 1)
