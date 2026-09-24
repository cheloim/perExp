#!/usr/bin/env python3
"""Populate dev database with random data for user Marcelo Mendoza.

Covers: cards, accounts, card closings, categories, expenses (6 months),
income, installments (Expense + ScheduledExpense), recurring subscriptions,
budgets, budget groups, investments, and notifications.

Usage (inside backend container):
    python scripts/populate_dev_data.py
"""

import os
import random
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if not os.getenv("SECRET_KEY"):
    secret_file = "/run/secrets/creditcard_backend_dev_secret_key"
    if os.path.exists(secret_file):
        with open(secret_file) as f:
            os.environ["SECRET_KEY"] = f.read().strip()

from calendar import monthrange
from datetime import date, datetime, timedelta

from app.database import SessionLocal
from app.models import (
    Account,
    Budget,
    BudgetGroup,
    Card,
    CardClosing,
    Category,
    Expense,
    Investment,
    Notification,
    RecurringExpense,
    ScheduledExpense,
    User,
)
from app.seed import _apply_base_hierarchy_for_user
from app.services.encryption import compute_hmac

TARGET_EMAIL = "mmendoza0989@gmail.com"
MONTHLY_INCOME = 650000

# Merchant pools by category name
MERCHANT_POOLS = {
    "Supermercado": ["COTO", "CARREFOUR", "DIA", "DISCO", "JUMBO", "CHANGO MAS", "VEA"],
    "Restaurantes": ["MCDONALDS", "BURGER KING", "LA PAROLACCIA", "SARKIS", "DON JULIO", "OSHER"],
    "Delivery": ["RAPPI", "PEDIDOSYA", "CABIFY EATS"],
    "Combustible": ["YPF", "SHELL", "PETROBRAS", "AXION"],
    "Transporte Público": ["SUBE RECARGA", "SUBE", "ECOBICI"],
    "Streaming": ["NETFLIX", "SPOTIFY", "DISNEY+", "HBO MAX", "AMAZON PRIME", "YOUTUBE PREMIUM"],
    "Electricidad & Gas": ["EDENOR", "EDESUR", "METROGAS"],
    "Internet & Cable": ["FIBERTEL", "PERSONAL", "CLARO"],
    "Farmacia": ["FARMACITY", "DR. AHUMADA", "FARMACIA DEL PUEBLO"],
    "Prepaga": ["SWISS MEDICAL", "OSDE", "GALENO"],
    "Ropa": ["ZARA", "H&M", "LEVIS", "ADIDAS", "NIKE"],
    "Almacén/Kiosco": ["ALMACEN DON PEPE", "KIOSCO EL RINCON", "CHINO DEL BARRIO"],
    "Cine & Salidas": ["CINE HOYTS", "CINEMARK", "BAR NOTERO"],
    "Librería & Libros": ["LIBRERIA EL ATENEO", "YENNY", "CASA DEL LIBRO"],
    "Taxi/Remis": ["UBER", "CABIFY", "DIDI"],
    "Tecnología": ["COMPUMAGNO", "GARBARINO", "MERCADO LIBRE", "FRAGATA"],
    "Hogar": ["CASA CUELLAR", "SODIMAC", "EASY"],
    "Mascota": ["PETISMO", "PETFARM"],
    "Salud": ["CLINICA PRIVADA", "ODONTOLOGO"],
    "Educación": ["CURSO ONLINE", "UNIVERSIDAD"],
    "Viajes": ["AEROLINEAS ARGENTINAS", "AIRBNB", "BOOKING.COM"],
    "Seguros": ["SEGURO AUTO", "LA CAJA"],
    "Gimnasio": ["MEGATLON", "SMART FIT", "EVOLUTION"],
    "Supermercado_delivery": ["RAPPI SUPER", "PEDIDOSYA SUPER"],
}

AMOUNT_RANGES = {
    "Supermercado": (12000, 55000),
    "Restaurantes": (6000, 35000),
    "Delivery": (4000, 22000),
    "Combustible": (18000, 50000),
    "Transporte Público": (1500, 8000),
    "Streaming": (2000, 15000),
    "Electricidad & Gas": (5000, 30000),
    "Internet & Cable": (6000, 22000),
    "Farmacia": (3000, 35000),
    "Prepaga": (20000, 70000),
    "Ropa": (6000, 90000),
    "Almacén/Kiosco": (1500, 15000),
    "Cine & Salidas": (4000, 20000),
    "Librería & Libros": (3000, 30000),
    "Taxi/Remis": (2000, 15000),
    "Tecnología": (15000, 250000),
    "Hogar": (6000, 80000),
    "Mascota": (3000, 18000),
    "Salud": (6000, 50000),
    "Educación": (5000, 60000),
    "Viajes": (60000, 500000),
    "Seguros": (12000, 45000),
    "Gimnasio": (8000, 20000),
}

