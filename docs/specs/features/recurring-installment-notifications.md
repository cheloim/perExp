# Feature: Recurring & Installment Payment Notifications

## Overview

Daily Celery tasks check for upcoming recurring charges and installment payments, then send notifications to users via the configured channel(s): in-app, Telegram, or both.

## Channel Configuration

Channel is resolved per-user via `Setting` keys:

| Key | Values | Default |
|---|---|---|
| `flag:notify_enabled` | `true/false` | `true` (global off switch) |
| `flag:notify_channel` | `inapp/telegram/both/none` | `both` (global default) |
| `{user_id}:notify_channel` | `inapp/telegram/both/none` | (inherits global) |

Resolution priority: user setting → global channel → `both`.

## Events

| Event | Task | Schedule | Dedupe | Advance Notice |
|---|---|---|---|---|
| **Recurring charge upcoming** | `check_upcoming_recurring` | Daily 8:00 (env `SCHEDULE_CHECK_RECURRING`) | unread `Notification` with same `recurring_id + charge_date` | Per-item `alert_days_before` (default 3) |
| **Installment upcoming** | `check_upcoming_installments` | Daily 8:15 (env `SCHEDULE_CHECK_INSTALLMENTS`) | unread `Notification` with same `scheduled_id + scheduled_date` | N days before (default 3, per-user configurable via `{user_id}:notify_installments_days_before`) |
| **Installment executed** | `execute_due_installments` | Daily 2:00 (env `SCHEDULE_DUE_INSTALLMENTS`) | One-shot (triggers on execution) | Immediate (on materialization) |

## Notification Types

| Type | Title Example | Body Example |
|---|---|---|
| `upcoming_recurring` | 🔔 Spotify — cobro en 3 días | Se cobra $2,500 el 09/09/2026. |
| `upcoming_installment` | 💳 Cuota (2/6) — vence mañana | Netflix — $5,000 vence mañana. |
| `installment_executed` | ✅ 2 cuotas registradas | • Netflix — $5,000 · Disney+ — $3,000 |

### Installment Execution Grouping

When `execute_due_installments` processes multiple cuotas for the same user, they are grouped into a single notification with a summary (up to 5 items listed, then "... y N más").

## Telegram Delivery

- Uses `send_message_to_chat(chat_id, text)` from `app/telegram_bot.py`
- Only sent if user has `telegram_chat_id` (not null, not `"[encrypted]"`)
- Errors are logged and do not fail the notification pipeline

## Implementation

| File | Role |
|---|---|
| `app/services/notify.py` | Shared `notify_user()` service: resolves channel, writes `Notification`, sends Telegram |
| `app/tasks/check_upcoming_recurring.py` | Daily task — rewritten to use `notify_user()` |
| `app/tasks/check_upcoming_installments.py` | New daily task — upcoming PENDING installments |
| `app/tasks/scheduled_expenses.py` | Extended — sends grouped confirmation after executing cuotas |
| `app/celery_schedule.py` | New `check-upcoming-installments-daily` entry at 8:15 |

## Decisions

- **No immediate notification on create/update**: user-initiated action with existing UI feedback; would be noisy
- **Default channel = both**: users get in-app + Telegram (opt-out via Setting)
- **No frontend settings UI yet**: Settings are backend-configurable (admin panel or DB); UI panel is a follow-up
- **Grouped execution confirmations**: one notification per user per daily run, not per cuota

## Tests

`tests/test_notifications.py` — all pure/mock, no DB required:
- Channel resolution: default both, global off, user override, global default, priority
- `notify_user`: both channels, inapp only, telegram only, none
- Telegram safety: missing chat_id, encrypted placeholder
