#!/usr/bin/env python3
"""
Script opcional para migrar gastos existentes de campos legacy (card, bank)
a las nuevas tablas estructuradas (accounts, cards).

Este script:
1. Encuentra todos los expenses con campo "card" = "Efectivo" o "Transferencia" y los asigna a cuentas
2. Encuentra todos los expenses con tarjetas y crea registros en la tabla cards

Uso:
  python backend/scripts/migrate_to_accounts_cards.py [--dry-run]
"""
import argparse
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app.models import Account, Card, Expense, User


def migrate_cash_expenses_to_accounts(db, dry_run=False):
    """Migrate cash/transfer expenses to accounts"""
    print("\n=== Migrando gastos en efectivo/transferencia a cuentas ===")

    # Get all users
    users = db.query(User).all()

    for user in users:
        print(f"\nUsuario: {user.full_name} (ID: {user.id})")

        # Find cash/transfer expenses for this user
        cash_expenses = (
            db.query(Expense)
            .filter(
                Expense.user_id == user.id,
                Expense.account_id.is_(None),  # Not yet migrated
                Expense.card_id.is_(None),
            )
            .filter(
                (Expense.card.ilike('%efectivo%')) | (Expense.card.ilike('%transferencia%'))
            )
            .all()
        )

        if not cash_expenses:
            print("  ✓ No hay gastos en efectivo/transferencia sin migrar")
            continue

        print(f"  Encontrados {len(cash_expenses)} gastos en efectivo/transferencia")

        # Check if user already has an "Efectivo" account
        efectivo_account = db.query(Account).filter(
            Account.user_id == user.id,
            Account.type == 'efectivo',
        ).first()

        if not efectivo_account:
            if dry_run:
                print(f"  [DRY-RUN] Crearía cuenta 'Efectivo' para {user.full_name}")
            else:
                efectivo_account = Account(
                    name="Efectivo",
                    type="efectivo",
                    user_id=user.id,
                )
                db.add(efectivo_account)
                db.flush()
                print(f"  ✓ Creada cuenta 'Efectivo' (ID: {efectivo_account.id})")
        else:
            print(f"  ✓ Usando cuenta existente 'Efectivo' (ID: {efectivo_account.id})")

        # Assign expenses to account
        if dry_run:
            print(f"  [DRY-RUN] Asignaría {len(cash_expenses)} gastos a la cuenta 'Efectivo'")
        else:
            for exp in cash_expenses:
                exp.account_id = efectivo_account.id
            print(f"  ✓ Asignados {len(cash_expenses)} gastos a la cuenta 'Efectivo'")


def migrate_card_expenses(db, dry_run=False):
    """Migrate card expenses to cards table"""
    print("\n=== Migrando gastos con tarjeta a la tabla cards ===")

    # Get all users
    users = db.query(User).all()

    for user in users:
        print(f"\nUsuario: {user.full_name} (ID: {user.id})")

        # Find unique card combinations for this user
        card_expenses = (
            db.query(Expense.card, Expense.bank, Expense.card_last4)
            .filter(
                Expense.user_id == user.id,
                Expense.card_id.is_(None),  # Not yet migrated
                Expense.card != "",
                Expense.card.notin_(["Efectivo", "Transferencia"]),
            )
            .distinct()
            .all()
        )

        if not card_expenses:
            print("  ✓ No hay gastos con tarjeta sin migrar")
            continue

        print(f"  Encontradas {len(card_expenses)} tarjetas únicas")

        for card_name, bank, last4 in card_expenses:
            # Check if card already exists
            existing = db.query(Card).filter(
                Card.user_id == user.id,
                Card.name == card_name,
                Card.bank == (bank or ""),
            ).first()

            if existing:
                card_id = existing.id
                print(f"  ✓ Usando tarjeta existente: {card_name} - {bank} (ID: {card_id})")
            else:
                if dry_run:
                    print(f"  [DRY-RUN] Crearía tarjeta: {card_name} - {bank}")
                    continue
                else:
                    new_card = Card(
                        name=card_name,
                        bank=bank or "",
                        last4_digits=last4,
                        card_type="credito",  # Default, can be updated manually
                        user_id=user.id,
                    )
                    db.add(new_card)
                    db.flush()
                    card_id = new_card.id
                    print(f"  ✓ Creada tarjeta: {card_name} - {bank} (ID: {card_id})")

            # Assign expenses to this card
            if not dry_run:
                expenses_to_update = (
                    db.query(Expense)
                    .filter(
                        Expense.user_id == user.id,
                        Expense.card == card_name,
                        Expense.bank == (bank or ""),
                        Expense.card_id.is_(None),
                    )
                    .all()
                )
                for exp in expenses_to_update:
                    exp.card_id = card_id
                print(f"    → Asignados {len(expenses_to_update)} gastos")


def main():
    parser = argparse.ArgumentParser(description="Migrar gastos a accounts/cards")
    parser.add_argument('--dry-run', action='store_true', help='Mostrar qué haría sin ejecutar cambios')
    args = parser.parse_args()

    db = SessionLocal()

    try:
        print("=" * 60)
        print("MIGRACIÓN DE GASTOS A ACCOUNTS/CARDS")
        print("=" * 60)

        if args.dry_run:
            print("\n⚠️  MODO DRY-RUN: No se harán cambios en la base de datos\n")

        migrate_cash_expenses_to_accounts(db, dry_run=args.dry_run)
        migrate_card_expenses(db, dry_run=args.dry_run)

        if args.dry_run:
            print("\n✓ Dry-run completado. Ejecutá sin --dry-run para aplicar cambios.")
        else:
            db.commit()
            print("\n✓ Migración completada exitosamente.")
            print("\nPodés revisar las cuentas y tarjetas creadas en la app.")

    except Exception as e:
        db.rollback()
        print(f"\n❌ Error durante la migración: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