CATEGORY_WEIGHTS = {
    "Supermercado": 16,
    "Restaurantes": 10,
    "Delivery": 8,
    "Combustible": 8,
    "Transporte Público": 6,
    "Streaming": 4,
    "Electricidad & Gas": 4,
    "Internet & Cable": 3,
    "Farmacia": 4,
    "Prepaga": 2,
    "Ropa": 5,
    "Almacén/Kiosco": 6,
    "Cine & Salidas": 4,
    "Librería & Libros": 2,
    "Taxi/Remis": 6,
    "Tecnología": 3,
    "Hogar": 4,
    "Mascota": 2,
    "Salud": 3,
    "Educación": 2,
    "Viajes": 1,
    "Seguros": 1,
    "Gimnasio": 3,
}

INSTALLMENT_TEMPLATES = [
    {"desc": "IPHONE 16 PRO", "base_amount": 1800000, "installments_range": (6, 12)},
    {"desc": "MACBOOK AIR M3", "base_amount": 1200000, "installments_range": (6, 12)},
    {"desc": 'TV SAMSUNG 65"', "base_amount": 850000, "installments_range": (6, 12)},
    {"desc": "VIAJE BARILOCHE", "base_amount": 480000, "installments_range": (3, 6)},
    {"desc": "SILLON BELGRANO", "base_amount": 220000, "installments_range": (3, 6)},
    {"desc": "AIRE ACONDICIONADO", "base_amount": 520000, "installments_range": (6, 12)},
    {"desc": "LAVARROPAS SAMSUNG", "base_amount": 680000, "installments_range": (6, 12)},
    {"desc": "NOTEBOOK LENOVO", "base_amount": 950000, "installments_range": (6, 12)},
]

RECURRING_DATA = [
    ("NETFLIX", "Netflix Premium", 6990, "monthly"),
    ("SPOTIFY", "Spotify Familiar", 3990, "monthly"),
    ("SMARTFIT", "SmartFit Gym", 15990, "monthly"),
    ("GOOGLE", "Google One 100GB", 3990, "monthly"),
    ("YOUTUBE", "YouTube Premium", 5990, "monthly"),
    ("APPLE", "iCloud 200GB", 1990, "monthly"),
    ("AMAZON", "Amazon Prime Anual", 14990, "yearly"),
    ("MICROSOFT", "Microsoft 365 Anual", 12990, "yearly"),
]

INVESTMENT_DATA = [
    {
        "ticker": "GGAL",
        "name": "Grupo Galicia",
        "type": "accion",
        "broker": "IOL",
        "qty": 150,
        "avg": 4200,
        "price": 4850,
        "currency": "ARS",
    },
    {
        "ticker": "YPFD",
        "name": "YPF",
        "type": "accion",
        "broker": "IOL",
        "qty": 80,
        "avg": 18500,
        "price": 21200,
        "currency": "ARS",
    },
    {
        "ticker": "PAMP",
        "name": "Pampa Energía",
        "type": "accion",
        "broker": "PPI",
        "qty": 200,
        "avg": 3100,
        "price": 3680,
        "currency": "ARS",
    },
    {
        "ticker": "AL30",
        "name": "Bonos AL30",
        "type": "bono",
        "broker": "IOL",
        "qty": 500,
        "avg": 85000,
        "price": 91000,
        "currency": "ARS",
    },
    {
        "ticker": "SPY",
        "name": "S&P500 ETF",
        "type": "cedear",
        "broker": "PPI",
        "qty": 10,
        "avg": 68000,
        "price": 72500,
        "currency": "ARS",
    },
    {
        "ticker": "BTC",
        "name": "Bitcoin",
        "type": "cripto",
        "broker": "Buenbit",
        "qty": 0.05,
        "avg": 55000,
        "price": 62000,
        "currency": "USD",
    },
]


