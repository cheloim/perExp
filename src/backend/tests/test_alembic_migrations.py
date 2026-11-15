"""Caso de uso de Alembic de punta a punta.

Crea una base vacía, aplica `alembic upgrade head`, verifica que el esquema
esperado exista y que `alembic check` no detecte diferencias contra los modelos.

Corre en un subprocess para que `env.py` no contamine el `DATABASE_URL` ni los
engines importados por el resto de la suite.
"""

import os
import subprocess
import sys
import uuid
from pathlib import Path

import psycopg
from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND_DIR = Path(__file__).resolve().parents[1]
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"
TEST_SECRET = "test-secret-key-that-is-at-least-32-chars-long"


def admin_url() -> str:
    return os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql://expenses_user:pPwsrqtfBm1exxVE32GiTu8HdT2H34@localhost:5432/expenses_test",
    )


def run_alembic(*args: str, database_url: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "DATABASE_URL": database_url, "SECRET_KEY": TEST_SECRET}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"alembic {' '.join(args)} falló:\n{result.stdout}\n{result.stderr}"
    )
    return result


def test_upgrade_head_creates_the_schema_and_matches_the_models():
    url = admin_url()
    database = f"alembic_test_{uuid.uuid4().hex[:10]}"
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{database}"')

    database_url = url.rsplit("/", 1)[0] + "/" + database
    try:
        run_alembic("upgrade", "head", database_url=database_url)

        head = ScriptDirectory.from_config(Config(str(ALEMBIC_INI))).get_current_head()
        with psycopg.connect(database_url) as conn:
            version = conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
                )
            }
            expense_columns = {
                row[0]
                for row in conn.execute(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'expenses'"
                )
            }
            review_columns = {
                row[0]
                for row in conn.execute(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'categorization_reviews'"
                )
            }

        assert version == head
        assert {"users", "expenses", "categorization_reviews", "alembic_version"} <= tables
        assert "is_recurring_projection" in expense_columns
        assert "bulk_applied" in review_columns

        # El contrato: una base creada por Alembic no difiere de los modelos.
        run_alembic("check", database_url=database_url)
    finally:
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s",
                (database,),
            )
            conn.execute(f'DROP DATABASE IF EXISTS "{database}"')
