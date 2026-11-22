"""LLM parsing, bank-notification detection and payment-method matching."""

import re
import unicodedata
from datetime import datetime

from app.models import Account, Card, Tag
from app.prompts import CARD_EXTRACT_PROMPT, EXPENSE_PARSE_PROMPT
from app.services.capture import sanitize_card_hint
from app.services.llm import LLMMessage, get_client, is_configured, parse_json_block
from app.telegram.constants import BUE
from app.telegram.runtime import bot_module, logger


def _llm_client():
    """Client for the bot's own key (falls back to `LLM_API_KEY`)."""
    return get_client(api_key_env="MESSAGES_BOT_LLM_API_KEY")


def _parse_expense(text: str, *, log_content: bool = True) -> list[dict]:
    today = datetime.now(BUE).date().strftime("%Y-%m-%d")
    prompt = EXPENSE_PARSE_PROMPT.format(today=today) + f"\n\nMensaje: {text}"
    if log_content:
        logger.debug("[PARSE] Prompt:\n%s", prompt)
    try:
        response = (
            bot_module()
            ._llm_client()
            .complete([LLMMessage(role="user", text=prompt)], feature="telegram_expense")
        )
        raw = response.text.strip()
        if log_content:
            logger.debug("[PARSE] Raw response: %s", raw)
        result = parse_json_block(raw)
        if log_content:
            logger.info("LLM parsed result: %s", result)
        # Normalize: if LLM returns a single object, wrap in list
        if isinstance(result, dict):
            return [result]
        if isinstance(result, list):
            return [r for r in result if isinstance(r, dict) and r.get("amount")]
        return []
    except Exception as e:
        if log_content:
            logger.error("LLM parse error: %s", e)
            logger.debug("[PARSE] Failed text input: %s", text)
        else:
            logger.error("LLM parse error for private message (%s)", type(e).__name__)
        return []


def _extract_card_info(raw_input: str, card_type: str) -> dict:
    """Extract card_name and bank from user input using LLM."""
    prompt = CARD_EXTRACT_PROMPT.format(raw_input=raw_input, card_type=card_type)
    if not is_configured():
        return {"card_name": raw_input, "bank": ""}

    try:
        result = (
            bot_module()
            ._llm_client()
            .complete_json([LLMMessage(role="user", text=prompt)], feature="telegram_card")
        )
        logger.info("Card extract result: %s", result)
        return result
    except Exception as e:
        logger.error("Card extract error: %s", e)
        return {"card_name": raw_input, "bank": ""}


BANK_NOTIFICATION_PATTERNS = [
    r"compra\s+(aprobada|confirmada|registrada)",
    r"d[eé]bito\s+(aprobado|confirmado|registrado|autom[aá]tico)",
    r"d[eé]bito\s+en\s+cuenta",
    r"consumo\s+(aprobado|confirmado|registrado|con\s+(la\s+)?tarjeta)",
    r"detalle\s+de\s+tu\s+consumo",
    r"tarjeta\s+(terminada|\*{4}|\d{4})",
    r"visa\s+terminada",
    r"mastercard\s+terminada",
    r"naranja\s+terminada",
    r"terminad[ao]\s+en\s+\d{4}",
    r"cr[eé]dito\s+(aprobado|confirmado|registrado)",
    r"transferencia\s+(saliente|enviada|realizada|a\s+tu\s+nombre)",
    r"realiz[oó]\s+la\s+siguiente\s+transferencia",
    r"extracci[oó]n\s+(cajero|autom[aá]tico)",
]


def _is_bank_notification(text: str) -> bool:
    """Detect if a message looks like a bank notification (not natural language)."""
    lower = text.lower()
    return any(re.search(p, lower) for p in BANK_NOTIFICATION_PATTERNS)


CARD_NAME_PATTERNS = [
    r"\b(visa\s+(?:d[eé]bito|credito|cr[eé]dito))\b",
    r"\b(mastercard\s+(?:d[eé]bito|credito|cr[eé]dito))\b",
    r"\b(visa|mastercard|naranja|amex|cabal|cmr|cordobesa|tarjeta naranja)\b",
]


BANK_NAME_PATTERNS = [
    r"\b(galicia|santander|bbva|hsbc|macro|banco nacion|banco provincia|"
    r"ciudad|superville|bind|brubank|ualabu| Mercado Pago|merpago|"
    r"rei|patagonia|comafi|hipotecario|sucursal central|banco web)\b",
]


