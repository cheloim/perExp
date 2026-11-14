"""Tests del registry y del motor de anonimización.

No tocan una base: la parte que depende de Postgres se valida contra un dump
real en `scripts/anonymize-db.sh`. Acá se protege lo que no puede fallar en
silencio: cobertura fail-closed, consistencia de los *_hmac y generación
determinística.
"""

import json

from scripts.anonymization_registry import (
    DROP_TABLES,
    PROCESS_ORDER,
    RULES,
    Rule,
    partner_mismatches,
)
from scripts.anonymize_db import (
    Context,
    build_values,
    check_coverage,
    normalize,
    scrub_json,
    synthetic_token,
    written_columns,
)


def fake_context() -> Context:
    return Context(
        token_key="test-key",
        compute_hmac=lambda value: f"hmac:{value}",
        encrypt_value=lambda value: f"enc:{value}",
    )


def test_every_table_with_rules_is_processed_and_not_dropped():
    assert set(RULES) - set(PROCESS_ORDER) == set()
    assert set(RULES) & set(DROP_TABLES) == set()


def test_partners_and_computed_columns_are_consistent():
    assert partner_mismatches() == []


def test_synthetic_token_is_deterministic_and_grouped():
    first = synthetic_token("k", "expenses:Purchase", "abc")
    assert first == synthetic_token("k", "expenses:Purchase", "abc")
    assert first != synthetic_token("k", "expenses:Purchase", "abd")
    assert first != synthetic_token("other-key", "expenses:Purchase", "abc")


def test_text_map_shares_values_within_a_group():
    ctx = fake_context()
    rule = Rule("text", prefix="Purchase", group_by="description_hmac")
    first = ctx.text_for("expenses", rule, "same-hmac")
    second = ctx.text_for("scheduled_expenses", rule, "same-hmac")
    other = ctx.text_for("expenses", rule, "other-hmac")
    assert first == second
    assert first != other


def test_coverage_fails_closed_on_unknown_column():
    columns = {
        table: [type("C", (), {"name": name})() for name in rules] for table, rules in RULES.items()
    }
    columns.update({table: [type("C", (), {"name": "id"})()] for table in DROP_TABLES})
    assert check_coverage(columns) == []

    columns["users"].append(type("C", (), {"name": "new_pii_column"})())
    errors = check_coverage(columns)
    assert any("users.new_pii_column" in error for error in errors)


def test_coverage_flags_missing_table_and_stale_rule():
    columns = {
        table: [type("C", (), {"name": name})() for name in rules] for table, rules in RULES.items()
    }
    columns.update({table: [type("C", (), {"name": "id"})()] for table in DROP_TABLES})
    columns["users"].pop()
    del columns["groups"]
    errors = check_coverage(columns)
    assert any("groups" in error for error in errors)
    assert any("regla declarada" in error for error in errors)


def test_normalize_matches_app_transforms():
    assert normalize("  Banco Nación  ", "lower_strip") == "banco nación"
    assert normalize("Compra 123", "raw") == "Compra 123"


def test_scrub_json_redacts_free_text_and_keeps_structure():
    ctx = fake_context()
    rule = Rule("json_scrub", json_keys=("merchant_key",))
    raw = json.dumps(
        {
            "merchant_key": "farmacia",
            "signals": {"amount": 1500, "note": "PII del comercio"},
            "flags": [" facebook ", "retail"],
        }
    )
    cleaned = json.loads(scrub_json(raw, rule, ctx))
    assert cleaned["merchant_key"].startswith("merchant ")
    assert cleaned["signals"] == {"amount": 1500, "note": ""}
    assert cleaned["flags"] == ["", ""]


def test_encrypted_text_and_hmac_pair_round_trip():
    ctx = fake_context()
    rules = RULES["accounts"]
    row = {"id": 1, "name": "Caja de ahorro", "user_id": 1, "type": "caja_ahorro"}
    values, plaintext = build_values("accounts", row, rules, ctx)
    assert values["name"].startswith("enc:")
    assert plaintext["name"].startswith("Account ")
    assert values["name_hmac"] == f"hmac:{plaintext['name'].strip().lower()}"


def test_computed_columns_are_written_too():
    written = written_columns(RULES["expenses"])
    assert "description_hmac" in written
    assert "description" in written
    assert "id" not in written
    assert "name_hmac" in written_columns(RULES["accounts"])


def test_hmac_is_recomputed_for_expenses_by_group():
    ctx = fake_context()
    rules = RULES["expenses"]
    row = {
        "id": 10,
        "description": "gAAAAAB-original",
        "description_hmac": "old-hmac",
        "amount": 100,
        "notes": "texto libre",
        "transaction_id": "12345",
    }
    values, plaintext = build_values("expenses", row, rules, ctx)
    assert values["description_hmac"] == f"hmac:{plaintext['description']}"
    assert values["description"].startswith("enc:")
    assert values["notes"] == ""
    assert values["transaction_id"] == "txn-10"


def test_null_is_preserved_but_not_for_description():
    ctx = fake_context()
    rules = RULES["users"]
    row = {
        "id": 3,
        "full_name": "gAAAAAB-original",
        "email": "real@example.com",
        "telegram_chat_id": None,
        "whatsapp_phone": None,
        "provider_id": "1234567890",
    }
    values, _ = build_values("users", row, rules, ctx)
    assert values["telegram_chat_id"] is None
    assert values["telegram_chat_hash"] is None
    assert values["provider_id"] is None
    assert values["email"] == "user3@example.test"
    assert values["full_name"].startswith("enc:")


def test_tags_derive_from_their_card_or_account():
    ctx = fake_context()
    ctx.entity_values[("cards", "card_name")] = {7: "Card synthetic-7"}
    ctx.entity_values[("accounts", "name")] = {9: "Account synthetic-9"}
    rules = RULES["tags"]
    card_values, _ = build_values(
        "tags",
        {"id": 1, "name": "gAAAAAB-old", "card_id": 7, "account_id": None},
        rules,
        ctx,
    )
    account_values, _ = build_values(
        "tags",
        {"id": 2, "name": "gAAAAAB-old", "card_id": None, "account_id": 9},
        rules,
        ctx,
    )
    assert "Card synthetic-7" in card_values["name"]
    assert "Account synthetic-9" in account_values["name"]


def test_digits_are_synthetic_and_unique_per_user():
    ctx = fake_context()
    rules = RULES["users"]
    first, _ = build_values(
        "users",
        {"id": 1, "email": "a@b.com", "full_name": "x", "telegram_chat_id": "123"},
        rules,
        ctx,
    )
    second, _ = build_values(
        "users",
        {"id": 2, "email": "c@d.com", "full_name": "y", "telegram_chat_id": "456"},
        rules,
        ctx,
    )
    assert first["telegram_chat_hash"] != second["telegram_chat_hash"]


def test_known_pii_columns_are_not_kept():
    assert RULES["users"]["email"].action == "email"
    assert RULES["users"]["full_name"].action == "encrypted"
    assert RULES["expenses"]["description"].action == "encrypted"
    assert RULES["cards"]["card_name"].action == "encrypted"
    assert RULES["cards"]["bank"].action == "encrypted"
    assert RULES["tags"]["name"].action == "encrypted_derived"
    assert RULES["recurring_expenses"]["merchant_key"].action == "text"
    assert RULES["categorization_reviews"]["evidence"].action == "json_scrub"
    assert RULES["users"]["hashed_password"].action == "const"
