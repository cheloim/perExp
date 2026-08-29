# Data Model — Oikonomia (Credit Card Analyzer)

## Entity Relationship Diagram

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│     User     │       │    Group     │       │ GroupMember  │
│──────────────│1     *│──────────────│1     *│──────────────│
│ id           │───────│ id           │───────│ id           │
│ full_name    │       │ name         │       │ group_id  FK │
│ email        │       │ created_by FK│       │ user_id   FK │
│ hashed_pass  │       │ created_at   │       │ role         │
│ invite_code  │       └──────────────┘       │ status       │
│ telegram_key │                               │ invited_by FK│
│ ...          │                               │ joined_at    │
└──────┬───────┘                               └──────────────┘
       │
       │1     *
       ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│    Card      │       │   Account    │       │   Category   │
│──────────────│       │──────────────│       │──────────────│
│ id           │       │ id           │       │ id           │
│ card_name    │       │ name         │       │ name         │
│ bank         │       │ type         │       │ color        │
│ holder       │       │ user_id   FK │       │ keywords     │
│ card_type    │       │ created_at   │       │ parent_id FK │
│ user_id   FK │       └──────────────┘       │ user_id   FK │
│ linked_acct  │                               │ budget_group │
│ created_at   │                               └──────┬───────┘
└──────┬───────┘                                      │
       │                                              │
       │1     *                    1     *             │
       ▼                            ▼                 ▼
┌──────────────────────────────────────────────────────────────┐
│                         Expense                               │
│──────────────────────────────────────────────────────────────│
│ id  │ date  │ description  │ amount  │ notes  │ is_income    │
│ card_id FK │ account_id FK │ category_id FK │ user_id FK    │
│ currency │ installment_number │ installment_total            │
│ installment_group_id │ transaction_id │ budget_event_id FK   │
└──────────────────────────────────────────────────────────────┘
       │
       │ 1    *
       ▼
┌──────────────┐       ┌──────────────┐
│  ImportJob   │       │CardClosing   │
│──────────────│       │──────────────│
│ id           │       │ id           │
│ filename     │       │ card         │
│ file_content │       │ card_last_dig│
│ status       │       │ card_type    │
│ preview_data │       │ bank         │
│ user_id   FK │       │ card_id   FK │
│ created_at   │       │ closing_date │
└──────────────┘       │ due_date     │
                       │ user_id   FK │
                       └──────────────┘

┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│  Investment  │       │  Budget      │       │ BudgetGroup  │
│──────────────│       │──────────────│       │──────────────│
│ id           │       │ id           │       │ id           │
│ ticker       │       │ user_id   FK │       │ user_id   FK │
│ name         │       │ category_id  │       │ name         │
│ type         │       │ amount       │       │ display_name │
│ broker       │       │ alert_thresh │       │ percentage   │
│ quantity     │       │ rollover     │       │ amount       │
│ avg_cost     │       │ is_active    │       │ spent        │
│ current_price│       │ created_at   │       │ is_active    │
│ currency     │       └──────────────┘       └──────────────┘
│ user_id   FK │
└──────────────┘

┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│ Notification │       │ AuditLog     │       │MonthlyReport │
│──────────────│       │──────────────│       │──────────────│
│ id           │       │ id           │       │ id           │
│ user_id   FK │       │ user_id   FK │       │ user_id   FK │
│ type         │       │ action       │       │ month        │
│ title        │       │ ip_address   │       │ status       │
│ body         │       │ user_agent   │       │ report_data  │
│ data         │       │ details      │       │ png_data     │
│ read         │       │ created_at   │       │ created_at   │
│ created_at   │       └──────────────┘       └──────────────┘
└──────────────┘