def get_or_create_cards(db, user_id):
    cards = db.query(Card).filter(Card.user_id == user_id).all()
    if cards:
        return cards

    banks = random.sample(["Galicia", "Santander", "BBVA", "Macro", "Nación", "HSBC"], k=3)
    card_defs = [
        ("Visa", "credito"),
        ("Mastercard", "credito"),
        ("Visa Débito", "debito"),
    ]
    for (card_name, card_type), bank in zip(card_defs, banks, strict=False):
        card = Card(
            user_id=user_id,
            card_name=card_name,
            card_name_hmac=compute_hmac(card_name.lower()),
            bank=bank,
            bank_hmac=compute_hmac(bank.lower()),
            card_type=card_type,
            holder="Marcelo",
        )
        db.add(card)
    db.commit()
    return db.query(Card).filter(Card.user_id == user_id).all()


def get_or_create_accounts(db, user_id):
    accounts = db.query(Account).filter(Account.user_id == user_id).all()
    if accounts:
        return accounts

    for name, acc_type in [
        ("Efectivo", "efectivo"),
        ("MercadoPago", "mercadopago"),
        ("Caja de Ahorro Galicia", "caja_ahorro"),
    ]:
        db.add(
            Account(
                user_id=user_id,
                name=name,
                name_hmac=compute_hmac(name.strip().lower()),
                type=acc_type,
            )
        )
    db.commit()
    return db.query(Account).filter(Account.user_id == user_id).all()


def seed_categories(db, user_id):
    cats = db.query(Category).filter(Category.user_id == user_id).all()
    if not cats:
        _apply_base_hierarchy_for_user(db, user_id)
        db.commit()
        cats = db.query(Category).filter(Category.user_id == user_id).all()

    result = {c.name: c for c in cats}

    if "Ingresos" not in result:
        parent = Category(
            name="Ingresos", color="#22c55e", keywords="", parent_id=None, user_id=user_id
        )
        db.add(parent)
        db.flush()
        if "Sueldo" not in result:
            db.add(
                Category(
                    name="Sueldo",
                    color="#4ade80",
                    keywords="sueldo,salario,haberes",
                    parent_id=parent.id,
                    user_id=user_id,
                )
            )
        db.commit()
        result = {c.name: c for c in db.query(Category).filter(Category.user_id == user_id).all()}

    bg_map = {
        "Supermercado": "necesidades",
        "Restaurantes": "gustos",
        "Delivery": "gustos",
        "Combustible": "necesidades",
        "Transporte Público": "necesidades",
        "Streaming": "gustos",
        "Electricidad & Gas": "necesidades",
        "Internet & Cable": "necesidades",
        "Farmacia": "necesidades",
        "Prepaga": "necesidades",
        "Ropa": "gustos",
        "Almacén/Kiosco": "necesidades",
        "Cine & Salidas": "gustos",
        "Librería & Libros": "ahorro",
        "Taxi/Remis": "gustos",
        "Tecnología": "gustos",
        "Hogar": "necesidades",
        "Mascota": "necesidades",
        "Salud": "necesidades",
        "Educación": "ahorro",
        "Viajes": "ahorro",
        "Seguros": "necesidades",
        "Gimnasio": "gustos",
        "Sueldo": "ahorro",
        "Bonificación": "ahorro",
    }
    changed = False
    for cat_name, bg in bg_map.items():
        c = result.get(cat_name)
        if c and c.budget_group != bg:
            c.budget_group = bg
            changed = True
    if changed:
        db.commit()

    return result


def _random_amount(lo, hi):
    base = random.randint(lo, hi)
    return round(base * random.uniform(0.6, 1.4), 2)


def _month_dates(today, months_back=6):
    dates = []
    y, m = today.year, today.month

    dates.append((y, m, today.day))

    for _ in range(months_back):
        m -= 1
        if m == 0:
            m = 12
            y -= 1
        days = monthrange(y, m)[1]
        dates.append((y, m, days))
    dates.reverse()
    return dates


