"""The LLM facade: JSON unwrapping, pricing and usage accounting.

These are the pieces that must not drift when a provider is swapped — the
adapters themselves are thin, but a wrong price or a lost token count would
quietly misreport spend on the dashboard. The monthly budget guard lives here
too: what it blocks, and — more importantly — what it must never block.
"""

import asyncio
import os
import unittest
from datetime import date
from unittest.mock import patch

os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars-long-for-testing"

from app.services.llm import metrics as llm_metrics  # noqa: E402
from app.services.llm.client import LLMBudgetExceededError, LLMClient, LLMError  # noqa: E402
from app.services.llm.pricing import estimate_cost_usd, price_for  # noqa: E402
from app.services.llm.types import LLMResult, parse_json_block  # noqa: E402


class TestParseJsonBlock(unittest.TestCase):
    def test_plain_json(self):
        self.assertEqual(parse_json_block('{"category_id": 3}'), {"category_id": 3})

    def test_markdown_fence_is_unwrapped(self):
        raw = '```json\n[{"amount": 500.0}]\n```'
        self.assertEqual(parse_json_block(raw), [{"amount": 500.0}])

    def test_fence_without_language_tag(self):
        self.assertEqual(parse_json_block('```\n{"a": 1}\n```'), {"a": 1})

    def test_chatter_around_the_payload(self):
        raw = 'Listo, acá está:\n{"a": 1}\nEspero que sirva.'
        self.assertEqual(parse_json_block(raw), {"a": 1})

    def test_empty_reply_raises(self):
        with self.assertRaises(ValueError):
            parse_json_block("   ")

    def test_non_json_raises(self):
        with self.assertRaises(ValueError):
            parse_json_block("not valid json")


class TestPricing(unittest.TestCase):
    def test_known_model_uses_its_price(self):
        self.assertEqual(price_for("gpt-6-luna"), {"input": 0.10, "output": 0.50})

    def test_model_lookup_is_case_insensitive(self):
        self.assertEqual(price_for("GPT-6-Luna"), price_for("gpt-6-luna"))

    def test_unknown_model_overestimates_rather_than_underestimates(self):
        self.assertGreater(price_for("algo-desconocido")["input"], price_for("gpt-6-luna")["input"])

    def test_cost_math(self):
        # 1M input + 1M output at 0.10/0.50
        self.assertAlmostEqual(estimate_cost_usd("gpt-6-luna", 1_000_000, 1_000_000), 0.60)

    def test_zero_usage_is_free(self):
        self.assertEqual(estimate_cost_usd("gpt-6-luna", 0, 0), 0.0)


class _FakePipeline:
    def __init__(self, store):
        self.store = store
        self.ops = []

    def hincrby(self, key, field, value):
        self.ops.append((key, field, float(value), "int"))
        return self

    def hincrbyfloat(self, key, field, value):
        self.ops.append((key, field, float(value), "float"))
        return self

    def incrbyfloat(self, key, value):
        self.ops.append((key, None, float(value), "float"))
        return self

    def execute(self):
        for key, field, value, _kind in self.ops:
            if field is None:
                self.store[key] = self.store.get(key, 0.0) + value
            else:
                bucket = self.store.setdefault(key, {})
                bucket[field] = bucket.get(field, 0.0) + value


class _FakeRedis:
    def __init__(self):
        self.store = {}

    def pipeline(self):
        return _FakePipeline(self.store)

    def hgetall(self, key):
        return {k.encode(): str(v).encode() for k, v in self.store.get(key, {}).items()}

    def get(self, key):
        return str(self.store[key]).encode() if key in self.store else None


