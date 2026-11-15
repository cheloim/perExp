"""Shared FX resolution (#508a).

Budget rates are BNA-only and never silently switch to CCL/BCRA. Display rates
may use the historical chain because they are a market snapshot.
"""

import pytest

from app.routers.investments import get_usd_rate_alias
from app.services import fx


@pytest.fixture
def store(monkeypatch):
    values: dict = {}
    monkeypatch.setattr(fx.cache, "get_json", lambda key: values.get(key))
    monkeypatch.setattr(
        fx.cache, "set_json", lambda key, value, ttl: values.__setitem__(key, value)
    )
    return values


def _bna(rate=1000.0, day="2026-11-15"):
    return {"rate": rate, "date": day, "source": "BNA"}


def test_parse_bna_uses_venta():
    assert fx._parse_bna({"venta": 1200, "fechaActualizacion": "2026-11-15T10:00:00"}) == {
        "rate": 1200.0,
        "date": "2026-11-15",
        "source": "BNA",
    }


def test_parse_bna_rejects_empty():
    assert fx._parse_bna({"venta": None, "compra": None}) is None


def test_budget_prefers_bna(store, monkeypatch):
    monkeypatch.setattr(fx, "_fetch_bna", lambda: _bna())

    result = fx.get_usd_rate("budget")

    assert result["source"] == "BNA"
    assert result["rate"] == 1000.0
    assert store[fx.LAST_BNA_KEY]["rate"] == 1000.0


def test_budget_falls_back_to_last_bna_without_using_adr(store, monkeypatch):
    store[fx.LAST_BNA_KEY] = _bna(900.0, "2026-11-14")
    monkeypatch.setattr(fx, "_fetch_bna", lambda: None)

    def fail_adr():
        raise AssertionError("budget must not use ADR")

    monkeypatch.setattr(fx, "_fetch_adr", fail_adr)

    result = fx.get_usd_rate("budget")

    assert result["rate"] == 900.0
    assert result["source"] == "BNA"
    assert "2026-11-14" in result["warning"]


def test_budget_without_bna_or_last_raises(store, monkeypatch):
    monkeypatch.setattr(fx, "_fetch_bna", lambda: None)

    with pytest.raises(fx.FxUnavailableError):
        fx.get_usd_rate("budget")


def test_display_uses_adr_after_bna(store, monkeypatch):
    monkeypatch.setattr(fx, "_fetch_bna", lambda: None)
    monkeypatch.setattr(
        fx,
        "_fetch_adr",
        lambda: {"rate": 1100.0, "date": "2026-11-15", "source": "ADR-implied"},
    )

    result = fx.get_usd_rate("display")

    assert result["source"] == "ADR-implied"
    assert result["rate"] == 1100.0


def test_display_uses_bcra_after_bna_and_adr(store, monkeypatch):
    monkeypatch.setattr(fx, "_fetch_bna", lambda: None)
    monkeypatch.setattr(fx, "_fetch_adr", lambda: None)
    monkeypatch.setattr(
        fx,
        "_fetch_bcra",
        lambda: {"rate": 1050.0, "date": "2026-11-15", "source": "BCRA"},
    )

    result = fx.get_usd_rate("display")

    assert result["source"] == "BCRA"
    assert result["rate"] == 1050.0


def test_historical_date_is_not_supported_yet(store):
    with pytest.raises(fx.FxUnavailableError):
        fx.get_usd_rate("budget", date_str="2020-01-01")


def test_investments_alias_asks_for_display(monkeypatch):
    calls = []
    monkeypatch.setattr(
        fx,
        "get_usd_rate",
        lambda purpose="budget", date_str=None: calls.append(purpose) or _bna(),
    )

    result = get_usd_rate_alias(current_user=object())

    assert result["source"] == "BNA"
    assert calls == ["display"]
