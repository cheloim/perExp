"""Shared context builders for weekly/monthly reports.

Implements Tracks A+B of the budget-context spec:
- `compra_mensual_grande` detection (deterministic, no user questions,
  no persistent tags — lives only in the report payload).
- budget-vs-real lines with a 20% deviation band vs the 3-month average.
- history-evidence flag (`modo acotado` for < 3 months).

Thresholds are module constants so the spec values stay greppable.
"""

import statistics
import unicodedata
from calendar import monthrange
from datetime import date

MIN_HISTORY_MONTHS = 3
DEVIATION_BAND_PCT = 20.0
COMPRA_WINDOW_MONTHS = 4
COMPRA_MIN_MATCHES = 3
COMPRA_DAY_TOLERANCE_DAYS = 10
HIGH_VARIATION_CV = 0.35

SUPER_KEYWORDS = ("super", "hiper", "mayorista", "almacen", "mercado", "autoservicio")
# Wallets that contain "mercado" but are not grocery stores.
SUPER_EXCLUSIONS = ("mercadopago", "mercado pago")


def _normalize(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return ascii_text.lower().strip()


def is_super_category(leaf_name: str, ancestor_names: list[str]) -> bool:
    """True when the leaf or any ancestor looks like a grocery/wholesale store."""
    names = [_normalize(leaf_name), *(_normalize(a) for a in ancestor_names)]
    if any(ex in n for n in names for ex in SUPER_EXCLUSIONS):
        return False
    return any(kw in n for n in names for kw in SUPER_KEYWORDS)


def is_limited_history(history_months: int) -> bool:
    """True when there is not enough evidence to classify or prescribe."""
    return history_months < MIN_HISTORY_MONTHS


def monthly_prompt_rules(limited: bool) -> str:
    """Extra system-prompt rules for the monthly analysis (unit-testable)."""
    rules = (
        "- Analizá a nivel SUBCATEGORÍA (hoja de categoría); agregá a categoría padre "
        "solo si la hoja tiene menos de 3 transacciones en el mes.\n"
        "- Generá alerts/flags solo si el desvío contra la media de 3 meses supera "
        f"±{DEVIATION_BAND_PCT:.0f}% Y no es una compra mensual detectada dentro de banda. "
        "Una compra mensual dentro de banda se menciona en 1 línea, sin alerta."
    )
    if limited:
        rules += (
            "\n- Hay poco historial (menos de 3 meses, modo acotado): describí lo observado "
            "sin prescribir cambios y decí explícito que el historial es acotado."
        )
    return rules


def weekly_prompt_rules(limited: bool) -> str:
    """Extra system-prompt rules for the weekly analysis (unit-testable)."""
    rules = (
        "- Si hay bloque BUDGET VS REAL, compará contra el presupuesto y la media de 3 meses; "
        f"solo marcá preocupación si el desvío supera ±{DEVIATION_BAND_PCT:.0f}%.\n"
        "- Una compra mensual detectada dentro de banda no es motivo de alerta."
    )
    if limited:
        rules += (
            "\n- Hay poco historial (menos de 3 meses, modo acotado): describí sin prescribir "
            "y decí explícito que el historial es acotado."
        )
    return rules


def detect_compra_mensual_grande(tickets: list[dict], p75_amount: float) -> dict | None:
    """Detect a big monthly grocery ticket pattern from per-month max tickets.

    `tickets`: ascending [{month: "YYYY-MM", day: int, amount: float}], ≤4 entries.
    Each ticket must exceed `p75_amount` (p75 of the leaf's amounts) and all
    matched days must fall within ±10 days of the median day.
    """
    if len(tickets) < COMPRA_MIN_MATCHES:
        return None
    matched = [t for t in tickets if t["amount"] > p75_amount]
    if len(matched) < COMPRA_MIN_MATCHES:
        return None
    days = sorted(t["day"] for t in matched)
    median_day = statistics.median(days)
    if any(abs(d - median_day) > COMPRA_DAY_TOLERANCE_DAYS for d in days):
        return None
    amounts = [t["amount"] for t in matched]
    mean = sum(amounts) / len(amounts)
    cv = (statistics.pstdev(amounts) / mean) if mean > 0 else 0.0
    return {
        "pattern_day": int(round(median_day)),
        "median_amount": round(statistics.median(amounts), 2),
        "months_matched": len(matched),
        "variable_amount": cv > HIGH_VARIATION_CV,
    }


def percentile(data: list[float], pct: float) -> float:
    """Linear-interpolation percentile (0-100)."""
    if not data:
        return 0.0
    ordered = sorted(data)
    if len(ordered) == 1:
        return ordered[0]
    rank = (pct / 100) * (len(ordered) - 1)
    low, high = int(rank), min(int(rank) + 1, len(ordered) - 1)
    frac = rank - low
    return ordered[low] + (ordered[high] - ordered[low]) * frac


def build_budget_vs_real_lines(budget_items: list[dict]) -> list[str]:
    """Format `BUDGET VS REAL` lines with deviation vs the 3-month average.

    Each item: {category_name, budget_amount, spent, avg_monthly}.
    Flags `ALERTA` only when |desvío| exceeds the 20% band.
    """
    lines = []
    for item in budget_items:
        name = item.get("category_name", "Sin categoría")
        budget = item.get("budget_amount", 0) or 0
        spent = item.get("spent", 0) or 0
        avg = item.get("avg_monthly", 0) or 0
        pct = round((spent / budget * 100) if budget > 0 else 0)
        if avg > 0:
            dev = round((spent - avg) / avg * 100)
            band = (
                f"→ ALERTA supera banda {DEVIATION_BAND_PCT:.0f}%"
                if abs(dev) > DEVIATION_BAND_PCT
                else "dentro de banda"
            )
            lines.append(
                f"  - {name}: presupuesto=${budget:,.0f}, gastado=${spent:,.0f} ({pct}%), "
                f"media 3m=${avg:,.0f}, desvío={dev:+.0f}% vs media {band}"
            )
        else:
            lines.append(
                f"  - {name}: presupuesto=${budget:,.0f}, gastado=${spent:,.0f} ({pct}%), "
                "sin historial"
            )
    return lines


def format_compra_mensual_lines(compras: list[dict]) -> list[str]:
    """Format detected monthly-purchase patterns for the LLM context."""
    lines = []
    for c in compras:
        extra = ", monto variable" if c.get("variable_amount") else ""
        lines.append(
            f"  - {c['leaf_name']}: compra mensual día ~{c['pattern_day']}, "
            f"ticket típico=${c['median_amount']:,.0f} "
            f"({c['months_matched']} de {COMPRA_WINDOW_MONTHS} meses{extra})"
        )
    return lines


def get_report_context(uid_list: list[int], db, end_month: date) -> dict:
    """Build evidence-based context for a report ending at `end_month`.

    `end_month`: first day of the last full month in the window (a partial
    current month must NOT be passed — it would fake a missing ticket).
    Single expense query + in-memory grouping (no N+1).
    """
    from app.models import Category, Expense

    window4 = [(end_month.year * 12 + end_month.month - 1 - i) for i in range(3, -1, -1)]
    window4_keys = [f"{v // 12}-{v % 12 + 1:02d}" for v in window4]
    start6_total = window4[0] - 2
    start6 = date(start6_total // 12, start6_total % 12 + 1, 1)
    end_last_day = monthrange(end_month.year, end_month.month)[1]
    end_date = date(end_month.year, end_month.month, end_last_day)

    expenses = (
        db.query(Expense)
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.date >= start6,
            Expense.date <= end_date,
            Expense.is_income == False,  # noqa: E712
        )
        .all()
    )

    history_months = len({(e.date.year, e.date.month) for e in expenses if e.date})

    cats = {c.id: c for c in db.query(Category).all()}
    by_leaf: dict[int, dict] = {}
    for e in expenses:
        if not e.category_id or e.category_id not in cats:
            continue
        cat = cats[e.category_id]
        ancestors = []
        seen = set()
        parent = cats.get(cat.parent_id) if cat.parent_id else None
        while parent and parent.id not in seen:
            seen.add(parent.id)
            ancestors.append(parent.name or "")
            parent = cats.get(parent.parent_id) if parent.parent_id else None
        if not is_super_category(cat.name or "", ancestors):
            continue
        leaf = by_leaf.setdefault(
            e.category_id,
            {
                "name": cat.name or "Sin categoría",
                "parent": ancestors[0] if ancestors else "",
                "amounts": [],
                "monthly_max": {},
            },
        )
        amount = abs(e.amount or 0)
        leaf["amounts"].append(amount)
        key = f"{e.date.year}-{e.date.month:02d}"
        if key in window4_keys:
            current = leaf["monthly_max"].get(key)
            if current is None or amount > current["amount"]:
                leaf["monthly_max"][key] = {"amount": amount, "day": e.date.day}

    compras = []
    for leaf in by_leaf.values():
        tickets = [
            {"month": k, "day": v["day"], "amount": v["amount"]}
            for k, v in sorted(leaf["monthly_max"].items())
        ]
        detected = detect_compra_mensual_grande(tickets, percentile(leaf["amounts"], 75))
        if detected:
            display = f"{leaf['parent']} > {leaf['name']}" if leaf["parent"] else leaf["name"]
            compras.append({"leaf_name": display, **detected})

    return {
        "history_months": history_months,
        "limited": is_limited_history(history_months),
        "compras_mensuales": compras,
    }


def get_monthly_budget_lines(user_id: int, uid_list: list[int], db, ref_date: date) -> list[str]:
    """Budget-vs-real lines for `ref_date`'s month across ALL active budgets.

    Weekly reports only flag budgets ≥80%; the LLM needs the full picture,
    so this queries every active budget (one avg query per budget).
    """
    from app.models import Budget, Category
    from app.services.budget_helpers import get_avg_monthly_spending, get_spending_for_category

    budgets = db.query(Budget).filter(Budget.user_id == user_id, Budget.is_active == True).all()  # noqa: E712
    items = []
    for b in budgets:
        spent = get_spending_for_category(
            b.category_id, ref_date.year, ref_date.month, uid_list, db
        )
        avg = get_avg_monthly_spending(b.category_id, uid_list, db)
        cat = db.query(Category).filter(Category.id == b.category_id).first()
        items.append(
            {
                "category_name": cat.name if cat else "Sin categoría",
                "budget_amount": b.amount,
                "spent": spent,
                "avg_monthly": avg,
            }
        )
    return build_budget_vs_real_lines(items)