class TestUsageAccounting(unittest.TestCase):
    def setUp(self):
        self.fake = _FakeRedis()
        self._client = llm_metrics._redis_client
        self._pid = llm_metrics._redis_pid
        llm_metrics._redis_client = self.fake
        llm_metrics._redis_pid = os.getpid()

    def tearDown(self):
        llm_metrics._redis_client = self._client
        llm_metrics._redis_pid = self._pid

    def _record(self, **kwargs):
        kwargs.setdefault("provider", "openai")
        kwargs.setdefault("model", "gpt-6-luna")
        kwargs.setdefault("feature", "analysis_chat")
        kwargs.setdefault("status", "ok")
        llm_metrics.record_llm_call(**kwargs)

    def test_records_tokens_by_direction(self):
        self._record(input_tokens=1000, output_tokens=250, cached_input_tokens=100)

        tokens = self.fake.store[llm_metrics._TOKENS_KEY]
        self.assertEqual(tokens["openai|gpt-6-luna|analysis_chat|input"], 1000)
        self.assertEqual(tokens["openai|gpt-6-luna|analysis_chat|output"], 250)
        self.assertEqual(tokens["openai|gpt-6-luna|analysis_chat|cached"], 100)

    def test_records_requests_with_status(self):
        self._record(status="error")

        requests = self.fake.store[llm_metrics._REQUESTS_KEY]
        self.assertEqual(requests["openai|gpt-6-luna|analysis_chat|error"], 1)

    def test_records_cost_and_monthly_bucket(self):
        self._record(input_tokens=1_000_000, output_tokens=1_000_000, cost_usd=0.60)

        self.assertEqual(
            self.fake.store[llm_metrics._COST_KEY]["openai|gpt-6-luna|analysis_chat"], 0.60
        )
        month_key = (
            f"{llm_metrics._SPEND_PREFIX}{__import__('datetime').date.today().strftime('%Y-%m')}"
        )
        self.assertEqual(self.fake.store[month_key], 0.60)

    def test_never_raises_without_redis(self):
        llm_metrics._redis_client = None
        llm_metrics._redis_pid = 0

        with patch.object(llm_metrics, "_redis", return_value=None):
            self._record(input_tokens=10)  # must not raise

    def test_collector_turns_records_into_series(self):
        self._record(input_tokens=1000, output_tokens=250, cost_usd=0.5, latency_seconds=1.25)

        # Counter families are exposed with a `_total` suffix: that is the name
        # Prometheus and the Grafana panels query, so assert on it.
        samples = [s for f in llm_metrics._LLMCollector().collect() for s in f.samples]
        names = {s.name for s in samples}

        self.assertIn("oikonomia_llm_requests_total", names)
        self.assertIn("oikonomia_llm_tokens_total", names)
        self.assertIn("oikonomia_llm_cost_usd_total", names)
        self.assertIn("oikonomia_llm_spend_usd_month_to_date", names)

        token_samples = [s for s in samples if s.name == "oikonomia_llm_tokens_total"]
        self.assertEqual({s.labels["direction"] for s in token_samples}, {"input", "output"})
        self.assertEqual(sum(s.value for s in token_samples), 1250)

    def test_budget_ratio_is_zero_without_a_budget(self):
        with patch.dict(os.environ, {"LLM_MONTHLY_BUDGET_USD": ""}, clear=False):
            families = {f.name: f for f in llm_metrics._LLMCollector().collect()}
        ratio = families["oikonomia_llm_budget_used_ratio"].samples[0]
        self.assertEqual(ratio.value, 0.0)

    def test_budget_ratio_divides_spend_by_budget(self):
        self._record(input_tokens=1_000_000, output_tokens=1_000_000, cost_usd=0.60)
        env = {"LLM_MONTHLY_BUDGET_USD": "10"}
        with patch.dict(os.environ, env, clear=False):
            families = {f.name: f for f in llm_metrics._LLMCollector().collect()}
        ratio = families["oikonomia_llm_budget_used_ratio"].samples[0]
        self.assertAlmostEqual(ratio.value, 0.06)

    def test_credit_expiry_is_exposed_as_a_timestamp(self):
        with patch.dict(os.environ, {"LLM_CREDIT_EXPIRES_AT": "2027-10-20"}, clear=False):
            families = {f.name: f for f in llm_metrics._LLMCollector().collect()}
            expires = families["oikonomia_llm_credit_expires_timestamp_seconds"].samples[0].value
            days = llm_metrics.credit_days_remaining()

        self.assertGreater(expires, 0)
        self.assertIsNotNone(days)
        self.assertGreater(days, 300)
        self.assertLess(days, 400)

    def test_budget_state_reads_spend_config_and_expiry(self):
        self._record(input_tokens=1_000_000, output_tokens=1_000_000, cost_usd=0.60)
        env = {
            "LLM_MONTHLY_BUDGET_USD": "10",
            "LLM_CREDIT_AMOUNT_USD": "10",
            "LLM_CREDIT_EXPIRES_AT": "2027-10-20",
        }
        with patch.dict(os.environ, env, clear=False):
            state = llm_metrics.get_budget_state()

        self.assertAlmostEqual(state.spend_usd, 0.60)
        self.assertEqual(state.budget_usd, 10.0)
        self.assertEqual(state.credit_usd, 10.0)
        self.assertGreater(state.credit_expires_at, 0)

    def test_no_expiry_series_when_not_configured(self):
        """An unset expiry is not "expired in 1970": the series stays silent."""
        env = {"LLM_CREDIT_EXPIRES_AT": "", "LLM_CREDIT_AMOUNT_USD": ""}
        with patch.dict(os.environ, env, clear=False):
            samples = [s for f in llm_metrics._LLMCollector().collect() for s in f.samples]

        self.assertNotIn(
            "oikonomia_llm_credit_expires_timestamp_seconds", {s.name for s in samples}
        )

    def test_no_credit_balance_series_without_credit(self):
        env = {"LLM_CREDIT_EXPIRES_AT": "", "LLM_CREDIT_AMOUNT_USD": ""}
        with patch.dict(os.environ, env, clear=False):
            samples = [s for f in llm_metrics._LLMCollector().collect() for s in f.samples]

        self.assertNotIn("oikonomia_llm_credit_balance_usd", {s.name for s in samples})

    def test_credit_balance_series_when_credit_is_configured(self):
        self._record(input_tokens=1_000_000, output_tokens=1_000_000, cost_usd=0.60)
        env = {"LLM_CREDIT_AMOUNT_USD": "10", "LLM_CREDIT_EXPIRES_AT": ""}
        with patch.dict(os.environ, env, clear=False):
            families = {f.name: f for f in llm_metrics._LLMCollector().collect()}

        balance = families["oikonomia_llm_credit_balance_usd"].samples[0]
        self.assertAlmostEqual(balance.value, 9.40)


