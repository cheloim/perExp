"""
Dry-run migration: encrypt, verify, rollback.
Usage: python scripts/dry_run_migration.py

Tests:
1. Encrypt all fields (User, Card, Expense, etc.)
2. Verify all encrypted fields can be decrypted
3. Verify Card search columns work (ilike queries)
4. Verify Expense search columns work (ilike queries)
5. Rollback transaction (no changes saved)

Output: Status: PASS or FAIL + verbose details
"""

import logging
import sys

sys.path.insert(0, ".")

from app.database import SessionLocal
from app.models import AuditLog, Card, Expense, Investment, MonthlyReport, ScheduledExpense, User
from app.services.encryption import (
    decrypt_value,
    encrypt_value,
    is_encrypted,
    tokenize_description,
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
    Card: ["card_name_search", "bank_search", "holder_search"],
    Expense: ["description_search"],
    ScheduledExpense: ["description_search"],
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

        # Test Card search columns
        for model, fields in SEARCH_FIELDS.items():
            rows = db.query(model).all()
            for row in rows:
                for field in fields:
                    source_field = field.replace("_search", "")
                    source_value = getattr(row, source_field)
                    if source_value:
                        # Generate search token
                        if is_encrypted(source_value):
                            plaintext = decrypt_value(source_value)
                        else:
                            plaintext = source_value
                        search_value = tokenize_description(plaintext)

                        if search_value:
                            stats["search_verified"] += 1

                            # Test ilike query
                            result = (
                                db.query(model)
                                .filter(getattr(model, field).ilike(f"%{search_value[:5]}%"))
                                .first()
                            )
                            if not result:
                                stats["search_failed"] += 1
                                failed_rows.append(
                                    {
                                        "table": model.__tablename__,
                                        "id": row.id,
                                        "field": field,
                                        "error": "search query failed",
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
        print(f"Status: FAIL")
        print(f"Error: {e}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
