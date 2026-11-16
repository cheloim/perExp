"""Reglas de anonimización de la base, columna por columna.

El contrato es **fail-closed**: `anonymize_db.py` enumera las columnas reales de
la base y aborta si alguna no está declarada acá. Agregar una columna nueva sin
clasificarla rompe la generación del fixture en vez de filtrar datos.

Acciones
--------
keep              Se conserva tal cual. Sólo para columnas sin PII.
null              Se pone en NULL.
const             Se pone un valor fijo (`const`).
email             `user{id}@example.test`.
text              Texto sintético en claro (`prefix` + token determinístico).
encrypted         Texto sintético cifrado con la key de anonimización.
derived           Texto en claro derivado de otra entidad (tag -> card/account).
encrypted_derived Igual que `derived`, pero cifrado.
synthetic_id      `{prefix}-{id}` (referencias opacas únicas).
json_scrub        JSON: conserva las claves de `json_keys` (remapeadas) y
                  redacta el resto de los strings.
hmac_literal      `compute_hmac(str(valor_de_source))`; para columnas *_hash
                  que la app deriva de un id.
computed          La llena el motor al procesar su columna `partner`.

`partner` indica la columna *_hmac que se recalcula con la misma función que usa
la app (`app.services.encryption.compute_hmac`). `normalize` reproduce el
transform que aplica cada sitio: `raw` o `lower_strip`.
"""

from dataclasses import dataclass

# Hash bcrypt de "testpassword". Es un fixture, no un secreto.
TEST_PASSWORD_HASH = "$2b$12$WlSiN5YCZsFjwc2jKT1Bdeb4yZvP952okrgitpCnxrjEq.IfO0iNG"


@dataclass(frozen=True)
class Rule:
    action: str
    prefix: str = "Synthetic"
    const: object = None
    group_by: str | None = None
    partner: str | None = None
    normalize: str = "raw"  # raw | lower_strip
    source: str | None = None
    lookups: tuple[tuple[str, str, str], ...] = ()
    json_keys: tuple[str, ...] = ()
    where: str | None = None
    max_len: int | None = None
    preserve_null: bool = True


KEEP = Rule("keep")
NULL = Rule("null")
COMPUTED = Rule("computed")


def _keep(*columns: str) -> dict[str, Rule]:
    return {column: KEEP for column in columns}


def _const(value: object) -> Rule:
    return Rule("const", const=value)


# Tablas que no aportan señal de migración y son el mayor riesgo de PII.
# Se vacían por completo.
DROP_TABLES = (
    "analysis_history",  # prompts y respuestas del LLM con datos financieros
    "audit_logs",  # IP y user-agent
    "impersonation_messages",  # chat entre admin y usuario
    "impersonation_sessions",  # tokens de impersonación
    "import_jobs",  # resúmenes bancarios y archivos crudos
    "monthly_reports",  # PDF/PNG con nombre, montos y movimientos
    "notifications",  # cuerpos con montos y comercios
    "platform_logs",  # trazas con datos de request
    "refresh_tokens",  # sesiones
    "settings",  # puede contener webhooks/tokens
)

# Tablas que pueden no existir según la versión del esquema. Se declaran para
# que la cobertura no falle cuando aparezcan, sin exigirlas.
OPTIONAL_TABLES = ("alembic_version", "schema_migrations", "fx_rates")

# Columnas que una revisión de Alembic puede agregar a un dump previo. Si no
# están, no se exigen; si están, tienen regla igual.
OPTIONAL_COLUMNS = frozenset(
    {
        ("expenses", "is_recurring_projection"),
        ("expenses", "fx_rate"),
        ("expenses", "fx_rate_date"),
        ("expenses", "fx_rate_source"),
        ("expenses", "search_grams"),
        ("categorization_reviews", "bulk_applied"),
    }
)

# Orden de proceso: las entidades de las que otros derivan van primero.
PROCESS_ORDER = (
    "users",
    "accounts",
    "cards",
    "tags",
    "card_closings",
    "expenses",
    "fx_rates",
    "scheduled_expenses",
    "recurring_expenses",
    "merchant_preferences",
    "categorization_reviews",
    "categories",
    "groups",
    "budget_events",
    "budget_groups",
    "investments",
    "budgets",
    "category_suggestions",
    "expense_tags",
    "group_members",
    "schema_migrations",
    "alembic_version",
)


