from datetime import datetime

from pydantic import BaseModel, EmailStr, field_validator

from app.schemas.common import _validate_email_format, _validate_password_strength


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        return v.lower().strip()


class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        return _validate_email_format(v)

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        return _validate_password_strength(v)


class UserResponse(BaseModel):
    id: int
    full_name: str
    email: str
    is_active: bool
    created_at: datetime
    provider: str | None = None
    avatar_url: str | None = None
    invite_code: str | None = None
    mfa_enabled: bool = False
    email_verified: bool = False
    onboarding_completed: bool = False
    is_admin: bool = False
    is_blocked: bool = False
    whats_new_dismissed_version: str | None = None
    model_config = {"from_attributes": True}


class OAuthRequest(BaseModel):
    code: str | None = None
    provider: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    mfa_required: bool = False
    mfa_setup_required: bool = False
    force_password_change: bool = False


class MFASetupResponse(BaseModel):
    secret: str
    qr_code: str


class MFAVerifyRequest(BaseModel):
    code: str


class MFALoginRequest(BaseModel):
    token: str
    code: str


class EmailVerificationRequest(BaseModel):
    token: str


class ForceChangePasswordRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        return _validate_password_strength(v)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class DeleteAccountRequest(BaseModel):
    current_password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        return _validate_email_format(v)


class TelegramWebAppRequest(BaseModel):
    init_data: str


class TelegramLoginWidgetRequest(BaseModel):
    id: int
    first_name: str
    last_name: str | None = None
    username: str | None = None
    photo_url: str | None = None
    auth_date: str
    hash: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        return _validate_password_strength(v)
