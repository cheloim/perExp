"""The analysis window: the current month plus the two before it.

The assistant used to analyse the current month only, which made any question
about a trend ("¿cómo vengo?", "compará con el mes pasado") unanswerable. The
request now carries a window length (`months`) and the endpoint selects the
current month plus `months - 1` previous ones — unless an exact `month` arrives,
which names a precise period and wins.
"""

import asyncio
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.database import get_db
from app.models import Expense
from app.routers import analysis
from app.schemas import AnalysisRequest
from app.services.auth import get_current_user
from app.services.encryption import compute_hmac

# ── Helpers ──────────────────────────────────────────────────────────


def _first_day_months_ago(n: int) -> date:
    """First day of the month `n` months back — written independently of the
    endpoint's own arithmetic, so an off-by-one there shows up here."""
    d = date.today().replace(day=1)
    for _ in range(n):
        d = (d - timedelta(days=1)).replace(day=1)
    return d


def _add_expense(db, user, on: date, description: str, amount: float) -> Expense:
    exp = Expense(
        date=on,
        description=description,
        description_hmac=compute_hmac(description),
        amount=amount,
        user_id=user.id,
        is_income=False,
    )
    db.add(exp)
    db.flush()
    return exp


class _FakeModels:
    """The model API surface the router uses: one frame, and the prompt kept."""

    def __init__(self, prompts: list):
        self._prompts = prompts

    async def generate_content_stream(self, **kwargs):
        self._prompts.append(kwargs["contents"])

        async def _frames():
            yield SimpleNamespace(text="respuesta del modelo")

        return _frames()


class _FakeClient:
    def __init__(self, prompts: list):
        self.aio = SimpleNamespace(models=_FakeModels(prompts))


class _HistorySink:
    """Stands in for SessionLocal: the history row is captured, not committed."""

    def __init__(self):
        self.saved = []

    def add(self, obj):
        self.saved.append(obj)

    def commit(self):
        pass

    def close(self):
        pass


@pytest.fixture
def fake_llm(monkeypatch):
    prompts: list = []
    sink = _HistorySink()
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setattr(analysis.genai, "Client", lambda api_key=None: _FakeClient(prompts))
    monkeypatch.setattr(analysis, "SessionLocal", lambda: sink)
    return SimpleNamespace(prompts=prompts, history=sink)


def _prompt_text(prompts: list) -> str:
    """The data block the endpoint hands to the model as its final turn."""
    return prompts[-1][-1].parts[0].text


def _stream(req: AnalysisRequest, db, user) -> str:
    """Run the endpoint and collect the SSE frames it produces."""

    async def _go():
        response = await analysis.stream_analysis(req, db, user)
        frames = []
        async for frame in response.body_iterator:
            frames.append(frame)
        return "".join(frames)

    return asyncio.run(_go())


# ── Tests ────────────────────────────────────────────────────────────


def test_the_window_covers_the_current_month_and_the_two_before(db, test_user, fake_llm):
    for months_back, tag in enumerate(("actual", "mes-1", "mes-2")):
        _add_expense(db, test_user, _first_day_months_ago(months_back), f"gasto {tag}", 1000.0)
    # Four months back: outside the window, and the request never sees it.
    _add_expense(db, test_user, _first_day_months_ago(3), "gasto viejo", 9999.0)

    text = _stream(AnalysisRequest(question="¿cómo vengo?", months=3), db, test_user)

    prompt = _prompt_text(fake_llm.prompts)
    assert f"Período: {_first_day_months_ago(2)} → {date.today()}" in prompt
    assert "- Transacciones: 3" in prompt
    for tag in ("actual", "mes-1", "mes-2"):
        assert f"gasto {tag}" in prompt
    assert "gasto viejo" not in prompt
    assert "respuesta del modelo" in text
    # A window is not a month: the history records no month for it.
    assert fake_llm.history.saved[0].month is None


def test_an_exact_month_wins_over_the_window(db, test_user, fake_llm):
    _add_expense(db, test_user, date(2026, 3, 10), "gasto de marzo", 500.0)
    _add_expense(db, test_user, date(2026, 2, 10), "gasto de febrero", 700.0)
    _add_expense(db, test_user, date(2026, 4, 10), "gasto de abril", 900.0)

    _stream(AnalysisRequest(month="2026-03", months=3), db, test_user)

    prompt = _prompt_text(fake_llm.prompts)
    assert "Período: 2026-03" in prompt
    assert "- Transacciones: 1" in prompt
    assert "gasto de marzo" in prompt
    assert "gasto de febrero" not in prompt
    assert "gasto de abril" not in prompt
    assert fake_llm.history.saved[0].month == "2026-03"


def test_a_window_is_recorded_without_a_month(db, test_user, fake_llm):
    _add_expense(db, test_user, date.today(), "gasto de hoy", 100.0)

    _stream(AnalysisRequest(months=1), db, test_user)

    # `month` stores a month; a window has none to store, so it stays null
    # rather than borrowing today's.
    assert fake_llm.history.saved[0].month is None


def test_one_month_is_just_the_current_month(db, test_user, fake_llm):
    _add_expense(db, test_user, _first_day_months_ago(0), "gasto actual", 100.0)
    _add_expense(db, test_user, _first_day_months_ago(1), "gasto del mes pasado", 200.0)

    _stream(AnalysisRequest(months=1), db, test_user)

    prompt = _prompt_text(fake_llm.prompts)
    assert "- Transacciones: 1" in prompt
    assert "gasto actual" in prompt
    assert "gasto del mes pasado" not in prompt


def test_no_expenses_in_the_window_streams_the_no_data_message(db, test_user, fake_llm):
    # Expenses exist, but only outside the window.
    _add_expense(db, test_user, _first_day_months_ago(3), "gasto viejo", 9999.0)

    text = _stream(AnalysisRequest(question="¿cómo vengo?", months=3), db, test_user)

    assert "No hay gastos registrados" in text
    assert "data: [DONE]" in text
    # Nothing to analyse is not a question for the model.
    assert fake_llm.prompts == []


@pytest.mark.parametrize("bad", [0, 25])
def test_months_outside_1_to_24_is_a_422(db, test_user, bad):
    app = FastAPI()
    app.include_router(analysis.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: test_user

    response = TestClient(app).post("/analysis/stream", json={"question": "hola", "months": bad})

    assert response.status_code == 422
