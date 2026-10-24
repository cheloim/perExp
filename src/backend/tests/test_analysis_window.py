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
from app.models import Category, Expense, User
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


class _FakeLLM:
    """The LLM facade the router uses: one frame, and the prompt kept."""

    def __init__(self, prompts: list):
        self._prompts = prompts

    async def astream(self, messages, *, feature, system=None, temperature=None):
        self._prompts.append(messages)
        yield "respuesta del modelo"


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
    monkeypatch.setattr(analysis, "get_client", lambda **kw: _FakeLLM(prompts))
    monkeypatch.setattr(analysis, "is_configured", lambda *a, **k: True)
    monkeypatch.setattr(analysis, "SessionLocal", lambda: sink)
    return SimpleNamespace(prompts=prompts, history=sink)


def _prompt_text(prompts: list) -> str:
    """The data block the endpoint hands to the model as its final turn."""
    return prompts[-1][-1].text


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


# ── Twelve months, comparisons, retrieval (#417) ─────────────────────


def test_twelve_months_is_the_window_by_default(db, test_user, fake_llm):
    """A question that names no period gets twelve months, not the whole
    history — long enough for trends, bounded enough for the prompt."""
    _add_expense(db, test_user, _first_day_months_ago(11), "gasto de hace once meses", 100.0)
    _add_expense(db, test_user, _first_day_months_ago(12), "gasto de hace un año", 100.0)

    _stream(AnalysisRequest(question="¿cómo vengo?"), db, test_user)

    prompt = _prompt_text(fake_llm.prompts)
    assert f"Período: {_first_day_months_ago(11)} → {date.today()}" in prompt
    assert "gasto de hace once meses" in prompt
    assert "gasto de hace un año" not in prompt


def test_twelve_months_can_be_asked_for_by_name(db, test_user, fake_llm):
    _add_expense(db, test_user, _first_day_months_ago(11), "gasto viejo", 100.0)
    _add_expense(db, test_user, _first_day_months_ago(12), "gasto fuera", 100.0)

    _stream(AnalysisRequest(months=12), db, test_user)

    prompt = _prompt_text(fake_llm.prompts)
    assert "gasto viejo" in prompt
    assert "gasto fuera" not in prompt


def test_month_over_month_deltas_are_computed_for_the_model(db, test_user, fake_llm):
    prev_key = _first_day_months_ago(1).strftime("%Y-%m")
    curr_key = _first_day_months_ago(0).strftime("%Y-%m")
    _add_expense(db, test_user, _first_day_months_ago(1), "gasto del mes pasado", 2000.0)
    _add_expense(db, test_user, _first_day_months_ago(0), "gasto de este mes", 3000.0)

    _stream(AnalysisRequest(months=2), db, test_user)

    prompt = _prompt_text(fake_llm.prompts)
    assert "COMPARACIÓN MES A MES:" in prompt
    assert f"- {curr_key}: $3,000.00 (vs {prev_key}: +50.0%, +$1,000.00)" in prompt


def test_the_top_categories_compare_the_newest_month_against_the_previous_one(
    db, test_user, fake_llm
):
    super_m = Category(name="Supermercado", user_id=test_user.id)
    libreria = Category(name="Librería", user_id=test_user.id)
    db.add_all([super_m, libreria])
    db.flush()

    for cat, on, amount in (
        (super_m, _first_day_months_ago(1), 1000.0),
        (super_m, _first_day_months_ago(0), 3000.0),
        (libreria, _first_day_months_ago(0), 500.0),
    ):
        exp = _add_expense(db, test_user, on, f"compra en {cat.name}", amount)
        exp.category_id = cat.id

    _stream(AnalysisRequest(months=2), db, test_user)

    prompt = _prompt_text(fake_llm.prompts)
    assert "CATEGORÍAS — " in prompt
    assert "- Supermercado: $3,000.00 (vs $1,000.00, +200.0%)" in prompt
    assert "- Librería: $500.00 (vs $0.00, sin base)" in prompt


def test_a_question_retrieves_the_spend_it_is_about(db, test_user, fake_llm):
    """The window arrives aggregated; the words of the question find the spends
    it is about so a merchant question has something to answer from."""
    _add_expense(
        db, test_user, date.today() - timedelta(days=1), "YENNY TORTUGAS OPEN MALL", 55479.67
    )
    _add_expense(db, test_user, date.today() - timedelta(days=2), "SUPERMERCADO COTO", 12000.0)

    _stream(
        AnalysisRequest(question="¿Cuánto gasté en YENNY TORTUGAS?", months=3),
        db,
        test_user,
    )

    prompt = _prompt_text(fake_llm.prompts)
    assert "GASTOS QUE COINCIDEN CON LA PREGUNTA (yenny, tortugas)" in prompt
    block = prompt.split("GASTOS QUE COINCIDEN CON LA PREGUNTA")[1]
    assert "YENNY TORTUGAS OPEN MALL" in block
    assert "$55,479.67" in block


def test_retrieval_never_leaves_the_user(db, test_user, fake_llm):
    other = User(
        email="other@example.com",
        full_name="Other, User",
        hashed_password="x",
        email_verified=True,
    )
    db.add(other)
    db.flush()
    _add_expense(db, other, date.today(), "YENNY TORTUGAS OPEN MALL", 999999.0)
    _add_expense(db, test_user, date.today(), "YENNY TORTUGAS OPEN MALL", 55479.67)

    _stream(
        AnalysisRequest(question="¿Cuánto gasté en YENNY TORTUGAS?", months=3),
        db,
        test_user,
    )

    prompt = _prompt_text(fake_llm.prompts)
    assert "YENNY TORTUGAS OPEN MALL" in prompt
    assert "$999,999.00" not in prompt
    assert "$55,479.67" in prompt


def test_the_prompt_stays_bounded_at_twelve_months(db, test_user, fake_llm):
    """Aggregates plus top 10 plus the retrieval block: a year of spending must
    not turn the prompt into a transaction dump."""
    for i in range(500):
        _add_expense(
            db,
            test_user,
            _first_day_months_ago(i % 12),
            f"comercio numero {i}",
            10.0 + i,
        )

    _stream(
        AnalysisRequest(question="¿Cuánto gasté en el comercio 42?", months=12),
        db,
        test_user,
    )

    assert len(_prompt_text(fake_llm.prompts)) < 16000
