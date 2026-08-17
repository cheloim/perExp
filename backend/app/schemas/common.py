import dns.resolver
from pydantic import BaseModel

BUE = __import__("zoneinfo", fromlist=["ZoneInfo"]).ZoneInfo("America/Argentina/Buenos_Aires")

SPECIAL_CHARS = "!@#$%^&*()-_+=<>?/[]{}|"

BLOCKED_DOMAINS = {
    "test.com",
    "example.com",
    "fake.com",
    "email.com",
    "mail.com",
    "nomail.com",
    "noemail.com",
    "noway.com",
    "notmail.com",
    "spam.com",
    "throwaway.com",
    "trashmail.com",
    "tempmail.com",
    "temporary.com",
    "guerrillamail.com",
    "guerrillamail.net",
    "guerrillamail.org",
    "mailinator.com",
    "mailinator.net",
    "mailinator.org",
    "yopmail.com",
    "yopmail.fr",
    "yopmail.net",
    "sharklasers.com",
    "grr.la",
    "guerrillamailblock.com",
    "dispostable.com",
    "tempail.com",
    "temp-mail.org",
    "fakeinbox.com",
    "trashymail.com",
    "trashymail.net",
    "maildrop.cc",
    "discard.email",
    "discardmail.com",
    "mailnesia.com",
    "mailcatch.com",
    "tempinbox.com",
    "mohmal.com",
    "burnermail.io",
    "anonaddy.com",
}


def _validate_email_format(v: str) -> str:
    email = v.lower().strip()
    domain = email.split("@")[1] if "@" in email else ""

    if domain in BLOCKED_DOMAINS:
        raise ValueError("Este dominio de email no está permitido. Usá un email real.")

    try:
        dns.resolver.resolve(domain, "MX")
    except (
        dns.resolver.NXDOMAIN,
        dns.resolver.NoAnswer,
        dns.resolver.NoNameservers,
        dns.resolver.LifetimeTimeout,
    ):
        raise ValueError(f"El dominio '{domain}' no parece ser un dominio de email válido.")

    return email


def _validate_password_strength(v: str) -> str:
    if len(v) < 8:
        raise ValueError("La contraseña debe tener al menos 8 caracteres")
    if not any(c.isupper() for c in v):
        raise ValueError("La contraseña debe contener al menos una mayúscula")
    if not any(c.islower() for c in v):
        raise ValueError("La contraseña debe contener al menos una minúscula")
    if not any(c.isdigit() for c in v):
        raise ValueError("La contraseña debe contener al menos un número")
    if not any(c in SPECIAL_CHARS for c in v):
        raise ValueError(
            f"La contraseña debe contener al menos un carácter especial ({SPECIAL_CHARS})"
        )
    return v


class AccountSimple(BaseModel):
    id: int
    name: str
    type: str
    model_config = {"from_attributes": True}


class CardSimple(BaseModel):
    id: int
    card_name: str
    bank: str
    holder: str = ""
    card_type: str
    model_config = {"from_attributes": True}
