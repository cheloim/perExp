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


_PAYMENT_STOPWORDS = {
    "ahorro",
    "banco",
    "caja",
    "compra",
    "consumo",
    "corriente",
    "credito",
    "cuenta",
    "de",
    "debito",
    "del",
    "el",
    "en",
    "la",
    "mi",
    "mis",
    "pago",
    "tarjeta",
}

_CARD_FRANCHISES = {
    "amex",
    "cabal",
    "cmr",
    "cordobesa",
    "diners",
    "maestro",
    "mastercard",
    "naranja",
    "visa",
}

_ACCOUNT_HINTS = {
    "ahorro",
    "billetera",
    "caja",
    "cash",
    "corriente",
    "cuenta",
    "efectivo",
    "mercado",
    "mercadopago",
    "sueldo",
}


def _normalize_payment_name(value: str | None) -> str:
    """Case, accent and punctuation-insensitive form used to match names."""
    if not value:
        return ""
    text = _strip_accents(str(value))
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _normalize_card_type(value: str | None) -> str | None:
    """Return the canonical card type (``credito``/``debito``) or ``None``."""
    text = _normalize_payment_name(value)
    if not text:
        return None
    if "debit" in text:
        return "debito"
    if "credit" in text:
        return "credito"
    return None


def _payment_tokens(value: str | None) -> set[str]:
    """Meaningful name tokens, dropping the words every payment method shares."""
    return {
        token
        for token in _normalize_payment_name(value).split()
        if token and token not in _PAYMENT_STOPWORDS
    }


def _bank_matches(stored: str | None, mentioned: str | None) -> bool:
    """Compare bank names with or without the ``Banco`` prefix and accents."""
    if not mentioned:
        return True
    left = re.sub(r"^banco ", "", _normalize_payment_name(stored))
    right = re.sub(r"^banco ", "", _normalize_payment_name(mentioned))
    if not left or not right:
        return False
    return left == right or left in right or right in left


def _has_account_hint(text: str | None) -> bool:
    tokens = set(_normalize_payment_name(text).split())
    return bool(tokens & _ACCOUNT_HINTS)


def _has_card_hint(text: str | None) -> bool:
    tokens = set(_normalize_payment_name(text).split())
    return bool(tokens & _CARD_FRANCHISES)


def _match_card_from_text(
    cards: list,
    text_card_name: str | None,
    text_bank: str | None,
    text_card_type: str | None,
) -> "Card | None":
    """Match a card by normalized franchise, bank and type.

    Exact names win over substrings so "Visa" does not resolve to
    "Visa Débito" when both cards exist. The stored bank may carry the
    ``Banco`` prefix and accents; the message usually does not.
    """
    if not text_card_name:
        return None

    name = _normalize_payment_name(text_card_name)
    card_type = _normalize_card_type(text_card_type)
    if not name:
        return None

    def matches(card) -> bool:
        card_name = _normalize_payment_name(card.card_name)
        return (
            (card_name == name or name in card_name or card_name in name)
            and (card_type is None or _normalize_card_type(card.card_type) == card_type)
            and _bank_matches(card.bank, text_bank)
        )

    for card in cards:
        if _normalize_payment_name(card.card_name) == name and matches(card):
            return card
    for card in cards:
        if matches(card):
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


def _tag_candidate_names(card_name: str | None, bank: str | None) -> set[str]:
    """Raw and normalized spellings a payment tag may have been stored under."""
    card = (card_name or "").strip()
    bank_name = (bank or "").strip()
    card_base = re.sub(r"\s*(?:cr[eé]dito|d[eé]bito)\s*", " ", card, flags=re.IGNORECASE).strip()
    bank_base = re.sub(r"^banco\s+", "", bank_name, flags=re.IGNORECASE).strip()

    candidates = {
        card,
        bank_name,
        bank_base,
        card_base,
        f"{bank_name} {card}".strip(),
        f"{card} {bank_name}".strip(),
        f"{bank_base} {card_base}".strip(),
        f"{card_base} {bank_base}".strip(),
    }
    variants: set[str] = set()
    for candidate in candidates:
        if not candidate:
            continue
        variants.add(candidate.strip().lower())
        variants.add(_normalize_payment_name(candidate))
    return {variant for variant in variants if variant}


