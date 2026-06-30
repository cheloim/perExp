# Authentication

## Overview

NikoFin supports multiple authentication methods: email/password, Google OAuth, and Apple Sign-In. All methods issue JWT tokens valid for 7 days.

## JWT Configuration

| Setting          | Value                      |
| ---------------- | -------------------------- |
| Algorithm        | HS256                      |
| Expiry           | 7 days (`JWT_EXPIRE_DAYS`) |
| Secret           | `SECRET_KEY` env var       |
| Password hashing | bcrypt                     |

## Login Methods

### Email + Password

**Endpoint**: `POST /auth/login`

```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response**:

```json
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "user": { ... }
}
```

### Registration

**Endpoint**: `POST /auth/register`

```json
{
  "full_name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123"
}
```

**Password requirements**:

- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 lowercase letter
- At least 1 digit

**On registration**:

- Default category hierarchy is seeded
- User record created with bcrypt-hashed password

### Google OAuth (id_token)

**Endpoint**: `POST /auth/oauth`

```json
{
  "provider": "google",
  "id_token": "eyJ..."
}
```

The `id_token` is verified via Google's tokeninfo endpoint:

```
GET https://oauth2.googleapis.com/tokeninfo?id_token={token}
```

### Google OAuth (Authorization Code)

**Endpoint**: `POST /auth/oauth/callback`

```json
{
  "provider": "google",
  "code": "authorization_code"
}
```

Flow:

1. Exchange code for tokens via Google OAuth
2. Verify id_token from response
3. Create/login user

### Apple Sign-In

**Endpoint**: `POST /auth/oauth`

```json
{
  "provider": "apple",
  "id_token": "eyJ..."
}
```

Verification:

1. Fetch Apple's public keys from `https://appleid.apple.com/auth/keys`
2. Match `kid` header in JWT
3. Verify signature with Apple's public key (RS256)
4. Extract user info from token

## Token Management

### Refresh Token

**Endpoint**: `POST /auth/refresh`

Returns a new JWT token. Requires valid current token.

### Change Password

**Endpoint**: `PUT /auth/password`

```json
{
  "current_password": "oldpass",
  "new_password": "newpass"
}
```

### Forgot Password

**Endpoint**: `POST /auth/forgot-password`

```json
{
  "email": "user@example.com"
}
```

- Generates reset token (15-minute expiry)
- Sends email via Resend API
- Token stored in `reset_token` and `reset_token_expires`

### Reset Password

**Endpoint**: `POST /auth/reset-password`

```json
{
  "token": "reset_token_from_email",
  "new_password": "newpass"
}
```

## User Profile

### Get Current User

**Endpoint**: `GET /auth/me`

Returns current user profile including:

- `id`, `full_name`, `email`
- `provider` (local, google, apple)
- `avatar_url`
- `invite_code` (for family groups)
- `telegram_linked` (boolean)

## Telegram Bot Authentication

### Get Telegram Key

**Endpoint**: `GET /auth/me/telegram-key`

Returns 12-character key for linking Telegram bot.

### Regenerate Telegram Key

**Endpoint**: `POST /auth/me/telegram-key/regenerate`

Invalidates old key and generates new one.

### Check Telegram Status

**Endpoint**: `GET /auth/me/telegram-status`

Returns:

```json
{
  "linked": true,
  "chat_id": "123456789"
}
```

## Security Features

- **bcrypt** password hashing
- **JWT** with 7-day expiry
- **Single-use** Telegram keys (invalidated after linking)
- **Token-based** password reset (15-min expiry)
- **OAuth** provider verification (Google, Apple)
- **CORS** configured for production domain

## Protected Routes

All routes except `/auth/login`, `/auth/register`, and `/auth/oauth` require a valid JWT token in the `Authorization: Bearer {token}` header.
