from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from datetime import datetime
from app.database import get_db
from app.models import Card, User
from app.services.auth import get_current_user
from app.routers.groups import get_group_user_ids

router = APIRouter(prefix="/cards", tags=["cards"])


class CardCreate(BaseModel):
    custom_naming: str
    name: str
    bank: str = ""
    holder: str = ""
    card_type: str = "credito"  # credito, debito


class CardUpdate(BaseModel):
    custom_naming: str | None = None
    name: str | None = None
    bank: str | None = None
    holder: str | None = None
    card_type: str | None = None


class CardResponse(BaseModel):
    id: int
    custom_naming: str
    name: str
    bank: str
    holder: str
    card_type: str
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
    uid_list = get_group_user_ids(current_user.id, db)
    cards = db.query(Card).filter(Card.user_id.in_(uid_list)).all()
    return cards


@router.post("", response_model=CardResponse, status_code=201)
def create_card(
    card: CardCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new card"""
    custom_naming = card.custom_naming.strip()
    name = card.name.strip()
    bank = card.bank.strip() if card.bank else ""

    if not custom_naming:
        raise HTTPException(status_code=400, detail="custom_naming es obligatorio")
    if not name or not bank:
        raise HTTPException(status_code=400, detail="Nombre y banco son obligatorios")

    existing_by_naming = db.query(Card).filter(
        Card.user_id == current_user.id,
        func.lower(func.trim(Card.custom_naming)) == custom_naming.lower(),
    ).first()
    if existing_by_naming:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Ya existe una tarjeta con ese nombre personalizado",
                "existing_id": existing_by_naming.id,
                "existing_custom_naming": existing_by_naming.custom_naming,
            }
        )

    existing_by_fields = db.query(Card).filter(
        Card.user_id == current_user.id,
        func.lower(func.trim(Card.name)) == name.lower(),
        func.lower(func.trim(Card.bank)) == bank.lower(),
        Card.card_type == card.card_type,
    ).first()

    if existing_by_fields:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Ya existe una tarjeta con esos datos",
                "existing_id": existing_by_fields.id,
                "existing_name": existing_by_fields.name,
                "existing_bank": existing_by_fields.bank,
                "existing_card_type": existing_by_fields.card_type,
            }
        )

    db_card = Card(
        custom_naming=custom_naming,
        name=name,
        bank=bank,
        holder=card.holder or "",
        card_type=card.card_type,
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
    db_card = db.query(Card).filter(
        Card.id == card_id,
        Card.user_id == current_user.id,
    ).first()

    if not db_card:
        raise HTTPException(status_code=404, detail="Card not found")

    update_data = card.model_dump(exclude_none=True)

    if "custom_naming" in update_data:
        new_naming = update_data["custom_naming"].strip()
        if not new_naming:
            raise HTTPException(status_code=400, detail="custom_naming no puede estar vacío")
        existing = db.query(Card).filter(
            Card.user_id == current_user.id,
            func.lower(func.trim(Card.custom_naming)) == new_naming.lower(),
            Card.id != card_id,
        ).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Ya existe otra tarjeta con ese nombre personalizado",
                    "existing_id": existing.id,
                    "existing_custom_naming": existing.custom_naming,
                }
            )
        update_data["custom_naming"] = new_naming

    for key, value in update_data.items():
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
    db_card = db.query(Card).filter(
        Card.id == card_id,
        Card.user_id == current_user.id,
    ).first()

    if not db_card:
        raise HTTPException(status_code=404, detail="Card not found")

    # Check if card has expenses
    from app.models import Expense
    has_expenses = db.query(Expense).filter(Expense.card_id == card_id).first()
    if has_expenses:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete card with associated expenses"
        )

    db.delete(db_card)
    db.commit()
    return None


@router.post("/sync-holders")
def sync_card_holders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Sync holders from expenses to cards based on most frequent person per bank+name"""
    from sqlalchemy import func
    from app.models import Expense
    
    cards = db.query(Card).filter(Card.user_id == current_user.id).all()
    updated = 0
    
    for card in cards:
        if card.holder:
            continue
        
        most_common_person = db.query(
            Expense.person,
            func.count(Expense.id).label('cnt')
        ).filter(
            Expense.user_id == current_user.id,
            func.lower(func.trim(Expense.bank)) == (card.bank or '').lower().strip(),
            Expense.card.ilike(f"%{card.name}%"),
            Expense.person.isnot(None),
            Expense.person != ''
        ).group_by(Expense.person).order_by(func.count(Expense.id).desc()).first()
        
        if most_common_person and most_common_person[0]:
            card.holder = most_common_person[0]
            updated += 1
    
    db.commit()
    return {"updated": updated, "total_cards": len(cards)}
