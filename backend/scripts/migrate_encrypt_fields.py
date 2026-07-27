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
            # Note: EncryptedType handles encryption automatically when writing
            # We just need to check if the value in DB is already encrypted
            if user.full_name and not is_encrypted(user.full_name):
                # Value is plaintext, mark for re-save (EncryptedType will encrypt)
                user.full_name = user.full_name  # Touch to trigger update
                changed = True

            # Generate telegram_chat_hash if missing
            if user.telegram_chat_id and not user.telegram_chat_hash:
                from app.services.encryption import decrypt_value
                # Get the plaintext value (already decrypted by ORM)
                original_value = user.telegram_chat_id
                user.telegram_chat_hash = compute_hmac(original_value)
                changed = True

            # Encrypt mfa_secret if plaintext
            if user.mfa_secret and not is_encrypted(user.mfa_secret):
                user.mfa_secret = user.mfa_secret  # Touch to trigger update
                changed = True

            if changed:
                migrated += 1

        db.commit()
        offset += BATCH_SIZE

    logger.info(f"  Migrated {migrated} users")


def _migrate_cards(db):
    """Encrypt card fields and generate search tokens."""
    logger.info("Migrating cards table...")
    offset = 0
    migrated = 0

    while True:
        cards = db.query(Card).offset(offset).limit(BATCH_SIZE).all()
        if not cards:
            break

        for card in cards:
            changed = False

            # Encrypt card_name and generate search token
            if card.card_name and not is_encrypted(card.card_name):
                card.card_name = card.card_name  # Touch to trigger update
                card.card_name_search = tokenize_description(card.card_name)
                changed = True
            elif card.card_name and (
                not card.card_name_search or is_encrypted(card.card_name_search)
            ):
                # Already encrypted but missing or encrypted search token
                from app.services.encryption import decrypt_value
                card.card_name_search = tokenize_description(decrypt_value(card.card_name))
                changed = True

            # Encrypt bank and generate search token
            if card.bank and not is_encrypted(card.bank):
                card.bank = card.bank  # Touch to trigger update
                card.bank_search = tokenize_description(card.bank)
                changed = True
            elif card.bank and (
                not card.bank_search or is_encrypted(card.bank_search)
            ):
                from app.services.encryption import decrypt_value
                card.bank_search = tokenize_description(decrypt_value(card.bank))
                changed = True

            # Encrypt holder and generate search token
            if card.holder and not is_encrypted(card.holder):
                card.holder = card.holder  # Touch to trigger update
                card.holder_search = tokenize_description(card.holder)
                changed = True
            elif card.holder and (
                not card.holder_search or is_encrypted(card.holder_search)
            ):
                from app.services.encryption import decrypt_value
                card.holder_search = tokenize_description(decrypt_value(card.holder))
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

            # Note: EncryptedType handles encryption automatically
            # We just need to touch the field to trigger update
            if expense.description and not is_encrypted(expense.description):
                # Value is plaintext, get it before ORM encrypts
                original_value = expense.description
                # Touch to trigger update (EncryptedType will encrypt)
                expense.description = original_value
                # Generate search tokens from plaintext
                expense.description_search = tokenize_description(original_value)
                changed = True
            elif expense.description and (
                not expense.description_search or is_encrypted(expense.description_search)
            ):
                # Already encrypted but missing search tokens
                # or search tokens are encrypted (need to regenerate)
                # ORM already decrypted it, so we can use the value directly
                expense.description_search = tokenize_description(expense.description)
                changed = True

            if expense.notes and not is_encrypted(expense.notes):
                expense.notes = expense.notes  # Touch to trigger update
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

            # Note: EncryptedType handles encryption automatically
            if inv.notes and not is_encrypted(inv.notes):
                inv.notes = inv.notes  # Touch to trigger update
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

            # Note: EncryptedType handles encryption automatically
            if log.ip_address and not is_encrypted(log.ip_address):
                log.ip_address = log.ip_address  # Touch to trigger update
                changed = True

            if log.user_agent and not is_encrypted(log.user_agent):
                log.user_agent = log.user_agent  # Touch to trigger update
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

            # Note: EncryptedType handles encryption automatically
            if report.report_data and not is_encrypted(report.report_data):
                report.report_data = report.report_data  # Touch to trigger update
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
