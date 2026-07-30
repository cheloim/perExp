"""
Dry-run migration: encrypt, verify, rollback.
Usage: python scripts/dry_run_migration.py

Tests:
1. Encrypt all fields (User, Card, Expense, etc.)
2. Verify all encrypted fields can be decrypted
3. Verify HMAC columns are populated
4. Rollback transaction (no changes saved)

Output: Status: PASS or FAIL + verbose details
"""

import logging
import sys

sys.path.insert(0, ".")

from app.database import SessionLocal
from app.models import Account, AuditLog, Card, Expense, Investment, MonthlyReport, ScheduledExpense, User
from app.services.encryption import (
    decrypt_value,
    encrypt_value,
    is_encrypted,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ENCRYPTED_FIELDS = {
    User: ["full_name", "telegram_chat_id", "mfa_secret"],
    Card: ["card_name", "bank", "holder"],
    Expense: ["description", "notes"],
    ScheduledExpense: ["description"],
    Investment: ["notes"],
    AuditLog: ["ip_address", "user_agent"],
    MonthlyReport: ["report_data"],
}

SEARCH_FIELDS = {
    Card: ["card_name_hmac", "bank_hmac"],
    Expense: ["description_hmac"],
    ScheduledExpense: ["description_hmac"],
    Account: ["name_hmac"],
}


def main():
    db = SessionLocal()
    db.begin()  # Start transaction

    stats = {
        "tables": 0,
        "encrypted": 0,
        "verified": 0,
        "failed": 0,
        "search_verified": 0,
        "search_failed": 0,
    }
    failed_rows = []

    try:
        # Test encryption on all fields
        for model, fields in ENCRYPTED_FIELDS.items():
            stats["tables"] += 1
            rows = db.query(model).all()

            for row in rows:
                for field in fields:
                    value = getattr(row, field)
                    if value and not is_encrypted(value):
                        stats["encrypted"] += 1

                        # Verify can encrypt and decrypt
                        encrypted = encrypt_value(value)
                        decrypted = decrypt_value(encrypted)
                        if decrypted == value:
                            stats["verified"] += 1
                        else:
                            stats["failed"] += 1
                            failed_rows.append(
                                {
                                    "table": model.__tablename__,
                                    "id": row.id,
                                    "field": field,
                                    "error": "decrypt mismatch",
                                }
                            )

        # Verify HMAC columns - only test rows that already have HMAC values
        for model, fields in SEARCH_FIELDS.items():
            rows = db.query(model).all()
            for row in rows:
                for field in fields:
                    hmac_value = getattr(row, field)
                    if hmac_value:
                        stats["search_verified"] += 1
                    else:
                        stats["search_failed"] += 1
                        failed_rows.append(
                            {
                                "table": model.__tablename__,
                                "id": row.id,
                                "field": field,
                                "error": "HMAC column empty",
                            }
                        )

        # Rollback (no changes saved)
        db.rollback()

        # Print summary
        status = "PASS" if stats["failed"] == 0 and stats["search_failed"] == 0 else "FAIL"
        print(f"Status: {status}")
        print(f"Tables: {stats['tables']}")
        print(f"Encrypted: {stats['encrypted']}")
        print(f"Verified: {stats['verified']}")
        print(f"Failed: {stats['failed']}")
        print(f"Search verified: {stats['search_verified']}")
        print(f"Search failed: {stats['search_failed']}")

        if failed_rows:
            print("\nFailed rows:")
            for row in failed_rows:
                print(f"  {row['table']}:{row['id']}.{row['field']} - {row['error']}")

        return 0 if status == "PASS" else 1

    except Exception as e:
        db.rollback()
        print("Status: FAIL")
        print(f"Error: {e}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
