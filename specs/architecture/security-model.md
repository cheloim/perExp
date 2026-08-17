# Security Model

## JWT Authentication

Library: **python-jose** (jose.JWTError, jose.jwt)

| Setting            | Value / Env Var              | Default        |
|--------------------|------------------------------|----------------|
| Algorithm          | `HS256` (hardcoded)          |                |
| Secret             | `SECRET_KEY` env var         | **required**, min 32 chars |
| Token expiry       | `JWT_EXPIRE_DAYS` env var    | 7 days         |
| MFA partial token  | 5 minutes (hardcoded)        |                |
| Force change token | 5 minutes (hardcoded)        |                |

Token payload:

```json
{"sub": "<user_id>", "exp": <unix_timestamp>}
```

Flow:
1. User calls `POST /auth/login` with email + password
2. If MFA enabled → returns partial token (5 min TTL) + `mfa_required: true`
3. Client sends partial token + TOTP code to `POST /auth/login/mfa`
4. Full token issued (7 days)
5. Refresh via `POST /auth/refresh` (requires valid token)

## OAuth Providers

### Google OAuth

Two flows supported:
- **ID token flow**: Client sends `id_token` from Google Sign-In → verified via `googleapis.com/oauth2/v3/tokeninfo`
- **Authorization code flow**: Client sends `code` → exchanged for tokens via `oauth2.googleapis.com/token` → `id_token` verified

Env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

### Apple Sign-In

Planned. Will follow similar pattern to Google (id_token verification).

## MFA (Multi-Factor Authentication)

Library: **pyotp** (TOTP), **qrcode** (QR generation)

| Step                | Endpoint                    | Description                      |
|---------------------|-----------------------------|----------------------------------|
| Setup               | `GET /mfa/setup`            | Returns secret + QR code PNG     |
| Enable              | `POST /mfa/enable`          | Verify code → set `mfa_enabled`  |
| Disable             | `POST /mfa/disable`         | Verify code → clear `mfa_secret` |
| Login verification  | `POST /auth/login/mfa`      | Verify code against stored secret|

Secrets are stored encrypted (Fernet) in `users.mfa_secret` column via `EncryptedType`.

TOTP allows 1 step drift (`valid_window=1`) for clock skew tolerance.

## Field-Level Encryption

Library: **cryptography** (Fernet)

`EncryptedType` is a custom SQLAlchemy `TypeDecorator` that transparently encrypts on write and decrypts on read:

```python
# app/types/encrypted.py
class EncryptedType(TypeDecorator):
    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return encrypt_value(value) if value else value

    def process_result_value(self, value, dialect):
        return decrypt_value(value) if value else value
```

Fernet key is derived from `SECRET_KEY` via SHA-256:

```python
key = hashlib.sha256(secret.encode()).digest()
fernet_key = base64.urlsafe_b64encode(key)
```

### Encrypted Fields

| Model       | Field                | Type             |
|-------------|----------------------|------------------|
| `User`      | `full_name`          | `EncryptedType`  |
| `User`      | `telegram_chat_id`   | `EncryptedType`  |
| `User`      | `mfa_secret`         | `EncryptedType`  |
| `User`      | `whatsapp_phone`     | `EncryptedType`  |
| `Account`   | `name`               | `EncryptedType`  |
| `Card`      | `card_name`          | `EncryptedType`  |
| `Card`      | `bank`               | `EncryptedType`  |
| `Card`      | `holder`             | `EncryptedType`  |
| `Expense`   | `description`        | `EncryptedType`  |
| `Expense`   | `notes`              | `EncryptedType`  |
| `Investment`| `notes`              | `EncryptedType`  |
| `ScheduledExpense` | `description` | `EncryptedType`  |
| `MonthlyReport`    | `report_data`  | `EncryptedType`  |
| `AuditLog`  | `ip_address`         | `EncryptedType`  |
| `AuditLog`  | `user_agent`         | `EncryptedType`  |

## HMAC for Searchable Encrypted Fields

Library: **hmac** + **hashlib** (HMAC-SHA256)

Since encrypted fields can't be queried directly, HMAC columns provide deterministic lookups:

```python
def compute_hmac(value: str) -> str:
    secret = os.getenv("SECRET_KEY", "")
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()
```

### HMAC Columns

