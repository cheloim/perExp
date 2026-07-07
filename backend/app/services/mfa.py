"""TOTP-based Multi-Factor Authentication service."""

import io
import os

import pyotp
import qrcode

APP_ENV = os.getenv("APP_ENV", "development")
APP_NAME = "NikoFin" if APP_ENV == "production" else "NikoFin (Dev)"


def generate_mfa_secret() -> str:
    """Generate a new TOTP secret."""
    return pyotp.random_base32()


def get_totp_uri(secret: str, email: str, issuer_name: str = APP_NAME) -> str:
    """Generate the TOTP URI for QR code generation."""
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name=issuer_name)


def generate_qr_code_data_uri(uri: str) -> str:
    """Generate a QR code as a data URI for display in frontend."""
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    import base64

    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def verify_totp(secret: str, code: str) -> bool:
    """Verify a TOTP code. Allows 1 step drift for clock skew."""
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


def get_mfa_setup_data(secret: str, email: str) -> dict:
    """Get all data needed for MFA setup (secret, URI, QR code)."""
    uri = get_totp_uri(secret, email)
    qr_code = generate_qr_code_data_uri(uri)
    return {
        "secret": secret,
        "uri": uri,
        "qr_code": qr_code,
    }
