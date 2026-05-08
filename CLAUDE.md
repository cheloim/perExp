# Credit Card Analyzer — CLAUDE.md

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI + SQLAlchemy 2 + Pydantic v2 + SQLite |
| Frontend | React 18 + TypeScript + Vite + TanStack Query v5 + React Router DOM v7 |
| Charts | Recharts |
| LLM | Google Gemini Flash via `google-genai` SDK |
| PDF parsing | pdfplumber |

## GNOME Human Interface Guidelines (HIG)

El frontend sigue el **GNOME Human Interface Guidelines** para una experiencia de usuario consistente y accessible.

### Principios Generales

- **Jerarquía visual clara**: Labels prominentes, hints sutiles
- **Espaciado uniforme**: 8px base (space-y-1, space-y-2, space-y-3, space-y-4)
- **Feedback visual**: Estados focus/hover con `focus:ring-2 focus:ring-primary/30`
- **Colores del sistema**: Usar variables CSS (`--color-primary`, `--color-surface`, `--text-primary`, etc.)

### Estilos de Formularios

```tsx
// Input field
<input
  className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
  placeholder="Ej: Nombre"
/>

// Label
<label className="text-xs font-medium text-[var(--text-secondary)]">Label</label>

// Select
<select className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition">
  <option>Opción</option>
</select>

// Botón primario
<button className="px-4 py-2 rounded-md bg-[var(--color-primary)] text-[var(--color-on-primary)] text-sm font-medium hover:brightness-110 disabled:opacity-60 transition">
  Guardar
</button>

// Botón secundario
<button className="px-4 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition">
  Cancelar
</button>
```

### Agrupación de Campos

- **Espaciado entre grupos**: `space-y-4` o `pt-4 border-t border-[var(--border-color)]`
- **Labels siempre visibles** (no flotantes)
- **Hints en placeholder**: "Ej: Galicia" en lugar de solo "Banco"
- **Campos opcionales**: Sin indicador especial, placeholder indica opcional

### Iconos y Badges

- Usar emojis o iconos SVG de 16x16px
- Badges: `text-xs font-medium px-1.5 py-0.5 rounded-full`

## Running

```bash
# Backend  (from backend/)
source .venv/bin/activate && uvicorn main:app --reload   # http://localhost:8000

# Frontend (from frontend/)
npm run dev   # http://localhost:5173
```

## Key Files

```
backend/
  main.py                          # FastAPI app entry, lifespan, CORS, router includes
  app/
    models.py                       # SQLAlchemy models, all table definitions, startup ALTERs
    database.py                     # SessionLocal, get_db dependency
    schemas.py                      # Pydantic schemas (Create, Update, Response)
    routers/
      auth.py                       # /auth — login, register, me, password, telegram-key
      accounts.py                   # /accounts — CRUD
      cards.py                      # /cards — CRUD
      categories.py                 # /categories — CRUD + /apply-base-hierarchy, /seed-defaults
      card_closings.py              # /card-closings — CRUD
      expenses.py                   # /expenses — list, create, update, delete, bulk, recategorize
      dashboard.py                  # /dashboard — summary, installments, card-summary, trends, merchants
      import_.py                    # /import — preview, confirm, smart (PDF/CSV LLM), rows-confirm, debug
      investments.py                # /investments — CRUD, sync IOL/PPI, cash balances, chat stream
      analysis.py                   # /analysis — stream, summarize, history
      groups.py                     # /groups — invite, leave, /me
      notifications.py             # /notifications — list, read, accept, reject

frontend/src/
  api/client.ts                    # All axios API calls
  types/index.ts                   # All TypeScript interfaces
  pages/
    Dashboard.tsx              # Summary, area chart, category bars, recent transactions
    ExpensesPage.tsx           # List with filters, edit modal, bulk actions
    ImportPage.tsx             # File upload (manual CSV + LLM smart import)
    AnalysisPage.tsx           # Gemini chat/analysis
    AccountsPage.tsx           # Accounts & cards management
    InvestmentsPage.tsx        # Investments portfolio (IOL + PPI sync)
    CategoriesPage.tsx         # Category CRUD
    CategoryDashboard.tsx      # Category breakdown & trends
    InstallmentsPage.tsx       # Cuotas dashboard
    CardEvolutionChart.tsx    # Card spending evolution chart
  App.tsx                      # Router + nav tabs + sidebar + AI drawer
  main.tsx                     # React root, QueryClient (staleTime: 30s)
  components/
    AIAssistant.tsx           # Floating chat drawer (Dashboard/Expenses)
    InvestmentsAssistant.tsx  # Side panel chat (Investments page)
    NotificationsPanel.tsx    # Bell notifications drawer
    UserPanel.tsx              # User account drawer
```

## Database Schema (`expenses.db`)

