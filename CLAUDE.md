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
categories (id, name, color, keywords)
expenses   (id, date, description, amount, currency,
            category_id, card, bank, person, notes,
            transaction_id, installment_number, installment_total, installment_group_id)
analysis_history (id, created_at, month, question, result_text, expense_count, total_amount)
```

New columns are added via `ALTER TABLE … ADD COLUMN` in `main.py` startup block — no migrations library.

## Backend Patterns

- **DB session**: `get_db()` FastAPI dependency, yields `Session`
- **Null strings**: `ExpenseResponse` has a `coerce_none` validator that converts `None → ""` for `card, bank, person, notes, currency`. This means the frontend ALWAYS receives strings, never null for those fields.
- **PUT /expenses/{id}**: Uses `model_dump(exclude_none=True)` — only sends fields explicitly set (None fields are skipped)
- **Auto-categorize**: keyword matching in `auto_categorize()` + sign-based logic in `_resolve_category()`
- **Duplicate detection**: `_is_duplicate()` checks `transaction_id` first, then `(date, amount, description)` triple — does NOT account for installment_number (known bug)
- **Smart import flow**: `POST /import/smart` (LLM parse) → returns preview → `POST /import/rows-confirm` (bulk save)
- **PDF extraction**: `_extract_pdf_text()` using pdfplumber; text sent raw to Gemini with `SMART_IMPORT_PROMPT`
- **Spanish month dates**: LLM prompt instructs YYYY-MM-DD output but PDF dates like "15-ENE" / "15-Enero" need explicit handling — `pd.to_datetime` cannot parse Spanish abbreviations
- **Installment date fixing**: after LLM parse, `add_months()` shifts dates for installments C.02/03, C.03/03, etc.
- **Cors**: allows `localhost:5173` and `localhost:8082`

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
| GET | /categories | List all categories |
| POST | /categories | Create category |
| PUT | /categories/{id} | Update category |
| DELETE | /categories/{id} | Delete category |
| GET | /expenses | List expenses (params: category_id, month, bank, person, search, limit, offset) |
| POST | /expenses | Create expense |
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
