"""TOTP service nominal and error paths (#561)."""

import base64

import pyotp

from app.services.mfa import (
    generate_mfa_secret,
    generate_qr_code_data_uri,
    get_mfa_setup_data,
    get_totp_uri,
    verify_totp,
)


def test_generate_mfa_secret_is_base32_and_unique():
    first = generate_mfa_secret()
    second = generate_mfa_secret()

    assert first != second
    assert pyotp.TOTP(first).now()


def test_totp_uri_contains_issuer_and_account():
    secret = generate_mfa_secret()

    uri = get_totp_uri(secret, "user@example.com", issuer_name="Oikonomia Test")

    assert uri.startswith("otpauth://totp/")
    assert "Oikonomia%20Test" in uri
    assert "user%40example.com" in uri


def test_qr_code_data_uri_is_a_png_payload():
    uri = get_totp_uri(generate_mfa_secret(), "user@example.com")

    data_uri = generate_qr_code_data_uri(uri)

    assert data_uri.startswith("data:image/png;base64,")
    decoded = base64.b64decode(data_uri.split(",", 1)[1])
    assert decoded.startswith(b"\x89PNG")


def test_setup_data_bundles_secret_uri_and_qr():
    secret = generate_mfa_secret()

    setup = get_mfa_setup_data(secret, "user@example.com")

    assert setup["secret"] == secret
    assert secret in setup["uri"]
    assert setup["qr_code"].startswith("data:image/png;base64,")


def test_verify_totp_accepts_the_current_code_and_rejects_others():
    secret = generate_mfa_secret()

    assert verify_totp(secret, pyotp.TOTP(secret).now()) is True
    assert verify_totp(secret, "000000") is False
    assert verify_totp(secret, "not-a-code") is False