def _match_cuenta_tag_from_text(
    card_name: str | None,
    bank: str | None,
    user_id: int,
    db,
    *,
    text: str | None = None,
    card_type: str | None = None,
) -> "Tag | None":
    """Match a ``cuenta`` tag by exact HMAC first, then by normalized tokens.

    HMAC is an exact blind index: it cannot see the ``Banco`` prefix, accents,
    card-type words or the order the platform used when it named the tag. The
    user-scoped tag list is small, so a normalized comparison on the decrypted
    names is both cheap and what actually resolves the message.
    """
    from app.services.encryption import compute_hmac

    if not card_name and not bank and not text:
        return None

    candidates = _tag_candidate_names(card_name, bank)
    if candidates:
        hmacs = [compute_hmac(candidate) for candidate in candidates]
        tag = (
            db.query(Tag)
            .filter(
                Tag.user_id == user_id,
                Tag.group_name == "cuenta",
                Tag.name_hmac.in_(hmacs),
            )
            .first()
        )
        if tag:
            return tag

    input_tokens = _payment_tokens(card_name) | _payment_tokens(bank)
    if not input_tokens:
        return None

    context = " ".join(part for part in (text, card_name, bank) if part)
    account_hint = _has_account_hint(text) or _has_account_hint(card_name)
    card_hint = _has_card_hint(text) or _has_card_hint(card_name)
    normalized_type = _normalize_card_type(card_type or text)
    input_norm = _normalize_payment_name(context)

    tags = db.query(Tag).filter(Tag.user_id == user_id, Tag.group_name == "cuenta").all()
    scored: list[tuple[int, Tag]] = []
    for tag in tags:
        tag_name = str(tag.name or "")
        tag_norm = _normalize_payment_name(tag_name)
        tag_tokens = _payment_tokens(tag_name)
        score = 0

        if input_tokens <= tag_tokens:
            score += 10 + len(input_tokens)
        elif tag_tokens and tag_tokens <= input_tokens:
            score += 8 + len(tag_tokens)
        if tag_norm and input_norm and (tag_norm in input_norm or input_norm in tag_norm):
            score += 6
        if bank and _bank_matches(tag_name, bank):
            score += 3
        if account_hint and _has_account_hint(tag_name):
            score += 5
        if card_hint and _has_card_hint(tag_name):
            score += 5

        tag_type = _normalize_card_type(tag_name)
        if normalized_type and tag_type == normalized_type:
            score += 3
        elif normalized_type and tag_type and tag_type != normalized_type:
            score -= 5

        if tag.card_id or tag.account_id:
            score += 1
        if score > 0:
            scored.append((score, tag))

    if not scored:
        return None
    scored.sort(key=lambda row: (-row[0], -len(_payment_tokens(row[1].name)), row[1].id))
    best_score, best = scored[0]
    if best_score < 8:
        return None
    return best


def _match_account_from_text(text: str, user_id: int, db) -> "Account | None":
    """Match an account by normalized name, bank and account-type words."""
    normalized = _normalize_payment_name(text)
    if not normalized:
        return None
    text_tokens = set(normalized.split())

    def keyword_in_text(keyword: str) -> bool:
        value = _normalize_payment_name(keyword)
        if not value:
            return False
        # "mp" must be a word on its own; substring matching would make
        # "compra" look like MercadoPago.
        if len(value) <= 3:
            return value in text_tokens
        return value in normalized

    for account_type, keywords in ACCOUNT_TYPE_KEYWORDS.items():
        if any(keyword_in_text(keyword) for keyword in keywords):
            account = (
                db.query(Account)
                .filter(
                    Account.user_id == user_id,
                    Account.type == account_type,
                )
                .first()
            )
            if account:
                return account

    accounts = db.query(Account).filter(Account.user_id == user_id).all()
    for account in accounts:
        name = _normalize_payment_name(account.name)
        if name and name in normalized:
            return account

    # "cuenta de Galicia" against "Caja de Ahorro Galicia": the account's
    # meaningful token (Galicia) is in the text, and the text says "cuenta".
    # Requiring the account word keeps a USD purchase from matching a
    # "Cuenta USD" just because the amount says USD.
    if not _has_account_hint(text):
        return None
    token_matches = [
        account
        for account in accounts
        if (tokens := _payment_tokens(account.name)) and tokens <= text_tokens
    ]
    return token_matches[0] if token_matches else None


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

    target_type = _normalize_card_type(card_type) or "credito"

    # Pass 1: match by card_name + bank (ignore card_type)
    # card_name is the most reliable identifier — the LLM often gets card_type wrong
    if card_name:
        name_lower = _normalize_payment_name(card_name)
        matches = []
        for card in cards:
            if not _bank_matches(card.bank, bank):
                continue
            card_lower = _normalize_payment_name(card.card_name)
            if name_lower and (name_lower in card_lower or card_lower in name_lower):
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
                if _normalize_card_type(card.card_type) == target_type:
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
        if _normalize_card_type(card.card_type) != target_type:
            continue
        if _bank_matches(card.bank, bank):
            if log_content:
                logger.debug("[CARD_MATCH] Pass 2 (bank+type): matched %s", card.card_name)
            return card

    # Pass 3: match by card_type only — if only one card of that type, auto-select
    type_cards = [c for c in cards if _normalize_card_type(c.card_type) == target_type]
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
