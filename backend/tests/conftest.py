"""Test fixtures for integration tests."""

import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Use separate test database
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql://expenses_user:expenses_secure_pass_2026@localhost:5433/expenses_test",
)


@pytest.fixture(scope="session")
def engine():
    """Create test database engine."""
    return create_engine(TEST_DATABASE_URL)


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
