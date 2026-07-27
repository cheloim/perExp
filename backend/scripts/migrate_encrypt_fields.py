"""Migration script to encrypt existing plaintext data.

This script:
1. Encrypts plaintext fields in users, cards, expenses, investments, audit_logs, monthly_reports
2. Generates HMAC hashes for telegram_chat_id lookups
3. Generates search tokens for expense descriptions

Idempotent: safe to run multiple times (skips already-encrypted rows).
"""

import logging
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models import AuditLog, Card, Expense, Investment, MonthlyReport, User
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
    logger.info("Migrating users table...")
    offset = 0
    migrated = 0

    while True:
        users = db.query(User).offset(offset).limit(BATCH_SIZE).all()
        if not users:
            break

        for user in users:
            changed = False

            # Encrypt full_name if plaintext
            if user.full_name and not is_encrypted(user.full_name):
                user.full_name = encrypt_value(user.full_name)
                changed = True

            # Encrypt telegram_chat_id if plaintext and generate hash
            if user.telegram_chat_id and not is_encrypted(user.telegram_chat_id):
                original_value = user.telegram_chat_id
                user.telegram_chat_id = encrypt_value(original_value)
                user.telegram_chat_hash = compute_hmac(original_value)
                changed = True
            elif user.telegram_chat_id and not user.telegram_chat_hash:
                # Already encrypted but missing hash - decrypt and recompute
                from app.services.encryption import decrypt_value
                original_value = decrypt_value(user.telegram_chat_id)
                user.telegram_chat_hash = compute_hmac(original_value)
                changed = True

            # Encrypt mfa_secret if plaintext
            if user.mfa_secret and not is_encrypted(user.mfa_secret):
                user.mfa_secret = encrypt_value(user.mfa_secret)
                changed = True

            if changed:
                migrated += 1

        db.commit()
        offset += BATCH_SIZE

    logger.info(f"  Migrated {migrated} users")


def _migrate_cards(db):
    """Encrypt card fields."""
    logger.info("Migrating cards table...")
    offset = 0
    migrated = 0

    while True:
        cards = db.query(Card).offset(offset).limit(BATCH_SIZE).all()
        if not cards:
            break

        for card in cards:
            changed = False

            if card.card_name and not is_encrypted(card.card_name):
                card.card_name = encrypt_value(card.card_name)
                changed = True

            if card.bank and not is_encrypted(card.bank):
                card.bank = encrypt_value(card.bank)
                changed = True

            if card.holder and not is_encrypted(card.holder):
                card.holder = encrypt_value(card.holder)
                changed = True

            if changed:
                migrated += 1

        db.commit()
        offset += BATCH_SIZE

    logger.info(f"  Migrated {migrated} cards")


def _migrate_expenses(db):
    """Encrypt expense fields and generate description_search."""
    logger.info("Migrating expenses table...")
    offset = 0
    migrated = 0

    while True:
        expenses = db.query(Expense).offset(offset).limit(BATCH_SIZE).all()
        if not expenses:
            break

        for expense in expenses:
            changed = False

            if expense.description and not is_encrypted(expense.description):
                original_value = expense.description
                expense.description = encrypt_value(original_value)
                expense.description_search = tokenize_description(original_value)
                changed = True
            elif expense.description and not expense.description_search:
                # Already encrypted but missing search tokens
                from app.services.encryption import decrypt_value
                original_value = decrypt_value(expense.description)
                expense.description_search = tokenize_description(original_value)
                changed = True

            if expense.notes and not is_encrypted(expense.notes):
                expense.notes = encrypt_value(expense.notes)
                changed = True

            if changed:
                migrated += 1

        db.commit()
        offset += BATCH_SIZE

    logger.info(f"  Migrated {migrated} expenses")


def _migrate_investments(db):
    """Encrypt investment notes."""
    logger.info("Migrating investments table...")
    offset = 0
    migrated = 0

    while True:
        investments = db.query(Investment).offset(offset).limit(BATCH_SIZE).all()
        if not investments:
            break

        for inv in investments:
            changed = False

            if inv.notes and not is_encrypted(inv.notes):
                inv.notes = encrypt_value(inv.notes)
                changed = True

            if changed:
                migrated += 1

        db.commit()
        offset += BATCH_SIZE

    logger.info(f"  Migrated {migrated} investments")


def _migrate_audit_logs(db):
    """Encrypt audit log fields."""
    logger.info("Migrating audit_logs table...")
    offset = 0
    migrated = 0

    while True:
        logs = db.query(AuditLog).offset(offset).limit(BATCH_SIZE).all()
        if not logs:
            break

        for log in logs:
            changed = False

            if log.ip_address and not is_encrypted(log.ip_address):
                log.ip_address = encrypt_value(log.ip_address)
                changed = True

            if log.user_agent and not is_encrypted(log.user_agent):
                log.user_agent = encrypt_value(log.user_agent)
                changed = True

            if changed:
                migrated += 1

        db.commit()
        offset += BATCH_SIZE

    logger.info(f"  Migrated {migrated} audit logs")


def _migrate_monthly_reports(db):
    """Encrypt monthly report data."""
    logger.info("Migrating monthly_reports table...")
    offset = 0
    migrated = 0

    while True:
        reports = db.query(MonthlyReport).offset(offset).limit(BATCH_SIZE).all()
        if not reports:
            break

        for report in reports:
            changed = False

            if report.report_data and not is_encrypted(report.report_data):
                report.report_data = encrypt_value(report.report_data)
                changed = True

            if changed:
                migrated += 1

        db.commit()
        offset += BATCH_SIZE

    logger.info(f"  Migrated {migrated} monthly reports")


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

        logger.info("Encryption migration completed successfully!")
    except Exception as e:
        logger.error(f"Migration failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    migrate_plaintext_data()
