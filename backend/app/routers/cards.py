from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Card, User
from app.routers.groups import get_group_user_ids
from app.services.auth import get_current_user

router = APIRouter(prefix="/cards", tags=["cards"])


def get_first_name(full_name: str) -> str:
    """Extract first name from full_name. 'Perez, Juan' -> 'Juan', 'Juan Perez' -> 'Juan'"""
    if not full_name:
        return ""
    if "," in full_name:
        return full_name.split(",")[1].strip().split()[0] if len(full_name.split(",")) > 1 else ""
    return full_name.strip().split()[0] if full_name.strip() else ""


class CardCreate(BaseModel):
    card_name: str
    bank: str = ""
    holder: str = ""
    card_type: str = "credito"  # credito, debito
    linked_account_id: int | None = None


class CardUpdate(BaseModel):
    card_name: str | None = None
    bank: str | None = None
    holder: str | None = None
    card_type: str | None = None
    linked_account_id: int | None = None


class CardResponse(BaseModel):
    id: int
    card_name: str
    bank: str
    holder: str
    card_type: str
    linked_account_id: int | None = None
    linked_account_name: str | None = None
    user_id: int
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("", response_model=list[CardResponse])
def list_cards(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all cards for the current user and group"""
    from sqlalchemy.orm import joinedload

    uid_list = get_group_user_ids(current_user.id, db)
    cards = (
        db.query(Card)
        .options(joinedload(Card.linked_account))
        .filter(Card.user_id.in_(uid_list))
        .all()
    )
    result = []
    for card in cards:
        card_dict = CardResponse.model_validate(card)
        card_dict.linked_account_name = card.linked_account.name if card.linked_account else None
        result.append(card_dict)
    return result


@router.post("", response_model=CardResponse, status_code=201)
def create_card(
    card: CardCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new card"""
    from app.models import Account

    card_name = card.card_name.strip()
    bank = card.bank.strip() if card.bank else ""

    if not card_name or not bank:
        raise HTTPException(status_code=400, detail="Nombre y banco son obligatorios")

    # Validate linked_account_id if provided
    linked_account_id = None
    if card.linked_account_id is not None:
        account = (
            db.query(Account)
            .filter(
                Account.id == card.linked_account_id,
                Account.user_id == current_user.id,
            )
            .first()
        )
        if not account:
            raise HTTPException(status_code=404, detail="Cuenta no encontrada")
        if account.type != "caja_ahorro":
            raise HTTPException(
                status_code=400,
                detail="Solo se pueden vincular cuentas de tipo Caja de Ahorro",
            )
        if card.card_type != "debito":
            raise HTTPException(
                status_code=400,
                detail="Solo las tarjetas de débito se pueden vincular a una cuenta",
            )
        # Check if account is already linked to another card
        existing_link = (
            db.query(Card).filter(Card.linked_account_id == card.linked_account_id).first()
        )
        if existing_link:
            raise HTTPException(
                status_code=409,
                detail="Esta cuenta ya está vinculada a otra tarjeta",
            )
        linked_account_id = card.linked_account_id

    existing_by_fields = (
        db.query(Card)
        .filter(
            Card.user_id == current_user.id,
            func.lower(func.trim(Card.card_name)) == card_name.lower(),
            func.lower(func.trim(Card.bank)) == bank.lower(),
            Card.card_type == card.card_type,
        )
        .first()
    )

    if existing_by_fields:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Ya existe una tarjeta con esos datos",
                "existing_id": existing_by_fields.id,
                "existing_card_name": existing_by_fields.card_name,
                "existing_bank": existing_by_fields.bank,
                "existing_card_type": existing_by_fields.card_type,
            },
        )

    holder = card.holder.strip() if card.holder else ""
    if not holder:
        holder = get_first_name(current_user.full_name or "")

    db_card = Card(
        card_name=card_name,
        bank=bank,
        holder=holder,
        card_type=card.card_type,
        linked_account_id=linked_account_id,
        user_id=current_user.id,
    )
    db.add(db_card)
    db.commit()
    db.refresh(db_card)
    return db_card


@router.put("/{card_id}", response_model=CardResponse)
def update_card(
    card_id: int,
    card: CardUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a card"""
    from app.models import Account

    db_card = (
        db.query(Card)
        .filter(
            Card.id == card_id,
            Card.user_id == current_user.id,
        )
        .first()
    )

    if not db_card:
        raise HTTPException(status_code=404, detail="Card not found")

    update_data = card.model_dump(exclude_none=True)

    # Validate linked_account_id if being updated
    if "linked_account_id" in update_data:
        linked_id = update_data["linked_account_id"]
        if linked_id is not None:
            account = (
                db.query(Account)
                .filter(
                    Account.id == linked_id,
                    Account.user_id == current_user.id,
                )
                .first()
            )
            if not account:
                raise HTTPException(status_code=404, detail="Cuenta no encontrada")
            if account.type != "caja_ahorro":
                raise HTTPException(
                    status_code=400,
                    detail="Solo se pueden vincular cuentas de tipo Caja de Ahorro",
                )
            card_type = update_data.get("card_type", db_card.card_type)
            if card_type != "debito":
                raise HTTPException(
                    status_code=400,
                    detail="Solo las tarjetas de débito se pueden vincular a una cuenta",
                )
            # Check if account is already linked to another card
            existing_link = (
                db.query(Card)
                .filter(Card.linked_account_id == linked_id, Card.id != card_id)
                .first()
            )
            if existing_link:
                raise HTTPException(
                    status_code=409,
                    detail="Esta cuenta ya está vinculada a otra tarjeta",
                )

    for key, value in update_data.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(db_card, key, value)

    db.commit()
    db.refresh(db_card)
    return db_card


@router.delete("/{card_id}", status_code=204)
def delete_card(
    card_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a card"""
    db_card = (
        db.query(Card)
        .filter(
            Card.id == card_id,
            Card.user_id == current_user.id,
        )
        .first()
    )

    if not db_card:
        raise HTTPException(status_code=404, detail="Card not found")

    # Check if card has expenses
    from app.models import Expense

    has_expenses = (
        db.query(Expense)
        .filter(
            Expense.card_id == card_id,
            Expense.user_id == current_user.id,
        )
        .first()
    )
    if has_expenses:
        raise HTTPException(status_code=400, detail="Cannot delete card with associated expenses")

    db.delete(db_card)
    db.commit()
    return None


@router.post("/sync-holders")
def sync_card_holders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Sync holders: auto-assign holder from user's full_name for cards without one"""
    cards = db.query(Card).filter(Card.user_id == current_user.id).all()
    updated = 0

    for card in cards:
        if card.holder:
            continue

        card.holder = get_first_name(current_user.full_name or "")
        if card.holder:
            updated += 1

    db.commit()
    return {"updated": updated, "total_cards": len(cards)}
