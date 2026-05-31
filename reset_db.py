#!/usr/bin/env python3
"""
Limpia la base de datos del Credit Card Analyzer.
Borra todos los gastos e historial de análisis, conserva usuarios, grupos y categorías.

Uso:
    python reset_db.py              # limpia gastos + historial
    python reset_db.py --all        # limpia todo incluyendo categorías
    python reset_db.py --dry-run    # muestra qué borraría sin ejecutar
    python reset_db.py --force      # limpia sin pedir confirmación
    python reset_db.py --vacuum     # ejecuta VACUUM tras borrar (reclama espacio)
    python reset_db.py --delete-categories 1 2 3   # elimina categorías específicas por ID
    python reset_db.py --vacuum --delete-categories 1 2 3  # combo: elimina categorías y vacuum
"""

import sqlite3
import sys
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "backend", "expenses.db")

TABLES = [
    "expenses",
    "analysis_history",
    "scheduled_expenses",
    "notifications",
    "card_closings",
    "cards",
    "accounts",
    "investments",
    "groups",
    "group_members",
]

TABLE_STRUCT = {t: ["id", "name"] for t in TABLES}
TABLE_STRUCT["groups"] += ["name"]
if "--all" in sys.argv[1:]:
    TABLES.append("categories")


def get_counts(cur):
    return {t: cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES}


def print_report(counts, delete_categories):
    print("─" * 40)
    for t, n in counts.items():
        marker = "" if t not in ("categories",) else f" {'← se borrará' if delete_categories else '← se conserva'}"
        print(f"  {t:<26} {n:>6} filas{marker}")
    print("─" * 40)


def parse_category_ids(args):
    """Extrae IDs de categorías de los argumentos."""
    ids = []
    try:
        idx = args.index("--delete-categories")
        for i in range(idx + 1, len(args)):
            if args[i].startswith("--"):
                break
            ids.append(int(args[i]))
    except ValueError:
        pass
    return ids


def delete_categories_by_ids(cur, category_ids):
    """Elimina categorías específicas por ID."""
    if not category_ids:
        return
    placeholders = ",".join("?" * len(category_ids))
    cur.execute(f"DELETE FROM categories WHERE id IN ({placeholders})", category_ids)


def delete_all(cur, vacuum=False):
    for t in TABLES:
        cur.execute(f"DELETE FROM {t}")
    if vacuum:
        cur.execute("VACUUM")


def main():
    args = sys.argv[1:]
    delete_categories = "--all" in args
    dry_run = "--dry-run" in args
    force = "--force" in args
    vacuum = "--vacuum" in args

    category_ids = parse_category_ids(args)
    if category_ids and delete_categories:
        print("Error: no se puede usar --all junto con --delete-categories")
        sys.exit(1)

    if delete_categories and "categories" not in TABLES:
        TABLES.append("categories")

    if not os.path.exists(DB_PATH):
        print(f"No se encontró la base de datos en: {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    counts = get_counts(cur)
    print_report(counts, delete_categories or bool(category_ids))

    if category_ids:
        print(f"Categorías a eliminar por ID: {category_ids}")
        print(f"  → {len(category_ids)} categoría(s) serán eliminadas")

    if dry_run:
        print("Modo dry-run: no se realizado ningún cambio.")
        conn.close()
        return

    if not force:
        confirm = input("¿Confirmar limpieza? [s/N] ").strip().lower()
        if confirm != "s":
            print("Cancelado.")
            conn.close()
            return

    try:
        if category_ids:
            delete_categories_by_ids(cur, category_ids)
            print(f"  Categorías eliminadas: {len(category_ids)}")
        else:
            delete_all(cur, vacuum=vacuum)
        conn.commit()
    except sqlite3.Error as e:
        conn.rollback()
        print(f"Error durante la limpieza: {e}")
        conn.close()
        sys.exit(1)

    conn.close()

    print("Listo.")
    for t, n in counts.items():
        print(f"  {t:<26} {n:>6} borrados")


if __name__ == "__main__":
    main()
