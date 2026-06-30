import calendar as cal_module
import re
from datetime import date

_SPANISH_MONTHS = {
    "ENERO": "01",
    "FEBRERO": "02",
    "MARZO": "03",
    "ABRIL": "04",
    "MAYO": "05",
    "JUNIO": "06",
    "JULIO": "07",
    "AGOSTO": "08",
    "SEPTIEMBRE": "09",
    "SETIEMBRE": "09",
    "OCTUBRE": "10",
    "NOVIEMBRE": "11",
    "DICIEMBRE": "12",
    "ENE": "01",
    "FEB": "02",
    "MAR": "03",
    "ABR": "04",
    "MAY": "05",
    "JUN": "06",
    "JUL": "07",
    "AGO": "08",
    "SEP": "09",
    "OCT": "10",
    "NOV": "11",
    "DIC": "12",
    "FEBR": "02",
    "SEPT": "09",
    "AGOS": "08",
    "SETIEM": "09",
    "SEPTIEM": "09",
    "NOVIEM": "11",
    "DICIEM": "12",
    "OCTUBR": "10",
}

_SPANISH_MONTHS_SORTED = sorted(_SPANISH_MONTHS.keys(), key=len, reverse=True)


def _normalize_date_str(raw: str) -> str:
    raw_upper = raw.upper().strip()
    raw_upper = re.sub(r"(?<=[A-Z])\.", "", raw_upper)

    for es in _SPANISH_MONTHS_SORTED:
        if es in raw_upper:
            raw_upper = raw_upper.replace(es, _SPANISH_MONTHS[es])
            break

    m = re.match(r"^(\d{2})[\s\-/](\d{2})[\s\-/](\d{1,4})$", raw_upper.strip())
    if m:
        first, second, third = m.group(1), m.group(2), m.group(3)
        if len(third) == 4:
            if int(first) > 12:
                return f"{third}-{second.zfill(2)}-{first.zfill(2)}"
            return f"{first}-{second}-{third}"
        if int(first) > 12:
            return f"20{third}-{second.zfill(2)}-{first.zfill(2)}"
        return f"20{third}-{first.zfill(2)}-{second.zfill(2)}"

    m_ddmm = re.match(r"^(\d{1,2})[\s\-/](\d{1,2})[\s\-/](\d{4})$", raw_upper.strip())
    if m_ddmm:
        dd, mm, yyyy = m_ddmm.group(1).zfill(2), m_ddmm.group(2).zfill(2), m_ddmm.group(3)
        return f"{yyyy}-{mm}-{dd}"

    m2 = re.match(r"^(\d{2})-(\d{2})-(\d{2})$", raw_upper.strip())
    if m2:
        return f"20{m2.group(1)}-{m2.group(2)}-{m2.group(3)}"

    return raw_upper


