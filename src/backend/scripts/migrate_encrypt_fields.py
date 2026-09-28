"""Migration script to encrypt existing plaintext data.

This script:
1. Encrypts plaintext fields in users, cards, expenses, investments, audit_logs, monthly_reports
2. Generates HMAC hashes for telegram_chat_id lookups
3. Generates search tokens for expense descriptions

Idempotent: safe to run multiple times (skips already-encrypted rows).
"""

import logging
import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database import SessionLocal
from app.services.encryption import (
    compute_hmac,
    encrypt_value,
    is_encrypted,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _migrate_table(db, table_name, id_column, query, fields):
    """Generic encrypt-and-update for a table.

    Args:
        db: SQLAlchemy session.
        table_name: Name for logging.
        id_column: Name of the primary key column.
        query: SQL SELECT to fetch rows (must return id as first column).
        fields: List of dicts, one per encryptable column:
            - "col": SELECT alias / row attribute name
            - "update": SET clause column name (e.g. "full_name = :fn")
            - "param": param name used in SET clause
            - "hmac_update" (optional): SET clause for HMAC column
            - "hmac_param" (optional): param name for HMAC value
            - "hmac_transform" (optional): function applied before HMAC (e.g. str.lower)
    """
    logger.info(f"Migrating {table_name} table...")
    raw = db.execute(text(query)).fetchall()
    migrated = 0

    for row in raw:
        row_id = row[0]
        updates = []
        params = {id_column: row_id}

        for i, field in enumerate(fields):
            value = row[1 + i]
            if value and not is_encrypted(value):
                updates.append(field["update"])
                params[field["param"]] = encrypt_value(value)
                if "hmac_update" in field:
                    updates.append(field["hmac_update"])
                    transform = field.get("hmac_transform", lambda v: v)
                    params[field["hmac_param"]] = compute_hmac(transform(value))

        if updates:
            db.execute(
                text(f"UPDATE {table_name} SET {', '.join(updates)} WHERE id = :{id_column}"),
                params,
            )
            migrated += 1

    db.commit()
    logger.info(f"  Migrated {migrated} {table_name}")


def migrate_plaintext_data():
    """Main migration function. Idempotent - safe to run multiple times."""
    db = SessionLocal()
    try:
        logger.info("Starting encryption migration...")

        _migrate_table(db, "users", "uid",
            "SELECT id, full_name, telegram_chat_id, mfa_secret FROM users", [
                dict(col="full_name", update="full_name = :fn", param="fn"),
                dict(col="telegram_chat_id", update="telegram_chat_id = :tcid", param="tcid",
                     hmac_update="telegram_chat_hash = :hash", hmac_param="hash"),
                dict(col="mfa_secret", update="mfa_secret = :mfa", param="mfa"),
            ])

        _migrate_table(db, "accounts", "aid",
            "SELECT id, name FROM accounts", [
                dict(col="name", update="name = :name", param="name",
                     hmac_update="name_hmac = :hmac", hmac_param="hmac"),
            ])

        _migrate_table(db, "cards", "cid",
            "SELECT id, card_name, bank, holder FROM cards", [
                dict(col="card_name", update="card_name = :cn", param="cn",
                     hmac_update="card_name_hmac = :cns", hmac_param="cns",
                     hmac_transform=str.lower),
                dict(col="bank", update="bank = :bk", param="bk",
                     hmac_update="bank_hmac = :bks", hmac_param="bks",
                     hmac_transform=str.lower),
                dict(col="holder", update="holder = :ho", param="ho"),
            ])

        _migrate_table(db, "expenses", "eid",
            "SELECT id, description, notes FROM expenses", [
                dict(col="description", update="description = :desc", param="desc",
                     hmac_update="description_hmac = :search", hmac_param="search"),
                dict(col="notes", update="notes = :notes", param="notes"),
            ])

        _migrate_table(db, "investments", "iid",
            "SELECT id, notes FROM investments WHERE notes IS NOT NULL", [
                dict(col="notes", update="notes = :notes", param="notes"),
            ])

        _migrate_table(db, "audit_logs", "lid",
            "SELECT id, ip_address, user_agent FROM audit_logs", [
                dict(col="ip_address", update="ip_address = :ip", param="ip"),
                dict(col="user_agent", update="user_agent = :ua", param="ua"),
            ])

        _migrate_table(db, "monthly_reports", "rid",
            "SELECT id, report_data FROM monthly_reports WHERE report_data IS NOT NULL", [
                dict(col="report_data", update="report_data = :rd", param="rd"),
            ])

        _migrate_table(db, "scheduled_expenses", "sid",
            "SELECT id, description FROM scheduled_expenses", [
                dict(col="description", update="description = :desc", param="desc",
                     hmac_update="description_hmac = :search", hmac_param="search"),
            ])

        logger.info("Encryption migration completed successfully!")
    except Exception as e:
        logger.error(f"Migration failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    migrate_plaintext_data()
