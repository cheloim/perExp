"""Free-text matching and the blind index for encrypted expense fields.

Expense.description, Expense.notes and Category.name are EncryptedType
columns, so SQL LIKE cannot be used. ``build_search_grams`` stores HMACs of
the 2- and 3-grams in ``Expense.search_grams``; the GIN index narrows the
candidates and only those rows are decrypted and verified with
``expense_matches``. Both sides of the comparison go through
tokenize_description(), so matching is case- and accent-insensitive.
"""

from app.services.encryption import compute_hmac, tokenize_description


def _grams(text: str) -> set[str]:
    """Return the 2- and 3-grams of every word in ``text``."""
    grams: set[str] = set()
    for word in tokenize_description(text or "").split():
        for size in (2, 3):
            for start in range(len(word) - size + 1):
                grams.add(word[start : start + size])
    return grams


def build_search_grams(*fields: str | None) -> str:
    """Blind index for the searchable text fields.

    Each gram is HMACed with the encryption key, so the column never stores
    plaintext. Empty text yields an empty string (not NULL) to distinguish
    "indexed and empty" from "pending backfill".
    """
    grams: set[str] = set()
    for field in fields:
        grams.update(_grams(field or ""))
    return " ".join(sorted(compute_hmac(gram) for gram in grams))


def build_query_grams(search: str) -> list[str]:
    """HMACs of every gram in the query, ready for the GIN index."""
    return [compute_hmac(gram) for gram in sorted(_grams(search))]


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