┌────────────────────┐  ┌──────────────┐  ┌──────────────────┐
│ ScheduledExpense   │  │RecurringExp  │  │CategorySuggestion│
│────────────────────│  │──────────────│  │──────────────────│
│ id                 │  │ id           │  │ id               │
│ installment_group  │  │ user_id   FK │  │ expense_id    FK │
│ installment_number │  │ merchant_key │  │ user_id       FK │
│ installment_total  │  │ description  │  │ suggested_cat FK │
│ scheduled_date     │  │ amount       │  │ confidence       │
│ amount             │  │ currency     │  │ status           │
│ description        │  │ category_id  │  │ source           │
│ card_id FK         │  │ card_id   FK │  │ created_at       │
│ account_id FK      │  │ account_id FK│  └──────────────────┘
│ status             │  │ frequency    │
│ category_id FK     │  │ next_charge  │  ┌──────────────────┐
│ executed_expense FK│  │ alert_days   │  │   BudgetEvent    │
│ user_id FK         │  │ is_active    │  │──────────────────│
│ created_at         │  │ source       │  │ id               │
└────────────────────┘  │ last_seen_at │  │ user_id       FK │
                        │ created_at   │  │ name             │
                        └──────────────┘  │ start_date       │
                                          │ end_date         │
┌────────────────────┐  ┌──────────────┐  │ total_amount     │
│AnalysisHistory     │  │   Setting    │  │ spent            │
│────────────────────│  │──────────────│  │ categories       │
│ id                 │  │ key (PK)     │  │ is_active        │
│ user_id FK         │  │ value        │  │ created_at       │
│ month              │  └──────────────┘  └──────────────────┘
│ question           │
│ result_text        │  ┌──────────────────────────┐
│ expense_count      │  │  ImpersonationSession    │
│ total_amount       │  │──────────────────────────│
│ created_at         │  │ id                       │
└────────────────────┘  │ admin_id FK              │
                        │ target_user_id FK        │
                        │ status                   │
                        │ token                    │
                        │ expires_at               │
                        └──────────┬───────────────┘
                                   │ 1    *
                                   ▼
                        ┌──────────────────────┐
                        │ImpersonationMessage  │
                        │──────────────────────│
                        │ id                   │
                        │ session_id FK        │
                        │ sender_id FK         │
                        │ message              │
                        └──────────────────────┘

┌────────────────────┐
│  MerchantPreference│
│────────────────────│
│ id                 │
│ user_id FK         │
│ merchant_key       │
│ category_id FK     │
│ confidence         │
│ usage_count        │
│ last_used_at       │
│ created_at         │
└────────────────────┘

