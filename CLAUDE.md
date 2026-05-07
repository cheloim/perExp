# Credit Card Analyzer — CLAUDE.md

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI + SQLAlchemy 2 + Pydantic v2 + SQLite |
| Frontend | React 18 + TypeScript + Vite + TanStack Query v5 + React Router DOM v7 |
| Charts | Recharts |
| LLM | Google Gemini Flash via `google-genai` SDK |
| PDF parsing | pdfplumber |

## Running

```bash
# Backend  (from backend/)
source .venv/bin/activate && uvicorn main:app --reload   # http://localhost:8000

# Frontend (from frontend/)
npm run dev   # http://localhost:5173
```

## Key Files

```
backend/main.py          # Entire backend (~1100 lines): models, schemas, all routes
frontend/src/
  api/client.ts          # All axios API calls
  types/index.ts         # All shared TypeScript interfaces
  pages/
    Dashboard.tsx        # Summary cards, pie chart, bar chart, recent expenses
    ExpensesPage.tsx     # Expense list + edit modal
    ImportPage.tsx       # File upload (manual CSV + LLM smart import)
    AnalysisPage.tsx     # Gemini chat/analysis
    CategoriesPage.tsx   # CRUD for categories + detail modal
  App.tsx                # Router + nav tabs
  main.tsx               # React root, QueryClient (staleTime: 30s)
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
- **ExpenseCreate type**: does NOT include installment fields — those must be added if edit modal needs to preserve them

## Known Bugs (unresolved as of 2026-04-28)

1. **422 on expense edit (PDF imports)**: Frontend sends `currency: ""` (empty string from coerce_none round-trip). `"" ?? 'ARS'` doesn't catch it. Fix: use `|| 'ARS'`. Also `ExpenseCreate` missing installment fields → lost on edit.
2. **Dashboard month filter debounce**: `onChange` directly calls `setMonth` → refetch on every keystroke. Fix: `useDebounce` or controlled input + button.
3. **Installment false duplicates**: `_is_duplicate` treats C.01/03 and C.02/03 as same row if same (date, amount, cleaned_description). Fix: include `installment_number` + `installment_total` in uniqueness check.
4. **Spanish month PDF dates**: LLM may not always convert "15-ENE" → "2025-01-15". Fix: add Spanish→number month map to `SMART_IMPORT_PROMPT` and/or fallback parser in `smart_import`.

## Pending Features (as of 2026-04-28)

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

| Method | Path | Description |
|---|---|---|
| POST | /auth/register | Register new user |
| POST | /auth/login | Login (returns JWT) |
| GET | /auth/me | Get current user info |
| PUT | /auth/change-password | Change password |
| GET | /categories | List all categories |
| POST | /categories | Create category |
| PUT | /categories/{id} | Update category |
| DELETE | /categories/{id} | Delete category |
| **GET** | **/accounts** | **List user's accounts** |
| **POST** | **/accounts** | **Create account** |
| **PUT** | **/accounts/{id}** | **Update account** |
| **DELETE** | **/accounts/{id}** | **Delete account (fails if has expenses)** |
| **GET** | **/cards** | **List user's cards** |
| **POST** | **/cards** | **Create card** |
| **PUT** | **/cards/{id}** | **Update card** |
| **DELETE** | **/cards/{id}** | **Delete card (fails if has expenses)** |
| GET | /expenses | List expenses (params: category_id, month, bank, person, search, limit, offset) |
| POST | /expenses | Create expense (validates account_id for cash/transfer) |
| PUT | /expenses/{id} | Update expense (partial, exclude_none) |
| DELETE | /expenses/{id} | Delete expense |
| GET | /expenses/check-duplicate | Check duplicate (params: date, amount, description, transaction_id) |
| GET | /dashboard/summary | Dashboard aggregates (params: month) |
| POST | /import/preview | CSV/Excel preview with column mapping |
| POST | /import/confirm | CSV/Excel confirm import |
| POST | /import/smart | LLM smart import (PDF/CSV) — returns SmartImportPreview |
| POST | /import/rows-confirm | Confirm smart import rows |
| POST | /analysis/stream | Gemini analysis stream (SSE) |
| GET | /analysis/history | Analysis history |
| DELETE | /analysis/history/{id} | Delete history entry |
| GET | /investments | List investments |
| POST | /investments | Create investment |
| PUT | /investments/{id} | Update investment |
| DELETE | /investments/{id} | Delete investment |
| GET | /groups/me | Get user's family group |
| POST | /groups/invite | Invite user to group (by DNI) |
| DELETE | /groups/leave | Leave current group |
| GET | /notifications | List notifications |
