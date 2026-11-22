"""Budget event use cases (#569)."""

import json

from fastapi import HTTPException
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.models import BudgetEvent, Category, Expense
from app.schemas import BudgetEventCreate, BudgetEventResponse, BudgetEventUpdate


def event_response(event: BudgetEvent, categories: list | None = None) -> BudgetEventResponse:
    if categories is None:
        categories = json.loads(event.categories) if event.categories else []
    return BudgetEventResponse(
        id=event.id,
        name=event.name,
        start_date=event.start_date.isoformat(),
        end_date=event.end_date.isoformat(),
        total_amount=event.total_amount,
        spent=event.spent,
        categories=categories,
        is_active=event.is_active,
    )


def list_events(db: Session, user_id: int) -> list[BudgetEventResponse]:
    """List all active budget events for the user."""
    events = (
        db.query(BudgetEvent)
        .filter(BudgetEvent.user_id == user_id, BudgetEvent.is_active == True)
        .all()
    )
    return [event_response(event) for event in events]


def create_event(db: Session, user_id: int, data: BudgetEventCreate) -> BudgetEventResponse:
    """Create a budget event (vacations, etc.)."""
    start = data.start_date
    end = data.end_date

    if end < start:
        raise HTTPException(400, "End date must be after start date")

    event = BudgetEvent(
        user_id=user_id,
        name=data.name,
        start_date=start,
        end_date=end,
        total_amount=data.total_amount,
        categories=json.dumps(data.categories),
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    return event_response(event, data.categories)


def update_event(
    db: Session, event_id: int, user_id: int, data: BudgetEventUpdate
) -> BudgetEventResponse:
    """Update a budget event."""
    event = (
        db.query(BudgetEvent)
        .filter(BudgetEvent.id == event_id, BudgetEvent.user_id == user_id)
        .first()
    )
    if not event:
        raise HTTPException(404, "Budget event not found")

    if data.name is not None:
        event.name = data.name
    if data.total_amount is not None:
        event.total_amount = data.total_amount
    if data.is_active is not None:
        event.is_active = data.is_active

    db.commit()
    db.refresh(event)

    return event_response(event)


def delete_event(db: Session, event_id: int, user_id: int) -> dict:
    """Delete a budget event."""
    event = (
        db.query(BudgetEvent)
        .filter(BudgetEvent.id == event_id, BudgetEvent.user_id == user_id)
        .first()
    )
    if not event:
        raise HTTPException(404, "Budget event not found")

    db.delete(event)
    db.commit()
    return {"ok": True}


def link_expenses(db: Session, event_id: int, user_id: int, expense_ids: list[int]) -> dict:
    """Link expenses to a budget event and update the event's spent amount."""
    event = (
        db.query(BudgetEvent)
        .filter(BudgetEvent.id == event_id, BudgetEvent.user_id == user_id)
        .first()
    )
    if not event:
        raise HTTPException(404, "Budget event not found")

    # Unlink previously linked expenses
    db.query(Expense).filter(
        Expense.budget_event_id == event_id,
        Expense.user_id == user_id,
    ).update({"budget_event_id": None})

    # Link new expenses
    total_spent = 0.0
    for exp_id in expense_ids:
        expense = db.query(Expense).filter(Expense.id == exp_id, Expense.user_id == user_id).first()
        if expense:
            expense.budget_event_id = event_id
            total_spent += abs(expense.amount)

    event.spent = total_spent
    db.commit()

    return {"ok": True, "spent": total_spent}


def event_expenses(db: Session, event_id: int, user_id: int) -> list[dict]:
    """Get expenses linked to a budget event, plus unlinked ones in its date range."""
    event = (
        db.query(BudgetEvent)
        .filter(BudgetEvent.id == event_id, BudgetEvent.user_id == user_id)
        .first()
    )
    if not event:
        raise HTTPException(404, "Budget event not found")

    # Get all expenses in the event's date range
    all_expenses = (
        db.query(Expense)
        .filter(
            Expense.user_id == user_id,
            Expense.date >= event.start_date,
            Expense.date <= event.end_date,
            Expense.is_income == False,
        )
        .order_by(desc(Expense.date))
        .all()
    )

    result = []
    for expense in all_expenses:
        cat = db.query(Category).filter(Category.id == expense.category_id).first()
        result.append(
            {
                "id": expense.id,
                "description": expense.description,
                "amount": expense.amount,
                "date": expense.date.isoformat(),
                "category_name": cat.name if cat else None,
                "linked": expense.budget_event_id == event_id,
            }
        )

    return result
