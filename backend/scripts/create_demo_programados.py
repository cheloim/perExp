"""Create demo data for Programados page visualization."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date, timedelta
from app.database import SessionLocal
from app.models import RecurringExpense, User


def create_demo():
    db = SessionLocal()
    try:
        # Get first active user
        user = db.query(User).filter(User.is_active == True).first()
        if not user:
            print("❌ No active user found")
            return

        print(f"Creating demo data for user: {user.email}")

        # Check if demo data already exists
        existing = (
            db.query(RecurringExpense)
            .filter(
                RecurringExpense.user_id == user.id,
                RecurringExpense.merchant_key.in_(
                    ["NETFLIX", "SPOTIFY", "GYM", "AMAZON_PRIME", "OPENAI"]
                ),
            )
            .count()
        )

        if existing > 0:
            print(f"✅ Demo data already exists ({existing} records)")
            return

        demo_data = [
            {
                "merchant_key": "NETFLIX",
                "description": "Netflix",
                "amount": 5000.0,
                "category_id": 351,
                "frequency": "monthly",
                "next_charge_date": date.today() + timedelta(days=5),
            },
            {
                "merchant_key": "SPOTIFY",
                "description": "Spotify",
                "amount": 2500.0,
                "category_id": 351,
                "frequency": "monthly",
                "next_charge_date": date.today() + timedelta(days=10),
            },
            {
                "merchant_key": "GYM",
                "description": "Gimnasio",
                "amount": 8000.0,
                "category_id": 356,
                "frequency": "monthly",
                "next_charge_date": date.today() + timedelta(days=3),
            },
            {
                "merchant_key": "AMAZON_PRIME",
                "description": "Amazon Prime",
                "amount": 1500.0,
                "category_id": 351,
                "frequency": "monthly",
                "next_charge_date": date.today() + timedelta(days=15),
            },
            {
                "merchant_key": "OPENAI",
                "description": "OpenAI ChatGPT",
                "amount": 20000.0,
                "category_id": 351,
                "frequency": "monthly",
                "next_charge_date": date.today() + timedelta(days=8),
            },
        ]

        created = 0
        for item in demo_data:
            rec = RecurringExpense(
                user_id=user.id,
                merchant_key=item["merchant_key"],
                description=item["description"],
                amount=item["amount"],
                category_id=item["category_id"],
                frequency=item["frequency"],
                next_charge_date=item["next_charge_date"],
                is_active=True,
            )
            db.add(rec)
            created += 1

        db.commit()
        print(f"✅ Created {created} demo recurring expenses")

        # Show summary
        print("\nDemo data summary:")
        for item in demo_data:
            print(
                f"  • {item['merchant_key']}: ${item['amount']:,.0f}/mes - Próx: {item['next_charge_date']}"
            )

    finally:
        db.close()


if __name__ == "__main__":
    create_demo()
