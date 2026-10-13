"""Unit tests for report context builders (pure logic, no DB).

Spec: .opencode/plan/2026-10-13-budget-context-reports.md (Tracks A+B).
Thresholds: banda 20%, 3 de 4 meses, ±10 días, p75, mínimo 3 meses.
"""

import pytest

from app.services import report_context as rc


class TestIsSuperCategory:
    def test_leaf_named_supermercado(self):
        assert rc.is_super_category("Supermercado", []) is True

    def test_child_of_super_parent(self):
        assert rc.is_super_category("Frescos", ["Supermercado"]) is True

    def test_mayorista_leaf(self):
        assert rc.is_super_category("Súper · Mayorista", ["Alimentos"]) is True

    def test_unrelated_category(self):
        assert rc.is_super_category("Transporte", []) is False

    def test_subte_not_super(self):
        # "Subte" contains "sub"+"te" but must not match "super"
        assert rc.is_super_category("Subte", ["Transporte"]) is False


class TestDetectCompraMensual:
    def _tickets(self, days, amounts, months=None):
        months = months or ["2026-06", "2026-07", "2026-08", "2026-09"][: len(days)]
        return [
            {"month": m, "day": d, "amount": a}
            for m, d, a in zip(months, days, amounts, strict=True)
        ]

    def test_detects_stable_monthly_pattern(self):
        tickets = self._tickets([3, 5, 2, 4], [120000, 125000, 118000, 122000])
        result = rc.detect_compra_mensual_grande(tickets, p75_amount=50000)
        assert result is not None
        assert result["months_matched"] == 4
        assert result["pattern_day"] == pytest.approx(3.5, abs=1)
        assert result["variable_amount"] is False

    def test_detects_with_one_missing_month(self):
        tickets = self._tickets([3, 5, 4], [120000, 125000, 118000])
        result = rc.detect_compra_mensual_grande(tickets, p75_amount=50000)
        assert result is not None
        assert result["months_matched"] == 3

    def test_insufficient_history_returns_none(self):
        tickets = self._tickets([3, 5], [120000, 125000])
        assert rc.detect_compra_mensual_grande(tickets, p75_amount=50000) is None

    def test_high_variation_still_detected_with_flag(self):
        tickets = self._tickets([3, 4, 2, 5], [60000, 200000, 90000, 180000])
        result = rc.detect_compra_mensual_grande(tickets, p75_amount=40000)
        assert result is not None
        assert result["variable_amount"] is True

    def test_small_tickets_below_p75_not_detected(self):
        tickets = self._tickets([3, 5, 2, 4], [8000, 9500, 7000, 9000])
        assert rc.detect_compra_mensual_grande(tickets, p75_amount=50000) is None

    def test_scattered_days_not_detected(self):
        tickets = self._tickets([1, 12, 25, 8], [120000, 125000, 118000, 122000])
        assert rc.detect_compra_mensual_grande(tickets, p75_amount=50000) is None


class TestBudgetVsRealLines:
    def test_deviation_beyond_band_flags_alert(self):
        items = [
            {
                "category_name": "Transporte",
                "budget_amount": 40000,
                "spent": 43200,
                "avg_monthly": 30000,
            }
        ]
        (line,) = rc.build_budget_vs_real_lines(items)
        assert "Transporte" in line
        assert "+44%" in line
        assert "ALERTA" in line

    def test_deviation_within_band_is_quiet(self):
        items = [
            {
                "category_name": "Súper",
                "budget_amount": 120000,
                "spent": 64000,
                "avg_monthly": 58000,
            }
        ]
        (line,) = rc.build_budget_vs_real_lines(items)
        assert "ALERTA" not in line
        assert "dentro de banda" in line

    def test_zero_avg_reports_no_history(self):
        items = [
            {"category_name": "Mascotas", "budget_amount": 20000, "spent": 9500, "avg_monthly": 0}
        ]
        (line,) = rc.build_budget_vs_real_lines(items)
        assert "sin historial" in line
        assert "ALERTA" not in line


class TestHistoryEvidence:
    def test_fewer_than_3_months_is_limited(self):
        assert rc.is_limited_history(0) is True
        assert rc.is_limited_history(2) is True

    def test_3_or_more_months_is_enough(self):
        assert rc.is_limited_history(3) is False
        assert rc.is_limited_history(6) is False


