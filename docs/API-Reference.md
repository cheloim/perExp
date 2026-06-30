# API Reference

## Base URL

- **Development**: `http://localhost:8001`
- **Production**: `https://your-domain.com`
- **API Docs**: `http://localhost:8001/docs` (Swagger UI)

## Authentication

All endpoints (except auth) require JWT token:

```
Authorization: Bearer {access_token}
```

## Routers

### Auth (`/auth`)

| Method | Endpoint                           | Description                |
| ------ | ---------------------------------- | -------------------------- |
| `POST` | `/auth/login`                      | Email + password login     |
| `POST` | `/auth/register`                   | Create new account         |
| `POST` | `/auth/oauth`                      | Google/Apple OAuth         |
| `POST` | `/auth/oauth/callback`             | OAuth authorization code   |
| `POST` | `/auth/refresh`                    | Refresh JWT token          |
| `POST` | `/auth/forgot-password`            | Send reset email           |
| `POST` | `/auth/reset-password`             | Reset with token           |
| `PUT`  | `/auth/password`                   | Change password            |
| `GET`  | `/auth/me`                         | Get current user           |
| `GET`  | `/auth/me/telegram-key`            | Get Telegram auth key      |
| `POST` | `/auth/me/telegram-key/regenerate` | Regenerate Telegram key    |
| `GET`  | `/auth/me/telegram-status`         | Check Telegram link status |

### Expenses (`/expenses`)

| Method   | Endpoint                  | Description                                                                  |
| -------- | ------------------------- | ---------------------------------------------------------------------------- |
| `GET`    | `/expenses`               | List expenses (filters: date, category, bank, person, card, account, search) |
| `POST`   | `/expenses`               | Create expense                                                               |
| `PUT`    | `/expenses/{id}`          | Update expense                                                               |
| `DELETE` | `/expenses/{id}`          | Delete expense                                                               |
| `POST`   | `/expenses/bulk-category` | Bulk update categories                                                       |
| `POST`   | `/expenses/bulk-delete`   | Bulk delete expenses                                                         |

### Cards (`/cards`)

| Method   | Endpoint      | Description |
| -------- | ------------- | ----------- |
| `GET`    | `/cards`      | List cards  |
| `POST`   | `/cards`      | Create card |
| `PUT`    | `/cards/{id}` | Update card |
| `DELETE` | `/cards/{id}` | Delete card |

### Accounts (`/accounts`)

| Method   | Endpoint         | Description    |
| -------- | ---------------- | -------------- |
| `GET`    | `/accounts`      | List accounts  |
| `POST`   | `/accounts`      | Create account |
| `PUT`    | `/accounts/{id}` | Update account |
| `DELETE` | `/accounts/{id}` | Delete account |

### Categories (`/categories`)

| Method   | Endpoint           | Description                    |
| -------- | ------------------ | ------------------------------ |
| `GET`    | `/categories`      | List categories (hierarchical) |
| `POST`   | `/categories`      | Create category                |
| `PUT`    | `/categories/{id}` | Update category                |
| `DELETE` | `/categories/{id}` | Delete category                |

### Dashboard (`/dashboard`)

| Method | Endpoint                 | Description            |
| ------ | ------------------------ | ---------------------- |
| `GET`  | `/dashboard`             | Main dashboard summary |
| `GET`  | `/dashboard/by-category` | Expenses by category   |
| `GET`  | `/dashboard/by-period`   | Expenses by period     |
| `GET`  | `/dashboard/by-currency` | Expenses by currency   |
| `GET`  | `/dashboard/by-card`     | Expenses by card       |
| `GET`  | `/dashboard/trends`      | AI trend analysis      |

### Import Jobs (`/import-jobs`)

