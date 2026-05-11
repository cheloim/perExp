#!/usr/bin/env python3
"""
Create test data for income verification
"""
from datetime import date
from app.database import SessionLocal
from app.models import User, Account, Expense, Category
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def main():
    db = SessionLocal()
    try:
        print("=== Creating Test Data ===\n")

        # 1. Get or create user
        user = db.query(User).first()
        if not user:
            print("Creating test user...")
            # Use a simple password that won't exceed bcrypt limits
            hashed = pwd_context.hash("test")
            user = User(
                dni="12345678",
                full_name="Test User",
                email="test@example.com",
                hashed_password=hashed,
                is_active=True
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"✓ User created: {user.email} (ID: {user.id})")
        else:
            print(f"✓ Using existing user: {user.email} (ID: {user.id})")

        # 2. Get or create "Haberes" account
        account = db.query(Account).filter(
            Account.user_id == user.id,
            Account.name == "Haberes"
        ).first()

        if not account:
            print("\nCreating 'Haberes' account...")
            account = Account(
                name="Haberes",
                type="cuenta_corriente",
                user_id=user.id
            )
            db.add(account)
            db.commit()
            db.refresh(account)
            print(f"✓ Account created: {account.name} (ID: {account.id})")
        else:
            print(f"\n✓ Using existing account: {account.name} (ID: {account.id})")

        # 3. Get "Haberes" category (child of "Ingresos")
        ingresos_parent = db.query(Category).filter(
            Category.name == "Ingresos",
            Category.parent_id.is_(None)
        ).first()

        haberes_cat = None
        if ingresos_parent:
            haberes_cat = db.query(Category).filter(
                Category.name == "Haberes",
                Category.parent_id == ingresos_parent.id
            ).first()
            print(f"\n✓ Found category: Ingresos → Haberes (ID: {haberes_cat.id if haberes_cat else 'NOT FOUND'})")
        else:
            print("\n⚠️  'Ingresos' parent category not found")

        # 4. Create test income transaction
        print("\nCreating test income transaction...")
        income = Expense(
            date=date(2026, 5, 11),
            description="Cobro Mayo - Test",
            amount=50000.00,  # Positive amount
            currency="ARS",
            category_id=haberes_cat.id if haberes_cat else None,
            is_income=True,  # Explicitly mark as income
            account_id=account.id,
            card="",
            bank="",
            person="",
            notes="Test income transaction",
            user_id=user.id
        )
        db.add(income)
        db.commit()
        db.refresh(income)
        print(f"✓ Income created: {income.description} | ${income.amount:,.2f} | is_income={income.is_income}")

        # 5. Get a regular expense category
        supermercado_cat = db.query(Category).filter(
            Category.name == "Supermercado"
        ).first()

        # 6. Create test expense transaction
        print("\nCreating test expense transaction...")
        expense = Expense(
            date=date(2026, 5, 10),
            description="Compra Supermercado - Test",
            amount=5000.00,  # Positive amount
            currency="ARS",
            category_id=supermercado_cat.id if supermercado_cat else None,
            is_income=False,  # Regular expense
            card="Tarjeta Test",
            bank="Banco Test",
            person="Test Holder",
            notes="Test expense transaction",
            user_id=user.id
        )
        db.add(expense)
        db.commit()
        db.refresh(expense)
        print(f"✓ Expense created: {expense.description} | ${expense.amount:,.2f} | is_income={expense.is_income}")

        # 7. Verify separation
        print("\n=== Verification ===")
        income_count = db.query(Expense).filter(
            Expense.user_id == user.id,
            Expense.is_income == True
        ).count()
        expense_count = db.query(Expense).filter(
            Expense.user_id == user.id,
            Expense.is_income == False
        ).count()

        print(f"Total income entries: {income_count}")
        print(f"Total expense entries: {expense_count}")

        print("\n✅ Test data created successfully!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    main()