┌────────────────────┐
│   PlatformLog      │
│────────────────────│
│ id                 │
│ level              │
│ module             │
│ message            │
│ details            │
│ created_at         │
└────────────────────┘
```

## Entity Details

### User

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `full_name` | EncryptedType | NOT NULL, default `""` | AES-256 encrypted |
| `email` | String | UNIQUE, NOT NULL | Login identifier |
| `invite_code` | String(8) | UNIQUE, nullable, indexed | For family group invites |
| `hashed_password` | String | nullable | NULL for OAuth-only users |
| `is_active` | Boolean | default `True` | |
| `created_at` | DateTime | default `utcnow` | |
| `telegram_key` | String(12) | UNIQUE, nullable, indexed | Bot linking token |
| `telegram_chat_id` | EncryptedType | nullable | Encrypted Telegram chat ID |
| `telegram_chat_hash` | String(64) | UNIQUE, nullable, indexed | HMAC for lookup |
| `provider` | String | nullable | `google`, `local` |
| `provider_id` | String | nullable, indexed | OAuth provider user ID |
| `avatar_url` | String | nullable | Profile picture URL |
| `reset_token` | String(64) | UNIQUE, nullable, indexed | Password reset token |
| `reset_token_expires` | DateTime | nullable | Token expiry |
| `mfa_secret` | EncryptedType | nullable | TOTP secret (encrypted) |
| `mfa_enabled` | Boolean | default `False` | |
| `email_verified` | Boolean | default `False` | |
| `email_verification_token` | String(64) | UNIQUE, nullable, indexed | |
| `force_password_change` | Boolean | default `False` | Admin-forced reset |
| `onboarding_completed` | Boolean | default `False` | First-use wizard |
| `auto_detected_banner_dismissed_at` | DateTime | nullable | UX state |
| `is_admin` | Boolean | default `False` | Platform admin flag |
| `is_blocked` | Boolean | default `False` | |
| `blocked_at` | DateTime | nullable | |
| `blocked_reason` | Text | nullable | |
| `whatsapp_phone` | EncryptedType | nullable | Encrypted phone number |
| `whatsapp_phone_hash` | String(64) | UNIQUE, nullable, indexed | HMAC for lookup |
| `whatsapp_key` | String(12) | UNIQUE, nullable, indexed | WhatsApp linking token |

### Card

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `card_name` | EncryptedType | NOT NULL | Visa, Mastercard, etc. |
| `card_name_hmac` | String(64) | nullable, indexed | Searchable HMAC |
| `bank` | EncryptedType | default `""` | Issuing bank |
| `bank_hmac` | String(64) | nullable, indexed | Searchable HMAC |
| `holder` | EncryptedType | default `""` | First name (family grouping) |
| `card_type` | String | default `"credito"` | `credito` / `debito` |
| `linked_account_id` | Integer | FK → accounts.id, nullable | Associated bank account |
| `user_id` | Integer | FK → users.id, NOT NULL | |
| `created_at` | DateTime | default `utcnow` | |

### Account

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `name` | EncryptedType | NOT NULL | Account name |
| `name_hmac` | String(64) | nullable, indexed | Searchable HMAC |
| `type` | String | default `"efectivo"` | `efectivo`, `cuenta_corriente`, `caja_ahorro`, `mercadopago`, etc. |
| `user_id` | Integer | FK → users.id, NOT NULL | |
| `created_at` | DateTime | default `utcnow` | |

### Category

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `name` | String | indexed | Category name |
| `color` | String | default `"#6366f1"` | Hex color for charts |
| `keywords` | Text | default `""` | Comma-separated match keywords |
| `parent_id` | Integer | FK → categories.id, nullable | Hierarchy support |
| `user_id` | Integer | FK → users.id, nullable | NULL = system default |
| `budget_group` | String(20) | default `"necesidades"` | `necesidades` / `gustos` / `ahorro` |

**Constraints:** UNIQUE(`name`, `user_id`)

### Expense

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `date` | Date | NOT NULL | Transaction date |
| `description` | EncryptedType | NOT NULL | Merchant/description |
| `description_hmac` | String(64) | nullable, indexed | Searchable HMAC |
| `amount` | Float | NOT NULL | Transaction amount |
| `category_id` | Integer | FK → categories.id, nullable | |
| `notes` | EncryptedType | default `""` | User notes |
| `transaction_id` | String | nullable, indexed | Bank reference ID |
| `currency` | String | default `"ARS"` | `ARS` / `USD` |
| `installment_number` | Integer | nullable | Current installment (1 of N) |
| `installment_total` | Integer | nullable | Total installments |
| `installment_group_id` | String | nullable, indexed | Groups related installments |
| `user_id` | Integer | FK → users.id, NOT NULL | |
| `account_id` | Integer | FK → accounts.id, nullable | |
| `card_id` | Integer | FK → cards.id, nullable | |
| `budget_event_id` | Integer | FK → budget_events.id, nullable | |
| `is_income` | Boolean | NOT NULL, default `False` | Income vs expense flag |

**Indexes:** (`user_id`, `date`), (`user_id`, `category_id`), (`user_id`, `installment_group_id`)

### Investment

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `ticker` | String | default `""` | Stock/cedear ticker |
| `name` | String | default `""` | Full name |
| `type` | String | default `""` | `cedear`, `accion`, `bono`, `fci`, `plazo_fijo` |
| `broker` | String | default `""` | `iol`, `ppi`, `manual` |
| `quantity` | Float | default `0.0` | Shares held |
| `avg_cost` | Float | default `0.0` | Average purchase price |
| `current_price` | Float | nullable | Last known market price |
| `currency` | String | default `"ARS"` | |
| `notes` | EncryptedType | default `""` | |
| `updated_at` | DateTime | default `utcnow` | |
| `user_id` | Integer | FK → users.id, NOT NULL | |

**Indexes:** (`user_id`), (`user_id`, `ticker`, `broker`)

### ImportJob

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `user_id` | Integer | FK → users.id, NOT NULL, indexed | |
| `filename` | String | NOT NULL | Original filename |
| `status` | String | default `"PROCESSING"` | `PROCESSING` / `READY_PREVIEW` / `COMPLETED` / `FAILED` |
| `file_content` | LargeBinary | — | Raw file bytes |
| `preview_data` | Text | — | JSON preview for user confirmation |
| `error_message` | Text | nullable | Error details if FAILED |
| `created_at` | DateTime | default `utcnow` | |
| `completed_at` | DateTime | nullable | |

### Notification

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `user_id` | Integer | FK → users.id, NOT NULL | |
| `type` | String | NOT NULL | `budget_alert`, `recurring`, `system`, etc. |
| `title` | String | NOT NULL | |
| `body` | Text | default `""` | |
| `data` | Text | default `"{}"` | JSON payload |
| `read` | Boolean | default `False` | |
| `created_at` | DateTime | default `utcnow` | |

**Indexes:** (`user_id`, `read`)

### CardClosing

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `card` | String | NOT NULL, default `""` | Card display name |
| `card_last_digits` | String | default `""` | Last 4 digits |
| `card_type` | String | default `""` | |
| `bank` | String | default `""` | |
| `card_id` | Integer | FK → cards.id, nullable | Linked card |
| `closing_date` | Date | NOT NULL | Current closing date |
| `next_closing_date` | Date | nullable | |
| `due_date` | Date | nullable | Payment due date |
| `last_imported_at` | DateTime | default `utcnow` | |
| `user_id` | Integer | FK → users.id, NOT NULL | |

### ScheduledExpense

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `installment_group_id` | String | NOT NULL, indexed | Groups related installments |
| `installment_number` | Integer | NOT NULL | Current installment |
| `installment_total` | Integer | NOT NULL | Total installments |
| `scheduled_date` | Date | NOT NULL, indexed | When to execute |
| `amount` | Float | NOT NULL | |
| `currency` | String | default `"ARS"` | |
| `description` | EncryptedType | NOT NULL | |
| `description_hmac` | String(64) | nullable, indexed | |
| `card_id` | Integer | FK → cards.id, nullable | |
| `account_id` | Integer | FK → accounts.id, nullable | |
| `status` | String | default `"PENDING"`, indexed | `PENDING` / `EXECUTED` / `CANCELLED` |
| `category_id` | Integer | FK → categories.id, nullable | |
| `executed_expense_id` | Integer | FK → expenses.id, nullable | Created expense |
| `executed_at` | DateTime | nullable | |
| `created_at` | DateTime | default `utcnow` | |
| `user_id` | Integer | FK → users.id, NOT NULL | |
| `transaction_id` | String | nullable, indexed | |

### AnalysisHistory

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `created_at` | DateTime | NOT NULL, default `utcnow` | |
| `month` | String | nullable | Target month |
| `question` | Text | nullable | User's question |
| `result_text` | Text | NOT NULL, default `""` | LLM response |
| `expense_count` | Integer | default `0` | Expenses analyzed |
| `total_amount` | Float | default `0.0` | Total in scope |
| `user_id` | Integer | FK → users.id, NOT NULL | |

### RecurringExpense

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `user_id` | Integer | FK → users.id, NOT NULL | |
| `merchant_key` | String(255) | NOT NULL | Normalized merchant key |
| `description` | String(500) | NOT NULL | Display description |
| `amount` | Float | NOT NULL | Expected amount |
| `currency` | String | default `"ARS"` | |
| `category_id` | Integer | FK → categories.id, nullable | |
| `card_id` | Integer | FK → cards.id, nullable | |
| `account_id` | Integer | FK → accounts.id, nullable | |
| `frequency` | String | default `"monthly"` | `monthly` / `weekly` / `yearly` |
| `next_charge_date` | Date | nullable | |
| `alert_days_before` | Integer | default `3` | |
| `is_active` | Boolean | default `True` | |
| `source` | String(20) | default `"manual"` | `auto` / `manual` |
| `last_seen_at` | DateTime | nullable | Last matched expense |
| `created_at` | DateTime | default `utcnow` | |
| `updated_at` | DateTime | onupdate | |

### Group

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `name` | String | NOT NULL | Group name |
| `created_by` | Integer | FK → users.id, nullable | Owner |
| `created_at` | DateTime | default `utcnow` | |

### GroupMember

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `group_id` | Integer | FK → groups.id, NOT NULL | CASCADE delete |
| `user_id` | Integer | FK → users.id, NOT NULL | CASCADE delete |
| `role` | String | default `"member"` | `admin` / `member` |
| `status` | String | default `"accepted"` | `pending` / `accepted` / `rejected` |
| `invited_by` | Integer | FK → users.id, nullable | |
| `joined_at` | DateTime | default `utcnow` | |

**Constraints:** UNIQUE(`group_id`, `user_id`)

### Budget

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `user_id` | Integer | FK → users.id, NOT NULL | |
| `category_id` | Integer | FK → categories.id, NOT NULL | |
| `amount` | Float | NOT NULL | Monthly budget limit |
| `alert_threshold` | Float | default `0.80` | Alert at 80% |
| `rollover` | Boolean | default `False` | Unused budget carries over |
| `is_active` | Boolean | default `True` | |
| `created_at` | DateTime | default `utcnow` | |
| `updated_at` | DateTime | onupdate | |

**Constraints:** UNIQUE(`user_id`, `category_id`)

### BudgetGroup

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `user_id` | Integer | FK → users.id, NOT NULL | |
| `name` | String(20) | NOT NULL | Internal key |
| `display_name` | String(50) | NOT NULL | UI label |
| `percentage` | Float | NOT NULL | % of income |
| `amount` | Float | default `0` | Calculated amount |
| `spent` | Float | default `0` | Current spending |
| `is_active` | Boolean | default `True` | |
| `created_at` | DateTime | default `utcnow` | |
| `updated_at` | DateTime | onupdate | |

**Constraints:** UNIQUE(`user_id`, `name`)

### BudgetEvent

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `user_id` | Integer | FK → users.id, NOT NULL | |
| `name` | String(100) | NOT NULL | Event name (e.g., "Vacaciones") |
| `start_date` | Date | NOT NULL | |
| `end_date` | Date | NOT NULL | |
| `total_amount` | Float | NOT NULL | Budget for event |
| `spent` | Float | default `0` | |
| `categories` | Text | default `"[]"` | JSON array of category IDs |
| `is_active` | Boolean | default `True` | |
| `created_at` | DateTime | default `utcnow` | |
| `updated_at` | DateTime | onupdate | |

### CategorySuggestion

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `expense_id` | Integer | FK → expenses.id, UNIQUE, NOT NULL | One suggestion per expense |
| `user_id` | Integer | FK → users.id, NOT NULL | |
| `suggested_category_id` | Integer | FK → categories.id, NOT NULL | |
| `confidence` | Float | NOT NULL | 0.0–1.0 |
| `status` | String | default `"pending"` | `pending` / `approved` / `rejected` |
| `source` | String | default `"llm"` | `llm` / `keyword` |
| `created_at` | DateTime | default `utcnow` | |
| `updated_at` | DateTime | default `utcnow`, onupdate | |

### MonthlyReport

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `user_id` | Integer | FK → users.id, NOT NULL | |
| `month` | String(7) | NOT NULL | `YYYY-MM` format |
| `status` | String(20) | default `"READY"` | `PENDING` / `READY` / `FAILED` |
| `report_data` | EncryptedType | nullable | JSON with full report |
| `pdf_data` | LargeBinary | nullable | Legacy PDF bytes |
| `png_data` | LargeBinary | nullable | Report image |
| `error_message` | Text | nullable | |
| `created_at` | DateTime | default `utcnow` | |
| `generated_at` | DateTime | nullable | |

**Indexes:** UNIQUE(`user_id`, `month`)

### AuditLog

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | Integer | PK, auto-increment | |
| `user_id` | Integer | FK → users.id, nullable | SET NULL on delete |
| `action` | String(50) | NOT NULL | `login`, `create_expense`, etc. |
| `ip_address` | EncryptedType | nullable | Encrypted |
| `user_agent` | EncryptedType | nullable | Encrypted |
| `details` | Text | nullable | Additional context |
| `created_at` | DateTime | default `utcnow` | |

### Additional Tables

**MerchantPreference** — Learned category mappings per merchant.

**ImpersonationSession** / **ImpersonationMessage** — Admin impersonation with chat.

**PlatformLog** — Application-level error/warning log (WARNING, ERROR, CRITICAL).

**Setting** — Key-value configuration store (PK: `key`).