```sql
categories (id, name, color, keywords, parent_id)
accounts   (id, name, type, user_id, created_at)
cards      (id, name, bank, last4_digits, card_type, user_id, created_at)
expenses   (id, date, description, amount, currency,
            category_id, card, bank, person, notes,
            transaction_id, installment_number, installment_total, installment_group_id,
            card_last4, user_id, group_id,
            account_id, card_id)
analysis_history (id, created_at, month, question, result_text, expense_count, total_amount, user_id)
users      (id, dni, full_name, email, hashed_password, is_active, created_at, telegram_key, telegram_chat_id)
groups     (id, name, created_by, created_at)
group_members (id, group_id, user_id, role, status, invited_by, joined_at)
investments (id, ticker, name, type, broker, quantity, avg_cost, current_price, currency, notes, updated_at, user_id)
card_closings (id, card, card_last_digits, card_type, bank, closing_date, next_closing_date, due_date, last_imported_at, user_id)
notifications (id, user_id, type, title, body, data, read, created_at)
```

**New structured fields (2026-05):**
- `expenses.account_id` → FK to `accounts` (for cash/transfer payments)
- `expenses.card_id` → FK to `cards` (for card payments)
- Legacy fields (`card`, `bank`, `person`) maintained for compatibility

New columns are added via `ALTER TABLE … ADD COLUMN` in `models.py` startup block — no migrations library.

## Backend Patterns

- **DB session**: `get_db()` FastAPI dependency, yields `Session`
- **Authentication**: JWT tokens via `get_current_user()` dependency, user isolation enforced in all routers
- **Multi-user**: All data (expenses, categories, investments, etc.) filtered by `user_id` or group membership
- **Null strings**: `ExpenseResponse` has a `coerce_none` validator that converts `None → ""` for `card, bank, person, notes, currency`. This means the frontend ALWAYS receives strings, never null for those fields.
- **PUT /expenses/{id}**: Uses `model_dump(exclude_none=True)` — only sends fields explicitly set (None fields are skipped)
- **Account/Card separation (2026-05)**: POST /expenses validates that cash/transfer payments have `account_id`. Legacy `card`/`bank` fields still supported. See `MIGRATION_ACCOUNTS_CARDS.md`
- **Auto-categorize**: keyword matching in `auto_categorize()` + sign-based logic in `_resolve_category()`
- **Duplicate detection**: `_is_duplicate()` checks `transaction_id` first, then `(date, amount, description)` triple — does NOT account for installment_number (known bug)
- **Smart import flow**: `POST /import/smart` (LLM parse) → returns preview → `POST /import/rows-confirm` (bulk save)
- **PDF extraction**: `_extract_pdf_text()` using pdfplumber; text sent raw to Gemini with `SMART_IMPORT_PROMPT`
- **Spanish month dates**: LLM prompt instructs YYYY-MM-DD output but PDF dates like "15-ENE" / "15-Enero" need explicit handling — `pd.to_datetime` cannot parse Spanish abbreviations
- **Installment date fixing**: after LLM parse, `add_months()` shifts dates for installments C.02/03, C.03/03, etc.
- **Cors**: allows `localhost:5173` and `localhost:8082`
- **Telegram bot**: Separate thread running async bot, users authenticate with 12-char key, auto-categorization + installment support

## Frontend Patterns

- **API calls**: all in `src/api/client.ts`, all use axios, base URL `http://localhost:8000`
- **State**: TanStack Query for server state; local `useState` for UI state (filters, modals)
- **URL-synced filters**: `useSearchParams()` in ExpensesPage for category_id, bank, person, search params
- **Currency init guard**: use `|| 'ARS'` (not `?? 'ARS'`) when initializing currency from API response — `coerce_none` returns `""` for null, and `"" ?? 'ARS'` = `""` (wrong)
- **ExpenseCreate type**: includes `installment_number`, `installment_total`, `installment_group_id` fields — modal preserves them on edit.

## Known Bugs (unresolved as of 2026-05-08)

1. **Installment false duplicates**: `_is_duplicate` treats C.01/03 and C.02/03 as same row if same (date, amount, cleaned_description). Fix: include `installment_number` + `installment_total` in uniqueness check.
2. **Spanish month PDF dates**: LLM may not always convert "15-ENE" → "2025-01-15". Fix: add Spanish→number month map to `SMART_IMPORT_PROMPT` and/or fallback parser in `smart_import`.

## Pending Features (as of 2026-05-08)

- Dashboard: trend indicators (alcista/bajista) per category
- Replace bar chart with line chart (Recharts `LineChart`)
- Category dashboard with per-category filter
- Description search filter on dashboard
- Time range selector (week / month / year) on charts
- Right-side cards info panel (last 4 digits, cardholder, bank, total per card)
- Multiple file upload for LLM import (`multiple` on `<input>`, loop in handler)
- Disable manual import mode (LLM-only UI)
- Installments/cuotas dashboard (grouped by `installment_group_id`)

## API Endpoints Reference

### Auth

| Method | Path | Description |
|---|---|---|
| POST | /auth/register | Register new user |
| POST | /auth/login | Login (returns JWT) |
| GET | /auth/me | Get current user info |
| PUT | /auth/password | Change password |
| GET | /auth/me/telegram-key | Get Telegram key |
| POST | /auth/me/telegram-key/regenerate | Regenerate Telegram key |