def add_months(dt: date, months: int) -> date:
    month = dt.month - 1 + months
    year = dt.year + month // 12
    month = month % 12 + 1
    day = min(dt.day, cal_module.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def predict_next_closing(last_closing: date, days: int = 28) -> date:
    """Predict next closing date using rolling cycle from last known closing."""
    from datetime import timedelta
    return last_closing + timedelta(days=days)


def get_closing_day_approx(closing_day: int, ref_date: date) -> date:
    """Get approximate closing date for a month using a fixed closing_day (1-31)."""
    year, month = ref_date.year, ref_date.month
    last_day = cal_module.monthrange(year, month)[1]
    day = min(closing_day, last_day)
    return date(year, month, day)


def get_billing_period_for_card(card_id: int, ref_date: date, db) -> tuple[date, date] | None:
    """
    Get the billing period that contains ref_date for a specific card.
    Uses CardClosing records when available, falls back to closing_day prediction.

    Returns (period_start, period_end) or None if no data available.
    """
    from datetime import timedelta

    from app.models import Card, CardClosing

    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        return None

    # Get all closings for this card, ordered by date
    closings = (
        db.query(CardClosing)
        .filter(CardClosing.card_id == card_id)
        .order_by(CardClosing.closing_date.asc())
        .all()
    )

    if closings:
        # Find which period contains ref_date
        for i, closing in enumerate(closings):
            period_end = closing.closing_date
            if i == 0:
                # First closing - period start is unknown, use closing_date itself
                period_start = period_end
            else:
                period_start = closings[i - 1].closing_date + timedelta(days=1)

            if period_start <= ref_date <= period_end:
                return (period_start, period_end)

        # ref_date is after the last known closing - predict next period
        last_closing = closings[-1].closing_date
        predicted_next = predict_next_closing(last_closing)
        period_start = last_closing + timedelta(days=1)

        if ref_date <= predicted_next:
            return (period_start, predicted_next)

        # ref_date is even further - try to chain predictions
        while ref_date > predicted_next:
            period_start = predicted_next + timedelta(days=1)
            predicted_next = predict_next_closing(predicted_next)
            if ref_date <= predicted_next:
                return (period_start, predicted_next)

        return (period_start, predicted_next)

    # No CardClosing records - use closing_day if available
    if card.closing_day:
        # Find the closing day that would contain ref_date
        # A period with closing_day X runs from (X+1 of prev month) to (X of this month)
        this_month_closing = get_closing_day_approx(card.closing_day, ref_date)
        if ref_date <= this_month_closing:
            # ref_date is before this month's closing, so it's in this period
            prev_month = add_months(ref_date, -1)
            period_start = get_closing_day_approx(card.closing_day, prev_month) + timedelta(days=1)
            return (period_start, this_month_closing)
        else:
            # ref_date is after this month's closing, so it's in next period
            next_month = add_months(ref_date, 1)
            period_end = get_closing_day_approx(card.closing_day, next_month)
            period_start = this_month_closing + timedelta(days=1)
            return (period_start, period_end)

    return None


def get_billing_periods_history(card_id: int, count: int, db) -> list[dict]:
    """
    Return the last N billing periods for a card, using CardClosing records.
    For the current (latest) period, predict the end date.

    Returns list of {"start": date, "end": date, "label": str}
    """
    from datetime import timedelta

    from app.models import CardClosing

    closings = (
        db.query(CardClosing)
        .filter(CardClosing.card_id == card_id)
        .order_by(CardClosing.closing_date.desc())
        .limit(count)
        .all()
    )

    if not closings:
        return []

    # Reverse to chronological order
    closings = list(reversed(closings))

    periods = []
    for i, closing in enumerate(closings):
        period_end = closing.closing_date
        if i == 0:
            # First closing - we don't know the period start
            # Use previous closing if available, otherwise just use the closing date
            period_start = period_end  # Will be adjusted if we have more history
        else:
            period_start = closings[i - 1].closing_date + timedelta(days=1)

        label = _format_period_label(period_start, period_end)
        periods.append({"start": period_start, "end": period_end, "label": label})

    # Add predicted current period if the last closing is old enough
    last_closing = closings[-1].closing_date
    predicted_next = predict_next_closing(last_closing)
    current_start = last_closing + timedelta(days=1)

    # Only add if it makes sense (predicted end is in the future or recent)
    if predicted_next >= date.today() - timedelta(days=7):
        label = _format_period_label(current_start, predicted_next)
        periods.append({
            "start": current_start,
            "end": predicted_next,
            "label": label,
            "is_predicted": True,
        })

    return periods


def get_current_billing_periods(db, user_id: int) -> list[dict]:
    """
    Return the current billing period for each credit card belonging to user.
    Uses CardClosing records + prediction.
    """

    from app.models import Card

    cards = (
        db.query(Card)
        .filter(Card.user_id == user_id, Card.card_type == "credito")
        .all()
    )

    results = []
    for card in cards:
        period = get_billing_period_for_card(card.id, date.today(), db)
        if period:
            start, end = period
            results.append({
                "card_id": card.id,
                "card_name": card.card_name,
                "bank": card.bank,
                "holder": card.holder,
                "period_start": start,
                "period_end": end,
                "label": _format_period_label(start, end),
            })
        else:
            results.append({
                "card_id": card.id,
                "card_name": card.card_name,
                "bank": card.bank,
                "holder": card.holder,
                "period_start": None,
                "period_end": None,
                "label": None,
            })

    return results


def _format_period_label(start: date, end: date) -> str:
    """Format a billing period label like '22 May - 25 Jun'."""
    months_es = {
        1: "Ene", 2: "Feb", 3: "Mar", 4: "Abr", 5: "May", 6: "Jun",
        7: "Jul", 8: "Ago", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dic",
    }
    if start.year == end.year and start.month == end.month or start.year == end.year:
        return f"{start.day} {months_es[start.month]} - {end.day} {months_es[end.month]} {end.year}"
    else:
        return f"{start.day} {months_es[start.month]} {start.year} - {end.day} {months_es[end.month]} {end.year}"
