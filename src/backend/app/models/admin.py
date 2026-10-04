"""Admin models: AuditLog, ImpersonationSession, ImpersonationMessage, PlatformLog, MonthlyReport."""

from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, Integer, LargeBinary, String, Text
from sqlalchemy.orm import relationship

from app.database import Base
from app.types.encrypted import EncryptedType


class MonthlyReport(Base):
    __tablename__ = "monthly_reports"
    __table_args__ = (Index("ix_monthly_reports_user_month", "user_id", "month", unique=True),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    month = Column(String(7), nullable=False)  # YYYY-MM format
    status = Column(String(20), default="READY")  # PENDING | READY | FAILED
    report_data = Column(EncryptedType, nullable=True)  # JSON with full report data
    pdf_data = Column(LargeBinary, nullable=True)  # Generated PDF bytes (legacy)
    png_data = Column(LargeBinary, nullable=True)  # Generated PNG image bytes
    error_message = Column(Text, nullable=True)  # Error if FAILED
    created_at = Column(DateTime, default=datetime.utcnow)
    generated_at = Column(DateTime, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_user_id", "user_id"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(50), nullable=False)
    ip_address = Column(EncryptedType, nullable=True)
    user_agent = Column(EncryptedType, nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ImpersonationSession(Base):
    __tablename__ = "impersonation_sessions"
    __table_args__ = (Index("ix_impersonation_sessions_admin_id", "admin_id"),)

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    target_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(20), default="pending")  # pending | active | ended | rejected | expired
    token = Column(String(512), nullable=True)
    expires_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    admin = relationship("User", foreign_keys=[admin_id])
    target_user = relationship("User", foreign_keys=[target_user_id])
    messages = relationship(
        "ImpersonationMessage", back_populates="session", cascade="all, delete-orphan"
    )


class ImpersonationMessage(Base):
    __tablename__ = "impersonation_messages"
    __table_args__ = (Index("ix_impersonation_messages_session_id", "session_id"),)

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(
        Integer, ForeignKey("impersonation_sessions.id", ondelete="CASCADE"), nullable=False
    )
    sender_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("ImpersonationSession", back_populates="messages")
    sender = relationship("User", foreign_keys=[sender_id])


class PlatformLog(Base):
    __tablename__ = "platform_logs"
    __table_args__ = (
        Index("ix_platform_logs_level_created", "level", "created_at"),
        Index("ix_platform_logs_created_at", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    level = Column(String(10), nullable=False)  # WARNING | ERROR | CRITICAL
    module = Column(String(100), nullable=False)
    message = Column(Text, nullable=False)
    details = Column(Text, nullable=True)  # Full traceback if available
    created_at = Column(DateTime, default=datetime.utcnow)