def _strip_accents(s: str) -> str:
    """Strip accents from text for accent-insensitive matching."""
    nfkd = unicodedata.normalize("NFKD", s.lower().strip())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _match_card_from_text(
    cards: list,
    text_card_name: str | None,
    text_bank: str | None,
    text_card_type: str | None,
) -> "Card | None":
    """Match a card from user's cards using accent-insensitive substring matching."""
    if not text_card_name:
        return None
    text_lower = _strip_accents(text_card_name)
    for card in cards:
        card_lower = _strip_accents(card.card_name)
        name_match = (
            card_lower == text_lower or text_lower in card_lower or card_lower in text_lower
        )
        type_match = not text_card_type or card.card_type == text_card_type
        if (
            name_match
            and type_match
            and (not text_bank or (card.bank and card.bank.lower() == text_bank.lower()))
        ):
            return card
    return None


def _extract_card_from_text(text: str) -> tuple[str | None, str | None, str | None]:
    """Try to extract card_name, bank, and card_type from natural language text."""
    lower = text.lower()
    card_name = None
    bank = None
    card_type = None
    for p in CARD_NAME_PATTERNS:
        m = re.search(p, lower)
        if m:
            card_name = m.group(1).title()
            break
    for p in BANK_NAME_PATTERNS:
        m = re.search(p, lower)
        if m:
            bank = m.group(1).title()
            break
    # Extract card type (debito/credito) from the text
    if re.search(r"\bd[eé]bito\b", lower):
        card_type = "debito"
    elif re.search(r"\bcredito|cr[eé]dito\b", lower):
        card_type = "credito"
    return card_name, bank, card_type


ACCOUNT_TYPE_KEYWORDS = {
    "efectivo": ["efectivo", "cash"],
    "mercadopago": ["mercadopago", "mercado pago", "mp", "merpago"],
    "cuenta_corriente": ["cuenta corriente", "c/c"],
    "caja_ahorro": ["caja de ahorro", "caja ahorro", "c/a"],
}


def _match_cuenta_tag_from_text(
    card_name: str | None,
    bank: str | None,
    user_id: int,
    db,
) -> "Tag | None":
    """Match a 'cuenta' tag by computing HMAC candidates from extracted card_name/bank.

    The platform stores payment methods as tags with group_name='cuenta' and
    encrypted names. Matching uses name_hmac (same as get_or_create_payment_tag).
    """
    from app.services.encryption import compute_hmac

    if not card_name and not bank:
        return None

    # Strip card type words — platform tags are stored as "Bank CardName"
    # without "Crédito"/"Débito" (e.g., "Santander Visa" not "Santander Visa Crédito")
    card_base = card_name
    if card_base:
        card_base = re.sub(
            r"\s*(?:cr[eé]dito|d[eé]bito)\s*", " ", card_base, flags=re.IGNORECASE
        ).strip()

    candidates = set()
    if card_name and bank:
        candidates.add(f"{bank} {card_name}".strip().lower())
        candidates.add(f"{card_name} {bank}".strip().lower())
    if card_base and bank and card_base != card_name:
        candidates.add(f"{bank} {card_base}".strip().lower())
        candidates.add(f"{card_base} {bank}".strip().lower())
    if card_name:
        candidates.add(card_name.strip().lower())
    if card_base and card_base != card_name:
        candidates.add(card_base.strip().lower())
    if bank:
        candidates.add(bank.strip().lower())

    hmacs = [compute_hmac(c) for c in candidates]
    tag = (
        db.query(Tag)
        .filter(
            Tag.user_id == user_id,
            Tag.group_name == "cuenta",
            Tag.name_hmac.in_(hmacs),
        )
        .first()
    )
    return tag


def _match_account_from_text(text: str, user_id: int, db) -> "Account | None":
    """Try to match an account from natural language text."""
    lower = text.lower()

    # Try to match by account type keywords
    for acct_type, keywords in ACCOUNT_TYPE_KEYWORDS.items():
        for kw in keywords:
            if kw in lower:
                account = (
                    db.query(Account)
                    .filter(
                        Account.user_id == user_id,
                        Account.type == acct_type,
                    )
                    .first()
                )
                if account:
                    return account

    # Try to match by account name (exact substring match)
    accounts = db.query(Account).filter(Account.user_id == user_id).all()
    for account in accounts:
        if account.name and account.name.lower() in lower:
            return account

    return None


