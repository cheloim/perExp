"""HTTP layer for the dashboard endpoints (#566).

Aggregations and report math live in ``app.services.dashboard_*``. This module
only wires routes, dependencies, caching and HTTP error translation.
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.services.access import scoped_user_ids
from app.services.auth import get_current_user
from app.services.cache import dash_summary_key, get_json, group_hash, set_json
from app.services.dashboard_ai import AiTrendsError, ai_trends
from app.services.dashboard_breakdowns import (
    card_category_breakdown,
    card_summary,
    category_trend,
    tag_summary,
    top_merchants,
)
from app.services.dashboard_installments import (
    credit_card_pasivos,
    installments_monthly_load,
    installments_overview,
    scheduled_summary,
)
from app.services.dashboard_reports import (
    ReportRequestError,
    compute_monthly_report,
    monthly_report_download,
    report_image_payload,
    request_monthly_report,
)
from app.services.dashboard_reports import (
    list_monthly_reports as _list_monthly_reports,
)
from app.services.dashboard_shared import apply_filters as _apply_filters
from app.services.dashboard_summary import account_expenses, compute_summary

# Kept as module attributes for existing callers and tests.
__all__ = ["router", "_apply_filters", "_compute_summary"]

# The summary computation is resolved through this module by existing callers
# and tests; the implementation lives in the service layer.
_compute_summary = compute_summary

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get(
    "/summary",
    summary="Get expense summary",
    description="Retrieve aggregated expense data including totals by category, period, card, currency, and recent expenses.",
)
def get_summary(
    month: str | None = None,
    group_by: str = "month",
    person: str | None = None,
    category_id: int | None = None,
    bank: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = scoped_user_ids(current_user, db)
    gh = group_hash(uid_list)
    cache_key = dash_summary_key(gh, month, person, category_id, bank, group_by)
    cached = get_json(cache_key)
    if cached is not None:
        return cached
    result = compute_summary(month, group_by, person, category_id, bank, db, current_user)
    set_json(cache_key, result, ttl=90)
    return result


@router.get(
    "/monthly-report",
    summary="Get monthly financial report",
    description="Generate a monthly analysis report with income vs expenses, savings rate, top categories, MoM comparison, and LLM-powered insights.",
)
async def get_monthly_report(
    month: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a monthly analysis report with income vs expenses, savings rate, top categories, MoM comparison, trend history, and LLM analysis."""
    return await compute_monthly_report(month=month, db=db, current_user=current_user)


@router.get(
    "/monthly-report/download",
    summary="Download monthly report as HTML",
    description="Download a printable HTML version of the monthly financial report for the specified month.",
)
def download_monthly_report(
    month: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download the monthly report as a printable HTML file."""
    return HTMLResponse(content=monthly_report_download(month, db, current_user))


@router.get(
    "/monthly-reports",
    summary="List monthly reports",
    description="List all generated monthly reports for the current user with their status and generation date.",
)
def list_monthly_reports(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List generated monthly reports for the current user."""
    return _list_monthly_reports(db, current_user)


@router.post(
    "/monthly-reports/generate",
    summary="Generate a monthly report",
    description="Trigger on-demand generation of a monthly report via a background Celery task.",
)
def generate_monthly_report(
    month: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a monthly report on-demand. Dispatches Celery task for async generation."""
    try:
        return request_monthly_report(month, db, current_user)
    except ReportRequestError as exc:
        raise HTTPException(exc.status_code, exc.detail)


@router.get(
    "/monthly-reports/{month}/download",
    summary="Download monthly report as image",
    description="Download a previously generated monthly report as a PNG image (or PDF for legacy reports).",
)
def download_report_image(
    month: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download the monthly report as PNG image."""
    try:
        content, media_type, filename = report_image_payload(month, db, current_user)
    except ReportRequestError as exc:
        raise HTTPException(exc.status_code, exc.detail)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/account-expenses",
    summary="Get account-based expenses",
    description="Retrieve expenses excluding credit card transactions, showing only debit, bank transfer, and cash spending.",
)
def get_account_expenses(
    month: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return account_expenses(month=month, db=db, current_user=current_user)


@router.get(
    "/installments",
    summary="Get installments overview",
    description="Retrieve all installment groups showing paid and remaining installments with next payment dates.",
)
def get_installments_dashboard(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    return installments_overview(db=db, current_user=current_user)


@router.get(
    "/installments/monthly-load",
    summary="Get installments monthly load",
    description="Show a 7-month window of installment payment load (3 past, current, 3 future) including projected amounts.",
)
def get_installments_monthly_load(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    return installments_monthly_load(db=db, current_user=current_user)


@router.get(
    "/scheduled-summary",
    summary="Get scheduled expenses summary",
    description="Retrieve pending scheduled installments and manual scheduled expenses for the next 3 months.",
)
def get_scheduled_summary(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    return scheduled_summary(db=db, current_user=current_user)


@router.get(
    "/credit-card-pasivos",
    summary="Get credit card liabilities",
    description="Calculate total pending credit card liabilities from scheduled expenses and future installment projections.",
)
def get_credit_card_pasivos(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    return credit_card_pasivos(db=db, current_user=current_user)


@router.get(
    "/top-merchants",
    summary="Get top merchants",
    description="Retrieve the top merchants by total spending, with optional month, person, and bank filters.",
)
def get_top_merchants(
    month: str | None = None,
    person: str | None = None,
    bank: str | None = None,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return top_merchants(
        month=month, person=person, bank=bank, limit=limit, db=db, current_user=current_user
    )


@router.get(
    "/card-summary",
    summary="Get card spending summary",
    description="Retrieve spending summary per card and account for the last 12 months, including monthly breakdowns.",
)
def get_card_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return card_summary(db=db, current_user=current_user)


@router.get(
    "/tag-summary",
    summary="Get tag spending summary",
    description="Retrieve spending summary per tag for the last 12 months, including monthly breakdowns. Optional groups filter.",
)
def get_tag_summary(
    groups: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return tag_summary(groups=groups, db=db, current_user=current_user)


@router.get(
    "/card-category-breakdown",
    summary="Get card-category breakdown",
    description="Retrieve a matrix of spending by card and category, useful for stacked bar charts.",
)
def get_card_category_breakdown(
    month: str | None = None,
    bank: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return card_category_breakdown(month=month, bank=bank, db=db, current_user=current_user)


@router.get(
    "/category-trend",
    summary="Get category spending trend",
    description="Retrieve monthly spending trend per category over a configurable number of months.",
)
def get_category_trend(
    months: int = 4,
    anchor_month: str | None = None,
    person: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return category_trend(
        months=months,
        anchor_month=anchor_month,
        person=person,
        db=db,
        current_user=current_user,
    )


@router.get(
    "/ai-trends",
    summary="Get AI spending trends analysis",
    description="Retrieve an LLM-powered analysis of spending trends with projections and actionable insights.",
)
async def get_ai_trends(
    month: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return await ai_trends(month=month, db=db, current_user=current_user)
    except AiTrendsError as exc:
        raise HTTPException(exc.status_code, exc.detail)