def seed_expenses(db, user_id, cards, accounts, categories, months_info):
    weighted_cats = []
    for name, w in CATEGORY_WEIGHTS.items():
        if name in categories:
            weighted_cats.extend([name] * w)

    total = 0
    for y, m, days_in_month in months_info:
        monthly_salary = round(MONTHLY_INCOME * random.uniform(0.95, 1.05), 2)
        salary_day = random.choice([1, 5])
        db.add(
            Expense(
                date=date(y, m, min(salary_day, days_in_month)),
                description=f"Sueldo {y}-{m:02d}",
                description_hmac=compute_hmac(f"sueldo {y}-{m:02d}".lower()),
                amount=monthly_salary,
                user_id=user_id,
                category_id=categories.get("Sueldo").id if "Sueldo" in categories else None,
                account_id=accounts[2].id if len(accounts) > 2 else accounts[0].id,
                is_income=True,
                currency="ARS",
            )
        )
        total += 1

        num_expenses = random.randint(100, 150)
        for _ in range(num_expenses):
            d = random.randint(1, days_in_month)
            cat_name = random.choice(weighted_cats)
            cat = categories.get(cat_name)
            merchants = MERCHANT_POOLS.get(cat_name, ["GASTO VARIO"])
            merchant = random.choice(merchants)
            lo, hi = AMOUNT_RANGES.get(cat_name, (2000, 20000))
            amount = _random_amount(lo, hi)

            exp = Expense(
                date=date(y, m, d),
                description=merchant,
                description_hmac=compute_hmac(merchant.lower()),
                amount=amount,
                category_id=cat.id if cat else None,
                currency="ARS",
                user_id=user_id,
                is_income=False,
            )
            if random.random() < 0.7:
                exp.card_id = random.choice(cards).id
            else:
                exp.account_id = random.choice(accounts).id
            db.add(exp)
            total += 1

        db.commit()
        print(f"  {y}-{m:02d}: {num_expenses + 1} gastos (incl. sueldo)")

    return total


def seed_installments(db, user_id, cards, categories, today):
    cuotas_cat = categories.get("Cuotas") or categories.get("Compras")
    templates = random.sample(INSTALLMENT_TEMPLATES, k=min(6, len(INSTALLMENT_TEMPLATES)))
    current_month = today.replace(day=1)
    created_sched = 0
    created_exp = 0

    for tpl in templates:
        grp = str(uuid.uuid4())
        n_install = random.randint(*tpl["installments_range"])
        total = round(tpl["base_amount"] * random.uniform(0.7, 1.3), 2)
        per_install = round(total / n_install, 2)
        card = random.choice([c for c in cards if c.card_type == "credito"] or cards)
        start_offset = random.randint(-6, -1)
        start = current_month + timedelta(days=start_offset * 30)

        for i in range(n_install):
            d = start + timedelta(days=i * 30)
            if d > today + timedelta(days=120):
                break
            status = "EXECUTED" if d < today else "PENDING"

            exp = Expense(
                date=d,
                description=tpl["desc"],
                description_hmac=compute_hmac(tpl["desc"].lower()),
                amount=per_install,
                category_id=cuotas_cat.id if cuotas_cat else None,
                currency="ARS",
                installment_number=i + 1,
                installment_total=n_install,
                installment_group_id=grp,
                user_id=user_id,
                card_id=card.id,
                is_income=False,
            )
            db.add(exp)
            created_exp += 1

            sched = ScheduledExpense(
                installment_group_id=grp,
                installment_number=i + 1,
                installment_total=n_install,
                scheduled_date=d,
                amount=per_install,
                description=tpl["desc"],
                description_hmac=compute_hmac(tpl["desc"].lower()),
                currency="ARS",
                card_id=card.id,
                category_id=cuotas_cat.id if cuotas_cat else None,
                status=status,
                user_id=user_id,
                executed_at=datetime(d.year, d.month, d.day, 10, 0)
                if status == "EXECUTED"
                else None,
            )
            db.add(sched)
            created_sched += 1

    db.commit()
    print(
        f"  {len(templates)} compras en cuotas ({created_exp} gastos, {created_sched} programados)"
    )
    return created_exp, created_sched


def seed_recurring(db, user_id, cards, categories):
    subs_cat = categories.get("Streaming") or categories.get("Suscripciones")
    gym_cat = categories.get("Gimnasio") or categories.get("Salud")
    cloud_cat = categories.get("Tecnología")

    card = next((c for c in cards if c.card_type == "credito"), cards[0]) if cards else None
    created = 0
    today = date.today()
    next_month = today.replace(day=1) + timedelta(days=32)
    next_charge = next_month.replace(day=random.randint(1, 15))

    for mkey, desc, amt, freq in RECURRING_DATA:
        cat = subs_cat
        if "Gym" in desc or "Fit" in desc:
            cat = gym_cat
        elif "Google" in desc or "iCloud" in desc or "Microsoft" in desc:
            cat = cloud_cat

        db.add(
            RecurringExpense(
                user_id=user_id,
                merchant_key=mkey,
                description=desc,
                amount=amt,
                frequency=freq,
                next_charge_date=next_charge,
                is_active=True,
                source="manual",
                category_id=cat.id if cat else None,
                card_id=card.id if card else None,
            )
        )
        created += 1

    db.commit()
    print(f"  {created} suscripciones recurrentes creadas")
    return created