class _StubClient(LLMClient):
    """A provider that answers from memory: the guard is what is under test."""

    provider = "openai"

    def _complete(self, messages, temperature, json_mode) -> LLMResult:
        return LLMResult(text="{}", model="gpt-6-luna", input_tokens=1, output_tokens=1)

    async def _acomplete(self, messages, temperature, json_mode) -> LLMResult:
        return LLMResult(text="{}", model="gpt-6-luna", input_tokens=1, output_tokens=1)

    def _stream(self, messages, temperature):
        yield {"text": "hola", "result": LLMResult(text="hola", model="gpt-6-luna")}

    async def _astream(self, messages, temperature):
        yield {"text": "hola", "result": LLMResult(text="hola", model="gpt-6-luna")}


class _BrokenRedis:
    """Every read fails, the way a dead Redis would."""

    def get(self, key):
        raise ConnectionError("redis caído")


class TestBudgetGuard(unittest.TestCase):
    """The monthly budget is a real block, and only when it is configured."""

    def setUp(self):
        self.fake = _FakeRedis()
        self._client = llm_metrics._redis_client
        self._pid = llm_metrics._redis_pid
        llm_metrics._redis_client = self.fake
        llm_metrics._redis_pid = os.getpid()
        self.llm = _StubClient("test-key", "gpt-6-luna")

    def tearDown(self):
        llm_metrics._redis_client = self._client
        llm_metrics._redis_pid = self._pid

    def _set_spend(self, amount: float) -> None:
        self.fake.store[f"{llm_metrics._SPEND_PREFIX}{date.today().strftime('%Y-%m')}"] = amount

    def _month_spend(self) -> float:
        return self.fake.store[f"{llm_metrics._SPEND_PREFIX}{date.today().strftime('%Y-%m')}"]

    def _blocked_records(self) -> int:
        requests = self.fake.store.get(llm_metrics._REQUESTS_KEY, {})
        return int(requests.get("openai|gpt-6-luna|analysis_chat|budget_blocked", 0))

    def test_budget_error_is_an_llm_error(self):
        self.assertTrue(issubclass(LLMBudgetExceededError, LLMError))

    def test_no_budget_never_blocks(self):
        """Unset or 0 budget keeps today's behaviour: unlimited."""
        self._set_spend(1000.0)
        for budget in ("", "0"):
            with self.subTest(budget=budget):
                env = {"LLM_MONTHLY_BUDGET_USD": budget}
                with patch.dict(os.environ, env, clear=False):
                    result = self.llm.complete(
                        [{"role": "user", "text": "hola"}], feature="analysis_chat"
                    )
                self.assertEqual(result.text, "{}")
                self.assertEqual(self._blocked_records(), 0)

    def test_under_budget_goes_through(self):
        self._set_spend(9.99)
        with patch.dict(os.environ, {"LLM_MONTHLY_BUDGET_USD": "10"}, clear=False):
            result = self.llm.complete([{"role": "user", "text": "hola"}], feature="analysis_chat")

        self.assertEqual(result.text, "{}")
        self.assertEqual(self._blocked_records(), 0)

    def test_at_budget_blocks_and_records(self):
        self._set_spend(10.0)
        with (
            patch.dict(os.environ, {"LLM_MONTHLY_BUDGET_USD": "10"}, clear=False),
            self.assertRaises(LLMBudgetExceededError),
        ):
            self.llm.complete([{"role": "user", "text": "hola"}], feature="analysis_chat")

        self.assertEqual(self._blocked_records(), 1)

    def test_over_budget_blocks(self):
        self._set_spend(12.5)
        with (
            patch.dict(os.environ, {"LLM_MONTHLY_BUDGET_USD": "10"}, clear=False),
            self.assertRaises(LLMBudgetExceededError),
        ):
            self.llm.complete([{"role": "user", "text": "hola"}], feature="analysis_chat")

    def test_blocked_call_does_not_spend(self):
        self._set_spend(10.0)
        with (
            patch.dict(os.environ, {"LLM_MONTHLY_BUDGET_USD": "10"}, clear=False),
            self.assertRaises(LLMBudgetExceededError),
        ):
            self.llm.complete([{"role": "user", "text": "hola"}], feature="analysis_chat")

        self.assertEqual(self._month_spend(), 10.0)

    def test_json_helpers_block_through_the_same_guard(self):
        self._set_spend(10.0)
        with (
            patch.dict(os.environ, {"LLM_MONTHLY_BUDGET_USD": "10"}, clear=False),
            self.assertRaises(LLMBudgetExceededError),
        ):
            self.llm.complete_json([{"role": "user", "text": "hola"}], feature="analysis_chat")

        # One check, one record: the helper delegates instead of re-checking.
        self.assertEqual(self._blocked_records(), 1)

    def test_async_and_streaming_calls_are_guarded_at_call_time(self):
        self._set_spend(10.0)
        env = {"LLM_MONTHLY_BUDGET_USD": "10"}
        with patch.dict(os.environ, env, clear=False), self.assertRaises(LLMBudgetExceededError):
            asyncio.run(
                self.llm.acomplete([{"role": "user", "text": "hola"}], feature="analysis_chat")
            )
        with patch.dict(os.environ, env, clear=False), self.assertRaises(LLMBudgetExceededError):
            self.llm.stream([{"role": "user", "text": "hola"}], feature="analysis_chat")
        with patch.dict(os.environ, env, clear=False), self.assertRaises(LLMBudgetExceededError):
            self.llm.astream([{"role": "user", "text": "hola"}], feature="analysis_chat")

    def test_streaming_still_yields_when_under_budget(self):
        self._set_spend(0.5)
        env = {"LLM_MONTHLY_BUDGET_USD": "10"}
        with patch.dict(os.environ, env, clear=False):
            chunks = list(
                self.llm.stream([{"role": "user", "text": "hola"}], feature="analysis_chat")
            )

        async def consume():
            return [
                c
                async for c in self.llm.astream(
                    [{"role": "user", "text": "hola"}], feature="analysis_chat"
                )
            ]

        with patch.dict(os.environ, env, clear=False):
            async_chunks = asyncio.run(consume())

        self.assertEqual(chunks, ["hola"])
        self.assertEqual(async_chunks, ["hola"])

    def test_unreadable_spend_fails_open_and_logs(self):
        """A dead Redis must not stop the app: the call goes through."""
        llm_metrics._redis_client = _BrokenRedis()
        env = {"LLM_MONTHLY_BUDGET_USD": "10"}
        with (
            patch.dict(os.environ, env, clear=False),
            self.assertLogs("app.services.llm.metrics", level="WARNING") as logs,
        ):
            result = self.llm.complete([{"role": "user", "text": "hola"}], feature="analysis_chat")

        self.assertEqual(result.text, "{}")
        self.assertEqual(self._blocked_records(), 0)
        self.assertTrue(any("gasto mensual" in line for line in logs.output))

    def test_unexpected_state_failure_fails_open_and_logs(self):
        self._set_spend(1000.0)
        env = {"LLM_MONTHLY_BUDGET_USD": "10"}
        with (
            patch.dict(os.environ, env, clear=False),
            patch("app.services.llm.client.get_budget_state", side_effect=RuntimeError("raro")),
            self.assertLogs("app.services.llm.client", level="WARNING") as logs,
        ):
            result = self.llm.complete([{"role": "user", "text": "hola"}], feature="analysis_chat")

        self.assertEqual(result.text, "{}")
        self.assertEqual(self._blocked_records(), 0)
        self.assertTrue(any("llamada sigue" in line for line in logs.output))


if __name__ == "__main__":
    unittest.main()
