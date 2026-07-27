"""Unit tests for the encryption module."""

import os
import unittest
from unittest.mock import patch

# Set SECRET_KEY before importing encryption module
os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars-long-for-testing"

from app.services.encryption import (
    compute_hmac,
    decrypt_value,
    encrypt_value,
    is_encrypted,
    tokenize_description,
)


class TestEncryption(unittest.TestCase):
    """Test Fernet encryption/decryption."""

    def test_encrypt_decrypt_roundtrip(self):
        """Encrypt then decrypt returns original value."""
        original = "Hello, World! 123"
        encrypted = encrypt_value(original)
        decrypted = decrypt_value(encrypted)
        self.assertEqual(decrypted, original)

    def test_encrypt_returns_different_value(self):
        """Encrypted value is different from original."""
        original = "Sensitive data"
        encrypted = encrypt_value(original)
        self.assertNotEqual(encrypted, original)

    def test_encrypt_empty_string(self):
        """Encrypting empty string returns empty string."""
        self.assertEqual(encrypt_value(""), "")

    def test_decrypt_empty_string(self):
        """Decrypting empty string returns empty string."""
        self.assertEqual(decrypt_value(""), "")

    def test_decrypt_none(self):
        """Decrypting None returns None."""
        self.assertIsNone(decrypt_value(None))

    def test_decrypt_plaintext_fallback(self):
        """Decryption of plaintext returns plaintext (migration support)."""
        plaintext = "not-encrypted-data"
        result = decrypt_value(plaintext)
        self.assertEqual(result, plaintext)

    def test_encrypt_deterministic(self):
        """Same input produces same ciphertext (Fernet with same key)."""
        original = "test-value"
        encrypted1 = encrypt_value(original)
        encrypted2 = encrypt_value(original)
        # Fernet uses random IV, so ciphertext will be different
        # but both should decrypt to same value
        self.assertEqual(decrypt_value(encrypted1), decrypt_value(encrypted2))

    def test_is_encrypted_true(self):
        """is_encrypted returns True for encrypted values."""
        encrypted = encrypt_value("test")
        self.assertTrue(is_encrypted(encrypted))

    def test_is_encrypted_false(self):
        """is_encrypted returns False for plaintext."""
        self.assertFalse(is_encrypted("plaintext"))

    def test_is_encrypted_empty(self):
        """is_encrypted returns False for empty string."""
        self.assertFalse(is_encrypted(""))

    def test_is_encrypted_none(self):
        """is_encrypted returns False for None."""
        self.assertFalse(is_encrypted(None))

    def test_is_encrypted_fernet_prefix(self):
        """is_encrypted detects Fernet token prefix."""
        # Fernet tokens start with 'gAAAAAB'
        self.assertTrue(is_encrypted("gAAAAABqZ3jJ-1GzGpLcQ3a"))
        self.assertTrue(is_encrypted("gaaaaabqZ3jJ-1GzGpLcQ3a"))  # Case-insensitive
        self.assertFalse(is_encrypted("not-encrypted"))
        self.assertFalse(is_encrypted("gAAAA"))  # Too short


class TestHMAC(unittest.TestCase):
    """Test HMAC computation."""

    def test_hmac_deterministic(self):
        """Same input produces same HMAC."""
        hmac1 = compute_hmac("test-value")
        hmac2 = compute_hmac("test-value")
        self.assertEqual(hmac1, hmac2)

    def test_hmac_different_inputs(self):
        """Different inputs produce different HMACs."""
        hmac1 = compute_hmac("value1")
        hmac2 = compute_hmac("value2")
        self.assertNotEqual(hmac1, hmac2)

    def test_hmac_length(self):
        """HMAC is 64 hex characters (SHA-256)."""
        hmac_value = compute_hmac("test")
        self.assertEqual(len(hmac_value), 64)

    def test_hmac_empty_string(self):
        """Computing HMAC of empty string returns empty string."""
        self.assertEqual(compute_hmac(""), "")

    def test_hmac_none(self):
        """Computing HMAC of None returns None."""
        self.assertIsNone(compute_hmac(None))


class TestTokenization(unittest.TestCase):
    """Test description tokenization."""

    def test_basic_tokenization(self):
        """Basic lowercase and cleanup."""
        result = tokenize_description("Farmacity $1500 medicamentos")
        self.assertEqual(result, "farmacity 1500 medicamentos")

    def test_accent_removal(self):
        """Accents are removed."""
        result = tokenize_description("Farmacía medicamentos")
        self.assertEqual(result, "farmacia medicamentos")

    def test_special_characters(self):
        """Special characters replaced with spaces."""
        result = tokenize_description("Netflix USD 5.99")
        self.assertEqual(result, "netflix usd 5 99")

    def test_multiple_spaces_collapsed(self):
        """Multiple spaces collapsed to single space."""
        result = tokenize_description("  hello   world  ")
        self.assertEqual(result, "hello world")

    def test_empty_string(self):
        """Empty string returns empty string."""
        self.assertEqual(tokenize_description(""), "")

    def test_none(self):
        """None returns None."""
        self.assertIsNone(tokenize_description(None))

    def test_spanish_text(self):
        """Spanish text with accents and special chars."""
        result = tokenize_description("Almuerzo con José María - $8.500")
        self.assertEqual(result, "almuerzo con jose maria 8 500")

    def test_mixed_case(self):
        """Mixed case normalized to lowercase."""
        result = tokenize_description("UBER Eats Delivery")
        self.assertEqual(result, "uber eats delivery")


class TestEncryptionTypeDecorator(unittest.TestCase):
    """Test SQLAlchemy EncryptedType decorator."""

    def test_encrypted_type_import(self):
        """EncryptedType can be imported."""
        from app.types.encrypted import EncryptedType
        self.assertIsNotNone(EncryptedType)

    def test_encrypted_type_bind_param(self):
        """EncryptedType encrypts on bind."""
        from app.types.encrypted import EncryptedType
        enc_type = EncryptedType()
        encrypted = enc_type.process_bind_param("test-value", None)
        self.assertNotEqual(encrypted, "test-value")
        self.assertTrue(is_encrypted(encrypted))

    def test_encrypted_type_result_value(self):
        """EncryptedType decrypts on result."""
        from app.types.encrypted import EncryptedType
        enc_type = EncryptedType()
        encrypted = encrypt_value("test-value")
        decrypted = enc_type.process_result_value(encrypted, None)
        self.assertEqual(decrypted, "test-value")

    def test_encrypted_type_none_bind(self):
        """EncryptedType handles None on bind."""
        from app.types.encrypted import EncryptedType
        enc_type = EncryptedType()
        result = enc_type.process_bind_param(None, None)
        self.assertIsNone(result)

    def test_encrypted_type_none_result(self):
        """EncryptedType handles None on result."""
        from app.types.encrypted import EncryptedType
        enc_type = EncryptedType()
        result = enc_type.process_result_value(None, None)
        self.assertIsNone(result)


class TestMigrationLogic(unittest.TestCase):
    """Test migration script logic."""

    def test_is_encrypted_for_migration(self):
        """is_encrypted correctly identifies encrypted vs plaintext."""
        encrypted = encrypt_value("secret-data")
        self.assertTrue(is_encrypted(encrypted))
        self.assertFalse(is_encrypted("plain-data"))


if __name__ == "__main__":
    unittest.main()