def seed_card_closings(db, user_id, cards):
    today = date.today()
    created = 0
    for card in cards:
        if card.card_type != "credito":
            continue
        closing_day = random.choice([10, 15, 20, 25, 28])
        last_digits = str(random.randint(1000, 9999))
        y, m = today.year, today.month
        if today.day > closing_day:
            m += 1
            if m > 12:
                m = 1
                y += 1
        closing_date = date(y, m, closing_day)
        next_due_day = min(closing_day + 10, 28)
        due_month = m + 1
        due_year = y
        if due_month > 12:
            due_month = 1
            due_year += 1
        due_date = date(due_year, due_month, next_due_day)

        db.add(
            CardClosing(
                card=card.card_name,
                card_last_digits=last_digits,
                card_type=card.card_type,
                bank=card.bank or "",
                card_id=card.id,
                closing_date=closing_date,
                next_closing_date=closing_date + timedelta(days=30),
                due_date=due_date,
                user_id=user_id,
            )
        )
        created += 1

    db.commit()
    print(f"  {created} cierres de tarjeta creados")


def seed_budgets(db, user_id, categories):
    budget_defs = {
        "Supermercado": 120000,
        "Restaurantes": 50000,
        "Delivery": 30000,
        "Combustible": 80000,
        "Transporte Público": 15000,
        "Streaming": 20000,
        "Farmacia": 25000,
        "Ropa": 40000,
        "Cine & Salidas": 20000,
        "Gimnasio": 20000,
        "Hogar": 50000,
    }

    created = 0
    for cat_name, amount in budget_defs.items():
        cat = categories.get(cat_name)
        if not cat:
            continue
        existing = (
            db.query(Budget).filter(Budget.user_id == user_id, Budget.category_id == cat.id).first()
        )
        if existing:
            existing.amount = amount
            continue
        db.add(
            Budget(
                user_id=user_id,
                category_id=cat.id,
                amount=amount,
                alert_threshold=0.80,
                is_active=True,
            )
        )
        created += 1

    db.commit()
    print(f"  {created} presupuestos creados (total {len(budget_defs)} categorías)")


def seed_budget_groups(db, user_id):
    groups = [
        ("necesidades", "Necesidades", 50),
        ("gustos", "Gustos", 30),
        ("ahorro", "Ahorro", 20),
    ]
    for name, display, pct in groups:
        existing = (
            db.query(BudgetGroup)
            .filter(BudgetGroup.user_id == user_id, BudgetGroup.name == name)
            .first()
        )
        if existing:
            existing.amount = round(MONTHLY_INCOME * pct / 100, 2)
            continue
        db.add(
            BudgetGroup(
                user_id=user_id,
                name=name,
                display_name=display,
                percentage=pct,
                amount=round(MONTHLY_INCOME * pct / 100, 2),
                spent=0,
                is_active=True,
            )
        )
    db.commit()
    print("  3 grupos de presupuesto inicializados (50/30/20)")


def seed_investments(db, user_id):
    existing = db.query(Investment).filter(Investment.user_id == user_id).count()
    if existing > 0:
        print(f"  {existing} inversiones ya existen, saltando")
        return

    for inv in INVESTMENT_DATA:
        db.add(
            Investment(
                ticker=inv["ticker"],
                name=inv["name"],
                type=inv["type"],
                broker=inv["broker"],
                quantity=inv["qty"],
                avg_cost=inv["avg"],
                current_price=inv["price"],
                currency=inv["currency"],
                user_id=user_id,
            )
        )
    db.commit()
    print(f"  {len(INVESTMENT_DATA)} inversiones creadas")


