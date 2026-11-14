#!/usr/bin/env python3
"""Anonimiza una copia restaurada de la base de producción.

No descifra: reemplaza cada columna cifrada por un valor sintético cifrado con
la key de anonimización. La key de producción nunca se usa ni se necesita.

La cobertura es fail-closed: si la base tiene una columna que el registry no
clasifica, aborta. Así una columna nueva no puede filtrarse en silencio.

Uso:
    python -m scripts.anonymize_db --dry-run
    python -m scripts.anonymize_db --dsn postgresql://.../expenses_anon
    python -m scripts.anonymize_db --verify-only

El nombre de la base destino debe terminar en `_anon` o `_anonymized` salvo que
se pase `--force`. Es el seguro contra correrlo por error sobre producción.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field

import psycopg
from psycopg import sql

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.anonymization_registry import (  # noqa: E402
    DROP_TABLES,
    OPTIONAL_TABLES,
    PROCESS_ORDER,
    RULES,
    Rule,
    partner_mismatches,
)

# Key pública a propósito: sólo protege datos sintéticos. Permite que CI
# descifre el fixture y que cualquiera lo reproduzca. No puede abrir el dump de
# producción, que está cifrado con otra key.
DEFAULT_ANONYMIZATION_KEY = "fhieZvFCBU1XCNbXXkR2QkF0HyPOT35R-QxMtYoXJy0="

TEXT_TYPES = {"character varying", "text", "character"}
NULLABLE_ACTIONS = {
    "text",
    "encrypted",
    "derived",
    "encrypted_derived",
    "synthetic_id",
    "synthetic_digits",
    "encrypted_digits",
    "email",
    "blank",
    "json_scrub",
}

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"^\+?\d[\d\s().-]{8,}\d$")
LONG_DIGITS_RE = re.compile(r"\d{13,}")


@dataclass
class Column:
    name: str
    data_type: str
    nullable: bool


@dataclass
class Report:
    coverage_errors: list[str] = field(default_factory=list)
    counts_before: dict[str, int] = field(default_factory=dict)
    counts_after: dict[str, int] = field(default_factory=dict)
    verification_errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.coverage_errors and not self.verification_errors


# ── Criptografía ────────────────────────────────────────────────────────────


def load_crypto(key: str):
    """Carga las funciones de la app con la key de anonimización."""
    os.environ["ENCRYPTION_KEY"] = key
    os.environ["SECRET_KEY"] = key
    from app.services.encryption import compute_hmac, encrypt_value

    return compute_hmac, encrypt_value


def synthetic_token(key: str, namespace: str, value: str) -> str:
    digest = hashlib.sha256(f"{namespace}:{value}".encode()).hexdigest()
    return base64.urlsafe_b64encode(
        hashlib.blake2b(digest.encode(), key=key.encode()[:64], digest_size=12).digest()
    ).decode()[:16]


def normalize(value: str, mode: str) -> str:
    if mode == "lower_strip":
        return value.strip().lower()
    return value


# ── Catálogo y cobertura ────────────────────────────────────────────────────


def list_columns(conn: psycopg.Connection) -> dict[str, list[Column]]:
    rows = conn.execute(
        """
        SELECT table_name, column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
        """
    ).fetchall()
    columns: dict[str, list[Column]] = {}
    for table, name, data_type, is_nullable in rows:
        columns.setdefault(table, []).append(
            Column(name=name, data_type=data_type, nullable=is_nullable == "YES")
        )
    return columns


def check_coverage(columns: dict[str, list[Column]]) -> list[str]:
    errors: list[str] = []
    for problem in partner_mismatches():
        errors.append(f"registry inconsistente: {problem}")

    for table, cols in sorted(columns.items()):
        if table in DROP_TABLES:
            continue
        declared = RULES.get(table)
        if declared is None:
            errors.append(f"{table}: tabla sin reglas (no está en RULES ni en DROP_TABLES)")
            continue
        actual = {column.name for column in cols}
        missing = actual - set(declared)
        extra = set(declared) - actual
        for name in sorted(missing):
            errors.append(f"{table}.{name}: columna real sin regla")
        for name in sorted(extra):
            errors.append(f"{table}.{name}: regla declarada pero la columna no existe")

    for table in sorted(RULES):
        if table not in columns and table not in OPTIONAL_TABLES:
            errors.append(f"{table}: tiene reglas pero la tabla no existe")
        if table not in PROCESS_ORDER:
            errors.append(f"{table}: tiene reglas pero no está en PROCESS_ORDER")
        if table in DROP_TABLES:
            errors.append(f"{table}: está en DROP_TABLES y en RULES a la vez")

    for table in DROP_TABLES:
        if table not in columns:
            errors.append(f"{table}: DROP_TABLES menciona una tabla inexistente")
    return errors


# ── Generación de valores ───────────────────────────────────────────────────


@dataclass
class Context:
    token_key: str
    compute_hmac: object
    encrypt_value: object
    text_map: dict[tuple[str, str], str] = field(default_factory=dict)
    entity_values: dict[tuple[str, str], dict[int, str]] = field(default_factory=dict)

    def text_for(self, table: str, column: Rule, group: str) -> str:
        if column.group_by:
            map_key = (column.prefix, group)
        else:
            map_key = (table, column.prefix, group)
        if map_key not in self.text_map:
            token = synthetic_token(self.token_key, f"{table}:{column.prefix}", group)
            value = f"{column.prefix} {token}"
            if column.max_len:
                value = value[: column.max_len]
            self.text_map[map_key] = value
        return self.text_map[map_key]


def _original_is_null(row: dict, rule: Rule, column: str) -> bool:
    return getattr(rule, "preserve_null", True) and row.get(column) is None


def build_values(
    table: str,
    row: dict,
    rules: dict[str, Rule],
    ctx: Context,
) -> tuple[dict[str, object], dict[str, str]]:
    """Devuelve (valores nuevos, plaintext de las columnas cifradas)."""
    new_values: dict[str, object] = {}
    plaintext: dict[str, str] = {}
    row_id = row["id"]

    for column, rule in rules.items():
        if rule.action == "keep":
            continue
        if rule.action == "computed":
            continue
        if rule.where and not row.get("__where__", {}).get(column):
            continue

        original = row.get(column)
        if rule.action in NULLABLE_ACTIONS and original is None:
            new_values[column] = None
            continue
        if (
            original == ""
            and rule.action in {"text", "encrypted", "derived", "encrypted_derived"}
            and column != "description"
        ):
            # Preserva las cadenas vacías: el esquema y los tests distinguen
            # NULL de "". Sólo `description` es NOT NULL y siempre se rellena.
            new_values[column] = ""
            plaintext[column] = ""
            continue

        value: object
        clear: str | None = None

        if rule.action == "null":
            value = None
        elif rule.action == "const":
            value = None if rule.const is None else rule.const
        elif rule.action == "blank":
            value = None if original is None else ""
        elif rule.action == "email":
            value = f"user{row_id}@example.test"
        elif rule.action in {"text", "encrypted"}:
            group = str(row.get(rule.group_by)) if rule.group_by else str(row_id)
            clear = ctx.text_for(table, rule, group)
            value = ctx.encrypt_value(clear) if rule.action == "encrypted" else clear
        elif rule.action in {"derived", "encrypted_derived"}:
            clear = None
            for source_column, entity_table, entity_field in rule.lookups:
                source_id = row.get(source_column)
                if source_id is None:
                    continue
                clear = ctx.entity_values.get((entity_table, entity_field), {}).get(source_id)
                if clear:
                    break
            if not clear:
                clear = ctx.text_for(table, rule, str(row_id))
            value = ctx.encrypt_value(clear) if rule.action == "encrypted_derived" else clear
        elif rule.action == "synthetic_id":
            value = f"{rule.prefix}-{row_id}"
        elif rule.action == "synthetic_digits":
            clear = f"{rule.prefix}{row_id}"
            value = clear
        elif rule.action == "encrypted_digits":
            clear = f"{rule.prefix}{row_id}"
            value = ctx.encrypt_value(clear)
        elif rule.action == "hmac_literal":
            source = plaintext.get(rule.source or "", row.get(rule.source))
            value = ctx.compute_hmac(str(source)) if source is not None else None
        elif rule.action == "json_scrub":
            value = scrub_json(original, rule, ctx)
        else:
            raise RuntimeError(f"acción desconocida: {rule.action}")

        new_values[column] = value
        if clear is not None:
            plaintext[column] = clear

    # Columnas *_hmac: se recalculan con la misma transformación que usa la app.
    for column, rule in rules.items():
        if rule.action != "computed":
            continue
        owner = next(
            (name for name, candidate in rules.items() if candidate.partner == column),
            None,
        )
        if owner is None:
            raise RuntimeError(f"{table}.{column}: computed sin partner")
        clear = plaintext.get(owner)
        if clear is None:
            new_values[column] = None
            continue
        normalized = normalize(clear, rules[owner].normalize)
        new_values[column] = ctx.compute_hmac(normalized)
    return new_values, plaintext


def scrub_json(raw: object, rule: Rule, ctx: Context) -> str:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return "{}"
    if not isinstance(payload, dict):
        return "{}"

    def scrub(value: object) -> object:
        if isinstance(value, dict):
            return {key: scrub(item) for key, item in value.items()}
        if isinstance(value, list):
            return [scrub(item) for item in value]
        if isinstance(value, str):
            return ""
        return value

    cleaned: dict[str, object] = {}
    for key, value in payload.items():
        if key in rule.json_keys and isinstance(value, str):
            cleaned[key] = ctx.text_for(
                "categorization_reviews", Rule("text", prefix="merchant", group_by=key), value
            )
        else:
            cleaned[key] = scrub(value)
    return json.dumps(cleaned)


def where_flags(conn, table: str, rules: dict[str, Rule]) -> str | None:
    """Evalúa los `where` por fila sin traer la expresión al motor."""
    clauses = {rule.where for rule in rules.values() if rule.where}
    if not clauses:
        return None
    if len(clauses) != 1:
        raise RuntimeError(f"{table}: más de un `where` distinto no está soportado")
    return clauses.pop()


# ── Proceso por tabla ───────────────────────────────────────────────────────


def primary_key(conn, table: str) -> str:
    row = conn.execute(
        """
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = %s::regclass AND i.indisprimary
        """,
        (table,),
    ).fetchall()
    if len(row) != 1:
        raise RuntimeError(f"{table}: se esperaba una PK de una columna, hay {len(row)}")
    return row[0][0]


def table_count(conn, table: str) -> int:
    return conn.execute(
        sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table))
    ).fetchone()[0]


def written_columns(rules: dict[str, Rule]) -> list[str]:
    """Columnas que el UPDATE escribe. `computed` también: se llena en memoria."""
    return [name for name, rule in rules.items() if rule.action != "keep"]


def process_table(conn, table: str, columns: list[Column], ctx: Context) -> None:
    rules = RULES[table]
    if all(rule.action == "keep" for rule in rules.values()):
        return

    pk = primary_key(conn, table)
    if pk != "id":
        raise RuntimeError(f"{table}: el motor asume PK `id`, encontró `{pk}`")

    where_sql = where_flags(conn, table, rules)
    names = [column.name for column in columns]
    select = sql.SQL("SELECT {} FROM {}").format(
        sql.SQL(", ").join(sql.Identifier(name) for name in names),
        sql.Identifier(table),
    )
    if where_sql:
        select = select + sql.SQL(" WHERE ") + sql.SQL(where_sql)

    written = written_columns(rules)
    update_sql = sql.SQL("UPDATE {} SET {} WHERE {} = %s").format(
        sql.Identifier(table),
        sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(name)) for name in written),
        sql.Identifier(pk),
    )

    rows = conn.execute(select).fetchall()
    updates: list[tuple] = []
    for raw in rows:
        row = dict(zip(names, raw, strict=True))
        if where_sql:
            # El filtro ya lo aplicó el SELECT: todas las filas entran.
            row["__where__"] = {name: True for name in rules}
        new_values, plaintext = build_values(table, row, rules, ctx)
        updates.append(tuple(new_values[name] for name in written) + (row[pk],))
        for column, value in plaintext.items():
            ctx.entity_values.setdefault((table, column), {})[row[pk]] = value

    with conn.cursor() as cursor:
        for chunk in chunks(updates, 500):
            cursor.executemany(update_sql, chunk)


def chunks(items: list[tuple], size: int) -> Iterable[list[tuple]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def drop_tables(conn, tables: Iterable[str]) -> None:
    existing = list(tables)
    if not existing:
        return
    conn.execute(
        sql.SQL("TRUNCATE TABLE {} CASCADE").format(
            sql.SQL(", ").join(sql.Identifier(table) for table in existing)
        )
    )


# ── Verificación ────────────────────────────────────────────────────────────


def encrypted_columns() -> list[tuple[str, str]]:
    return [
        (table, column)
        for table, rules in RULES.items()
        for column, rule in rules.items()
        if rule.action in {"encrypted", "encrypted_derived", "encrypted_digits"}
    ]


def verify(conn, columns: dict[str, list[Column]], ctx: Context, report: Report) -> None:
    from app.services.encryption import decrypt_value, is_encrypted

    for table, column in encrypted_columns():
        rows = conn.execute(
            sql.SQL("SELECT {pk}, {col} FROM {tbl} WHERE {col} IS NOT NULL AND {col} <> ''").format(
                pk=sql.Identifier("id"),
                col=sql.Identifier(column),
                tbl=sql.Identifier(table),
            )
        ).fetchall()
        for row_id, value in rows:
            if not is_encrypted(value):
                report.verification_errors.append(
                    f"{table}.{column} id={row_id}: no parece ciphertext Fernet"
                )
                continue
            if decrypt_value(value) == "[encrypted]":
                report.verification_errors.append(
                    f"{table}.{column} id={row_id}: no descifra con la key de anonimización"
                )

    for table, cols in columns.items():
        if table in DROP_TABLES:
            continue
        for column in cols:
            rule = RULES[table].get(column.name)
            if rule is None or rule.action != "keep":
                continue
            if column.data_type not in TEXT_TYPES:
                continue
            values = conn.execute(
                sql.SQL("SELECT {col} FROM {tbl} WHERE {col} IS NOT NULL").format(
                    col=sql.Identifier(column.name), tbl=sql.Identifier(table)
                )
            ).fetchall()
            for (value,) in values:
                text = str(value)
                if EMAIL_RE.search(text) and "@example.test" not in text:
                    report.verification_errors.append(
                        f"{table}.{column.name}: email sin anonimizar"
                    )
                if PHONE_RE.match(text) or LONG_DIGITS_RE.search(text):
                    report.verification_errors.append(
                        f"{table}.{column.name}: posible teléfono/tarjeta sin anonimizar"
                    )

    for table, cols in columns.items():
        if table in DROP_TABLES:
            continue
        before = report.counts_before.get(table)
        after = table_count(conn, table)
        report.counts_after[table] = after
        if before is not None and before != after:
            report.verification_errors.append(f"{table}: {before} filas antes, {after} después")

    for table in DROP_TABLES:
        after = table_count(conn, table)
        report.counts_after[table] = after
        if after != 0:
            report.verification_errors.append(f"{table}: debería estar vacía, tiene {after}")

    report.verification_errors.extend(hmac_pair_errors(conn))
    report.verification_errors.extend(foreign_key_violations(conn))


def hmac_pair_errors(conn) -> list[str]:
    """Cada *_hmac tiene que coincidir con su columna origen.

    Sin este chequeo, un `computed` que se calcula pero no se escribe deja el
    HMAC de producción en la base y pasa desapercibido.
    """
    from app.services.encryption import decrypt_value

    problems: list[str] = []
    for table, rules in RULES.items():
        pairs = [
            (column, rule)
            for column, rule in rules.items()
            if rule.partner and rule.action != "computed"
        ]
        for column, rule in pairs:
            partner = rule.partner
            rows = conn.execute(
                sql.SQL("SELECT {pk}, {col}, {partner} FROM {tbl}").format(
                    pk=sql.Identifier("id"),
                    col=sql.Identifier(column),
                    partner=sql.Identifier(partner),
                    tbl=sql.Identifier(table),
                )
            ).fetchall()
            for row_id, clear, stored in rows:
                if rule.action in {"encrypted", "encrypted_derived", "encrypted_digits"}:
                    clear = decrypt_value(clear) if clear else None
                expected = ctx_free_hmac(clear, rule)
                if expected != stored:
                    problems.append(f"{table}.{partner} id={row_id}: no coincide con {column}")
    return problems


def ctx_free_hmac(value: object, rule: Rule) -> object:
    from app.services.encryption import compute_hmac

    if value is None or value == "":
        return None if value is None else ""
    return compute_hmac(normalize(str(value), rule.normalize))


def foreign_key_violations(conn) -> list[str]:
    constraints = conn.execute(
        """
        SELECT c.conrelid::regclass::text AS child,
               a.attname AS child_col,
               c.confrelid::regclass::text AS parent,
               af.attname AS parent_col
        FROM pg_constraint c
        JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
        JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS f(attnum, ord) ON f.ord = k.ord
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = f.attnum
        WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
        """
    ).fetchall()
    problems: list[str] = []
    for child, child_col, parent, parent_col in constraints:
        if "." in child or "." in parent:
            continue  # esquema no-public
        count = conn.execute(
            sql.SQL(
                "SELECT count(*) FROM {child} c WHERE c.{cc} IS NOT NULL "
                "AND NOT EXISTS (SELECT 1 FROM {parent} p WHERE p.{pc} = c.{cc})"
            ).format(
                child=sql.Identifier(child),
                cc=sql.Identifier(child_col),
                parent=sql.Identifier(parent),
                pc=sql.Identifier(parent_col),
            )
        ).fetchone()[0]
        if count:
            problems.append(f"FK rota: {child}.{child_col} -> {parent}.{parent_col} ({count})")
    return problems


# ── Entrada ─────────────────────────────────────────────────────────────────


def connect(dsn: str | None) -> psycopg.Connection:
    return psycopg.connect(dsn or "", autocommit=False)


def assert_safe_target(conn, force: bool) -> None:
    name = conn.info.dbname or ""
    if force:
        return
    if not (name.endswith("_anon") or name.endswith("_anonymized")):
        raise SystemExit(
            f"La base destino se llama `{name}`. El nombre debe terminar en "
            "`_anon` o `_anonymized`, o pasá --force si estás seguro."
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", default=None, help="DSN; si falta usa las PG* env")
    parser.add_argument("--key", default=os.getenv("ANONYMIZATION_KEY", DEFAULT_ANONYMIZATION_KEY))
    parser.add_argument("--dry-run", action="store_true", help="valida cobertura y sale")
    parser.add_argument("--verify-only", action="store_true", help="sólo verifica")
    parser.add_argument("--force", action="store_true", help="permite un nombre sin _anon")
    args = parser.parse_args(argv)

    compute_hmac, encrypt_value = load_crypto(args.key)
    ctx = Context(
        token_key=args.key,
        compute_hmac=compute_hmac,
        encrypt_value=encrypt_value,
    )

    report = Report()
    with connect(args.dsn) as conn:
        assert_safe_target(conn, args.force)
        columns = list_columns(conn)
        report.coverage_errors = check_coverage(columns)

        if report.coverage_errors:
            for error in report.coverage_errors:
                print(f"ERROR {error}", file=sys.stderr)
            print(
                f"\n{len(report.coverage_errors)} problema(s) de cobertura. "
                "Completá el registry antes de anonimizar.",
                file=sys.stderr,
            )
            return 2

        if args.dry_run:
            print(
                f"Cobertura OK: {len(columns)} tablas, {sum(map(len, columns.values()))} columnas."
            )
            print(f"Se vaciarían: {', '.join(sorted(DROP_TABLES))}")
            return 0

        if not args.verify_only:
            report.counts_before = {table: table_count(conn, table) for table in columns}
            with conn.transaction():
                for table in PROCESS_ORDER:
                    if table in columns:
                        process_table(conn, table, columns[table], ctx)
                drop_tables(conn, DROP_TABLES)
            print("Anonimización aplicada.")

        verify(conn, columns, ctx, report)
        for warning in report.warnings:
            print(f"WARN {warning}", file=sys.stderr)
        for error in report.verification_errors:
            print(f"ERROR {error}", file=sys.stderr)

    if report.ok:
        total = sum(report.counts_after.get(table, 0) for table in RULES)
        print(f"Verificación OK: {total} filas en tablas preservadas, sin violaciones de FK.")
        return 0
    print(f"\n{len(report.verification_errors)} problema(s) de verificación.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