### Categories

| Method | Path | Description |
|---|---|---|
| GET | /categories | List all categories |
| POST | /categories | Create category |
| PUT | /categories/{id} | Update category |
| DELETE | /categories/{id} | Delete category |
| POST | /categories/apply-base-hierarchy | Apply base hierarchy |
| POST | /categories/seed-defaults | Seed default categories |

### Accounts

| Method | Path | Description |
|---|---|---|
| GET | /accounts | List user's accounts |
| POST | /accounts | Create account |
| PUT | /accounts/{id} | Update account |
| DELETE | /accounts/{id} | Delete account (fails if has expenses) |

### Cards

| Method | Path | Description |
|---|---|---|
| GET | /cards | List user's cards |
| POST | /cards | Create card |
| PUT | /cards/{id} | Update card |
| DELETE | /cards/{id} | Delete card (fails if has expenses) |

### Expenses

| Method | Path | Description |
|---|---|---|
| GET | /expenses | List expenses (params: category_id, month, bank, person, search, limit, offset, date_from, date_to, uncategorized) |
| POST | /expenses | Create expense (validates account_id for cash/transfer) |
| PUT | /expenses/{id} | Update expense (partial, exclude_none) |
| DELETE | /expenses/{id} | Delete expense |
| DELETE | /expenses/all | Delete all user expenses |
| GET | /expenses/check-duplicate | Check duplicate |
| GET | /expenses/distinct-values | Get distinct banks, persons, cards |
| GET | /expenses/card-options | Get card options (with DSU grouping) |
| POST | /expenses/bulk-category | Bulk update category |
| POST | /expenses/recategorize | Re-categorize expenses |

### Dashboard

| Method | Path | Description |
|---|---|---|
| GET | /dashboard/summary | Dashboard aggregates |
| GET | /dashboard/installments | Installment groups |
| GET | /dashboard/installments/monthly-load | Monthly installment load |
| GET | /dashboard/card-summary | Card spending summary (with DSU grouping) |
| GET | /dashboard/card-category-breakdown | Card × category breakdown |
| GET | /dashboard/category-trend | Category trend over N months |
| GET | /dashboard/ai-trends | AI-generated trends & projections |
| GET | /dashboard/top-merchants | Top merchants by spending |

### Import

| Method | Path | Description |
|---|---|---|
| POST | /import/preview | CSV/Excel preview with column mapping |
| POST | /import/confirm | CSV/Excel confirm import |
| POST | /import/smart | LLM smart import (PDF/CSV) — returns SmartImportPreview |
| POST | /import/rows-confirm | Confirm smart import rows |
| POST | /import/pdf-debug | Debug PDF extraction |
| POST | /import/csv-debug | Debug CSV parsing |
| POST | /import/csv-parser-debug | Debug CSV parser (Santander) |
| POST | /import/csv-raw-llm-preview | Raw LLM CSV preview |

### Analysis

| Method | Path | Description |
|---|---|---|
| POST | /analysis/stream | Gemini analysis stream (SSE) |
| POST | /analysis/summarize | Summarize chat conversation (SSE) |
| GET | /analysis/history | Analysis history |
| DELETE | /analysis/history/{id} | Delete history entry |

### Investments

| Method | Path | Description |
|---|---|---|
| GET | /investments | List investments |
| POST | /investments | Create investment |
| PUT | /investments/{id} | Update investment |
| PATCH | /investments/{id}/price | Update price |
| DELETE | /investments/{id} | Delete investment |
| POST | /investments/deduplicate | Deduplicate by ticker+broker |
| POST | /investments/sync/iol | Sync from InvertirOnline |
| POST | /investments/sync/ppi | Sync from Portfolio Personal |
| GET | /investments/usd-rate | USD/ARS rate (BCRA + BNA fallback) |
| GET | /investments/cash-balances | Cash balances from IOL + PPI |
| GET | /investments/manual-cash-balances | Get manual cash balances |
| PUT | /investments/manual-cash-balances/{broker} | Set manual cash balance |
| DELETE | /investments/manual-cash-balances/{broker} | Delete manual cash balance |
| POST | /investments/refresh-manual-prices | Refresh manual prices |
| GET | /settings | Get broker settings |
| PUT | /settings/{key} | Update setting |
| POST | /investments/chat/stream | Investments chat (SSE) |

### Groups

| Method | Path | Description |
|---|---|---|
| GET | /groups/me | Get user's family group |
| POST | /groups/invite | Invite user by DNI |
| DELETE | /groups/leave | Leave current group |

### Notifications

| Method | Path | Description |
|---|---|---|
| GET | /notifications | List notifications |
| GET | /notifications/unread-count | Unread count |
| PUT | /notifications/{id}/read | Mark as read |
| POST | /notifications/{id}/accept | Accept group invitation |
| POST | /notifications/{id}/reject | Reject group invitation |

### Card Closings

| Method | Path | Description |
|---|---|---|
| GET | /card-closings | List card closings |
| POST | /card-closings | Create card closing |
