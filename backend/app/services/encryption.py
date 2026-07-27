import base64
import hashlib
import hmac
import logging
import os
import unicodedata

from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

_fernet_instance = None


def get_fernet() -> Fernet:
    """Singleton Fernet instance derived from SECRET_KEY."""
    global _fernet_instance
    if _fernet_instance is None:
        secret = os.getenv("SECRET_KEY", "")
        if len(secret) < 32:
            raise RuntimeError("SECRET_KEY must be at least 32 characters")
        key = hashlib.sha256(secret.encode()).digest()
        _fernet_instance = Fernet(base64.urlsafe_b64encode(key))
    return _fernet_instance


def encrypt_value(value: str) -> str:
    """Encrypt a string value using Fernet."""
    if not value:
        return value
    return get_fernet().encrypt(value.encode()).decode()


def decrypt_value(value: str) -> str:
    """Decrypt a Fernet-encrypted value. Falls back to '[encrypted]' if decryption fails."""
    if not value:
        return value
    try:
        return get_fernet().decrypt(value.encode()).decode()
    except Exception as e:
        logger.warning(f"Decryption failed for value starting with '{value[:30]}...': {e}")
        return "[encrypted]"


def compute_hmac(value: str) -> str:
    """Compute HMAC-SHA256 for lookup columns."""
    if not value:
        return value
    secret = os.getenv("SECRET_KEY", "")
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()


def tokenize_description(text: str) -> str:
    """Tokenize description for search.

    Converts 'Farmacía $1500 medicamentos' → 'farmacia 1500 medicamentos'

    - Lowercase
    - Remove accents (NFD decomposition)
    - Keep only alphanumeric + spaces
    - Collapse multiple spaces
    """
    if not text:
        return text
    text = text.lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = "".join(c if c.isalnum() or c.isspace() else " " for c in text)
    return " ".join(text.split())


def is_encrypted(value: str) -> bool:
    """Check if a value looks like it's Fernet-encrypted.

    Checks if value starts with Fernet token prefix 'gAAAAAB' which indicates
    it was encrypted with Fernet. This is more robust than trying to decrypt
    which may fail if the key has changed.

    Note: Comparison is case-insensitive to handle tokenized/lowercased values.
    """
    if not value:
        return False
    # Fernet tokens always start with 'gAAAAAB' (version byte + timestamp)
    # Use case-insensitive comparison to handle tokenized values
    return value.upper().startswith("GAAAAAB")
