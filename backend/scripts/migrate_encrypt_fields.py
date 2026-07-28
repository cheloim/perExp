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
    tokenize_description,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _migrate_users(db):
    """Encrypt user fields and generate telegram_chat_hash."""
    logger.info("Migrating users table...")

    raw = db.execute(
        text("SELECT id, full_name, telegram_chat_id, mfa_secret FROM users")
    ).fetchall()
    migrated = 0

    for row in raw:
        uid, fn, tcid, mfa = row
        updates = []
        params = {"uid": uid}

        if fn and not is_encrypted(fn):
            updates.append("full_name = :fn")
            params["fn"] = encrypt_value(fn)

        if tcid and not is_encrypted(tcid):
            updates.append("telegram_chat_id = :tcid")
            params["tcid"] = encrypt_value(tcid)
            updates.append("telegram_chat_hash = :hash")
            params["hash"] = compute_hmac(tcid)

        if mfa and not is_encrypted(mfa):
            updates.append("mfa_secret = :mfa")
            params["mfa"] = encrypt_value(mfa)

        if updates:
            db.execute(
                text(f"UPDATE users SET {', '.join(updates)} WHERE id = :uid"), params
            )
            migrated += 1

    db.commit()
    logger.info(f"  Migrated {migrated} users")


def _migrate_cards(db):
    """Encrypt card fields and generate search tokens."""
    logger.info("Migrating cards table...")

    raw = db.execute(
        text("SELECT id, card_name, bank, holder FROM cards")
    ).fetchall()
    migrated = 0

    for row in raw:
        cid, cn, bk, ho = row
        updates = []
        params = {"cid": cid}

        if cn and not is_encrypted(cn):
            updates.append("card_name = :cn")
            params["cn"] = encrypt_value(cn)
            updates.append("card_name_search = :cns")
            params["cns"] = tokenize_description(cn)

        if bk and not is_encrypted(bk):
            updates.append("bank = :bk")
            params["bk"] = encrypt_value(bk)
            updates.append("bank_search = :bks")
            params["bks"] = tokenize_description(bk)

        if ho and not is_encrypted(ho):
            updates.append("holder = :ho")
            params["ho"] = encrypt_value(ho)
            updates.append("holder_search = :hos")
            params["hos"] = tokenize_description(ho)

        if updates:
            db.execute(
                text(f"UPDATE cards SET {', '.join(updates)} WHERE id = :cid"), params
            )
            migrated += 1

    db.commit()
    logger.info(f"  Migrated {migrated} cards")


def _migrate_expenses(db):
    """Encrypt expense fields and generate description_search."""
    logger.info("Migrating expenses table...")

    raw = db.execute(text("SELECT id, description, notes FROM expenses")).fetchall()
    migrated = 0

    for row in raw:
        eid, desc, notes = row
        updates = []
        params = {"eid": eid}

        if desc and not is_encrypted(desc):
            updates.append("description = :desc")
            params["desc"] = encrypt_value(desc)
            updates.append("description_search = :search")
            params["search"] = tokenize_description(desc)

        if notes and not is_encrypted(notes):
            updates.append("notes = :notes")
            params["notes"] = encrypt_value(notes)

        if updates:
            db.execute(
                text(f"UPDATE expenses SET {', '.join(updates)} WHERE id = :eid"),
                params,
            )
            migrated += 1

    db.commit()
    logger.info(f"  Migrated {migrated} expenses")


def _migrate_investments(db):
    """Encrypt investment notes."""
    logger.info("Migrating investments table...")

    raw = db.execute(
        text("SELECT id, notes FROM investments WHERE notes IS NOT NULL")
    ).fetchall()
    migrated = 0

    for row in raw:
        iid, notes = row
        if notes and not is_encrypted(notes):
            db.execute(
                text("UPDATE investments SET notes = :notes WHERE id = :iid"),
                {"notes": encrypt_value(notes), "iid": iid},
            )
            migrated += 1

    db.commit()
    logger.info(f"  Migrated {migrated} investments")


def _migrate_audit_logs(db):
    """Encrypt audit log fields."""
    logger.info("Migrating audit_logs table...")

    raw = db.execute(
        text("SELECT id, ip_address, user_agent FROM audit_logs")
    ).fetchall()
    migrated = 0

    for row in raw:
        lid, ip, ua = row
        updates = []
        params = {"lid": lid}

        if ip and not is_encrypted(ip):
            updates.append("ip_address = :ip")
            params["ip"] = encrypt_value(ip)

        if ua and not is_encrypted(ua):
            updates.append("user_agent = :ua")
            params["ua"] = encrypt_value(ua)

        if updates:
            db.execute(
                text(f"UPDATE audit_logs SET {', '.join(updates)} WHERE id = :lid"),
                params,
            )
            migrated += 1

    db.commit()
    logger.info(f"  Migrated {migrated} audit logs")


def _migrate_monthly_reports(db):
    """Encrypt monthly report data."""
    logger.info("Migrating monthly_reports table...")

    raw = db.execute(
        text("SELECT id, report_data FROM monthly_reports WHERE report_data IS NOT NULL")
    ).fetchall()
    migrated = 0

    for row in raw:
        rid, rd = row
        if rd and not is_encrypted(rd):
            db.execute(
                text("UPDATE monthly_reports SET report_data = :rd WHERE id = :rid"),
                {"rd": encrypt_value(rd), "rid": rid},
            )
            migrated += 1

    db.commit()
    logger.info(f"  Migrated {migrated} monthly reports")


def _migrate_scheduled_expenses(db):
    """Encrypt scheduled expense fields and generate search tokens."""
    logger.info("Migrating scheduled_expenses table...")

    raw = db.execute(
        text("SELECT id, description FROM scheduled_expenses")
    ).fetchall()
    migrated = 0

    for row in raw:
        sid, desc = row
        if desc and not is_encrypted(desc):
            db.execute(
                text(
                    "UPDATE scheduled_expenses SET description = :desc, description_search = :search WHERE id = :sid"
                ),
                {
                    "desc": encrypt_value(desc),
                    "search": tokenize_description(desc),
                    "sid": sid,
                },
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
