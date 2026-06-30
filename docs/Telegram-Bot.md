# Telegram Bot

## Overview

**@NikoFin_bot** is a Telegram bot that allows users to log expenses via natural language messages. It runs as a daemon thread inside the FastAPI backend process, using the `python-telegram-bot` library with a `ConversationHandler` for state management.

## Setup

### Linking a User

1. User opens @NikoFin_bot and sends `/start`
2. Bot checks if user's `telegram_chat_id` exists in database
3. If not linked → asks for 12-character authentication key
4. User copies key from web app (Settings → Telegram Bot)
5. Key is verified, `telegram_chat_id` is saved, key is invalidated
6. Bot confirms: "¡Listo, {name}! Ya podés mandarme tus gastos."

### Key Management

- **Generate key**: `GET /auth/me/telegram-key` → returns 12-char key
- **Regenerate key**: `POST /auth/me/telegram-key/regenerate` → invalidates old key
- **Check status**: `GET /auth/me/telegram-status` → linked/unlinked + chat_id

## Conversation Flow

```
/start
  ├─ [Already linked] → "¡Hola de nuevo!" → END
  └─ [Not linked] → WAITING_AUTH → handle_auth → END

[Any text message] → handle_message:
  ├─ "ayuda" → show help text → END
  ├─ [No amount found] → show help text → END
  └─ [Amount found] → parse with Gemini → WAITING_PAYMENT

WAITING_PAYMENT → handle_payment:
  ├─ "Efectivo/Transferencia" →
  │   ├─ [No accounts] → "Create account" → WAITING_ACCOUNT_CREATE_NAME
  │   └─ [Has accounts] → show accounts → WAITING_ACCOUNT_SELECT
  └─ "Tarjeta" →
      ├─ [No cards] → "Create card" → WAITING_CARD_CREATE_*
      └─ [Has cards] → show banks → WAITING_CARD_BANK

WAITING_ACCOUNT_SELECT → handle_account_select:
  ├─ [Select account] → auto-categorize → WAITING_CONFIRM
  └─ "Crear nueva" → WAITING_ACCOUNT_CREATE_NAME

WAITING_ACCOUNT_CREATE_NAME → handle_account_create_name:
  └─ [Type name] → show type keyboard → WAITING_ACCOUNT_CREATE_TYPE

WAITING_ACCOUNT_CREATE_TYPE → handle_account_create_type:
  └─ [Select type] → create account → auto-categorize → WAITING_CONFIRM

WAITING_CARD_BANK → handle_card_bank:
  ├─ [Select bank] → show cards → WAITING_CARD_TYPE
  └─ [No cards for bank] → "Type card name" → WAITING_CARD_MANUAL

WAITING_CARD_TYPE → handle_card_type:
  ├─ [Select card] → [Installment check] → WAITING_CONFIRM
  └─ "Otra tarjeta" → WAITING_CARD_MANUAL
  └─ "Crear nueva" → WAITING_CARD_CREATE_CHOICE

WAITING_CARD_MANUAL → handle_card_manual:
  └─ [Type card name] → [Installment check] → WAITING_CONFIRM

WAITING_INSTALLMENT_QUESTION → handle_installment_question:
  ├─ "Sí" → WAITING_INSTALLMENT_NUMBER
  └─ "No" → WAITING_CONFIRM

WAITING_INSTALLMENT_NUMBER → handle_installment_number:
  └─ [Type number] → WAITING_CONFIRM

WAITING_CONFIRM → handle_confirm:
  ├─ "Sí, guardar" → save expense → confirmation message → END
  └─ "Cancelar" → "Cancelado" → END
```

## Conversation States

| State                          | ID  | Trigger                  | Handler                       |
| ------------------------------ | --- | ------------------------ | ----------------------------- |
| `WAITING_AUTH`                 | 0   | `/start` (unlinked)      | `handle_auth`                 |
| `WAITING_PAYMENT`              | 1   | Expense parsed           | `handle_payment`              |
| `WAITING_CARD_BANK`            | 2   | "Tarjeta" selected       | `handle_card_bank`            |
| `WAITING_CARD_TYPE`            | 3   | Bank selected            | `handle_card_type`            |
| `WAITING_CONFIRM`              | 4   | Payment selected         | `handle_confirm`              |
| `WAITING_CARD_MANUAL`          | 5   | "Otra tarjeta"           | `handle_card_manual`          |
| `WAITING_INSTALLMENT_QUESTION` | 6   | Category matches rules   | `handle_installment_question` |
| `WAITING_INSTALLMENT_NUMBER`   | 7   | "Sí" to installments     | `handle_installment_number`   |
| `WAITING_ACCOUNT_SELECT`       | 8   | "Efectivo/Transferencia" | `handle_account_select`       |
| `WAITING_ACCOUNT_CREATE_NAME`  | 9   | "Crear nueva" account    | `handle_account_create_name`  |
| `WAITING_ACCOUNT_CREATE_TYPE`  | 10  | Name typed               | `handle_account_create_type`  |
| `WAITING_CARD_CREATE_CHOICE`   | 11  | "Crear nueva" card       | `handle_card_create_choice`   |
| `WAITING_CARD_CREATE_TYPE`     | 12  | "Crear nueva" card       | `handle_card_create_type`     |
| `WAITING_CARD_CREATE_NAME`     | 13  | Type selected            | `handle_card_create_name`     |
| `WAITING_CARD_CREATE_CONFIRM`  | 14  | Name typed               | `handle_card_create_confirm`  |

## Natural Language Parsing

The bot uses Gemini to parse messages like:

- "gasté 1500 en farmacity"
- "uber 3200 ayer"
- "almuerzo con Pedro 8500 pesos"
- "Netflix USD 5"

The LLM extracts:

```json
{
  "amount": 1500.0,
  "description": "farmacity",
  "date": "2026-06-29",
  "currency": "ARS"
}
```

## Auto-Categorization

After payment selection, the bot auto-categorizes based on keywords:

- Matches against the user's category tree
- Uses `auto_categorize()` function
- Shows category hierarchy with emojis in confirmation

## Installment Detection

Certain categories trigger installment questions:

- **Viajes** (Travel)
- **Educación** (Education)
- **Tecnología** (Technology)
- **Indumentaria** (Clothing)

The bot asks: "¿Lo pagaste en cuotas?" → then "¿Cuántas cuotas?"

## Markdown Escaping

All user-provided text in Markdown messages goes through `_escape_md()`:

```python
def _escape_md(text: str) -> str:
    for ch in ("\\", "*", "_", "[", "`"):
        text = text.replace(ch, f"\\{ch}")
    return text
```

This prevents `Can't parse entities` errors from Telegram.

## Error Handling

- **Session validation**: `_validate_session()` checks if user is still linked
- **Stale session**: Shows "Tu sesión fue desconectada desde la web"
- **Parse failure**: Shows help text with examples
- **Account creation**: Full flow with type selection
- **Card creation**: Full flow with LLM extraction

## Notifications

When the bot creates an expense, the user gets:

- Confirmation message with amount, category, payment method
- Emoji-rich formatting (🛒💰📅💳)
- Category tree with hierarchy indicators (└)
