# Spec: Telegram OpenID Connect SSO

## Problem

The current Telegram MiniApp SSO uses `initData` HMAC verification with a 5-minute expiry. This causes:
- Auto-login failures when the user opens the MiniApp after the5-minute window
- No login capability outside the MiniApp iframe (e.g., Direct Link)
- Silent failures that show a login page with no explanation
- Tightly coupled to the bot token (rotating the token breaks all sessions)

## Solution

Integrate Telegram's new OpenID Connect (OIDC) provider as the authentication mechanism for Telegram users, replacing the initData HMAC flow.

### Key URLs (Telegram OIDC)

| Resource | URL |
|----------|-----|
| Discovery | `https://oauth.telegram.org/.well-known/openid-configuration` |
| Authorization | `https://oauth.telegram.org/auth` |
| Token | `https://oauth.telegram.org/token` |
| JWKS | `https://oauth.telegram.org/.well-known/jwks.json` |
| Issuer | `https://oauth.telegram.org` |

### Authentication Flows

#### Flow 1: MiniApp Login (inside Telegram)
```
1. User opens MiniApp in Telegram
2. App detects Telegram context (isLikelyTelegram)
3. No stored token → show "Iniciar sesión con Telegram" button
4. User clicks → opens OIDC popup/redirect to oauth.telegram.org
5. User confirms in Telegram → redirected back with ?code=...
6. Frontend sends code to POST /auth/telegram/oidc
7. Backend exchanges code for id_token at Telegram's token endpoint
8. Backend verifies id_token (signature via JWKS, iss, aud, exp)
9. Backend extracts Telegram user ID from `sub` claim
10. Backend finds/creates user, links Telegram account if needed
11. Backend returns JWT → user is authenticated
```

#### Flow 2: Web Login (outside Telegram)
```
1. User visits platform.oikonomia.ar/login
2. "Iniciar sesión con Telegram" button visible alongside Google SSO
3. User clicks → redirect to oauth.telegram.org/auth
4. User confirms in Telegram app → redirected back with ?code=...
5. Same backend flow as above (steps 6-11)
```

#### Flow 3: Account Linking (existing user)
```
1. Authenticated user goes to Settings → Telegram Bot
2. Clicks "Vincular cuenta de Telegram"
3. OIDC flow runs → backend links Telegram ID to existing account
4. User can now log in via Telegram OR their original method
```

## Backend Changes

### New Environment Variables

```env
TELEGRAM_OIDC_CLIENT_ID=<from BotFather Web Login>
TELEGRAM_OIDC_CLIENT_SECRET=<from BotFather Web Login>
```

### New Endpoint: `POST /auth/telegram/oidc`

**Request:**
```json
{
  "code": "authorization_code_from_telegram",
  "redirect_uri": "https://platform.oikonomia.ar/auth/telegram/callback"
}
```

**Logic:**
1. Exchange `code` for tokens at `https://oauth.telegram.org/token`
   - Use `client_id`, `client_secret`, `code`, `redirect_uri`, `grant_type=authorization_code`
2. Verify `id_token`:
   - Fetch JWKS from `https://oauth.telegram.org/.well-known/jwks.json` (cache it)
   - Verify signature (RS256)
   - Verify `iss` == `https://oauth.telegram.org`
   - Verify `aud` == `client_id`
   - Verify `exp` is not expired
3. Extract claims: `sub` (Telegram user ID), `first_name`, `last_name`, `username`, `photo_url`
4. Find user by `telegram_chat_hash` (HMAC of `sub`)
5. If not found → create new user OR link to existing session user
6. Return `Token` (JWT)

**Response:** Same as existing auth endpoints:
```json
{
  "access_token": "...",
  "token_type": "bearer",
  "mfa_required": false,
  "force_password_change": false
}
```

### New Endpoint: `GET /auth/telegram/callback`

OIDC redirect handler for web flow. Receives `?code=...&state=...` from Telegram, exchanges for tokens server-side, redirects to frontend with token.

### New Endpoint: `POST /auth/telegram/link`

For authenticated users who want to link their Telegram account. Runs OIDC flow and adds `telegram_chat_hash` to existing user record.

### Keep Existing: `POST /auth/telegram/webapp`

Keep the initData HMAC endpoint as a fallback for older Telegram clients that don't support OIDC. Add a deprecation comment.

### Dependencies

```txt
# Add to requirements.txt
jose[cryptography]>=3.3.0  # For JWT verification with JWKS
# Or use PyJWT + requests for JWKS fetch
```

### JWKS Caching

```python
# services/telegram_oidc.py
_jwks_cache = {"keys": None, "fetched_at": 0}
JWKS_TTL = 3600  # 1 hour

async def get_jwks():
    if time.time() - _jwks_cache["fetched_at"] < JWKS_TTL:
        return _jwks_cache["keys"]
    async with httpx.AsyncClient() as client:
        resp = await client.get("https://oauth.telegram.org/.well-known/jwks.json")
        _jwks_cache["keys"] = resp.json()["keys"]
        _jwks_cache["fetched_at"] = time.time()
    return _jwks_cache["keys"]
```

