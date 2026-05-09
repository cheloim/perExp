#!/usr/bin/env python3
"""
Limpia la base de datos del Credit Card Analyzer.
Borra todos los gastos e historial de análisis, conserva las categorías.

Uso:
    python reset_db.py              # limpia gastos + historial
    python reset_db.py --all        # limpia todo incluyendo categorías
    python reset_db.py --dry-run    # muestra qué borraría sin ejecutar
"""

import sqlite3
import sys
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "backend", "expenses.db")

def count(cur, table):
    cur.execute(f"SELECT COUNT(*) FROM {table}")
    return cur.fetchone()[0]

def main():
    args = sys.argv[1:]
    delete_categories = "--all" in args
    dry_run = "--dry-run" in args

    if not os.path.exists(DB_PATH):
        print(f"No se encontró la base de datos en: {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    expenses_n      = count(cur, "expenses")
    history_n       = count(cur, "analysis_history")
    categories_n    = count(cur, "categories")
    cards_n         = count(cur, "cards")
    accounts_n      = count(cur, "accounts")
    card_closings_n = count(cur, "card_closings")
    investments_n   = count(cur, "investments")
    notifications_n = count(cur, "notifications")

    print("─" * 40)
    print(f"  expenses:         {expenses_n:>6} filas")
    print(f"  analysis_history: {history_n:>6} filas")
    print(f"  categories:       {categories_n:>6} filas {'← se borrará' if delete_categories else '← se conserva'}")
    print(f"  cards:           {cards_n:>6} filas")
    print(f"  accounts:        {accounts_n:>6} filas")
    print(f"  card_closings:   {card_closings_n:>6} filas")
    print(f"  investments:     {investments_n:>6} filas")
    print(f"  notifications:   {notifications_n:>6} filas")
    print("─" * 40)

    if dry_run:
        print("Modo dry-run: no se realizó ningún cambio.")
        conn.close()
        return

    confirm = input("¿Confirmar limpieza? [s/N] ").strip().lower()
    if confirm != "s":
        print("Cancelado.")
        conn.close()
        return

    cur.execute("DELETE FROM expenses")
    cur.execute("DELETE FROM analysis_history")
    cur.execute("DELETE FROM cards")
    cur.execute("DELETE FROM accounts")
    cur.execute("DELETE FROM card_closings")
    cur.execute("DELETE FROM investments")
    cur.execute("DELETE FROM notifications")
    if delete_categories:
        cur.execute("DELETE FROM categories")

    conn.commit()
    conn.close()

    print("Listo.")
    print(f"  expenses borrados:         {expenses_n}")
    print(f"  analysis_history borrados: {history_n}")
    print(f"  cards borradas:           {cards_n}")
    print(f"  accounts borrados:        {accounts_n}")
    print(f"  card_closings borrados:   {card_closings_n}")
    print(f"  investments borrados:     {investments_n}")
    print(f"  notifications borradas:   {notifications_n}")
    if delete_categories:
        print(f"  categories borradas:       {categories_n}")

if __name__ == "__main__":
    main()
