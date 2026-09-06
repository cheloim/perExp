# Feature: Quick View for Telegram Mini App

## Overview

When the Telegram Mini App opens, it now renders a lightweight Quick View instead of the full SPA. The user can switch to the full platform at any time within the same session. On the next open, it always starts in Quick View.

## Architecture

```
App.tsx
  ├── isTelegramWebApp() && quickView → QuickViewLayout
  │     ├── Header (N logo + "Plataforma completa" button)
  │     ├── QuickSummary  ← lazy
  │     ├── QuickBudget   ← lazy
  │     ├── QuickUpcoming ← lazy
  │     ├── FAB "+" → ExpenseModal (existing)
  │     └── Bottom pills (🏠 Resumen | 📊 Presupuesto | 📓 Próximos)
  └── else → MainLayout (full SPA)
```

## Files

| File | Purpose |
|---|---|
| `src/layouts/QuickViewLayout.tsx` | Shell: header, bottom pills, FAB, Suspense. Tabs via lazy imports. `onSwitchToFull` callback. |
| `src/pages/quick/QuickSummary.tsx` | KPIs (gasto mes vs anterior, ingresos), top 5 categories with bars, 5 recent expenses. Uses `getDashboard()`. |
| `src/pages/quick/QuickBudget.tsx` | Total budget progress, 50/30/20 groups with 🟢🟡🔴 bars, flagged categories. Uses `getBudgetGroups()` + `getBudgetSummary()`. |
| `src/pages/quick/QuickUpcoming.tsx` | Cuotas pending + scheduled grouped by month, recurring subscriptions with days-until. Uses `getScheduledSummary()` + `getRecurringExpenses()`. |
| `src/App.tsx` | Conditional: `isTelegramWebApp() && quickView` → QuickViewLayout, else MainLayout. Session-only state resets on close. |

## Behavior

- **Default**: always Quick View on open (session-only, resets when Mini App closes)
- **Switch**: "Plataforma completa" button → full MainLayout (same session)
- **FAB**: "+" opens the existing `ExpenseModal` (same component as desktop)
- **BackButton**: hidden in Quick View (Telegram closes the app)
- **Theme**: already applied by `initTelegramWebApp()` before render
- **Auth**: already handled by `telegramAutoLogin()` → JWT stored in localStorage

## Data Sources

All endpoints are existing, group-aware, no backend changes:

| Tab | API | Client function |
|---|---|---|
| Resumen | `GET /dashboard/summary` | `getDashboard()` |
| Presupuesto | `GET /budgets/groups`, `GET /budgets/summary` | `getBudgetGroups()`, `getBudgetSummary()` |
| Próximos | `GET /dashboard/scheduled-summary`, `GET /recurring` | `getScheduledSummary()`, `getRecurringExpenses()` |
| Alta | `POST /expenses` | `createExpense()` |

## Verification

```bash
cd src/frontend
npm run lint
npx prettier --check src/layouts/ src/pages/quick/
npm run typecheck
```

## Related

- Closes #202
- MiniAppPhoneMockup in `FeatureMockups.tsx:321` served as design spec
- Bot reports (#208) cover the "native quick view in chat" option; this covers the Mini App lightweight mode
