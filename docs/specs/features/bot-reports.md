# Feature: Inline Bot Reports

## Overview

Four new Telegram bot commands that return financial reports as structured text messages with emoji. Group-aware (includes accepted family group members' data, consistent with the web dashboard).

## Commands

| Command | Report | Output |
|---|---|---|
| `/presupuesto` | Budget status | Total budget vs spent, macro groups (50/30/20 or 60/40) with percentages, categories ≥ threshold flagged 🟡/🔴 |
| `/gastos` | Expense summary | Inline keyboard → 📅 Semana / 🗓️ Mes; totals, income, net, top-5 categories, prev-period delta |
| `/cuotas` | Upcoming scheduled | PENDING installments/manual within 30 days, grouped by week with totals |
| `/suscripciones` | Upcoming recurring | Active recurring expenses by next_charge_date with days-until badges |
| `/ayuda` | Help text | Existing command list (wired to _HELP_TEXT) |

## Architecture

```
telegram_bot.py (handlers + HTML formatters)
        │
        ▼
services/bot_reports.py (pure data functions, no side effects)
        │
        ├── budget_helpers.py (get_spending_for_category, get_spending_for_group)
        └── models.py (Budget, BudgetGroup, Expense, ScheduledExpense, RecurringExpense)
```

- **Shared service layer**: `bot_reports.py` returns plain dataclasses; format/render stays in the bot. This enables future WhatsApp parity by reusing the service functions.
- **Group-aware**: All queries use `get_group_user_ids()` to include accepted family group members.
- **Registered before ConversationHandler** in `_run_bot` so commands are matched first.
- **CallbackQueryHandler** for `/gastos` period picker (`report:week`, `report:month`).

## Data Flow

1. User sends `/presupuesto` → `cmd_presupuesto` → `build_budget_status(user_id, db)` → `_format_budget_report` → chunked HTML reply
2. User sends `/gastos` → keyboard shown → user picks Semana/Mes → `handle_report_callback` → `build_period_summary` → `_format_period_report` → HTML reply
3. User sends `/cuotas` → `build_upcoming_scheduled(uid_list, 30, db)` → `_format_scheduled_report` → HTML reply
4. User sends `/suscripciones` → `build_upcoming_recurring(uid_list, 30, db)` → `_format_recurring_report` → HTML reply

## Refactoring

- `tasks/weekly_summary.py` now delegates `_build_weekly_report_data` to `bot_reports.build_weekly_report_data`, keeping only the LLM analysis and Celery task orchestration.
- Duplicated query logic (budget helpers, scheduled-summary) consolidated into `bot_reports.py`.

## Edge Cases

- Messages > 4096 chars are split at newlines via `_chunk_message()`.
- Empty states (no budgets, no upcoming, no expenses) return clear "no data" messages.
- Session validation on callback queries prevents stale-session errors.
- `BUDGET_AHORRO_ENABLED` flag respected (ahorro group excluded when off).

## Tests

`tests/test_bot_reports.py` — 10 pure-function tests (no DB required):
- `build_budget_status`: empty, under-threshold, warning, exceeded, groups
- `build_period_summary`: week, month, empty
- `build_upcoming_scheduled`: empty, with items, ignores past/non-pending
- `build_upcoming_recurring`: empty, with items, ignores far-future/inactive
- `_chunk_message`: short, exact-limit, over-limit, no-newlines
- Formatting: empty budgets, flagged categories, period with data, scheduled/recurring reports

DB-dependent tests (17) require the test PostgreSQL container.
