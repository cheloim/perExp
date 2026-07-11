from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account, User
from app.services.auth import get_current_user

router = APIRouter(prefix="/accounts", tags=["accounts"])


class AccountCreate(BaseModel):
    name: str
    type: str = "efectivo"  # efectivo, cuenta_corriente, caja_ahorro, mercadopago, etc


class AccountUpdate(BaseModel):
    name: str | None = None
    type: str | None = None


class AccountResponse(BaseModel):
    id: int
    name: str
    type: str
    linked_card_id: int | None = None
    linked_card_name: str | None = None
    user_id: int
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("", response_model=list[AccountResponse])
def list_accounts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all accounts for the current user"""
    from app.models import Card

    accounts = db.query(Account).filter(Account.user_id == current_user.id).all()
    result = []
    for account in accounts:
        account_dict = AccountResponse.model_validate(account)
        # Find linked card (if any debit card references this account)
        linked_card = db.query(Card).filter(Card.linked_account_id == account.id).first()
        if linked_card:
            account_dict.linked_card_id = linked_card.id
            account_dict.linked_card_name = f"{linked_card.card_name} ({linked_card.bank})"
        result.append(account_dict)
    return result


@router.post("", response_model=AccountResponse, status_code=201)
def create_account(
    account: AccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new account"""
    name = account.name.strip()

    if not name:
        raise HTTPException(status_code=400, detail="El nombre es obligatorio")

    existing = (
        db.query(Account)
        .filter(
            Account.user_id == current_user.id,
            func.lower(func.trim(Account.name)) == name.lower(),
            Account.type == account.type,
        )
        .first()
    )

    if existing:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Ya existe una cuenta con esos datos",
                "existing_id": existing.id,
                "existing_name": existing.name,
                "existing_type": existing.type,
            },
        )

    db_account = Account(
        name=name,
        type=account.type,
        user_id=current_user.id,
    )
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    return db_account


@router.put("/{account_id}", response_model=AccountResponse)
def update_account(
    account_id: int,
    account: AccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update an account"""
    db_account = (
        db.query(Account)
        .filter(
            Account.id == account_id,
            Account.user_id == current_user.id,
        )
        .first()
    )

    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    update_data = account.model_dump(exclude_none=True)
    for key, value in update_data.items():
        setattr(db_account, key, value)

    db.commit()
    db.refresh(db_account)
    return db_account


@router.delete("/{account_id}", status_code=204)
def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete an account"""
    db_account = (
        db.query(Account)
        .filter(
            Account.id == account_id,
            Account.user_id == current_user.id,
        )
        .first()
    )

    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Check if account has expenses
    from app.models import Expense

    has_expenses = db.query(Expense).filter(Expense.account_id == account_id).first()
    if has_expenses:
        raise HTTPException(
            status_code=400, detail="Cannot delete account with associated expenses"
        )

    db.delete(db_account)
    db.commit()
    return None
