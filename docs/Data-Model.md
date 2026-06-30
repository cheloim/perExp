# Data Model

## Entity Relationship Diagram

```
User ──┬── Card ──────────── Expense
       ├── Account ───────── Expense
       ├── Category ──────── Expense
       ├── Investment
       ├── ImportJob
       ├── Notification
       ├── CardClosing
       ├── ScheduledExpense
       ├── AnalysisHistory
       └── GroupMember ──── Group
```

## Entities

### User

The central entity. All data is scoped to a user (or group).

| Field                 | Type       | Description                       |
| --------------------- | ---------- | --------------------------------- |
| `id`                  | Integer PK | Auto-increment                    |
| `full_name`           | String     | Display name                      |
| `email`               | String     | Unique, used for login            |
| `hashed_password`     | String     | bcrypt hash                       |
| `invite_code`         | String     | 8-char group invite code          |
| `telegram_key`        | String     | 12-char bot auth key (single-use) |
| `telegram_chat_id`    | String     | Telegram chat ID (for bot)        |
| `provider`            | String     | "local", "google", "apple"        |
| `provider_id`         | String     | OAuth provider user ID            |
| `avatar_url`          | String     | Profile picture URL               |
| `reset_token`         | String     | Password reset token              |
| `reset_token_expires` | DateTime   | Token expiry (15 min)             |

### Card

Credit or debit cards.

| Field       | Type       | Description                         |
| ----------- | ---------- | ----------------------------------- |
| `id`        | Integer PK | Auto-increment                      |
| `card_name` | String     | "Visa", "Mastercard", etc.          |
| `bank`      | String     | Issuing bank                        |
| `holder`    | String     | Cardholder name (for family groups) |
| `card_type` | String     | "credito" or "debito"               |
| `user_id`   | Integer FK | Owner                               |

### Account

Cash and bank accounts for transfers.

| Field     | Type       | Description                                                |
| --------- | ---------- | ---------------------------------------------------------- |
| `id`      | Integer PK | Auto-increment                                             |
| `name`    | String     | "Efectivo", "MercadoPago", etc.                            |
| `type`    | String     | efectivo, cuenta_corriente, caja_ahorro, mercadopago, otro |
| `user_id` | Integer FK | Owner                                                      |

### Category

Hierarchical expense categories.

| Field       | Type       | Description                              |
| ----------- | ---------- | ---------------------------------------- |
| `id`        | Integer PK | Auto-increment                           |
| `name`      | String     | Category name                            |
| `color`     | String     | Hex color for visualization              |
| `keywords`  | String     | Comma-separated auto-categorize keywords |
| `parent_id` | Integer FK | Self-referencing (up to 3 levels)        |
| `user_id`   | Integer FK | Owner (nullable for global categories)   |

### Expense

The core transaction record.

| Field                  | Type       | Description                          |
| ---------------------- | ---------- | ------------------------------------ |
| `id`                   | Integer PK | Auto-increment                       |
| `date`                 | Date       | Transaction date                     |
| `description`          | String     | Merchant/description                 |
| `amount`               | Float      | Transaction amount                   |
| `currency`             | String     | "ARS" or "USD"                       |
| `notes`                | String     | Optional notes                       |
| `transaction_id`       | String     | Unique ID from statement (for dedup) |
| `installment_number`   | Integer    | Current installment (e.g., 3)        |
| `installment_total`    | Integer    | Total installments (e.g., 12)        |
| `installment_group_id` | String     | Groups installments together         |
| `is_income`            | Boolean    | Income vs expense flag               |
| `category_id`          | Integer FK | Linked category                      |
| `card_id`              | Integer FK | Linked card (for card payments)      |
| `account_id`           | Integer FK | Linked account (for cash/transfer)   |
| `user_id`              | Integer FK | Owner                                |

### ScheduledExpense

Future installment records (auto-executed daily).

| Field                  | Type       | Description                              |
| ---------------------- | ---------- | ---------------------------------------- |
| `id`                   | Integer PK | Auto-increment                           |
| `installment_group_id` | String     | Groups with other installments           |
| `installment_number`   | Integer    | Current installment                      |
| `installment_total`    | Integer    | Total installments                       |
| `scheduled_date`       | Date       | When to execute                          |
| `amount`               | Float      | Amount                                   |
| `currency`             | String     | "ARS" or "USD"                           |
| `description`          | String     | Description                              |
| `status`               | String     | PENDING, EXECUTED, CANCELLED             |
| `category_id`          | Integer FK | Category                                 |
| `card_id`              | Integer FK | Card                                     |
| `account_id`           | Integer FK | Account                                  |
| `executed_expense_id`  | Integer FK | Links to created Expense after execution |
| `user_id`              | Integer FK | Owner                                    |

