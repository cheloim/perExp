"""Free-text matching for expenses whose fields are encrypted.

Expense.description, Expense.notes and Category.name are EncryptedType
columns, so SQL LIKE cannot be used: rows are decrypted and matched at
application level, the same way bank/person/card filters work on
GET /expenses. Both sides of the comparison go through
tokenize_description(), so matching is case- and accent-insensitive.
"""

from app.services.encryption import tokenize_description


def expense_matches(
    search: str,
    description: str | None = None,
    notes: str | None = None,
    category_name: str | None = None,
) -> bool:
    """Return True when `search` occurs in any of the expense's text fields.

    An empty or whitespace-only search matches every expense.
    """
    needle = tokenize_description(search or "")
    if not needle:
        return True
    return any(
        needle in tokenize_description(part or "") for part in (description, notes, category_name)
    )