| Method   | Endpoint                    | Description                 |
| -------- | --------------------------- | --------------------------- |
| `POST`   | `/import-jobs`              | Upload file (multipart)     |
| `GET`    | `/import-jobs`              | List import jobs            |
| `GET`    | `/import-jobs/{id}`         | Get job details + preview   |
| `PUT`    | `/import-jobs/{id}`         | Update preview data         |
| `POST`   | `/import-jobs/{id}/confirm` | Confirm and create expenses |
| `DELETE` | `/import-jobs/{id}`         | Delete job                  |

### Analysis (`/analysis`)

| Method | Endpoint              | Description             |
| ------ | --------------------- | ----------------------- |
| `POST` | `/analysis/chat`      | AI chat (SSE streaming) |
| `POST` | `/analysis/summarize` | Summarize conversation  |
| `GET`  | `/analysis/history`   | Get analysis history    |

### Investments (`/investments`)

| Method   | Endpoint                      | Description             |
| -------- | ----------------------------- | ----------------------- |
| `GET`    | `/investments`                | List investments        |
| `POST`   | `/investments`                | Create investment       |
| `PUT`    | `/investments/{id}`           | Update investment       |
| `DELETE` | `/investments/{id}`           | Delete investment       |
| `POST`   | `/investments/sync/iol`       | Sync with IOL           |
| `POST`   | `/investments/sync/ppi`       | Sync with PPI           |
| `POST`   | `/investments/refresh-prices` | Manual price refresh    |
| `GET`    | `/investments/usd-rate`       | Get USD/ARS rate        |
| `GET`    | `/investments/settings`       | Get broker settings     |
| `PUT`    | `/investments/settings`       | Update broker settings  |
| `POST`   | `/investments/assistant`      | AI chat (SSE streaming) |

### Groups (`/groups`)

| Method   | Endpoint               | Description         |
| -------- | ---------------------- | ------------------- |
| `POST`   | `/groups`              | Create group        |
| `POST`   | `/groups/join`         | Join by invite code |
| `POST`   | `/groups/leave`        | Leave group         |
| `GET`    | `/groups`              | Get current group   |
| `GET`    | `/groups/members`      | List members        |
| `DELETE` | `/groups/members/{id}` | Remove member       |

### Notifications (`/notifications`)

| Method   | Endpoint                     | Description               |
| -------- | ---------------------------- | ------------------------- |
| `GET`    | `/notifications`             | List notifications        |
| `GET`    | `/notifications/count`       | Get unread/pending counts |
| `GET`    | `/notifications/stream`      | SSE stream                |
| `PUT`    | `/notifications/{id}/read`   | Mark as read              |
| `PUT`    | `/notifications/read-all`    | Mark all as read          |
| `DELETE` | `/notifications/{id}`        | Delete notification       |
| `DELETE` | `/notifications/read-all`    | Delete all read           |
| `POST`   | `/notifications/{id}/accept` | Accept group invitation   |
| `POST`   | `/notifications/{id}/reject` | Reject group invitation   |

### Card Closings (`/card-closings`)

| Method   | Endpoint              | Description         |
| -------- | --------------------- | ------------------- |
| `GET`    | `/card-closings`      | List card closings  |
| `POST`   | `/card-closings`      | Create card closing |
| `PUT`    | `/card-closings/{id}` | Update card closing |
| `DELETE` | `/card-closings/{id}` | Delete card closing |

### Scheduled Expenses (`/scheduled-expenses`)

| Method | Endpoint                           | Description               |
| ------ | ---------------------------------- | ------------------------- |
| `GET`  | `/scheduled-expenses`              | List scheduled expenses   |
| `POST` | `/scheduled-expenses/{id}/execute` | Execute scheduled expense |
| `POST` | `/scheduled-expenses/{id}/cancel`  | Cancel scheduled expense  |

## Error Responses

All errors follow the format:

```json
{
  "detail": "Error message"
}
```

Common HTTP status codes:

- `400`: Bad request (validation error)
- `401`: Unauthorized (invalid/missing token)
- `403`: Forbidden (insufficient permissions)
- `404`: Not found
- `410`: Gone (expired import job)
- `415`: Unsupported media type
- `500`: Internal server error