| Model            | Encrypted Field | HMAC Column        | Index |
|------------------|-----------------|--------------------|-------|
| `Card`           | `card_name`     | `card_name_hmac`   | yes   |
| `Card`           | `bank`          | `bank_hmac`        | yes   |
| `Account`        | `name`          | `name_hmac`        | yes   |
| `Expense`        | `description`   | `description_hmac` | yes   |
| `ScheduledExpense`| `description`  | `description_hmac` | yes   |
| `User`           | `telegram_chat_id` | `telegram_chat_hash` | yes |
| `User`           | `whatsapp_phone`   | `whatsapp_phone_hash`| yes |

HMAC is computed from the lowercased, stripped value. It's updated whenever the parent encrypted field changes.

## Password Hashing

Library: **bcrypt**

```python
def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())
```

Password strength requirements (enforced in Pydantic validators):
- Minimum 8 characters
- At least 1 uppercase, 1 lowercase, 1 digit, 1 special character
- Special chars: `!@#$%^&*()-_+=<>?/[]{}|`

Email validation includes:
- DNS MX record check for the domain
- Blocked disposable email domain list

## Rate Limiting

Implementation: **Redis-based** (custom, not slowapi)

| Limit Type       | Max Attempts | Window   |
|------------------|-------------|----------|
| `login`          | 10          | 60s      |
| `register`       | 3           | 300s     |
| `forgot_password`| 3           | 300s     |
| `mfa`            | 5           | 300s     |

Key format: `rate_limit:{type}:{identifier}` (identifier = IP for login/register, `user:{id}` for MFA)

Uses Redis sorted sets with timestamp scores for sliding window counting.

### Account Lockout

After 5 failed login attempts, the account is locked for 15 minutes:
- Key: `lockout:{user_id}` with 900s TTL
- Resets on successful login
- Checked before password verification

## CSRF Protection

The API is stateless (JWT Bearer tokens, no cookies for auth). CSRF is not applicable because:
- No session cookies are used for authentication
- All auth is via `Authorization: Bearer <token>` header
- OAuth state parameter used for OAuth flows

## Secret Management

All secrets are managed as **external secrets** in podman-compose, sourced from environment variables:

```yaml
secrets:
  creditcard_backend_dev_secret_key:
    external: true
    env: SECRET_KEY_DEV
  creditcard_backend_dev_llm_api_key:
    external: true
    env: LLM_API_KEY_DEV
  creditcard_backend_dev_telegram_bot_token:
    external: true
    env: TELEGRAM_BOT_TOKEN_DEV
```

Secrets are mounted into containers at `/run/secrets/` by Podman.

### Required Secrets

| Secret                                | Purpose                        |
|---------------------------------------|--------------------------------|
| `SECRET_KEY`                          | JWT signing + Fernet key derivation + HMAC |
| `POSTGRES_PASSWORD`                   | Database password              |
| `LLM_API_KEY`                         | Gemini API for expense parsing |
| `INVESTMENTS_LLM_API_KEY`             | Gemini API for investment analysis |
| `MESSAGES_BOT_LLM_API_KEY`            | Gemini API for bot messages    |
| `TELEGRAM_BOT_TOKEN`                  | Telegram Bot API token         |
| `GOOGLE_CLIENT_ID`                    | Google OAuth client            |
| `GOOGLE_CLIENT_SECRET`                | Google OAuth secret            |
| `EMAIL_API_KEY`                       | Resend email API key           |
| `WHATSAPP_TOKEN`                      | WhatsApp Cloud API token       |
| `WHATSAPP_PHONE_ID`                   | WhatsApp phone number ID       |
| `WHATSAPP_VERIFY_TOKEN`               | WhatsApp webhook verify token  |

### Audit Logging

Security events are logged to `audit_logs` table:

| Action                  | When                                    |
|-------------------------|-----------------------------------------|
| `login_success`         | Successful login                        |
| `login_failed`          | Wrong password                          |
| `login_mfa_required`    | MFA challenge issued                    |
| `mfa_failed`            | Wrong TOTP code                         |
| `register`              | New user registration                   |
| `oauth_login`           | OAuth login                             |
| `password_changed`      | Password change                         |
| `force_password_changed`| Admin-forced password change            |
| `account_deleted`       | User self-deleted account               |

Each log entry captures: `user_id`, `action`, `ip_address`, `user_agent`, `details`, `created_at`.
