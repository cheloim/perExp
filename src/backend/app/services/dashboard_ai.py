"""AI spending-trends analysis for the dashboard (#566)."""

from __future__ import annotations

import time
from collections import defaultdict
from datetime import date

from sqlalchemy.orm import Session

from app.models import Expense, User
from app.services.access import scoped_user_ids
from app.services.aggregation import fallback_rate, to_ars
from app.services.dashboard_shared import category_map
from app.services.date_utils import add_months
from app.services.llm import LLMMessage, get_client, is_configured
from app.services.money import format_money

# Simple in-memory cache for LLM calls (avoid redundant calls on page reload)
_llm_cache: dict[str, tuple[float, object]] = {}


class AiTrendsError(Exception):
    """AI trends failure that the HTTP layer must translate into an HTTP error."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _get_cached(key: str, ttl_seconds: int):
    """Get cached value if not expired. Returns None if miss."""
    entry = _llm_cache.get(key)
    if entry and time.time() - entry[0] < ttl_seconds:
        return entry[1]
    return None


def _set_cached(key: str, value):
    """Store value in cache with current timestamp."""
    _llm_cache[key] = (time.time(), value)


async def ai_trends(month: str | None = None, db: Session = None, current_user: User = None):
    """LLM-powered analysis of spending trends with projections."""
    uid_list = scoped_user_ids(current_user, db)

    # Cache for 5 minutes per user+month — Redis (shared) fronted by L1
    cache_key = f"v1:aitrends:{current_user.id}:{month or 'all'}"
    legacy_key = f"ai_trends:{current_user.id}:{month or 'all'}"
    from app.services.cache import get_json as _redis_get
    from app.services.cache import set_json as _redis_set

    cached = _redis_get(cache_key)
    if cached is not None:
        return cached
    cached = _get_cached(legacy_key, ttl_seconds=300)
    if cached is not None:
        _redis_set(cache_key, cached, ttl=300)
        return cached

    from app.prompts import AI_TRENDS_PROMPT

    if not is_configured():
        raise AiTrendsError(500, "LLM_API_KEY no configurada.")

    today = date.today()
    six_months_ago = add_months(today, -6)

    expenses_hist = (
        db.query(Expense)
        .filter(Expense.user_id.in_(uid_list), Expense.date >= six_months_ago)
        .order_by(Expense.date)
        .all()
    )

    cat_map = category_map(uid_list, db)

    fallback = fallback_rate(db)
    by_month: dict = defaultdict(lambda: {"total": 0.0, "count": 0, "by_cat": defaultdict(float)})
    for e in expenses_hist:
        key = e.date.strftime("%Y-%m")
        amount_ars = to_ars(e, fallback)
        by_month[key]["total"] += amount_ars
        by_month[key]["count"] += 1
        cat_name = (
            cat_map[e.category_id].name
            if e.category_id and e.category_id in cat_map
            else "Sin categoría"
        )
        by_month[key]["by_cat"][cat_name] += amount_ars

    installments_exp = (
        db.query(Expense)
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.installment_group_id != None,
            Expense.installment_group_id != "",
            Expense.date >= add_months(today, -18),
        )
        .all()
    )

    groups: dict = defaultdict(list)
    for e in installments_exp:
        groups[e.installment_group_id].append(e)

    future_installments: dict = defaultdict(float)
    for _gid, exps in groups.items():
        exps_sorted = sorted(exps, key=lambda x: x.installment_number or 0)
        total_inst = exps_sorted[0].installment_total or 0
        paid = len(exps_sorted)
        remaining = max(0, total_inst - paid)
        if remaining == 0:
            continue
        last_exp = exps_sorted[-1]
        inst_amount = abs(to_ars(last_exp, fallback))
        last_date = last_exp.date
        for i in range(1, remaining + 1):
            future_date = add_months(last_date, i)
            future_key = future_date.strftime("%Y-%m")
            future_installments[future_key] += inst_amount

    sorted_months = sorted(by_month.keys())

    monthly_lines = []
    for m_key in sorted_months:
        d = by_month[m_key]
        cat_breakdown = ", ".join(
            f"{k}: {format_money(v, 'ARS')}"
            for k, v in sorted(d["by_cat"].items(), key=lambda x: x[1], reverse=True)[:5]
        )
        monthly_lines.append(
            f"  {m_key}: total={format_money(d['total'], 'ARS')} "
            f"({d['count']} transacciones) | {cat_breakdown}"
        )

    future_lines = []
    for i in range(1, 4):
        fm = add_months(today, i)
        fkey = fm.strftime("%Y-%m")
        inst_amt = future_installments.get(fkey, 0.0)
        future_lines.append(f"  {fkey}: cuotas_pendientes={format_money(inst_amt, 'ARS')}")

    filter_ctx = (
        f"Mes en foco del usuario: {month}"
        if month
        else "Sin filtro de mes específico (usar todos los datos)"
    )

    context = f"""DATOS DE GASTOS HISTÓRICOS (últimos 6 meses):
{chr(10).join(monthly_lines) or "  Sin datos suficientes"}

CUOTAS PENDIENTES PROYECTADAS:
{chr(10).join(future_lines)}

{filter_ctx}

Fecha actual: {today.isoformat()}
"""

    try:
        import asyncio

        result = await asyncio.wait_for(
            get_client().acomplete_json(
                [LLMMessage(role="user", text=context)],
                feature="dashboard_trends",
                system=AI_TRENDS_PROMPT,
            ),
            timeout=8.0,
        )
    except ValueError:
        raise AiTrendsError(422, "La IA no pudo generar el análisis. Intentá más tarde.")
    except TimeoutError:
        raise AiTrendsError(504, "La IA tardó demasiado. Intentá más tarde.")
    except Exception as e:
        raise AiTrendsError(500, f"Error al llamar a la IA: {e}")

    for proj in result.get("projection", []):
        fkey = proj.get("month", "")
        proj["installments_amount"] = future_installments.get(
            fkey, proj.get("installments_amount", 0)
        )

    result["monthly_history"] = [
        {
            "month": k,
            "total": by_month[k]["total"],
            "count": by_month[k]["count"],
            "by_cat": dict(by_month[k]["by_cat"]),
        }
        for k in sorted_months
    ]
    result["future_installments"] = {k: v for k, v in future_installments.items()}

    _set_cached(legacy_key, result)
    _redis_set(cache_key, result, ttl=300)
    return result
