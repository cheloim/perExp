"""The LLM facade: JSON unwrapping, pricing and usage accounting.

These are the pieces that must not drift when a provider is swapped — the
adapters themselves are thin, but a wrong price or a lost token count would
quietly misreport spend on the dashboard.
"""

import os
import unittest
from unittest.mock import patch

os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars-long-for-testing"

from app.services.llm import metrics as llm_metrics  # noqa: E402
from app.services.llm.pricing import estimate_cost_usd, price_for  # noqa: E402
from app.services.llm.types import parse_json_block  # noqa: E402


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

        self.assertEqual(self.fake.store[llm_metrics._COST_KEY]["openai|gpt-6-luna|analysis_chat"], 0.60)
        month_key = f"{llm_metrics._SPEND_PREFIX}{__import__('datetime').date.today().strftime('%Y-%m')}"
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


if __name__ == "__main__":
    unittest.main()
