"""Tests for the 72-byte password limit.

bcrypt 5 ya no trunca en silencio las contraseñas de más de 72 bytes: levanta
ValueError. La validación de esquema debe acotar antes de llegar al hash.
"""

import pytest

from app.schemas.common import _validate_password_strength


class TestPasswordByteLimit:
    def test_exactly_72_bytes_is_accepted(self):
        password = "Aa1!" + "x" * 68  # 4 + 68 = 72 bytes
        assert len(password.encode("utf-8")) == 72
        assert _validate_password_strength(password) == password

    def test_73_bytes_is_rejected(self):
        password = "Aa1!" + "x" * 69  # 4 + 69 = 73 bytes
        with pytest.raises(ValueError, match="72 bytes"):
            _validate_password_strength(password)

    def test_limit_counts_bytes_not_characters(self):
        # Cada 'ñ' ocupa 2 bytes en UTF-8: 39 caracteres pero 74 bytes.
        password = "Aa1!" + "ñ" * 35
        assert len(password) == 39
        assert len(password.encode("utf-8")) == 74
        with pytest.raises(ValueError, match="72 bytes"):
            _validate_password_strength(password)

    def test_multibyte_password_under_limit_is_accepted(self):
        password = "Aa1!" + "ñ" * 34  # 4 + 68 = 72 bytes
        assert len(password.encode("utf-8")) == 72
        assert _validate_password_strength(password) == password