### Investment

Investment portfolio records.

| Field           | Type       | Description                     |
| --------------- | ---------- | ------------------------------- |
| `id`            | Integer PK | Auto-increment                  |
| `ticker`        | String     | Stock ticker (e.g., "GGAL")     |
| `name`          | String     | Company/fund name               |
| `type`          | String     | Accion, Cedear, Bono, FCI, etc. |
| `broker`        | String     | IOL, PPI, or manual             |
| `quantity`      | Float      | Shares/units                    |
| `avg_cost`      | Float      | Average cost per unit           |
| `current_price` | Float      | Current market price            |
| `currency`      | String     | "ARS" or "USD"                  |
| `notes`         | String     | Optional notes                  |
| `updated_at`    | DateTime   | Last price update               |
| `user_id`       | Integer FK | Owner                           |

### ImportJob

Background import processing records.

| Field           | Type        | Description                                          |
| --------------- | ----------- | ---------------------------------------------------- |
| `id`            | Integer PK  | Auto-increment                                       |
| `filename`      | String      | Original filename                                    |
| `status`        | String      | PROCESSING, QUEUED, READY_PREVIEW, COMPLETED, FAILED |
| `file_content`  | LargeBinary | Raw file data (cleared after processing)             |
| `preview_data`  | Text (JSON) | Parsed transactions                                  |
| `error_message` | Text        | Error details if failed                              |
| `completed_at`  | DateTime    | Processing completion time                           |
| `user_id`       | Integer FK  | Owner                                                |

### Notification

Real-time notifications.

| Field        | Type        | Description                                   |
| ------------ | ----------- | --------------------------------------------- |
| `id`         | Integer PK  | Auto-increment                                |
| `type`       | String      | import_ready, import_failed, group_invitation |
| `title`      | String      | Bold header text                              |
| `body`       | Text        | Description text                              |
| `data`       | Text (JSON) | Type-specific payload                         |
| `read`       | Boolean     | Read status                                   |
| `created_at` | DateTime    | Creation time                                 |
| `user_id`    | Integer FK  | Recipient                                     |

### Group & GroupMember

Family group sharing.

**Group:**
| Field | Type | Description |
|-------|------|-------------|
| `id` | Integer PK | Auto-increment |
| `name` | String | Group name |
| `created_by` | Integer FK | Creator |

**GroupMember:**
| Field | Type | Description |
|-------|------|-------------|
| `id` | Integer PK | Auto-increment |
| `group_id` | Integer FK | Parent group |
| `user_id` | Integer FK | Member user |
| `role` | String | "member" (default) |
| `status` | String | pending, accepted, rejected |
| `invited_by` | Integer FK | Who invited this member |
| `joined_at` | DateTime | When they joined |

### CardClosing

Credit card billing cycle tracking.

| Field               | Type       | Description         |
| ------------------- | ---------- | ------------------- |
| `id`                | Integer PK | Auto-increment      |
| `card`              | String     | Card name           |
| `card_last_digits`  | String     | Last 4 digits       |
| `card_type`         | String     | credito/debito      |
| `bank`              | String     | Issuing bank        |
| `card_id`           | Integer FK | Linked card         |
| `closing_date`      | Integer    | Day of month (1-28) |
| `next_closing_date` | Date       | Next closing date   |
| `due_date`          | Date       | Payment due date    |
| `user_id`           | Integer FK | Owner               |

### AnalysisHistory

Saved AI analysis sessions.

| Field           | Type       | Description              |
| --------------- | ---------- | ------------------------ |
| `id`            | Integer PK | Auto-increment           |
| `month`         | String     | Analyzed month (YYYY-MM) |
| `question`      | String     | User's question          |
| `result_text`   | Text       | AI response              |
| `expense_count` | Integer    | Expenses analyzed        |
| `total_amount`  | Float      | Total amount analyzed    |
| `user_id`       | Integer FK | Owner                    |

### Setting

Key-value store for user preferences and broker credentials.

| Field   | Type      | Description                           |
| ------- | --------- | ------------------------------------- |
| `key`   | String PK | Composite: `{user_id}:{setting_name}` |
| `value` | Text      | Setting value                         |

## Key Relationships

- **User 1:N** → Card, Account, Expense, Investment, Category, ImportJob, Notification
- **Expense N:1** → Card, Account, Category
- **Category self-referencing** → parent_id (up to 3 levels deep)
- **Group 1:N** → GroupMember N:1 → User
- **ScheduledExpense N:1** → Card, Account, Category
- **ScheduledExpense 1:1** → Expense (after execution)
