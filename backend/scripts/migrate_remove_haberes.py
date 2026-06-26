"""
Migration to remove Haberes category from database.
The category was removed from seed.py but may still exist in the database.
This script is idempotent - safe to run multiple times.
"""

from datetime import datetime

from sqlalchemy import text

_log = lambda msg: print(f"{datetime.now().isoformat()} {msg}")


def migrate():
    """
    Remove Haberes category from the database.
    Reassign any linked expenses to null category.
    """
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        # Find all Haberes categories (may be duplicates)
        result = db.execute(
            text("SELECT id, name FROM categories WHERE name = :name"),
            {"name": "Haberes"},
        )
        haberes_rows = result.fetchall()

        if not haberes_rows:
            _log("[MIGRATE] Haberes category not found - nothing to do")
            return

        for haberes in haberes_rows:
            haberes_id = haberes[0]
            _log(f"[MIGRATE] Found Haberes category with id={haberes_id}")

            # Reassign expenses to null category
            update_result = db.execute(
                text("UPDATE expenses SET category_id = NULL WHERE category_id = :cat_id"),
                {"cat_id": haberes_id},
            )
            _log(f"[MIGRATE] Reassigned {update_result.rowcount} expenses to null category")

            # Delete the category
            db.execute(
                text("DELETE FROM categories WHERE id = :cat_id"),
                {"cat_id": haberes_id},
            )

        db.commit()
        _log(f"[MIGRATE] Successfully removed {len(haberes_rows)} Haberes category(ies)")

    except Exception as e:
        db.rollback()
        _log(f"[MIGRATE ERROR] {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    migrate()
