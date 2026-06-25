"""
Seed script to populate the database with randomized demo data.
Run from the backend directory: python -m app.seed_demo_data
"""

import random
import uuid
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Account, Card, Category, Expense, ScheduledExpense, User
from app.seed import _apply_base_hierarchy_for_user

# ─── Merchant pools per category ─────────────────────────────────────────────

MERCHANT_POOLS = {
    "Supermercado": [
        "COTO", "CARREFOUR", "DIA", "DISCO", "JUMBO", "CHANGO MAS",
        "VEA", "LOTE", "MEDIUM", "AKENATON", "LIBRE MERCADO",
    ],
    "Restaurantes": [
        "MCDONALDS", "BURGER KING", "LA PAROLACCIA", "SARKIS",
        "DON JULIO", "PAROLACCIA", "IL MATTO", "PAIN ET VIN",
        "OSHER", "LA BIRRERIA", "STEAK HOUSE",
    ],
    "Delivery": [
        "RAPPI", "PEDIDOSYA", "CABIFY EATS", "IFOOD", "MEPEDIDO",
    ],
    "Combustible": [
        "YPF", "SHELL", "PETROBRAS", "AXION", "BLANCA ESPERANZA",
        "OGASA", "PUMA",
    ],
    "Transporte Público": [
        "SUBE RECARGA", "SUBE", "ECOBICI",
    ],
    "Streaming": [
        "NETFLIX", "SPOTIFY", "DISNEY+", "HBO MAX", "AMAZON PRIME",
        "PARAMOUNT+", "YOUTUBE PREMIUM", "APPLE TV+",
    ],
    "Electricidad & Gas": [
        "EDENOR", "EDESUR", "METROGAS", "CAMUZ", "DISTRIBUIDORA DE GAS",
    ],
    "Internet & Cable": [
        "FIBERTEL", "PERSONAL", "CLARO", "MOVISTAR", "TDC",
    ],
    "Farmacia": [
        "FARMACITY", "DR. AHUMADA", "LA SANatorial", "ROEMMERS",
        "FARMACIA DEL PUEBLO",
    ],
    "Prepaga": [
        "SWISS MEDICAL", "OSDE", "SMG", "MEDICUS", "GALENO",
    ],
    "Ropa": [
        "ZARA", "H&M", "C&A", "LEVIS", "ADIDAS", "NIKE",
        "SHEIN", "RIP CURL", "FOREVER 21",
    ],
    "Almacén/Kiosco": [
        "ALMACEN DON PEPE", "KIOSCO EL RINCON", "VERDULERIA DON PEPE",
        "LIBRERIA", "CHINO DEL BARRIO",
    ],
    "Cine & Salidas": [
        "CINE HOYTS", "CINEMARK", "SALTER", "PUNTO CINE",
    ],
    "Librería & Libros": [
        "LIBRERIA EL ATENEO", "Yenny", "CASA DEL LIBRO", "AGUALISA",
    ],
    "Taxi/Remis": [
        "UBER", "CABIFY", "DIDI", "BEAT", "IN DRIVER",
    ],
    "Tecnología": [
        "COMPUMAGNO", "GARBARINO", "FRACTAL", "MAXICARGAS",
        "MERCADO LIBRE", "FALABELLA",
    ],
    "Hogar": [
        "CASA CUELLAR", "SODIMAC", "EASY", "LIVERA",
        "BLANCO Y ROJO",
    ],
    "Mascota": [
        "PETISMO", "PETFARM", "ZONA GAUCHA", "MASCOT Market",
    ],
    "Salud": [
        "CLINICA PRIVADA", "LABORATORIO", "ODONTOLOGO", "OFTALMOLOGO",
    ],
    "Educación": [
        "CURSO ONLINE", "UNIVERSIDAD", "LIBROS DE TEXTO", "UDC",
    ],
    "Viajes": [
        "VUELTA A BARILOCHE", "HOTEL CALAFATE", "AEROLINEAS ARGENTINAS",
        " booking.com", "AIRBNB",
    ],
    "Seguros": [
        "SEGURO AUTO", "SEGURO HOGAR", "SEGURO VIDA", "LA CAJA",
    ],
    "Gimnasio": [
        "MEGATLON", " SPORTS", "EVOLUTION", "SMART FIT",
    ],
}

# ─── Amount ranges per category (base amounts before randomization) ──────────

AMOUNT_RANGES = {
    "Supermercado": (8000, 50000),
    "Restaurantes": (5000, 30000),
    "Delivery": (3000, 18000),
    "Combustible": (15000, 45000),
    "Transporte Público": (2000, 8000),
    "Streaming": (1500, 12000),
    "Electricidad & Gas": (5000, 25000),
    "Internet & Cable": (5000, 20000),
    "Farmacia": (3000, 30000),
    "Prepaga": (15000, 60000),
    "Ropa": (5000, 80000),
    "Almacén/Kiosco": (1000, 12000),
    "Cine & Salidas": (3000, 15000),
    "Librería & Libros": (3000, 25000),
    "Taxi/Remis": (1500, 12000),
    "Tecnología": (10000, 200000),
    "Hogar": (5000, 60000),
    "Mascota": (2000, 15000),
    "Salud": (5000, 40000),
    "Educación": (3000, 50000),
    "Viajes": (50000, 500000),
    "Seguros": (10000, 40000),
    "Gimnasio": (5000, 15000),
}

