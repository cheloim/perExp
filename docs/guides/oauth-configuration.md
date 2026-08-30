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
  access_type: "offline",    // Optional: request refresh token
  prompt: "select_account",  // Optional: control consent behavior
  state: "...",              // Optional: CSRF protection
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
| `"online"` (default) | No refresh token issued | When you don't need to access Google APIs after login |
| `"offline"` | Refresh token issued | When you need to access Google APIs on behalf of the user |

**Important:** If you set `access_type: "offline"`, you MUST also set `prompt`. See below.

### `prompt` — Consent Behavior

| Value | Behavior | When to use |
|-------|----------|-------------|
| (not set) | Google decides | Default, but may re-prompt with `offline` access |
| `"select_account"` | Show account picker, skip consent on repeat visits | **Recommended for SSO** |
| `"consent"` | Always show consent screen | When you need fresh consent every time |
| `"none"` | No prompt (silent auth) | Background re-authentication |

### The `offline` + Missing `prompt` Trap

**Problem:** If you set `access_type: "offline"` without setting `prompt`, Google may show the consent screen on every login. This is because Google wants to ensure the user is aware they're granting offline access.

**Solution:** Always pair `access_type: "offline"` with `prompt: "select_account"`:

```typescript
// CORRECT
initCodeClient({
  // ...
  access_type: "offline",
  prompt: "select_account",
});

// WRONG — consent screen shows every login
initCodeClient({
  // ...
  access_type: "offline",
  // prompt not set
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
2. **Repeat login:** Without clearing cookies, click "Continuar con Google" again. Verify the consent screen does NOT appear (if `prompt: "select_account"` is set).
3. **Account picker:** Verify the account picker appears on repeat logins (if `prompt: "select_account"` is set).
4. **Token storage:** Verify the refresh token is stored in the database (if `access_type: "offline"` is set).

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

1. **Missing `prompt` with `offline` access** — Consent screen shows every login
2. **TypeScript type missing parameter** — Can't set the parameter without a type error
3. **Redirect URI mismatch** — Must exactly match Google Cloud Console (including trailing slash)
4. **Scopes changed** — Changing scopes forces re-consent for all users
5. **Google Cloud Console in "Testing" mode** — Consent screen always shows, refresh tokens expire after 7 days