class TestPromptRules:
    def test_monthly_rules_require_subcategory_level(self):
        rules = rc.monthly_prompt_rules(limited=False)
        assert "SUBCATEGOR" in rules
        assert "20%" in rules
        assert "compra mensual" in rules

    def test_monthly_rules_omit_acotado_when_enough_history(self):
        assert "acotado" not in rc.monthly_prompt_rules(limited=False)

    def test_monthly_rules_add_acotado_when_limited(self):
        rules = rc.monthly_prompt_rules(limited=True)
        assert "acotado" in rules
        assert "sin prescribir" in rules

    def test_weekly_rules_mention_budget_and_band(self):
        rules = rc.weekly_prompt_rules(limited=False)
        assert "20%" in rules
        assert "presupuesto" in rules

    def test_weekly_rules_add_acotado_when_limited(self):
        assert "acotado" in rc.weekly_prompt_rules(limited=True)

    def test_monthly_prompt_rules_is_plain_text(self):
        # Must be safe to append to the system prompt (no placeholders left)
        assert "{limited" not in rc.monthly_prompt_rules(limited=True)
        assert "{limited" not in rc.monthly_prompt_rules(limited=False)


# ── Wiring: monthly report payload (medium, needs DB) ─────────────────


def _w_create_user(db, email):
    from app.models import User
    from app.services.auth import get_password_hash

    user = User(
        email=email,
        full_name="Wiring User",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def _w_create_category(db, user, name, parent_id=None):
    from app.models import Category

    cat = Category(name=name, user_id=user.id, parent_id=parent_id, budget_group="necesidades")
    db.add(cat)
    db.flush()
    return cat


def _w_create_expense(db, user, amount, category_id, date_):
    from app.models import Expense
    from app.services.encryption import compute_hmac

    desc = f"wiring expense {amount} {date_.isoformat()}"
    expense = Expense(
        date=date_,
        description=desc,
        description_hmac=compute_hmac(desc),
        amount=amount,
        category_id=category_id,
        user_id=user.id,
        is_income=False,
    )
    db.add(expense)
    db.flush()
    return expense


def _w_create_budget(db, user, category_id, amount):
    from app.models import Budget

    budget = Budget(user_id=user.id, category_id=category_id, amount=amount)
    db.add(budget)
    db.flush()
    return budget


class TestMonthlyWiring:
    def test_report_includes_compra_mensual_and_budget_vs_real(self, db, monkeypatch):
        from datetime import date

        from app.tasks.monthly_report import _generate_report_data

        monkeypatch.delenv("LLM_API_KEY", raising=False)

        user = _w_create_user(db, "wiring@test.com")
        super_cat = _w_create_category(db, user, "Supermercado")
        _w_create_budget(db, user, super_cat.id, 500000)

        big = [
            ("2026-05", 3, 120000),
            ("2026-06", 4, 125000),
            ("2026-07", 2, 119000),
            ("2026-08", 5, 122000),
        ]
        for month, day, amount in big:
            y, m = int(month[:4]), int(month[5:7])
            _w_create_expense(db, user, amount, super_cat.id, date(y, m, day))
            for small_day in (10, 17, 24):
                _w_create_expense(db, user, 8000, super_cat.id, date(y, m, small_day))

        report = _generate_report_data(user.id, "2026-08", db)

        assert report["history_months"] == 4
        assert report["limited_history"] is False
        assert len(report["compra_mensual"]) == 1
        compra = report["compra_mensual"][0]
        assert compra["leaf_name"] == "Supermercado"
        assert compra["months_matched"] == 4
        assert len(report["budget_vs_real"]) == 1
        assert "Supermercado" in report["budget_vs_real"][0]

    def test_new_user_report_is_flagged_limited(self, db, monkeypatch):
        from datetime import date

        from app.tasks.monthly_report import _generate_report_data

        monkeypatch.delenv("LLM_API_KEY", raising=False)

        user = _w_create_user(db, "newbie@test.com")
        cat = _w_create_category(db, user, "Transporte")
        _w_create_expense(db, user, 15000, cat.id, date(2026, 8, 10))

        report = _generate_report_data(user.id, "2026-08", db)

        assert report["history_months"] == 1
        assert report["limited_history"] is True
        assert report["compra_mensual"] == []


class TestWeeklyWiring:
    def test_weekly_builder_attaches_evidence_context(self, db):
        from datetime import date, timedelta

        from app.services.bot_reports import build_weekly_report_data

        user = _w_create_user(db, "weekly@test.com")
        cat = _w_create_category(db, user, "Supermercado")
        _w_create_budget(db, user, cat.id, 200000)
        today = date.today()
        _w_create_expense(db, user, 25000, cat.id, today - timedelta(days=1))
        # Evidence window ends at the last full month: seed it too
        prev_month = (today.replace(day=1) - timedelta(days=1)).replace(day=15)
        _w_create_expense(db, user, 20000, cat.id, prev_month)

        report = build_weekly_report_data(user.id, today - timedelta(days=6), today, db)

        assert report["history_months"] == 1
        assert report["limited_history"] is True
        assert report["compra_mensual"] == []
        assert len(report["budget_vs_real"]) == 1
        assert "Supermercado" in report["budget_vs_real"][0]