## Frontend Changes

### Login Page (`LoginPage.tsx`)

Add "Iniciar sesión con Telegram" button alongside Google SSO:
```tsx
<button onClick={handleTelegramLogin}>
  Iniciar sesión con Telegram
</button>
```

### Telegram OIDC Initiation

```typescript
// api/client.ts
export const telegramOidcLogin = (code: string, redirectUri: string) =>
  api.post<AuthToken>("/auth/telegram/oidc", { code, redirect_uri: redirectUri })
    .then((r) => r.data);

export const telegramOidcLink = (code: string, redirectUri: string) =>
  api.post("/auth/telegram/link", { code, redirect_uri: redirectUri });
```

### Callback Page

New route: `/auth/telegram/callback`
- Extracts `code` from query params
- Sends to backend
- Stores token
- Redirects to dashboard

### MiniApp Flow Update

Replace `telegramAutoLogin()` (initData HMAC) with OIDC:
```typescript
// services/telegramWebApp.ts
export async function telegramAutoLogin(): Promise<boolean> {
  const wa = window.Telegram?.WebApp;
  if (!wa) return false;

  const existingToken = localStorage.getItem("auth_token");
  if (existingToken) return false;

  // Try OIDC: open Telegram's auth in the MiniApp context
  // Telegram handles the auth popup natively inside MiniApps
  try {
    const redirectUri = `${window.location.origin}/auth/telegram/callback`;
    const authUrl = `https://oauth.telegram.org/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid&state=miniapp`;
    // In MiniApp context, this opens a native Telegram auth dialog
    wa.openTelegramLink(authUrl);
    return false; // User will be redirected back after auth
  } catch {
    return false;
  }
}
```

### Direct Link

The Direct Link URL for the MiniApp:
```
https://t.me/YOUR_BOT_NAME/app
```

When opened, if the user isn't authenticated, the MiniApp shows the "Iniciar sesión con Telegram" button which triggers the OIDC flow.

## Migration Strategy

1. **Phase 1**: Add OIDC endpoints alongside existing initData endpoint
2. **Phase 2**: Update frontend to use OIDC for new logins
3. **Phase 3**: Keep initData endpoint as fallback for older Telegram clients
4. **Phase 4**: (Future) Deprecate initData endpoint when OIDC adoption is100%

## BotFather Configuration

| Setting | Location | Value |
|---------|----------|-------|
| **Allowed URLs** | Bot Settings → Web Login | `https://platform.oikonomia.ar` |
| **Redirect URL** | Bot Settings → Web Login | `https://platform.oikonomia.ar/auth/telegram/callback` |
| **Client ID** | Bot Settings → Web Login | (generated by BotFather) |
| **Client Secret** | Bot Settings → Web Login | (generated by BotFather) |
| **Mini App URL** | Bot Settings → Configure Mini App | `https://platform.oikonomia.ar` |
| **Splash icon** | Bot Settings → Configure Mini App | `assets/miniapp-splash.png` |

## Security Considerations

1. **PKCE**: Use S256 code challenge for the authorization flow
2. **State parameter**: Use random state to prevent CSRF
3. **JWKS caching**: Cache keys with TTL, handle key rotation
4. **Token validation**: Verify ALL claims (iss, aud, exp, iat)
5. **Redirect URI validation**: Must match registered URLs exactly
6. **Client secret**: Store in GitHub Secrets, never expose to frontend

## Files to Create/Modify

| File | Action |
|------|--------|
| `backend/app/services/telegram_oidc.py` | NEW — OIDC client (code exchange, JWKS, token verification) |
| `backend/app/routers/auth.py` | MODIFY — Add `/auth/telegram/oidc`, `/auth/telegram/callback`, `/auth/telegram/link` |
| `backend/app/schemas/auth.py` | MODIFY — Add `TelegramOidcRequest`, `TelegramCallbackRequest` |
| `backend/.env.example` | MODIFY — Add `TELEGRAM_OIDC_CLIENT_ID`, `TELEGRAM_OIDC_CLIENT_SECRET` |
| `backend/requirements.txt` | MODIFY — Add `jose[cryptography]` or equivalent |
| `.github/workflows/deploy.yml` | MODIFY — Add new secrets to env file builder |
| `frontend/src/pages/LoginPage.tsx` | MODIFY — Add Telegram login button |
| `frontend/src/pages/TelegramCallbackPage.tsx` | NEW — OIDC callback handler |
| `frontend/src/api/client.ts` | MODIFY — Add `telegramOidcLogin`, `telegramOidcLink` |
| `frontend/src/App.tsx` | MODIFY — Add `/auth/telegram/callback` route |
| `frontend/src/services/telegramWebApp.ts` | MODIFY — Update `telegramAutoLogin` to use OIDC |