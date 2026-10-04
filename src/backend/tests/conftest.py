"""Test fixtures for integration tests."""

import os

# Set env vars BEFORE any app imports (module-level reads them)
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-bot-token:1234567890")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-ci-that-is-at-least-32-chars")

# Override DATABASE_URL to use test database
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql://expenses_user:pPwsrqtfBm1exxVE32GiTu8HdT2H34@localhost:5432/expenses_test",
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


@pytest.fixture(scope="session")
def engine():
    """Create test database engine and ensure tables exist."""
    from app.database import Base

    eng = create_engine(TEST_DATABASE_URL)
    # Drop and recreate all tables to match current models
    Base.metadata.drop_all(bind=eng)
    Base.metadata.create_all(bind=eng)
    return eng


@pytest.fixture(scope="function")
def db(engine):
    """Create test database session with rollback."""
    connection = engine.connect()
    transaction = connection.begin()
    Session = sessionmaker(bind=connection)
    session = Session()

    yield session

    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def test_user(db):
    """Create a test user."""
    from app.models import User
    from app.services.auth import get_password_hash

    user = User(
        email="test@example.com",
        full_name="Test, User",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user