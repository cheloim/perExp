#!/usr/bin/env python3
"""Generate dummy data for user_id=10 (Marcelo) for July and August 2026."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load SECRET_KEY from file if not in environment
if not os.getenv("SECRET_KEY"):
    secret_file = "/run/secrets/creditcard_backend_dev_secret_key"
    if os.path.exists(secret_file):
        with open(secret_file) as f:
            os.environ["SECRET_KEY"] = f.read().strip()

from datetime import date, datetime

from app.database import SessionLocal
from app.models import Account, Card, Category, Expense, RecurringExpense, ScheduledExpense, User


def get_or_create_category(db, user_id, name, color="#3584e4", budget_group="necesidades"):
    cat = db.query(Category).filter(Category.user_id == user_id, Category.name == name).first()
    if not cat:
        cat = Category(name=name, color=color, user_id=user_id, budget_group=budget_group)
        db.add(cat)
        db.flush()
    return cat


def main():
    db = SessionLocal()

    # Find Marcelo's user
    user = db.query(User).filter(User.email == "mmendoza0989@gmail.com").first()
    if not user:
        print("ERROR: User mmendoza0989@gmail.com not found")
        db.close()
        return

    uid = user.id
    print(f"Generating dummy data for user {uid} ({user.email})")

    # Get or create categories
    cat_super = get_or_create_category(db, uid, "Supermercado", "#3584e4", "necesidades")
    cat_resto = get_or_create_category(db, uid, "Restaurantes", "#e66100", "gustos")
    cat_trans = get_or_create_category(db, uid, "Transporte", "#33d17a", "necesidades")
    cat_salud = get_or_create_category(db, uid, "Salud", "#e01b24", "necesidades")
    cat_entre = get_or_create_category(db, uid, "Entretenimiento", "#9141ac", "gustos")
    cat_hogar = get_or_create_category(db, uid, "Hogar", "#8ff0a4", "necesidades")
    cat_subs = get_or_create_category(db, uid, "Suscripciones", "#62a0ea", "gustos")
    cat_compras = get_or_create_category(db, uid, "Compras", "#ff7800", "gustos")
    cat_cuotas = get_or_create_category(db, uid, "Cuotas", "#f5c211", "necesidades")

    # Get first card and account
    card = db.query(Card).filter(Card.user_id == uid).first()
    account = db.query(Account).filter(Account.user_id == uid).first()
    card_id = card.id if card else None
    account_id = account.id if account else None

    # Clean existing data for this user
    db.query(Expense).filter(Expense.user_id == uid).delete()
    db.query(ScheduledExpense).filter(ScheduledExpense.user_id == uid).delete()
    db.query(RecurringExpense).filter(RecurringExpense.user_id == uid).delete()
    db.commit()
    print("Cleaned existing data")

    # Create recurring subscriptions
    recurring_data = [
        ("NETFLIX", "Netflix Premium", 6990, "monthly"),
        ("SPOTIFY", "Spotify Familiar", 3990, "monthly"),
        ("SMARTFIT", "SmartFit Gym", 15990, "monthly"),
        ("GOOGLE", "Google One 100GB", 3990, "monthly"),
        ("YOUTUBE", "YouTube Premium", 5990, "monthly"),
        ("APPLE", "iCloud 200GB", 1990, "monthly"),
        ("AMAZON", "Amazon Prime", 14990, "yearly"),
        ("MICROSOFT", "Microsoft 365", 12990, "yearly"),
    ]

    recurring_map = {}
    for mkey, desc, amt, freq in recurring_data:
        rec = RecurringExpense(
            user_id=uid,
            merchant_key=mkey,
            description=desc,
            amount=amt,
            frequency=freq,
            next_charge_date=date(2026, 8, 15),
            is_active=True,
            source="manual",
            category_id=cat_subs.id,
            card_id=card_id,
        )
        db.add(rec)
        db.flush()
        recurring_map[mkey] = rec
    db.commit()
    print(f"Created {len(recurring_data)} recurring subscriptions")

    # Generate data for July and August
    months = [
        (2026, 7, [
            # (date, description, amount, category, is_recurring_key)
            (1, "Sueldo Julio", 485000, None, True),  # income
            (1, "Supermercado Jumbo", 42350, cat_super, None),
            (2, "Uber Palermo", 2800, cat_trans, None),
            (2, "Cafe Tortoni", 1200, cat_resto, None),
            (3, "YPF Nafta V-Power", 25000, cat_trans, None),
            (3, "Netflix Premium", 6990, cat_subs, "NETFLIX"),
            (4, "Mercado Libre Auriculares", 34900, cat_compras, None),
            (5, "Rappi McDonalds", 8500, cat_resto, None),
            (5, "Spotify Familiar", 3990, cat_subs, "SPOTIFY"),
            (6, "Farmacity", 6700, cat_salud, None),
            (7, "Supermercado Disco", 38200, cat_super, None),
            (8, "Subte SUBE", 2000, cat_trans, None),
            (9, "Restaurante Parolaccia", 15800, cat_resto, None),
            (10, "SmartFit Gym", 15990, cat_subs, "SMARTFIT"),
            (10, "Shell Nafta", 22000, cat_trans, None),
            (11, "Libreria Yenny", 4500, cat_compras, None),
            (12, "Cine Hoyts", 5600, cat_entre, None),
            (13, "Supermercado Coto", 29800, cat_super, None),
            (14, "Kiosco", 1800, cat_entre, None),
            (15, "Uber Eats Sushi", 12300, cat_resto, None),
            (15, "Google One 100GB", 3990, cat_subs, "GOOGLE"),
            (16, "Garage", 3500, cat_trans, None),
            (17, "Supermercado Dia", 18900, cat_super, None),
            (18, "Peluqueria", 4500, cat_salud, None),
            (19, "YPF Nafta", 21000, cat_trans, None),
            (20, "Restaurante Osaka", 28500, cat_resto, None),
            (20, "YouTube Premium", 5990, cat_subs, "YOUTUBE"),
            (21, "Supermercado Jumbo", 35600, cat_super, None),
            (22, "Mercado Libre Funda", 8900, cat_compras, None),
            (23, "Uber", 3200, cat_trans, None),
            (24, "Farmacity", 11200, cat_salud, None),
            (25, "Bar Notero", 7800, cat_entre, None),
            (26, "Supermercado Disco", 41200, cat_super, None),
            (27, "Shell Nafta", 23500, cat_trans, None),
            (28, "Rappi Pizza", 9200, cat_resto, None),
            (29, "Libreria Ateneo", 6700, cat_compras, None),
            (30, "Supermercado Coto", 27300, cat_super, None),
            (31, "Alquiler", 135000, cat_hogar, None),
            (31, "Expensas", 42000, cat_hogar, None),
        ]),
        (2026, 8, [
            (1, "Sueldo Agosto", 485000, None, True),  # income
            (1, "Supermercado Jumbo", 38900, cat_super, None),
            (2, "Uber Microcentro", 3100, cat_trans, None),
            (3, "Netflix Premium", 6990, cat_subs, "NETFLIX"),
            (3, "YPF Nafta", 24000, cat_trans, None),
            (4, "Rappi Burger King", 7800, cat_resto, None),
            (5, "Spotify Familiar", 3990, cat_subs, "SPOTIFY"),
            (5, "Supermercado Disco", 35600, cat_super, None),
            (6, "Farmacity", 8900, cat_salud, None),
            (7, "Cafe Martinez", 1500, cat_resto, None),
            (8, "Mercado Libre Mochila", 28900, cat_compras, None),
            (9, "Subte SUBE", 2000, cat_trans, None),
            (10, "SmartFit Gym", 15990, cat_subs, "SMARTFIT"),
            (10, "Restaurante La Parolaccia", 14200, cat_resto, None),
            (11, "Shell Nafta", 22500, cat_trans, None),
            (12, "Supermercado Coto", 31200, cat_super, None),
            (13, "Cine Hoyts", 5600, cat_entre, None),
            (14, "iCloud 200GB", 1990, cat_subs, "APPLE"),
            (15, "Google One 100GB", 3990, cat_subs, "GOOGLE"),
            (15, "Uber Eats Pizza", 11200, cat_resto, None),
            (16, "Supermercado Dia", 22100, cat_super, None),
            (17, "YPF Nafta", 19800, cat_trans, None),
            (18, "Farmacity", 7400, cat_salud, None),
            (19, "Bar Notero", 6200, cat_entre, None),
            (20, "YouTube Premium", 5990, cat_subs, "YOUTUBE"),
            (20, "Supermercado Jumbo", 29800, cat_super, None),
            (21, "Mercado Libre Auriculares", 15900, cat_compras, None),
            (22, "Uber", 2900, cat_trans, None),
            (23, "Restaurante Osaka", 24500, cat_resto, None),
            (24, "Supermercado Disco", 33400, cat_super, None),
            (25, "Shell Nafta", 21000, cat_trans, None),
            (26, "Kiosco", 2200, cat_entre, None),
            (27, "Rappi Milanesa", 8900, cat_resto, None),
            (28, "Supermercado Coto", 26700, cat_super, None),
            (29, "Peluqueria", 4500, cat_salud, None),
            (30, "Libreria Ateneo", 5200, cat_compras, None),
            (31, "Alquiler", 135000, cat_hogar, None),
            (31, "Expensas", 42000, cat_hogar, None),
        ]),
    ]

    total_expenses = 0
    total_recurring = 0
    for year, month, entries in months:
        for day, desc, amount, cat, recurring_key in entries:
            is_income = cat is None and amount > 100000
            rec_id = None
            if recurring_key:
                rec = recurring_map.get(recurring_key)
                if rec:
                    rec_id = rec.id
                    total_recurring += 1

            expense = Expense(
                date=date(year, month, day),
                description=desc,
                amount=amount,
                user_id=uid,
                category_id=cat.id if cat else None,
                card_id=card_id,
                account_id=account_id,
                is_income=is_income,
                currency="ARS",
                recurring_expense_id=rec_id,
            )
            db.add(expense)
            total_expenses += 1

        db.commit()
        print(f"Created expenses for {year}-{month:02d}")

    # Create installments executed in July
    installments_july = [
        ("2026-07-05", "iPhone 16 4/12", 18500, "iph-001", 4, 12),
        ("2026-07-10", "MacBook Air 2/6", 28900, "mac-001", 2, 6),
        ("2026-07-15", "Viaje Bariloche 3/10", 15200, "via-001", 3, 10),
        ("2026-07-20", "Smart TV 5/6", 12800, "tv-001", 5, 6),
        ("2026-07-25", "Lavarropas 1/12", 8900, "lav-001", 1, 12),
    ]

    for dt_str, desc, amt, grp, num, total in installments_july:
        dt = datetime.strptime(dt_str, "%Y-%m-%d").date()
        sched = ScheduledExpense(
            installment_group_id=grp,
            installment_number=num,
            installment_total=total,
            scheduled_date=dt,
            amount=amt,
            description=desc,
            status="EXECUTED",
            executed_at=datetime(dt.year, dt.month, dt.day, 10, 0),
            user_id=uid,
            category_id=cat_cuotas.id,
            card_id=card_id,
        )
        db.add(sched)

    # Installments executed in August
    installments_aug = [
        ("2026-08-05", "iPhone 16 5/12", 18500, "iph-001", 5, 12),
        ("2026-08-10", "MacBook Air 3/6", 28900, "mac-001", 3, 6),
        ("2026-08-15", "Viaje Bariloche 4/10", 15200, "via-001", 4, 10),
        ("2026-08-20", "Smart TV 6/6", 12800, "tv-001", 6, 6),
        ("2026-08-25", "Lavarropas 2/12", 8900, "lav-001", 2, 12),
    ]

    for dt_str, desc, amt, grp, num, total in installments_aug:
        dt = datetime.strptime(dt_str, "%Y-%m-%d").date()
        sched = ScheduledExpense(
            installment_group_id=grp,
            installment_number=num,
            installment_total=total,
            scheduled_date=dt,
            amount=amt,
            description=desc,
            status="EXECUTED",
            executed_at=datetime(dt.year, dt.month, dt.day, 10, 0),
            user_id=uid,
            category_id=cat_cuotas.id,
            card_id=card_id,
        )
        db.add(sched)

    # Pending installments for September
    installments_sep = [
        ("2026-09-05", "iPhone 16 6/12", 18500, "iph-001", 6, 12),
        ("2026-09-10", "MacBook Air 4/6", 28900, "mac-001", 4, 6),
        ("2026-09-15", "Viaje Bariloche 5/10", 15200, "via-001", 5, 10),
        ("2026-09-25", "Lavarropas 3/12", 8900, "lav-001", 3, 12),
    ]

    for dt_str, desc, amt, grp, num, total in installments_sep:
        dt = datetime.strptime(dt_str, "%Y-%m-%d").date()
        sched = ScheduledExpense(
            installment_group_id=grp,
            installment_number=num,
            installment_total=total,
            scheduled_date=dt,
            amount=amt,
            description=desc,
            status="PENDING",
            user_id=uid,
            category_id=cat_cuotas.id,
            card_id=card_id,
        )
        db.add(sched)

    db.commit()
    print(f"Created installments: {len(installments_july)} executed (Jul), {len(installments_aug)} executed (Aug), {len(installments_sep)} pending (Sep)")

    # Summary
    total_exp = db.query(Expense).filter(Expense.user_id == uid, Expense.is_income == False).count()
    total_inc = db.query(Expense).filter(Expense.user_id == uid, Expense.is_income == True).count()
    total_rec = db.query(RecurringExpense).filter(RecurringExpense.user_id == uid).count()
    total_sched = db.query(ScheduledExpense).filter(ScheduledExpense.user_id == uid).count()

    print(f"\nSummary:")
    print(f"  Expenses: {total_exp}")
    print(f"  Income: {total_inc}")
    print(f"  Recurring subscriptions: {total_rec}")
    print(f"  Scheduled installments: {total_sched}")

    db.close()


if __name__ == "__main__":
    main()