def _parse_bank_notification(text: str, *, log_content: bool = True) -> dict | None:
    """Parse a bank notification using LLM to extract structured data."""
    from app.prompts import BANK_NOTIFICATION_PARSE_PROMPT

    today = datetime.now(BUE).date().strftime("%Y-%m-%d")
    prompt = BANK_NOTIFICATION_PARSE_PROMPT.format(today=today) + f"\n\nNotificación: {text}"

    try:
        if log_content:
            logger.info("[BANK_PARSE] Parsing bank notification: %s", text[:100])
        result = (
            bot_module()
            ._llm_client()
            .complete_json([LLMMessage(role="user", text=prompt)], feature="telegram_bank")
        )
        if log_content:
            logger.info("[BANK_PARSE] LLM result: %s", result)

        # Strip payment entity prefixes from description (e.g., "MERPAGO*BABYPOP" -> "BABYPOP")
        if result and result.get("description"):
            original = result["description"]
            result["description"] = _strip_payment_prefix(result["description"])
            if original != result["description"] and log_content:
                logger.info(
                    "[BANK_PARSE] Stripped prefix: '%s' -> '%s'", original, result["description"]
                )

        # The provider can echo "Visa ****4521" even when the prompt forbids it.
        if result:
            result["card_name"] = sanitize_card_hint(result.get("card_name"))
            result["bank"] = sanitize_card_hint(result.get("bank"))

        return result
    except Exception as e:
        if log_content:
            logger.error("Bank notification parse error: %s", e)
        else:
            logger.error("Bank notification parse error for private message (%s)", type(e).__name__)
        return None


def _match_card_from_notification(
    user_id: int,
    bank: str | None,
    card_type: str | None,
    card_name: str | None,
    db,
    *,
    log_content: bool = True,
) -> Card | None:
    """Match a bank notification to an existing card in DB.

    Matching priority:
      Pass 1: card_name + bank (ignore card_type) — card_name is the most reliable identifier
      Pass 2: bank + card_type (fallback when card_name doesn't match)
      Pass 3: card_type only (last resort — auto-select if single card of that type)
    """
    cards = db.query(Card).filter(Card.user_id == user_id).all()
    if not cards:
        return None

    target_type = card_type or "credito"

    # Pass 1: match by card_name + bank (ignore card_type)
    # card_name is the most reliable identifier — the LLM often gets card_type wrong
    if card_name:
        matches = []
        for card in cards:
            if bank and card.bank and card.bank.lower() != bank.lower():
                continue
            card_lower = _strip_accents(card.card_name)
            name_lower = _strip_accents(card_name)
            if name_lower in card_lower or card_lower in name_lower:
                matches.append(card)

        if len(matches) == 1:
            if log_content:
                logger.debug(
                    "[CARD_MATCH] Pass 1 (card_name+bank): matched %s",
                    matches[0].card_name,
                )
            return matches[0]
        elif len(matches) > 1:
            # Disambiguate by card_type when multiple cards match
            for card in matches:
                if card.card_type == target_type:
                    if log_content:
                        logger.debug(
                            "[CARD_MATCH] Pass 1 (card_name+bank+type): matched %s",
                            card.card_name,
                        )
                    return card
            if log_content:
                logger.debug(
                    "[CARD_MATCH] Pass 1 (card_name+bank): multiple matches, returning first: %s",
                    matches[0].card_name,
                )
            return matches[0]

    # Pass 2: match by bank + card_type (ignore card_name)
    for card in cards:
        if card.card_type != target_type:
            continue
        if bank and card.bank and card.bank.lower() == bank.lower():
            if log_content:
                logger.debug("[CARD_MATCH] Pass 2 (bank+type): matched %s", card.card_name)
            return card

    # Pass 3: match by card_type only — if only one card of that type, auto-select
    type_cards = [c for c in cards if c.card_type == target_type]
    if len(type_cards) == 1:
        if log_content:
            logger.debug("[CARD_MATCH] Pass 3 (type only): matched %s", type_cards[0].card_name)
        return type_cards[0]

    if log_content:
        logger.debug(
            "[CARD_MATCH] No match found. card_name=%s, bank=%s, card_type=%s",
            card_name,
            bank,
            card_type,
        )
    return None


_PAYMENT_PREFIXES = [
    "MERPAGO*",
    "MP*",
    "MERCADOPAGO*",
    "PAGO*MISCUENTAS*",
    "PAGO*",
    "DEB.CAJERO*",
    "DEBITO*",
    "DEB*",
    "COMPRA*",
]


def _strip_payment_prefix(description: str) -> str:
    """Strip payment entity prefixes from bank notification descriptions.

    Examples:
        "MERPAGO*BABYPOP" -> "BABYPOP"
        "MP*STARBUCKS" -> "STARBUCKS"
        "COMPRA*NOMBRE LOCAL" -> "NOMBRE LOCAL"
        "Uber Eats" -> "Uber Eats" (no change)
    """
    if not description:
        return description
    upper = description.upper().strip()
    for prefix in _PAYMENT_PREFIXES:
        if upper.startswith(prefix):
            cleaned = description[len(prefix) :].strip()
            if cleaned:
                return cleaned
    return description