# ─── Installment product templates ──────────────────────────────────────────

INSTALLMENT_TEMPLATES = [
    {"desc": "SAMSUNG GALAXY S24", "base_amount": 1200000, "installments_range": (6, 18), "category": None},
    {"desc": "IPHONE 15 PRO", "base_amount": 1800000, "installments_range": (6, 18), "category": None},
    {"desc": "NOTEBOOK LENOVO", "base_amount": 980000, "installments_range": (6, 12), "category": None},
    {"desc": "SILLON BELGRANO", "base_amount": 180000, "installments_range": (3, 6), "category": "Hogar"},
    {"desc": "VIAJE BARILOCHE", "base_amount": 500000, "installments_range": (3, 6), "category": "Viajes"},
    {"desc": "TV SAMSUNG 65\"", "base_amount": 800000, "installments_range": (6, 12), "category": None},
    {"desc": "AIRE ACONDICIONADO", "base_amount": 450000, "installments_range": (6, 12), "category": "Hogar"},
    {"desc": "MUEBLE LIVING", "base_amount": 350000, "installments_range": (3, 6), "category": "Hogar"},
    {"desc": "BICICLETA MOUNTAIN", "base_amount": 280000, "installments_range": (3, 6), "category": None},
    {"desc": "CONSOLA PS5", "base_amount": 750000, "installments_range": (6, 12), "category": None},
    {"desc": "CAFETERA NESPRESSO", "base_amount": 120000, "installments_range": (3, 6), "category": "Hogar"},
    {"desc": "SMART WATCH GARMIN", "base_amount": 350000, "installments_range": (3, 6), "category": None},
]


# ─── Helper functions ────────────────────────────────────────────────────────

def _random_date_in_range(start: date, end: date) -> date:
    """Return a random date between start and end (inclusive)."""
    delta = (end - start).days
    if delta <= 0:
        return start
    return start + timedelta(days=random.randint(0, delta))


def _random_amount(base_min: int, base_max: int) -> float:
    """Generate a randomized amount within the range, then apply ±40% variance."""
    base = random.randint(base_min, base_max)
    variance = random.uniform(0.6, 1.4)
    return round(base * variance, 2)


