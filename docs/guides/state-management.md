# State Management Guide

This guide covers state management patterns in Oikonomia's frontend, focusing on cross-device sync and query cache consistency.

## Overview

Oikonomia uses [TanStack Query](https://tanstack.com/query) (React Query) for server state management. The key principle: **server state should be the source of truth**, with localStorage used only as a fast-path cache.

## Key Files

| File | Purpose |
|------|---------|
| `src/frontend/src/App.tsx` | Main layout, global queries, Whats New modal |
| `src/frontend/src/api/client.ts` | API client functions |
| `src/frontend/src/types/index.ts` | TypeScript interfaces |

## The Two-Layer Pattern

For user preferences that should sync across devices:

```
┌─────────────────────────────────────────────┐
│  Server (PostgreSQL) — source of truth       │
│  API: PUT /auth/me/preference                │
│  Model: User.preference column               │
└──────────────────┬──────────────────────────┘
                   │ sync
┌──────────────────▼──────────────────────────┐
│  localStorage — fast-path cache              │
│  Key: "preference_key"                       │
│  Purpose: avoid flash before API response    │
└─────────────────────────────────────────────┘
```

### How it works:

1. **On page load:** Check localStorage first (instant). If not found, check server state from `useQuery`.
2. **On user action:** Update localStorage immediately, then call API to persist server-side.
3. **After API success:** Invalidate the query cache so `useQuery` picks up the new value.

## Query Cache Management

### The Problem: Stale Cache After Mutations

When a mutation updates server state, the `useQuery` cache can become stale. If you don't invalidate the query, components reading from the cache will show old data.

```typescript
// WRONG — fire-and-forget, cache stays stale
dismissWhatsNew(LATEST_VERSION).catch(() => {});
localStorage.setItem("whats_new_dont_remind_version", LATEST_VERSION);

// CORRECT — invalidate query after mutation
dismissWhatsNew(LATEST_VERSION).then(() => {
  queryClient.invalidateQueries({ queryKey: ["me"] });
}).catch(() => {});
localStorage.setItem("whats_new_dont_remind_version", LATEST_VERSION);
```

### When to Invalidate Queries

| Scenario | Action |
|----------|--------|
| Mutation returns updated `User` | `queryClient.invalidateQueries({ queryKey: ["me"] })` |
| Mutation affects expenses list | `queryClient.invalidateQueries({ queryKey: ["expenses"] })` |
| Mutation affects cards | `queryClient.invalidateQueries({ queryKey: ["cards"] })` |
| Mutation affects multiple data types | Invalidate all relevant query keys |

### Using `useQueryClient`

To access the query client in a component:

```typescript
import { useQueryClient } from "@tanstack/react-query";

function MyComponent() {
  const queryClient = useQueryClient();

  const handleSave = async () => {
    await saveSomething();
    queryClient.invalidateQueries({ queryKey: ["me"] });
  };
}
```

## Anti-Patterns to Avoid

### 1. Fire-and-Forget Mutations

```typescript
// WRONG — response is discarded, cache stays stale
apiCall().catch(() => {});

// CORRECT — use response or invalidate cache
apiCall().then((data) => {
  queryClient.invalidateQueries({ queryKey: ["me"] });
}).catch(() => {});
```

### 2. localStorage-Only Preferences

```typescript
// WRONG — only stored locally, doesn't sync across devices
localStorage.setItem("preference", value);

// CORRECT — persist server-side + localStorage as cache
api.put("/auth/me/preference", { value }).then(() => {
  queryClient.invalidateQueries({ queryKey: ["me"] });
});
localStorage.setItem("preference", value);
```

### 3. Stale `staleTime` Without Invalidation

```typescript
// This query won't refetch for 60 seconds
const { data: currentUser } = useQuery({
  queryKey: ["me"],
  queryFn: getMe,
  staleTime: 60000,
});

// If you mutate user data, you MUST invalidate
await updateUser(data);
queryClient.invalidateQueries({ queryKey: ["me"] });
```

## Cross-Device Sync Checklist

When implementing a user preference that should sync across devices:

- [ ] Server-side storage: Add column to User model (or relevant table)
- [ ] API endpoint: Create PUT endpoint to update the preference
- [ ] Schema: Add field to UserResponse Pydantic schema
- [ ] Migration: Create migration script + register in deploy.yml
- [ ] Frontend API: Add function to `client.ts`
- [ ] Frontend UI: Call API on user action
- [ ] Query invalidation: Invalidate `["me"]` query after mutation
- [ ] localStorage: Use as fast-path cache only
- [ ] Type check: Update TypeScript types

## Automated Validation

Run the state management validator:

```bash
python scripts/validate_state_sync.py
```

This script checks for:
- Fire-and-forget mutations that return User data
- localStorage preferences without backend API calls
