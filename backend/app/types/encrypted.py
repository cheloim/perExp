from sqlalchemy.types import String, TypeDecorator

from app.services.encryption import decrypt_value, encrypt_value


class EncryptedType(TypeDecorator):
    """SQLAlchemy type that transparently encrypts/decrypts values.

    Usage:
        class MyModel(Base):
            secret_field = Column(EncryptedType, nullable=True)
    """

    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        """Encrypt before writing to DB."""
        return encrypt_value(value) if value else value

    def process_result_value(self, value, dialect):
        """Decrypt when reading from DB."""
        return decrypt_value(value) if value else value
