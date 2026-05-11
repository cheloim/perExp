#!/usr/bin/env python3
"""
Migration script: Convert negative amounts to positive + set is_income flag
"""
from app.database import SessionLocal
from app.models import Expense, Category
from sqlalchemy import text

def main():
    db = SessionLocal()
    try:
        print("=== Income Migration Script ===\n")

        # 1. Count current negative amounts
        negative_count = db.query(Expense).filter(Expense.amount < 0).count()
        print(f"📊 Ingresos con amount negativo: {negative_count}")

        if negative_count == 0:
            print("✓ No hay ingresos a migrar")
            return

        # 2. Show sample income entries
        print("\n📋 Ejemplos de ingresos a migrar:")
        samples = db.query(Expense).filter(Expense.amount < 0).limit(5).all()
        for exp in samples:
            cat = db.query(Category).filter(Category.id == exp.category_id).first()
            cat_name = cat.name if cat else "Sin categoría"
            print(f"  - {exp.description[:40]:40} | {exp.amount:>10.2f} | {cat_name}")

        # 3. Set is_income=true for negative amounts
        print("\n🔄 Actualizando campo is_income...")
        result = db.execute(text("UPDATE expenses SET is_income = TRUE WHERE amount < 0"))
        print(f"✓ {result.rowcount} registros marcados como income")

        # 4. Convert negative amounts to positive
        print("\n🔄 Convirtiendo amounts negativos a positivos...")
        result = db.execute(text("UPDATE expenses SET amount = ABS(amount) WHERE is_income = TRUE"))
        print(f"✓ {result.rowcount} amounts convertidos a positivos")

        db.commit()

        # 5. Verify results
        print("\n📊 Verificación:")
        income_count = db.query(Expense).filter(Expense.is_income == True).count()
        negative_remaining = db.query(Expense).filter(Expense.amount < 0).count()

        print(f"  Total ingresos migrados: {income_count}")
        print(f"  Negativos restantes: {negative_remaining}")

        if negative_remaining > 0:
            print("\n⚠️  ADVERTENCIA: Quedan amounts negativos")
        else:
            print("\n✅ Migración completada exitosamente!")

        # 6. Show income breakdown by category
        print("\n📊 Ingresos por categoría:")
        from sqlalchemy import func
        breakdown = db.query(
            Category.name,
            func.count(Expense.id).label('count'),
            func.sum(Expense.amount).label('total')
        ).join(Expense, Expense.category_id == Category.id)\
         .filter(Expense.is_income == True)\
         .group_by(Category.name)\
         .all()

        for cat_name, count, total in breakdown:
            print(f"  - {cat_name:20} | {count:3} ingresos | ${total:>12,.2f}")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    main()