RULES: dict[str, dict[str, Rule]] = {
    "accounts": {
        **_keep("id", "type", "user_id", "created_at"),
        "name": Rule(
            "encrypted",
            prefix="Account",
            partner="name_hmac",
            normalize="lower_strip",
        ),
        "name_hmac": COMPUTED,
    },
    "budget_events": {
        **_keep(
            "id",
            "user_id",
            "start_date",
            "end_date",
            "total_amount",
            "spent",
            "categories",
            "is_active",
            "created_at",
            "updated_at",
        ),
        "name": Rule("text", prefix="Event"),
    },
    "budget_groups": {
        **_keep(
            "id",
            "user_id",
            "name",
            "percentage",
            "amount",
            "spent",
            "is_active",
            "created_at",
            "updated_at",
            "alert_thresholds",
        ),
        "display_name": Rule("text", prefix="Group"),
    },
    "budgets": _keep(
        "id",
        "user_id",
        "category_id",
        "amount",
        "alert_threshold",
        "rollover",
        "is_active",
        "created_at",
        "updated_at",
        "alert_thresholds",
    ),
    "card_closings": {
        **_keep(
            "id",
            "card_type",
            "closing_date",
            "next_closing_date",
            "due_date",
            "last_imported_at",
            "user_id",
            "card_id",
        ),
        "card": Rule(
            "derived",
            prefix="Card",
            lookups=(("card_id", "cards", "card_name"),),
        ),
        "bank": Rule(
            "derived",
            prefix="Bank",
            lookups=(("card_id", "cards", "bank"),),
        ),
        "card_last_digits": _const("0000"),
    },
    "cards": {
        **_keep("id", "card_type", "user_id", "created_at", "linked_account_id"),
        "card_name": Rule(
            "encrypted",
            prefix="Card",
            partner="card_name_hmac",
            normalize="lower_strip",
        ),
        "bank": Rule(
            "encrypted",
            prefix="Bank",
            partner="bank_hmac",
            normalize="lower_strip",
        ),
        "holder": Rule("encrypted", prefix="Person"),
        "card_name_hmac": COMPUTED,
        "bank_hmac": COMPUTED,
    },
    "categories": {
        **_keep("id", "color", "parent_id", "user_id", "budget_group"),
        "name": Rule("text", prefix="Category", where="user_id IS NOT NULL"),
        "keywords": Rule("const", const="", where="user_id IS NOT NULL"),
    },
    "categorization_reviews": {
        **_keep(
            "id",
            "expense_id",
            "user_id",
            "current_category_id",
            "suggested_category_id",
            "score",
            "source",
            "detector_version",
            "status",
            "bulk_applied",
            "reviewed_by",
            "reviewed_at",
            "created_at",
            "updated_at",
        ),
        "reason": _const(""),
        "evidence": Rule("json_scrub", json_keys=("merchant_key",)),
    },
    "category_suggestions": _keep(
        "id",
        "expense_id",
        "user_id",
        "suggested_category_id",
        "confidence",
        "status",
        "source",
        "created_at",
        "updated_at",
    ),
    "expense_tags": _keep("expense_id", "tag_id"),
    "expenses": {
        **_keep(
            "id",
            "date",
            "amount",
            "category_id",
            "currency",
            "installment_number",
            "installment_total",
            "installment_group_id",
            "user_id",
            "account_id",
            "card_id",
            "is_income",
            "budget_event_id",
            "recurring_expense_id",
            "created_at",
            "is_recurring_projection",
            "fx_rate",
            "fx_rate_date",
            "fx_rate_source",
        ),
        "description": Rule(
            "encrypted",
            prefix="Purchase",
            group_by="description_hmac",
            partner="description_hmac",
        ),
        "description_hmac": COMPUTED,
        # Blind n-gram index keyed with the production ENCRYPTION_KEY. Never
        # ship the production HMACs; the app backfills this column on boot.
        "search_grams": NULL,
        "notes": _const(""),
        "transaction_id": Rule("synthetic_id", prefix="txn"),
    },
    "fx_rates": _keep(
        "id",
        "date",
        "source",
        "base",
        "quote",
        "rate",
        "fetched_at",
    ),
    "group_members": _keep(
        "id", "group_id", "user_id", "role", "status", "invited_by", "joined_at"
    ),
    "groups": {
        **_keep("id", "created_by", "created_at"),
        "name": Rule("text", prefix="Family group"),
    },
    "investments": {
        **_keep(
            "id",
            "type",
            "quantity",
            "avg_cost",
            "current_price",
            "currency",
            "updated_at",
            "user_id",
        ),
        "ticker": Rule("text", prefix="TICK"),
        "name": Rule("text", prefix="Asset"),
        "broker": Rule("text", prefix="Broker"),
        "notes": _const(""),
    },
    "merchant_preferences": {
        **_keep(
            "id",
            "user_id",
            "category_id",
            "confidence",
            "usage_count",
            "last_used_at",
            "created_at",
        ),
        "merchant_key": Rule("text", prefix="merchant", group_by="merchant_key", max_len=255),
    },
    "recurring_expenses": {
        **_keep(
            "id",
            "user_id",
            "amount",
            "currency",
            "category_id",
            "card_id",
            "account_id",
            "frequency",
            "next_charge_date",
            "alert_days_before",
            "is_active",
            "last_seen_at",
            "created_at",
            "updated_at",
            "source",
            "tag_id",
        ),
        "merchant_key": Rule("text", prefix="merchant", group_by="merchant_key", max_len=255),
        "description": Rule("text", prefix="Purchase", group_by="merchant_key", max_len=500),
    },
    "scheduled_expenses": {
        **_keep(
            "id",
            "installment_group_id",
            "installment_number",
            "installment_total",
            "scheduled_date",
            "amount",
            "currency",
            "card_id",
            "account_id",
            "status",
            "category_id",
            "executed_expense_id",
            "executed_at",
            "created_at",
            "user_id",
            "expense_id",
        ),
        "description": Rule(
            "encrypted",
            prefix="Purchase",
            group_by="description_hmac",
            partner="description_hmac",
        ),
        "description_hmac": COMPUTED,
        "transaction_id": Rule("synthetic_id", prefix="txn"),
    },
    "schema_migrations": {
        **_keep("id", "script_name", "status", "executed_at", "created_at"),
        "output": NULL,
    },
    "alembic_version": _keep("version_num"),
    "tags": {
        **_keep(
            "id",
            "color",
            "group_name",
            "user_id",
            "card_id",
            "account_id",
            "category_id",
            "created_at",
        ),
        "name": Rule(
            "encrypted_derived",
            prefix="Tag",
            partner="name_hmac",
            normalize="lower_strip",
            lookups=(
                ("card_id", "cards", "card_name"),
                ("account_id", "accounts", "name"),
            ),
        ),
        "name_hmac": COMPUTED,
    },
    "users": {
        **_keep(
            "id",
            "is_active",
            "created_at",
            "provider",
            "reset_token_expires",
            "mfa_enabled",
            "email_verified",
            "force_password_change",
            "onboarding_completed",
            "auto_detected_banner_dismissed_at",
            "is_admin",
            "is_blocked",
            "blocked_at",
            "whats_new_dismissed_version",
            "last_login",
            "telegram_key_expires",
        ),
        "full_name": Rule("encrypted", prefix="Person"),
        "email": Rule("email"),
        "invite_code": NULL,
        "hashed_password": _const(TEST_PASSWORD_HASH),
        "telegram_key": NULL,
        "telegram_chat_id": Rule(
            "encrypted_digits",
            prefix="0000000000",
            partner="telegram_chat_hash",
        ),
        "telegram_chat_hash": COMPUTED,
        "provider_id": NULL,
        "avatar_url": NULL,
        "reset_token": NULL,
        "mfa_secret": NULL,
        "email_verification_token": NULL,
        "blocked_reason": NULL,
        "whatsapp_phone": Rule(
            "encrypted_digits",
            prefix="0000000000",
        ),
        "whatsapp_phone_hash": Rule("hmac_literal", source="id"),
        "whatsapp_key": NULL,
        "google_refresh_token": NULL,
        "google_refresh_token_hmac": NULL,
    },
}


# Columnas marcadas `computed` que ningún `partner` reclama (o al revés).
# Es una validación cruzada del registry, no del esquema.
def partner_mismatches() -> list[str]:
    claimed: set[tuple[str, str]] = set()
    problems: list[str] = []
    for table, columns in RULES.items():
        computed = {name for name, rule in columns.items() if rule.action == "computed"}
        for name, rule in columns.items():
            if not rule.partner:
                continue
            if rule.partner not in columns:
                problems.append(f"{table}.{name}: partner inexistente {rule.partner}")
            else:
                claimed.add((table, rule.partner))
        for name in computed - {r.partner for r in columns.values()}:
            problems.append(f"{table}.{name}: computed sin partner")
    unclaimed = claimed - {
        (table, name)
        for table, columns in RULES.items()
        for name, rule in columns.items()
        if rule.action == "computed"
    }
    for table, name in sorted(unclaimed):
        problems.append(f"{table}.{name}: partner declarado pero no es computed")
    return problems
