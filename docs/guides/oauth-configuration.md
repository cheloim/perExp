# OAuth/SSO Configuration Guide

This guide covers how to configure Google OAuth SSO in Oikonomia, including common pitfalls and how to avoid them.

## Overview

Oikonomia uses Google Identity Services (GIS) with the **authorization code flow** for SSO. The frontend initiates the OAuth flow, Google redirects back with an authorization code, and the backend exchanges the code for user data.

## Key Files

| File | Purpose |
|------|---------|
| `src/frontend/src/pages/LoginPage.tsx` | GIS client initialization + login handler |
| `src/frontend/src/env.d.ts` | TypeScript type definitions for GIS API |
| `src/backend/app/services/auth.py` | Token exchange + validation |
| `src/backend/app/routers/auth.py` | OAuth callback endpoint |

## GIS Client Parameters

The `initCodeClient()` call in `LoginPage.tsx` configures the OAuth flow:

```typescript
window.google.accounts.oauth2.initCodeClient({
  client_id: "...",           // Required: Google OAuth client ID
  scope: "email profile openid", // Required: requested scopes
  ux_mode: "redirect",       // Required: "redirect" or "popup"
  redirect_uri: "...",       // Required: must match Google Cloud Console
  // access_type and prompt are NOT set — see below
});
```

### Required Parameters

| Parameter | Description |
|-----------|-------------|
| `client_id` | Google OAuth client ID from Google Cloud Console |
| `scope` | Space-delimited list of requested scopes |
| `ux_mode` | `"redirect"` (full-page) or `"popup"` (inline) |
| `redirect_uri` | Must exactly match an authorized redirect URI in Google Cloud Console |

### `access_type` — Online vs Offline

| Value | Behavior | When to use |
|-------|----------|-------------|
| `"online"` (default) | No refresh token issued | **Recommended for SSO** — when you don't need to access Google APIs after login |
| `"offline"` | Refresh token issued | Only when you need to access Google APIs on behalf of the user (e.g., background sync) |

**Important:** `access_type: "offline"` causes Google to show the consent screen on **every login** and send a "data sharing notification" email each time. Only use it if you actually need the refresh token for background access.

### `prompt` — Consent Behavior

| Value | Behavior | When to use |
|-------|----------|-------------|
| (not set) | Google decides | **Recommended for SSO** — consent only on first login |
| `"select_account"` | Show account picker every time | When you want to force account selection (adds friction) |
| `"consent"` | Always show consent screen | When you need fresh consent every time (rare) |
| `"none"` | No prompt (silent auth) | Background re-authentication |

### Recommended Configuration for SSO

For standard SSO (login only, no background Google API access):

```typescript
// RECOMMENDED — consent only on first login, no refresh token
initCodeClient({
  client_id: "...",
  scope: "email profile openid",
  ux_mode: "redirect",
  redirect_uri: "...",
  // No access_type or prompt — Google uses default behavior
});
```

This configuration:
- Shows consent screen only on the first login
- Does NOT send "data sharing notification" emails on repeat logins
- Does NOT issue a refresh token (not needed for SSO)
- Shows account picker only if user has multiple Google accounts

### When to Use `access_type: "offline"`

Only use `access_type: "offline"` if you need to access Google APIs on behalf of the user when they're not actively using the app (e.g., syncing Google Calendar, sending emails via Gmail API).

If you use `access_type: "offline"`:
- Google will show the consent screen on **every login**
- Google will send a "data sharing notification" email on **every login**
- You MUST implement token refresh logic to use the refresh token
- You should set `prompt: "select_account"` to at least show the account picker

```typescript
// ONLY for background Google API access
initCodeClient({
  client_id: "...",
  scope: "email profile openid",
  ux_mode: "redirect",
  redirect_uri: "...",
  access_type: "offline",
  prompt: "select_account",
});
```

### `state` — CSRF Protection

The `state` parameter is a random string that prevents CSRF attacks on the OAuth flow. It should be:
1. Generated before the redirect
2. Verified after the callback

Currently not implemented. See [Google's documentation](https://developers.google.com/identity/protocols/oauth2/web/guides/using-the-state-parameter) for implementation details.

## TypeScript Type Definitions

The GIS API types are defined in `src/frontend/src/env.d.ts`. When adding new parameters to `initCodeClient`, you MUST also update the type definition:

```typescript
interface GoogleAccountsOauth2 {
  initCodeClient(config: {
    client_id: string;
    scope: string;
    ux_mode: "popup" | "redirect";
    redirect_uri: string;
    state?: string;
    access_type?: "online" | "offline";
    prompt?: "consent" | "select_account" | "none";
  }): GoogleCodeClient;
}
```

## Testing OAuth Changes

Before merging any OAuth-related PR:

1. **First login:** Clear all Google cookies/cache. Click "Continuar con Google". Verify the consent screen appears and shows the correct scopes.
2. **Repeat login:** Without clearing cookies, click "Continuar con Google" again. Verify the consent screen does NOT appear.
3. **No email:** Verify Google does NOT send a "data sharing notification" email on repeat logins.
4. **Account picker:** If user has multiple Google accounts, verify the account picker appears (only if `prompt: "select_account"` is set).

## Automated Validation

Run the OAuth configuration validator:

```bash
python scripts/validate_oauth_config.py
```

This script checks:
- All required parameters are present
- `prompt` is set when `access_type` is `"offline"`
- TypeScript type definition includes all used parameters

## Common Pitfalls

1. **Using `access_type: "offline"` without needing it** — Consent screen shows every login, Google sends notification emails every time
2. **Missing `prompt` with `offline` access** — Consent screen shows every login without account picker
3. **TypeScript type missing parameter** — Can't set the parameter without a type error
4. **Redirect URI mismatch** — Must exactly match Google Cloud Console (including trailing slash)
5. **Scopes changed** — Changing scopes forces re-consent for all users
6. **Google Cloud Console in "Testing" mode** — Consent screen always shows, refresh tokens expire after 7 days
