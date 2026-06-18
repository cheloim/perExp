"""
Seed script to populate the database with realistic demo data for visualization.
Run from the backend directory: python -m app.seed_demo_data [user_id]
"""

import random
import uuid
import sys
from datetime import date, timedelta
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Expense, Card, Account, Category, User, ScheduledExpense
from app.seed import _apply_base_hierarchy_for_user


def get_or_create_demo_user(db: Session) -> User:
    """Get the first user or create a demo user."""
    user = db.query(User).first()
    if not user:
        user = User(
            full_name="Demo, Usuario",
            email="demo@example.com",
            hashed_password="demo",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def get_or_create_cards(db: Session, user_id: int) -> list[Card]:
    """Get existing cards or create demo cards."""
    cards = db.query(Card).filter(Card.user_id == user_id).all()
    if cards:
        return cards

    demo_cards = [
        {"card_name": "Visa", "bank": "Galicia", "card_type": "credito", "holder": "Usuario"},
        {"card_name": "Mastercard", "bank": "Santander", "card_type": "credito", "holder": "Usuario"},
        {"card_name": "Visa Débito", "bank": "Galicia", "card_type": "debito", "holder": "Usuario"},
    ]
    for card_data in demo_cards:
        card = Card(user_id=user_id, **card_data)
        db.add(card)
    db.commit()
    return db.query(Card).filter(Card.user_id == user_id).all()


def get_or_create_accounts(db: Session, user_id: int) -> list[Account]:
    """Get existing accounts or create demo accounts."""
    accounts = db.query(Account).filter(Account.user_id == user_id).all()
    if accounts:
        return accounts

    demo_accounts = [
        {"name": "Efectivo", "type": "efectivo"},
        {"name": "MercadoPago", "type": "mercadopago"},
        {"name": "Caja de Ahorro Galicia", "type": "caja_ahorro"},
    ]
    for acc_data in demo_accounts:
        account = Account(user_id=user_id, **acc_data)
        db.add(account)
    db.commit()
    return db.query(Account).filter(Account.user_id == user_id).all()


def get_categories(db: Session, user_id: int) -> dict[str, Category]:
    """Get categories by name for the user. Creates them if they don't exist."""
    cats = db.query(Category).filter(
        (Category.user_id == user_id) | (Category.user_id.is_(None))
    ).all()

    if not cats:
        print(f"No categories found for user {user_id}. Creating base hierarchy...")
        _apply_base_hierarchy_for_user(db, user_id)
        db.commit()
        cats = db.query(Category).filter(
            (Category.user_id == user_id) | (Category.user_id.is_(None))
        ).all()

    return {c.name: c for c in cats}


def seed_demo_expenses(db: Session, user_id: int):
    """Create realistic demo expenses for the current and previous months."""
    # Delete existing demo expenses (those without installment_group_id)
    existing = db.query(Expense).filter(
        Expense.user_id == user_id,
        Expense.installment_group_id.is_(None),
    ).count()
    if existing > 0:
        print(f"Deleting {existing} existing non-installment expenses...")
        db.query(Expense).filter(
            Expense.user_id == user_id,
            Expense.installment_group_id.is_(None),
        ).delete()
        db.commit()

    cards = get_or_create_cards(db, user_id)
    accounts = get_or_create_accounts(db, user_id)
    categories = get_categories(db, user_id)

    # Map card names to card objects
    card_map = {c.card_name: c for c in cards}
    account_map = {a.name: a for a in accounts}

    today = date.today()
    current_month_start = today.replace(day=1)
    prev_month_start = (current_month_start - timedelta(days=1)).replace(day=1)

    # Demo expenses data — category names must match seed.py BASE_HIERARCHY exactly
    demo_expenses = [
        # Supermercado
        {"desc": "COTO", "amount": 28500, "category": "Supermercado", "card": "Visa", "bank": "Galicia", "person": "Usuario"},
        {"desc": "CARREFOUR", "amount": 35200, "category": "Supermercado", "card": "Mastercard", "bank": "Santander", "person": "Usuario"},
        {"desc": "DIA", "amount": 12800, "category": "Supermercado", "card": "Visa Débito", "bank": "Galicia", "person": "Usuario"},
        {"desc": "DISCO", "amount": 41500, "category": "Supermercado", "card": "Visa", "bank": "Galicia", "person": "Usuario"},
        # Restaurantes
        {"desc": "MCDONALDS", "amount": 8500, "category": "Restaurantes", "card": "Visa", "bank": "Galicia", "person": "Usuario"},
        {"desc": "BURGER KING", "amount": 7200, "category": "Restaurantes", "card": "Mastercard", "bank": "Santander", "person": "Usuario"},
        {"desc": "LA PAROLACCIA", "amount": 22000, "category": "Restaurantes", "card": "Visa", "bank": "Galicia", "person": "Usuario"},
        # Delivery
        {"desc": "RAPPI", "amount": 15600, "category": "Delivery", "card": "Visa", "bank": "Galicia", "person": "Usuario"},
        {"desc": "PEDIDOSYA", "amount": 12300, "category": "Delivery", "card": "Mastercard", "bank": "Santander", "person": "Usuario"},
        # Combustible
        {"desc": "YPF", "amount": 32000, "category": "Combustible", "card": "Visa Débito", "bank": "Galicia", "person": "Usuario"},
        {"desc": "SHELL", "amount": 28500, "category": "Combustible", "card": "Visa", "bank": "Galicia", "person": "Usuario"},
        # Transporte Público
        {"desc": "SUBE RECARGA", "amount": 5000, "category": "Transporte Público", "account": "MercadoPago", "person": "Usuario"},
        # Streaming
        {"desc": "NETFLIX", "amount": 6990, "category": "Streaming", "card": "Visa", "bank": "Galicia", "person": "Usuario"},
        {"desc": "SPOTIFY", "amount": 3490, "category": "Streaming", "card": "Mastercard", "bank": "Santander", "person": "Usuario"},
        {"desc": "DISNEY+", "amount": 8990, "category": "Streaming", "card": "Visa", "bank": "Galicia", "person": "Usuario"},
        # Electricidad & Gas
        {"desc": "EDENOR", "amount": 18500, "category": "Electricidad & Gas", "account": "MercadoPago", "person": "Usuario"},
        {"desc": "METROGAS", "amount": 8200, "category": "Electricidad & Gas", "account": "MercadoPago", "person": "Usuario"},
        # Internet & Cable
        {"desc": "FIBERTEL", "amount": 12800, "category": "Internet & Cable", "account": "Caja de Ahorro Galicia", "person": "Usuario"},
        # Farmacia
        {"desc": "FARMACITY", "amount": 15600, "category": "Farmacia", "card": "Visa", "bank": "Galicia", "person": "Usuario"},
        # Prepaga
        {"desc": "SWISS MEDICAL", "amount": 45000, "category": "Prepaga", "account": "Caja de Ahorro Galicia", "person": "Usuario"},
        # Ropa
        {"desc": "ZARA", "amount": 38900, "category": "Ropa", "card": "Mastercard", "bank": "Santander", "person": "Usuario"},
        # Supermercado (más)
        {"desc": "COTO", "amount": 19800, "category": "Supermercado", "card": "Visa", "bank": "Galicia", "person": "Usuario"},
        {"desc": "CARREFOUR", "amount": 27400, "category": "Supermercado", "card": "Visa", "bank": "Galicia", "person": "Usuario"},
        # Almacén/Kiosco
        {"desc": "ALMACEN DON PEPE", "amount": 8500, "category": "Almacén/Kiosco", "account": "Efectivo", "person": "Usuario"},
        {"desc": "KIOSCO EL RINCON", "amount": 3200, "category": "Almacén/Kiosco", "account": "Efectivo", "person": "Usuario"},
        # Cine & Salidas
        {"desc": "CINE HOYTS", "amount": 8900, "category": "Cine & Salidas", "card": "Mastercard", "bank": "Santander", "person": "Usuario"},
        # Librería & Libros
        {"desc": "LIBRERIA EL ATENEO", "amount": 15800, "category": "Librería & Libros", "card": "Visa", "bank": "Galicia", "person": "Usuario"},
        # Taxi/Remis
        {"desc": "UBER", "amount": 4500, "category": "Taxi/Remis", "card": "Visa", "bank": "Galicia", "person": "Usuario"},
        {"desc": "CABIFY", "amount": 6200, "category": "Taxi/Remis", "card": "Mastercard", "bank": "Santander", "person": "Usuario"},
    ]

    # Create expenses for current month (spread across the month)
    days_in_month = (today - current_month_start).days + 1
    for exp_data in demo_expenses:
        cat = categories.get(exp_data["category"])
        random_day = random.randint(1, min(days_in_month, 28))
        exp_date = current_month_start + timedelta(days=random_day - 1)

        expense = Expense(
            date=exp_date,
            description=exp_data["desc"],
            amount=exp_data["amount"],
            category_id=cat.id if cat else None,
            card=exp_data.get("card", ""),
            bank=exp_data.get("bank", ""),
            person=exp_data.get("person", ""),
            currency="ARS",
            user_id=user_id,
            is_income=False,
        )

        # Set card_id or account_id
        if "card" in exp_data and exp_data["card"] in card_map:
            expense.card_id = card_map[exp_data["card"]].id
        elif "account" in exp_data and exp_data["account"] in account_map:
            expense.account_id = account_map[exp_data["account"]].id

        db.add(expense)

    db.commit()
    print(f"Created {len(demo_expenses)} expenses for current month")


def seed_demo_installments(db: Session, user_id: int):
    """Create demo installment purchases."""
    existing = db.query(Expense).filter(
        Expense.user_id == user_id,
        Expense.installment_group_id.isnot(None),
    ).count()
    if existing > 0:
        print(f"Deleting {existing} existing installment expenses...")
        db.query(Expense).filter(
            Expense.user_id == user_id,
            Expense.installment_group_id.isnot(None),
        ).delete()
        # Also delete scheduled expenses
        db.query(ScheduledExpense).filter(
            ScheduledExpense.user_id == user_id,
        ).delete()
        db.commit()

    cards = get_or_create_cards(db, user_id)
    categories = get_categories(db, user_id)
    card_map = {c.card_name: c for c in cards}

    today = date.today()
    current_month_start = today.replace(day=1)

    # Installment purchases — category names must match seed.py BASE_HIERARCHY
    installment_purchases = [
        {
            "desc": "SAMSUNG GALAXY S24",
            "total_amount": 1200000,
            "installments": 12,
            "category": None,  # No matching category for electronics
            "card": "Visa",
            "bank": "Galicia",
            "start_month_offset": -3,
        },
        {
            "desc": "SILLON BELGRANO",
            "amount": 85000,
            "installments": 6,
            "category": "Expensas",  # Hogar → closest match
            "card": "Mastercard",
            "bank": "Santander",
            "start_month_offset": -2,
        },
        {
            "desc": "IPHONE 15 PRO",
            "total_amount": 1800000,
            "installments": 18,
            "category": None,  # No matching category for electronics
            "card": "Visa",
            "bank": "Galicia",
            "start_month_offset": -5,
        },
        {
            "desc": "VIAJE BARILOCHE",
            "total_amount": 450000,
            "installments": 6,
            "category": "Viajes",
            "card": "Mastercard",
            "bank": "Santander",
            "start_month_offset": -1,
        },
        {
            "desc": "NOTEBOOK LENOVO",
            "total_amount": 980000,
            "installments": 12,
            "category": None,  # No matching category for electronics
            "card": "Visa",
            "bank": "Galicia",
            "start_month_offset": -4,
        },
    ]

    for purchase in installment_purchases:
        group_id = str(uuid.uuid4())
        total = purchase.get("total_amount", purchase.get("amount", 0) * purchase["installments"])
        installment_amount = total / purchase["installments"]
        cat = categories.get(purchase["category"]) if purchase.get("category") else None
        card = card_map.get(purchase["card"])
        start_date = current_month_start + timedelta(days=purchase["start_month_offset"] * 30)

        for i in range(purchase["installments"]):
            exp_date = start_date + timedelta(days=i * 30)
            if exp_date > today + timedelta(days=90):  # Don't create too far in the future
                break

            expense = Expense(
                date=exp_date,
                description=purchase["desc"],
                amount=installment_amount,
                category_id=cat.id if cat else None,
                card=purchase["card"],
                bank=purchase["bank"],
                person="Usuario",
                currency="ARS",
                installment_number=i + 1,
                installment_total=purchase["installments"],
                installment_group_id=group_id,
                user_id=user_id,
                card_id=card.id if card else None,
                is_income=False,
            )
            db.add(expense)

            # Create corresponding ScheduledExpense
            scheduled = ScheduledExpense(
                installment_group_id=group_id,
                installment_number=i + 1,
                installment_total=purchase["installments"],
                scheduled_date=exp_date,
                amount=installment_amount,
                currency="ARS",
                description=purchase["desc"],
                card=purchase["card"],
                bank=purchase["bank"],
                person="Usuario",
                card_id=card.id if card else None,
                category_id=cat.id if cat else None,
                status="EXECUTED" if exp_date < today else "PENDING",
                user_id=user_id,
            )
            db.add(scheduled)

    db.commit()
    print(f"Created {len(installment_purchases)} installment purchases")


def main():
    import sys
    db = SessionLocal()
    try:
        # List all users
        users = db.query(User).all()
        if not users:
            print("No users found. Please create a user first.")
            return

        print("Available users:")
        for u in users:
            print(f"  id={u.id}: {u.full_name} ({u.email})")

        # Use specified user_id or first user
        target_id = int(sys.argv[1]) if len(sys.argv) > 1 else users[0].id
        user = db.get(User, target_id)
        if not user:
            print(f"User id={target_id} not found!")
            return

        print(f"\nSeeding data for: {user.full_name} (id={user.id})")

        # Show categories available
        cats = get_categories(db, user.id)
        print(f"Found {len(cats)} categories: {', '.join(list(cats.keys())[:10])}...")

        get_or_create_cards(db, user.id)
        get_or_create_accounts(db, user.id)

        seed_demo_expenses(db, user.id)
        seed_demo_installments(db, user.id)

        # Count final state
        expense_count = db.query(Expense).filter(Expense.user_id == user.id).count()
        card_count = db.query(Card).filter(Card.user_id == user.id).count()
        account_count = db.query(Account).filter(Account.user_id == user.id).count()
        scheduled_count = db.query(ScheduledExpense).filter(ScheduledExpense.user_id == user.id).count()

        print(f"\nDone! Final state:")
        print(f"  - {expense_count} expenses")
        print(f"  - {scheduled_count} scheduled expenses")
        print(f"  - {card_count} cards")
        print(f"  - {account_count} accounts")
    finally:
        db.close()


if __name__ == "__main__":
    main()