def seed_notifications(db, user_id):
    existing = db.query(Notification).filter(Notification.user_id == user_id).count()
    if existing > 0:
        print(f"  {existing} notificaciones ya existen, saltando")
        return

    today = date.today()
    items = [
        (
            "budget_warning",
            "Presupuesto superado",
            "El presupuesto de Supermercado fue superado este mes.",
            '{"category":"Supermercado"}',
        ),
        (
            "upcoming_recurring",
            "Próximo cobro",
            "Netflix Premium se cobra el 15 del mes.",
            '{"merchant":"NETFLIX"}',
        ),
        (
            "monthly_report_ready",
            "Informe mensual",
            f"Tu informe de {today.strftime('%B')} está disponible.",
            '{"month":"' + today.strftime("%Y-%m") + '"}',
        ),
        (
            "admin_message",
            "Bienvenido",
            "Bienvenido a Oikonomia. Explorá el panel de inversiones.",
            "{}",
        ),
        (
            "import_ready",
            "Importación completada",
            "La importación de tu resumen de tarjeta finalizó.",
            '{"filename":"resumen_visa.pdf"}',
        ),
        (
            "group_invitation",
            "Invitación a grupo",
            "Te invitaron al grupo 'Familia Mendoza'.",
            '{"group":"Familia Mendoza"}',
        ),
    ]
    for ntype, title, body, data in items:
        db.add(
            Notification(
                user_id=user_id,
                type=ntype,
                title=title,
                body=body,
                data=data,
                read=random.random() < 0.3,
            )
        )
    db.commit()
    print(f"  {len(items)} notificaciones creadas")


def main():
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == TARGET_EMAIL).first()
        if not user:
            print(f"ERROR: usuario {TARGET_EMAIL} no encontrado")
            return

        uid = user.id
        print(f"=== Populate dev data for: {user.email} (id={uid}) ===\n")

        print("0. Limpiando datos existentes...")
        for model in [
            Expense,
            ScheduledExpense,
            RecurringExpense,
            Budget,
            BudgetGroup,
            Investment,
            Notification,
            CardClosing,
            Card,
            Account,
        ]:
            count = db.query(model).filter(model.user_id == uid).delete()
            if count:
                print(f"   {model.__tablename__}: {count} eliminados")
        db.commit()

        print("1. Categorías...")
        categories = seed_categories(db, uid)
        print(f"   {len(categories)} categorías disponibles")

        print("2. Tarjetas...")
        cards = get_or_create_cards(db, uid)
        print(f"   {len(cards)} tarjetas")

        print("3. Cuentas...")
        accounts = get_or_create_accounts(db, uid)
        print(f"   {len(accounts)} cuentas")

        print("4. Cierres de tarjeta...")
        seed_card_closings(db, uid, cards)

        today = date.today()
        months = _month_dates(today, months_back=6)
        print("5. Gastos (7 meses, incl. mes actual)...")
        seed_expenses(db, uid, cards, accounts, categories, months)

        print("6. Cuotas...")
        seed_installments(db, uid, cards, categories, today)

        print("7. Suscripciones recurrentes...")
        seed_recurring(db, uid, cards, categories)

        print("8. Presupuestos...")
        seed_budgets(db, uid, categories)
        seed_budget_groups(db, uid)

        print("9. Inversiones...")
        seed_investments(db, uid)

        print("10. Notificaciones...")
        seed_notifications(db, uid)

        print("\n=== Resumen ===")
        print(
            f"  Gastos:              {db.query(Expense).filter(Expense.user_id == uid, Expense.is_income == False).count()}"
        )
        print(
            f"  Ingresos:            {db.query(Expense).filter(Expense.user_id == uid, Expense.is_income == True).count()}"
        )
        print(f"  Tarjetas:            {db.query(Card).filter(Card.user_id == uid).count()}")
        print(f"  Cuentas:             {db.query(Account).filter(Account.user_id == uid).count()}")
        print(
            f"  Programados:         {db.query(ScheduledExpense).filter(ScheduledExpense.user_id == uid).count()}"
        )
        print(
            f"  Recurrentes:         {db.query(RecurringExpense).filter(RecurringExpense.user_id == uid).count()}"
        )
        print(f"  Presupuestos:        {db.query(Budget).filter(Budget.user_id == uid).count()}")
        print(
            f"  Inversiones:         {db.query(Investment).filter(Investment.user_id == uid).count()}"
        )
        print(
            f"  Notificaciones:      {db.query(Notification).filter(Notification.user_id == uid).count()}"
        )
        print(
            f"  Cierres de tarjeta:  {db.query(CardClosing).filter(CardClosing.user_id == uid).count()}"
        )
        print("\nListo! Abrí http://localhost:8082 para explorar.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
