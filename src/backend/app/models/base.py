"""Core domain models: User, Group, GroupMember."""

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base
from app.types.encrypted import EncryptedType


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(EncryptedType, nullable=False, default="")
    email = Column(String, unique=True, nullable=False)
    invite_code = Column(String(8), nullable=True, unique=True, index=True)
    hashed_password = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)
    telegram_key = Column(String(12), nullable=True, unique=True, index=True)
    telegram_key_expires = Column(DateTime, nullable=True)
    telegram_chat_id = Column(EncryptedType, nullable=True)
    telegram_chat_hash = Column(String(64), nullable=True, unique=True, index=True)
    provider = Column(String, nullable=True)
    provider_id = Column(String, nullable=True, index=True)
    avatar_url = Column(String, nullable=True)
    reset_token = Column(String(64), nullable=True, unique=True, index=True)
    reset_token_expires = Column(DateTime, nullable=True)
    # Security: MFA
    mfa_secret = Column(EncryptedType, nullable=True)
    mfa_enabled = Column(Boolean, default=False)
    # Security: Email verification
    email_verified = Column(Boolean, default=False)
    email_verification_token = Column(String(64), nullable=True, unique=True, index=True)
    # Security: Forced password change
    force_password_change = Column(Boolean, default=False)
    # Onboarding
    onboarding_completed = Column(Boolean, default=False)
    # Auto-detect recurring banner
    auto_detected_banner_dismissed_at = Column(DateTime, nullable=True)
    # What's New dismissed version
    whats_new_dismissed_version = Column(String(20), nullable=True)
    # Admin
    is_admin = Column(Boolean, default=False)
    is_blocked = Column(Boolean, default=False)
    blocked_at = Column(DateTime, nullable=True)
    blocked_reason = Column(Text, nullable=True)
    # WhatsApp
    whatsapp_phone = Column(EncryptedType, nullable=True)
    whatsapp_phone_hash = Column(String(64), nullable=True, unique=True, index=True)
    whatsapp_key = Column(String(12), nullable=True, unique=True, index=True)
    # Google OAuth refresh token
    google_refresh_token = Column(EncryptedType, nullable=True)
    google_refresh_token_hmac = Column(String(64), nullable=True, index=True)


class Group(Base):
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    members = relationship("GroupMember", back_populates="group", cascade="all, delete-orphan")


class GroupMember(Base):
    __tablename__ = "group_members"
    __table_args__ = (UniqueConstraint("group_id", "user_id", name="uq_group_member"),)
    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String, default="member")
    status = Column(String, default="accepted")  # pending | accepted | rejected
    invited_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    joined_at = Column(DateTime, default=datetime.utcnow)
    group = relationship("Group", back_populates="members")