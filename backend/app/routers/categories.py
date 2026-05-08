from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Category, Expense, User
from app.schemas import CategoryCreate, CategoryResponse
from app.seed import _apply_base_hierarchy_for_user
from app.services.auth import get_current_user

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=List[CategoryResponse])
def get_categories(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Category).filter(Category.user_id == current_user.id).all()


@router.post("", response_model=CategoryResponse)
def create_category(cat: CategoryCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if db.query(Category).filter(Category.name == cat.name, Category.user_id == current_user.id).first():
        raise HTTPException(400, "Ya existe una categoría con ese nombre")
    db_cat = Category(**cat.model_dump(), user_id=current_user.id)
    db.add(db_cat)
    db.commit()
    db.refresh(db_cat)
    return db_cat


@router.put("/{cat_id}", response_model=CategoryResponse)
def update_category(cat_id: int, cat: CategoryCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_cat = db.query(Category).filter(Category.id == cat_id, Category.user_id == current_user.id).first()
    if not db_cat:
        raise HTTPException(404, "Categoría no encontrada")
    for k, v in cat.model_dump().items():
        setattr(db_cat, k, v)
    db.commit()
    db.refresh(db_cat)
    return db_cat


@router.delete("/{cat_id}")
def delete_category(cat_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_cat = db.query(Category).filter(Category.id == cat_id, Category.user_id == current_user.id).first()
    if not db_cat:
        raise HTTPException(404, "Categoría no encontrada")
    children = db.query(Category).filter(Category.parent_id == cat_id).all()
    if children:
        raise HTTPException(400, f"No se puede eliminar: tiene {len(children)} subcategorías. Elimínalas primero.")
    db.query(Expense).filter(Expense.category_id == cat_id).update({"category_id": None})
    db.delete(db_cat)
    db.commit()
    return {"ok": True}


@router.post("/apply-base-hierarchy")
def apply_base_hierarchy(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _apply_base_hierarchy_for_user(db, current_user.id)


@router.post("/seed-defaults")
def seed_default_categories(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _apply_base_hierarchy_for_user(db, current_user.id)