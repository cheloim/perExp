"""
Verify all encrypted fields can be decrypted.
Usage: python scripts/verify_encryption.py

Output: Status: PASS or FAIL + verbose details
"""

import logging
import sys

sys.path.insert(0, ".")

from app.database import SessionLocal
from app.models import AuditLog, Card, Expense, Investment, MonthlyReport, User
from app.services.encryption import decrypt_value, is_encrypted

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ENCRYPTED_FIELDS = {
    User: ["full_name", "telegram_chat_id", "mfa_secret"],
    Card: ["card_name", "bank", "holder"],
    Expense: ["description", "notes"],
    Investment: ["notes"],
    AuditLog: ["ip_address", "user_agent"],
    MonthlyReport: ["report_data"],
}

SEARCH_FIELDS = {
    Card: ["card_name_search", "bank_search", "holder_search"],
    Expense: ["description_search"],
}


def main():
    db = SessionLocal()
    stats = {"total": 0, "verified": 0, "failed": 0, "search_ok": 0, "search_missing": 0}
    failed_rows = []

    # Verify encrypted fields
    for model, fields in ENCRYPTED_FIELDS.items():
        rows = db.query(model).all()
        for row in rows:
            for field in fields:
                value = getattr(row, field)
                stats["total"] += 1
                if value and is_encrypted(value):
                    decrypted = decrypt_value(value)
                    if decrypted == "[encrypted]":
                        stats["failed"] += 1
                        failed_rows.append(f"{model.__tablename__}:{row.id}.{field}")
                    else:
                        stats["verified"] += 1

    # Verify search columns
    for model, fields in SEARCH_FIELDS.items():
        rows = db.query(model).all()
        for row in rows:
            for field in fields:
                value = getattr(row, field)
                if value:
                    stats["search_ok"] += 1
                else:
                    stats["search_missing"] += 1

    db.close()

    status = "PASS" if stats["failed"] == 0 else "FAIL"
    print(f"Status: {status}")
    print(f"Total: {stats['total']}")
    print(f"Verified: {stats['verified']}")
    print(f"Failed: {stats['failed']}")
    print(f"Search OK: {stats['search_ok']}")
    print(f"Search missing: {stats['search_missing']}")

    if failed_rows:
        print("\nFailed rows:")
        for row in failed_rows:
            print(f"  {row}")

    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