def _pick_random_items(lst: list, min_count: int = 1, max_count: int = None) -> list:
    """Pick random items from a list, allowing repeats if list is small."""
    if max_count is None:
        max_count = max(min_count, len(lst) // 2)
    count = random.randint(min_count, min(max_count, len(lst)))
    if len(lst) <= count:
        return list(lst)
    return random.sample(lst, count)


# ─── Core functions ─────────────────────────────────────────────────────────

def select_user_interactive(db: Session) -> User:
    """Show numbered list of users and prompt for selection."""
    users = db.query(User).order_by(User.id).all()
    if not users:
        print("No hay usuarios en la base de datos. Creá uno primero.")
        exit(1)

    print("\n=== Usuarios disponibles ===\n")
    for i, u in enumerate(users, 1):
        print(f"  [{i}] {u.full_name} — {u.email} (id={u.id})")

    print()
    while True:
        try:
            choice = input("Seleccioná el número de usuario: ").strip()
            idx = int(choice) - 1
            if 0 <= idx < len(users):
                return users[idx]
            print(f"  Número inválido. Elegí entre 1 y {len(users)}.")
        except (ValueError, EOFError):
            print("  Entrada inválida. Ingresá un número.")


def get_or_create_cards(db: Session, user_id: int) -> list[Card]:
    """Get existing cards or create demo cards with random banks."""
    cards = db.query(Card).filter(Card.user_id == user_id).all()
    if cards:
        return cards

    user = db.get(User, user_id)
    first_name = "Usuario"
    if user and user.full_name:
        if "," in user.full_name:
            first_name = user.full_name.split(",")[1].strip().split()[0]
        else:
            first_name = user.full_name.split()[0]

    banks = random.sample(["Galicia", "Santander", "BBVA", "Macro", "Nación", "HSBC"], k=3)
    card_types = [
        ("Visa", "credito"),
        ("Mastercard", "credito"),
        ("Visa Débito", "debito"),
    ]

    for (card_name, card_type), bank in zip(card_types, banks, strict=False):
        card = Card(
            user_id=user_id,
            card_name=card_name,
            bank=bank,
            card_type=card_type,
            holder=first_name,
        )
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


def seed_demo_expenses(db: Session, user_id: int, count: int = 60):
    """Create randomized demo expenses across the last 6 months."""
    cards = get_or_create_cards(db, user_id)
    accounts = get_or_create_accounts(db, user_id)
    categories = get_categories(db, user_id)

    today = date.today()
    six_months_ago = today - timedelta(days=180)

    # Build weighted category list (supermercado/restaurants more frequent)
    category_weights = {
        "Supermercado": 15,
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
        "Almacén/Kiosco": 5,
        "Cine & Salidas": 3,
        "Librería & Libros": 2,
        "Taxi/Remis": 6,
        "Tecnología": 3,
        "Hogar": 3,
        "Mascota": 2,
        "Salud": 3,
        "Educación": 2,
        "Viajes": 1,
        "Seguros": 1,
        "Gimnasio": 3,
    }

    weighted_categories = []
    for cat, weight in category_weights.items():
        if cat in categories:
            weighted_categories.extend([cat] * weight)

    # Split payment methods: 70% cards, 30% accounts
    card_names = [c.card_name for c in cards]
    account_names = [a.name for a in accounts]

    expenses_created = 0
    for _ in range(count):
        category_name = random.choice(weighted_categories)
        cat = categories.get(category_name)
        merchants = MERCHANT_POOLS.get(category_name, ["GASTO VARIO"])
        merchant = random.choice(merchants)
        amount_min, amount_max = AMOUNT_RANGES.get(category_name, (1000, 20000))
        amount = _random_amount(amount_min, amount_max)
        exp_date = _random_date_in_range(six_months_ago, today)

        expense = Expense(
            date=exp_date,
            description=merchant,
            amount=amount,
            category_id=cat.id if cat else None,
            currency="ARS",
            user_id=user_id,
            is_income=False,
        )

        # Randomly assign card (70%) or account (30%)
        if random.random() < 0.7 and card_names:
            card_obj = random.choice(cards)
            expense.card_id = card_obj.id
        elif account_names:
            acc_obj = random.choice(accounts)
            expense.account_id = acc_obj.id

        db.add(expense)
        expenses_created += 1

    db.commit()
    print(f"  {expenses_created} gastos creados (últimos 6 meses, randomizados)")


def seed_demo_installments(db: Session, user_id: int, count: int = 6):
    """Create randomized installment purchases."""
    cards = get_or_create_cards(db, user_id)
    categories = get_categories(db, user_id)

    today = date.today()
    current_month_start = today.replace(day=1)

    templates = random.sample(INSTALLMENT_TEMPLATES, k=min(count, len(INSTALLMENT_TEMPLATES)))

    for template in templates:
        group_id = str(uuid.uuid4())
        num_installments = random.randint(*template["installments_range"])
        # Apply ±30% variance to total amount
        total = round(template["base_amount"] * random.uniform(0.7, 1.3), 2)
        installment_amount = round(total / num_installments, 2)
        cat = categories.get(template["category"]) if template.get("category") else None
        card = random.choice(cards)

        # Random start month: 1-6 months ago
        start_offset = random.randint(-6, -1)
        start_date = current_month_start + timedelta(days=start_offset * 30)

        for i in range(num_installments):
            exp_date = start_date + timedelta(days=i * 30)
            if exp_date > today + timedelta(days=90):
                break

            expense = Expense(
                date=exp_date,
                description=template["desc"],
                amount=installment_amount,
                category_id=cat.id if cat else None,
                currency="ARS",
                installment_number=i + 1,
                installment_total=num_installments,
                installment_group_id=group_id,
                user_id=user_id,
                card_id=card.id,
                is_income=False,
            )
            db.add(expense)

            scheduled = ScheduledExpense(
                installment_group_id=group_id,
                installment_number=i + 1,
                installment_total=num_installments,
                scheduled_date=exp_date,
                amount=installment_amount,
                currency="ARS",
                description=template["desc"],
                card_id=card.id,
                category_id=cat.id if cat else None,
                status="EXECUTED" if exp_date < today else "PENDING",
                user_id=user_id,
            )
            db.add(scheduled)

    db.commit()
    print(f"  {len(templates)} compras en cuotas creadas")


def main():
    db = SessionLocal()
    try:
        user = select_user_interactive(db)
        print(f"\nGenerando datos randomizados para: {user.full_name} (id={user.id})")

        cats = get_categories(db, user.id)
        print(f"  {len(cats)} categorías disponibles")

        get_or_create_cards(db, user.id)
        get_or_create_accounts(db, user.id)

        print()
        seed_demo_expenses(db, user.id, count=60)
        seed_demo_installments(db, user.id, count=6)

        expense_count = db.query(Expense).filter(Expense.user_id == user.id).count()
        card_count = db.query(Card).filter(Card.user_id == user.id).count()
        account_count = db.query(Account).filter(Account.user_id == user.id).count()
        scheduled_count = db.query(ScheduledExpense).filter(
            ScheduledExpense.user_id == user.id
        ).count()

        print("\nListo! Estado final:")
        print(f"  - {expense_count} gastos")
        print(f"  - {scheduled_count} gastos programados/cuotas")
        print(f"  - {card_count} tarjetas")
        print(f"  - {account_count} cuentas")
    finally:
        db.close()


if __name__ == "__main__":
    main()
