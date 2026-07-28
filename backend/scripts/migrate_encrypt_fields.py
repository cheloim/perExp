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

from app.database import SessionLocal
from app.models import Card, Expense, ScheduledExpense, User
from app.services.encryption import (
    compute_hmac,
    encrypt_value,
    is_encrypted,
    tokenize_description,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BATCH_SIZE = 100


def _migrate_users(db):
    """Encrypt user fields and generate telegram_chat_hash."""
    from sqlalchemy import text

    logger.info("Migrating users table...")
    migrated = 0

    # Fetch ALL raw values from DB (bypass EncryptedType which returns [encrypted] for plaintext)
    raw_rows = db.execute(text("SELECT id, full_name, telegram_chat_id, mfa_secret FROM users")).fetchall()
    raw_data = {r[0]: {"full_name": r[1], "telegram_chat_id": r[2], "mfa_secret": r[3]} for r in raw_rows}

    for user_id, raw in raw_data.items():
        if not raw["full_name"] and not raw["telegram_chat_id"] and not raw["mfa_secret"]:
            continue

        # Use raw SQL UPDATE to encrypt (bypass ORM EncryptedType)
        updates = []
        params = {"uid": user_id}

        if raw["full_name"] and not is_encrypted(raw["full_name"]):
            updates.append("full_name = :full_name")
            params["full_name"] = encrypt_value(raw["full_name"])

        if raw["telegram_chat_id"] and not is_encrypted(raw["telegram_chat_id"]):
            updates.append("telegram_chat_id = :telegram_chat_id")
            params["telegram_chat_id"] = encrypt_value(raw["telegram_chat_id"])
            # Generate HMAC from raw plaintext
            updates.append("telegram_chat_hash = :telegram_chat_hash")
            params["telegram_chat_hash"] = compute_hmac(raw["telegram_chat_id"])
        elif raw["telegram_chat_id"] and is_encrypted(raw["telegram_chat_id"]):
            # Already encrypted, just generate hash if missing
            user = db.query(User).get(user_id)
            if user and not user.telegram_chat_hash:
                updates.append("telegram_chat_hash = :telegram_chat_hash")
                params["telegram_chat_hash"] = compute_hmac(user.telegram_chat_id)

        if raw["mfa_secret"] and not is_encrypted(raw["mfa_secret"]):
            updates.append("mfa_secret = :mfa_secret")
            params["mfa_secret"] = encrypt_value(raw["mfa_secret"])

        if updates:
            sql = f"UPDATE users SET {', '.join(updates)} WHERE id = :uid"
            db.execute(text(sql), params)
            migrated += 1

    db.commit()
    logger.info(f"  Migrated {migrated} users")


def _migrate_cards(db):
    """Encrypt card fields and generate search tokens."""
    from sqlalchemy import text

    logger.info("Migrating cards table...")
    migrated = 0

    # Fetch ALL raw values from DB
    raw_rows = db.execute(
        text("SELECT id, card_name, bank, holder FROM cards")
    ).fetchall()
    raw_data = {r[0]: {"card_name": r[1], "bank": r[2], "holder": r[3]} for r in raw_rows}

    for card_id, raw in raw_data.items():
        updates = []
        params = {"cid": card_id}

        if raw["card_name"] and not is_encrypted(raw["card_name"]):
            updates.append("card_name = :card_name")
            params["card_name"] = encrypt_value(raw["card_name"])
            updates.append("card_name_search = :card_name_search")
            params["card_name_search"] = tokenize_description(raw["card_name"])
        elif raw["card_name"] and is_encrypted(raw["card_name"]):
            # Already encrypted, generate search if missing
            card = db.query(Card).get(card_id)
            if card and (not card.card_name_search or is_encrypted(card.card_name_search)):
                updates.append("card_name_search = :card_name_search")
                params["card_name_search"] = tokenize_description(card.card_name)

        if raw["bank"] and not is_encrypted(raw["bank"]):
            updates.append("bank = :bank")
            params["bank"] = encrypt_value(raw["bank"])
            updates.append("bank_search = :bank_search")
            params["bank_search"] = tokenize_description(raw["bank"])
        elif raw["bank"] and is_encrypted(raw["bank"]):
            card = db.query(Card).get(card_id)
            if card and (not card.bank_search or is_encrypted(card.bank_search)):
                updates.append("bank_search = :bank_search")
                params["bank_search"] = tokenize_description(card.bank)

        if raw["holder"] and not is_encrypted(raw["holder"]):
            updates.append("holder = :holder")
            params["holder"] = encrypt_value(raw["holder"])
            updates.append("holder_search = :holder_search")
            params["holder_search"] = tokenize_description(raw["holder"])
        elif raw["holder"] and is_encrypted(raw["holder"]):
            card = db.query(Card).get(card_id)
            if card and (not card.holder_search or is_encrypted(card.holder_search)):
                updates.append("holder_search = :holder_search")
                params["holder_search"] = tokenize_description(card.holder)

        if updates:
            sql = f"UPDATE cards SET {', '.join(updates)} WHERE id = :cid"
            db.execute(text(sql), params)
            migrated += 1

    db.commit()
    logger.info(f"  Migrated {migrated} cards")


def _migrate_expenses(db):
    """Encrypt expense fields and generate description_search."""
    from sqlalchemy import text

    logger.info("Migrating expenses table...")
    migrated = 0

    # Fetch ALL raw values from DB
    raw_rows = db.execute(
        text("SELECT id, description, notes FROM expenses")
    ).fetchall()
    raw_data = {r[0]: {"description": r[1], "notes": r[2]} for r in raw_rows}

    for exp_id, raw in raw_data.items():
        updates = []
        params = {"eid": exp_id}

        if raw["description"] and not is_encrypted(raw["description"]):
            updates.append("description = :description")
            params["description"] = encrypt_value(raw["description"])
            updates.append("description_search = :description_search")
            params["description_search"] = tokenize_description(raw["description"])
        elif raw["description"] and is_encrypted(raw["description"]):
            # Already encrypted, generate search if missing
            exp = db.query(Expense).get(exp_id)
            if exp and (not exp.description_search or is_encrypted(exp.description_search)):
                updates.append("description_search = :description_search")
                params["description_search"] = tokenize_description(exp.description)

        if raw["notes"] and not is_encrypted(raw["notes"]):
            updates.append("notes = :notes")
            params["notes"] = encrypt_value(raw["notes"])

        if updates:
            sql = f"UPDATE expenses SET {', '.join(updates)} WHERE id = :eid"
            db.execute(text(sql), params)
            migrated += 1

    db.commit()
    logger.info(f"  Migrated {migrated} expenses")


def _migrate_investments(db):
    """Encrypt investment notes."""
    from sqlalchemy import text

    logger.info("Migrating investments table...")
    migrated = 0

    raw_rows = db.execute(text("SELECT id, notes FROM investments")).fetchall()
    raw_data = {r[0]: {"notes": r[1]} for r in raw_rows}

    for inv_id, raw in raw_data.items():
        if raw["notes"] and not is_encrypted(raw["notes"]):
            db.execute(
                text("UPDATE investments SET notes = :notes WHERE id = :iid"),
                {"notes": encrypt_value(raw["notes"]), "iid": inv_id},
            )
            migrated += 1

    db.commit()
    logger.info(f"  Migrated {migrated} investments")


def _migrate_audit_logs(db):
    """Encrypt audit log fields."""
    from sqlalchemy import text

    logger.info("Migrating audit_logs table...")
    migrated = 0

    raw_rows = db.execute(
        text("SELECT id, ip_address, user_agent FROM audit_logs")
    ).fetchall()
    raw_data = {r[0]: {"ip_address": r[1], "user_agent": r[2]} for r in raw_rows}

    for log_id, raw in raw_data.items():
        updates = []
        params = {"lid": log_id}

        if raw["ip_address"] and not is_encrypted(raw["ip_address"]):
            updates.append("ip_address = :ip_address")
            params["ip_address"] = encrypt_value(raw["ip_address"])

        if raw["user_agent"] and not is_encrypted(raw["user_agent"]):
            updates.append("user_agent = :user_agent")
            params["user_agent"] = encrypt_value(raw["user_agent"])

        if updates:
            sql = f"UPDATE audit_logs SET {', '.join(updates)} WHERE id = :lid"
            db.execute(text(sql), params)
            migrated += 1

    db.commit()
    logger.info(f"  Migrated {migrated} audit logs")


def _migrate_monthly_reports(db):
    """Encrypt monthly report data."""
    from sqlalchemy import text

    logger.info("Migrating monthly_reports table...")
    migrated = 0

    raw_rows = db.execute(text("SELECT id, report_data FROM monthly_reports")).fetchall()
    raw_data = {r[0]: {"report_data": r[1]} for r in raw_rows}

    for report_id, raw in raw_data.items():
        if raw["report_data"] and not is_encrypted(raw["report_data"]):
            db.execute(
                text("UPDATE monthly_reports SET report_data = :report_data WHERE id = :rid"),
                {"report_data": encrypt_value(raw["report_data"]), "rid": report_id},
            )
            migrated += 1

    db.commit()
    logger.info(f"  Migrated {migrated} monthly reports")


def _migrate_scheduled_expenses(db):
    """Encrypt scheduled expense fields and generate search tokens."""
    from sqlalchemy import text

    logger.info("Migrating scheduled_expenses table...")
    migrated = 0

    raw_rows = db.execute(
        text("SELECT id, description FROM scheduled_expenses")
    ).fetchall()
    raw_data = {r[0]: {"description": r[1]} for r in raw_rows}

    for exp_id, raw in raw_data.items():
        if raw["description"] and not is_encrypted(raw["description"]):
            db.execute(
                text(
                    "UPDATE scheduled_expenses SET description = :desc, description_search = :search WHERE id = :eid"
                ),
                {
                    "desc": encrypt_value(raw["description"]),
                    "search": tokenize_description(raw["description"]),
                    "eid": exp_id,
                },
            )
            migrated += 1
        elif raw["description"] and is_encrypted(raw["description"]):
            # Already encrypted, generate search if missing
            exp = db.query(ScheduledExpense).get(exp_id)
            if exp and (not exp.description_search or is_encrypted(exp.description_search)):
                db.execute(
                    text(
                        "UPDATE scheduled_expenses SET description_search = :search WHERE id = :eid"
                    ),
                    {"search": tokenize_description(exp.description), "eid": exp_id},
                )
                migrated += 1

    db.commit()
    logger.info(f"  Migrated {migrated} scheduled expenses")


def migrate_plaintext_data():
    """Main migration function. Idempotent - safe to run multiple times."""
    db = SessionLocal()
    try:
        logger.info("Starting encryption migration...")

        _migrate_users(db)
        _migrate_cards(db)
        _migrate_expenses(db)
        _migrate_investments(db)
        _migrate_audit_logs(db)
        _migrate_monthly_reports(db)
        _migrate_scheduled_expenses(db)

        logger.info("Encryption migration completed successfully!")
    except Exception as e:
        logger.error(f"Migration failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    migrate_plaintext_data()
