"""Admin use cases: monthly report administration."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.admin.common import _audit_admin, require_step_up
from app.database import get_db
from app.models import MonthlyReport, User
from app.services.auth import get_current_admin

router = APIRouter()


@router.get(
    "/reports",
    summary="List monthly reports",
    description="Return monthly reports filtered by user, month, or status.",
)
def get_reports(
    user_id: int | None = None,
    month: str = "",
    status: str = "",
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    query = db.query(MonthlyReport)
    if user_id:
        query = query.filter(MonthlyReport.user_id == user_id)
    if month:
        query = query.filter(MonthlyReport.month == month)
    if status:
        query = query.filter(MonthlyReport.status == status.upper())

    reports = query.order_by(MonthlyReport.created_at.desc()).limit(100).all()

    return {
        "reports": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "user_email": db.query(User.email).filter(User.id == r.user_id).scalar(),
                "month": r.month,
                "status": r.status,
                "error_message": r.error_message,
                "created_at": r.created_at.isoformat() if r.created_at else "",
                "generated_at": r.generated_at.isoformat() if r.generated_at else None,
                "has_png": r.png_data is not None,
            }
            for r in reports
        ]
    }


@router.delete(
    "/reports/{report_id}",
    summary="Delete a report",
    description="Permanently delete a monthly report by its ID.",
)
def delete_report(
    report_id: int,
    request: Request,
    admin: User = Depends(require_step_up),
    db: Session = Depends(get_db),
):
    report = db.get(MonthlyReport, report_id)
    if not report:
        raise HTTPException(404, "Report not found")
    db.delete(report)
    db.commit()
    _audit_admin(db, admin, "admin_delete_report", request, details={"report_id": report_id})
    return {"ok": True}


@router.delete(
    "/reports/user/{user_id}/month/{month}",
    summary="Delete report by user and month",
    description="Delete a specific user's monthly report for a given month.",
)
def delete_report_by_user_month(
    user_id: int,
    month: str,
    request: Request,
    admin: User = Depends(require_step_up),
    db: Session = Depends(get_db),
):
    report = (
        db.query(MonthlyReport)
        .filter(MonthlyReport.user_id == user_id, MonthlyReport.month == month)
        .first()
    )
    if not report:
        raise HTTPException(404, "Report not found")
    db.delete(report)
    db.commit()
    _audit_admin(
        db,
        admin,
        "admin_delete_report",
        request,
        details={"target_user_id": user_id, "month": month},
    )
    return {"ok": True}


class GenerateReportRequest(BaseModel):
    user_id: int
    month: str  # YYYY-MM format


@router.post(
    "/reports/generate",
    summary="Generate a monthly report",
    description="Generate a monthly report for a specific user and month, or regenerate if it failed.",
)
def generate_report(
    body: GenerateReportRequest,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Generate a monthly report for a specific user and month."""
    from app.tasks.monthly_report import generate_single_report

    user = db.get(User, body.user_id)
    if not user:
        raise HTTPException(404, "User not found")

    # Check if report already exists
    existing = (
        db.query(MonthlyReport)
        .filter(MonthlyReport.user_id == body.user_id, MonthlyReport.month == body.month)
        .first()
    )
    if existing:
        if existing.status == "READY":
            raise HTTPException(400, "Report already exists and is ready")
        # If failed or pending, delete and regenerate
        db.delete(existing)
        db.commit()

    # Create pending report
    report = MonthlyReport(
        user_id=body.user_id,
        month=body.month,
        status="PENDING",
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    # Enqueue generation task
    generate_single_report.delay(body.user_id, body.month)

    return {"ok": True, "report_id": report.id, "status": "PENDING"}


@router.post(
    "/reports/generate-all",
    summary="Generate reports for all users",
    description="Enqueue monthly report generation for every active user for a given month.",
)
def generate_all_reports(
    month: str,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Generate monthly reports for ALL active users for a given month."""
    from app.tasks.monthly_report import generate_single_report

    users = db.query(User).filter(User.is_active == True).all()
    created = 0

    for user in users:
        existing = (
            db.query(MonthlyReport)
            .filter(MonthlyReport.user_id == user.id, MonthlyReport.month == month)
            .first()
        )
        if existing:
            continue

        report = MonthlyReport(
            user_id=user.id,
            month=month,
            status="PENDING",
        )
        db.add(report)
        db.flush()
        generate_single_report.delay(user.id, month)
        created += 1

    db.commit()
    return {"ok": True, "created": created, "month": month}
