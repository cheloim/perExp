# Issue 199 — Make Cards/Accounts Optional, Introduce Tags

**Status:** Analysis Complete — Ready for Implementation
**Date:** 2026-09-07
**Related PR:** #195 (Dashboard visual refinements)

## Summary

Analyze making cards/accounts optional on expenses and replacing them with a **Tags** subsystem as the primary classification for payment methods. Tags will fully replace `Expense.card_id/account_id` read paths over time; the FK columns are retained during a deprecation window for backward compatibility with installments, credit-card pasivos, and CSV imports.

---

## 1. Current State

### 1.1 DB & schemas — already nullable

| Location | Field | Nullable |
|---|---|---|
| `models.py:253-254` | `Expense.account_id`, `Expense.card_id` | Yes, `ON DELETE SET NULL` |
| `schemas/expenses.py:25-26` | `ExpenseCreate.account_id/card_id` | `int \| None = None` |
| `schemas/expenses.py:54-55` | `ExpenseUpdate.account_id/card_id` | `int \| None = None` |

### 1.2 Enforcement — single backend gate

| Location | Rule |
|---|---|
| `routers/expenses.py:354-361` | Income requires `account_id` → 400 `account_required` |
| `routers/expenses.py:364-371` | Non-income requires `account_id` OR `card_id` → 400 `account_required` |

### 1.3 Bot flows — forced selection

| Bot | Flow | Location |
|---|---|---|
| Telegram | `WAITING_PAYMENT` — no skip button | `telegram_bot.py:1451-1539` |
| Telegram | Bank notification — no skip | `telegram_bot.py:1077-1283` |
| WhatsApp | `_ask_payment_method` — no skip | `whatsapp_bot.py:572-585, 669-766` |
| WhatsApp | Bank notification — no skip | `whatsapp_bot.py:475-564` |

Both bots have an existing unreachable "else" branch that saves without card/account:
- Telegram: `_save_expense_from_context` at `telegram_bot.py:2234-2241`
- WhatsApp: `_do_save_expense` at `whatsapp_bot.py:1052-1059`

### 1.4 Frontend — binary toggle, no "none" state

| Component | Behavior |
|---|---|
| `ExpenseModals.tsx:301-332` | Binary toggle "Tarjeta \| Efectivo" — no "Sin cuenta" |
| `ExpenseModals.tsx:279-292` | Blocking banner when no cards/accounts exist |
| `ExpenseModals.tsx:397-459` | Category select (pattern to mirror for Tags) |
| `ExpensesPage.tsx:1160-1166` | Row renders `exp.card · exp.bank · exp.person` |
| `ExpensesPage.tsx:661-722` | "Cuenta" filter dropdown (cards + accounts) |
| `ExpensesPage.tsx:471-513` | CSV export: Banco, Tarjeta, Persona columns |
| `ExpensesPage.tsx:1127-1134` | "Missing data" warning badge for absent card/account |
| `ExpensesPage.tsx:250-260` | Bulk edit: `card:${id}` / `account:${id}` options |

### 1.5 Tags — **do not exist**

No `Tag` model, no `expense_tags` table, no schema/router/UI/bot support anywhere in the codebase.

### 1.6 PUT/bulk-update — can't clear account/card

| Location | Issue |
|---|---|
| `routers/expenses.py:460` | `model_dump(exclude_none=True)` — nulls stripped |
| `routers/expenses.py:578-580` | Bulk-update skips `None` values |

Contrast: `bulk-category` at `routers/expenses.py:599-628` correctly accepts `category_id = null`.

---

## 2. Tag Design

### 2.1 Model

```python
class Tag(Base):
    __tablename__ = "tags"
    __table_args__ = (
        Index("ix_tags_user_id", "user_id"),
        Index("ix_tags_card_id", "card_id"),
        Index("ix_tags_account_id", "account_id"),
        UniqueConstraint("name_hmac", "user_id", name="uq_tag_name_user"),
    )
    id = Column(Integer, primary_key=True, index=True)
    name = Column(EncryptedType, nullable=False)
    name_hmac = Column(String(64), nullable=False, index=True)
    color = Column(String(7), default="#6366f1")
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    card_id = Column(Integer, ForeignKey("cards.id", ondelete="SET NULL"), nullable=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

# M2M association
class ExpenseTag(Base):
    __tablename__ = "expense_tags"
    __table_args__ = (
        Index("ix_expense_tags_tag_id", "tag_id"),
    )
    expense_id = Column(Integer, ForeignKey("expenses.id", ondelete="CASCADE"), primary_key=True)
    tag_id = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)
```

`Tag.name` is `EncryptedType` + `name_hmac` (same pattern as `Account` and `Card`) because tags derived from card/account names expose PII (bank names, card numbers).

### 2.2 Uniqueness

App-level dedupe on create: `filter(user_id, name_hmac == compute_hmac(name.strip().lower()))` → 409 with `existing_id`. Mirror `routers/accounts.py:82-102`.

### 2.3 Naming convention (backfill)

| Source | Tag Name | Tag Link |
|---|---|---|
| Card | `Tarjeta {bank} {card_name}` | `tag.card_id → card.id` |
| Account | `Cuenta {name}` | `tag.account_id → account.id` |
| Bank notification (no Card match) | `Tarjeta {bank} {card_last4}` | None |

### 2.4 Eager loading strategy

Use `selectinload(Expense.tags)` — NOT `joinedload` (cartesian product with 3 existing joinedloads, breaks SQL LIMIT at `expenses.py:143`).

---

## 3. Coupling Inventory

### 3.1 Enforcement (must remove/relax)

| File:Line | Coupling | Action |
|---|---|---|
| `expenses.py:354-361` | Income requires `account_id` | Remove (tags replace semantic) |
| `expenses.py:364-371` | Expense requires `account_id` OR `card_id` | Remove |
| `telegram_bot.py:1451-1539` | Forced payment selection | Add "⏭️ Sin cuenta" button |
| `telegram_bot.py:1077-1283` | Bank notification no skip | Add skip + auto-tag from parsed data |
| `whatsapp_bot.py:572-585, 669-766` | Forced payment selection | Add skip button |
| `whatsapp_bot.py:475-564` | Bank notification no skip | Add skip + auto-tag |
| `ExpenseModals.tsx:301-332` | Binary toggle | Add `payMethod="none"` state |
| `ExpenseModals.tsx:279-292` | Blocking banner | Downgrade to non-blocking hint |
| `expenses.py:460` | PUT `exclude_none=True` | Switch to `exclude_unset=True` |
| `expenses.py:578-580` | Bulk-update skips None | Accept explicit nulls |

### 3.2 Reports & aggregations (silent money-math breakages)

| File:Line | Issue | Fix |
|---|---|---|
| `dashboard.py:1632-1633` | `card-summary` drops cardless/accountless expenses | Add "Sin cuenta" bucket |
| `dashboard.py:279-296` | `by_card` skips cardless | Add `by_tag` aggregation |
| `dashboard.py:140-151` | `total_by_account` misclassifies cardless as cash | Resolve via tag→card |
| `dashboard.py:977-990` | `account-expenses` includes cardless in cash | Same tag→card resolution |
| `dashboard.py:1412,1449` | `credit-card-pasivos` undercounts | Resolve "is credit card" via tag→card→card_type |
| `expenses.py:702-725` | `last_used` filter `card_id IS NOT NULL` | Include tagged expenses |
| `monthly_report.py:185-230, 289-307` | accounts/cards/payment_methods sections | Replace with `tags_summary` |
| `monthly_report.py:392-433` | LLM prompt CUENTAS/TARJETAS sections | Replace with tag breakdown |
| `pdf_report.py:136-215, 274-283` | Doughnut + comparison charts | Rebuild from tags |
| `report_template.html:613-651` | Account/Card summary grid + chart | Replace with tag sections |
| `expenses.py:113-126` | bank/person/card/card_type filters (Python-side) | Add `tag_id` filter (DB-side) |

### 3.3 Scheduled/Recurring propagation (must copy tags)

| File:Line | Issue | Fix |
|---|---|---|
| `tasks/scheduled_expenses.py:45-46` | Execute copies card/account but not tags | Copy `expense_tags` rows |
| `routers/scheduled_expenses.py:146-147` | Same | Same |
| `services/import_utils.py:573-610` | `fix_missing_installments` clones card/account | Clone tags too |
| `tasks/detect_recurring.py:134-138` | Mode-vote over `card_id`/`account_id` | Add tag-mode derivation |
| `tasks/detect_recurring.py:157-158,171-172` | Writes card/account to recurring | Write tag_ids |

### 3.4 Computed fields & serialization

| File:Line | Issue | Fix |
|---|---|---|
| `schemas/expenses.py:99-112` | `card`/`bank`/`person` empty when `card_id` null | Fallback: first tag with `card_id` → that tag's Card |
| `dashboard.py:51-56` | `_get_card_info` | Same fallback |
| `dashboard.py:306-322` | `expense_to_dict` | Same fallback |
| `dashboard.py:992-1006` | Account-expenses output | Same fallback |
| `ExpensesPage.tsx:1160-1166` | Renders card/bank/person | Show tag chips instead |
| `ExpensesPage.tsx:1127-1134` | "Missing data" badge | Repurpose to "untagged" |
| `ExpenseDetailModal.tsx:19-27,46` | Shows card/account fields | Show tags |

### 3.5 Delete guards

| File:Line | Current | Fix |
|---|---|---|
| `cards.py:255-267` | Block delete if expenses reference `card_id` | Also check `tag.card_id` |
| `accounts.py:178-185` | Block delete if expenses reference `account_id` | Also check `tag.account_id` |
| `routers/auth.py:536-553` | User deletion cleans cards/accounts | Also clean tags + expense_tags |

### 3.6 Import pipeline

| File:Line | Current | Fix |
|---|---|---|
| `import_jobs.py:363-444` | Always resolves/creates Card per row | Also mint/attach tag from created Card |
| `import_jobs.py:382-395` | ScheduledExpense gets card_id | Also get tag |
| `csv_parser.py:304-308,599-614` | Card matching by last4 | Keep (card still created); tag auto-attach at confirm |
| `smart_import_core.py:386-411` | `matched_card_id` in preview | Keep; tag at confirm |

### 3.7 Audit

| File:Line | Issue | Fix |
|---|---|---|
| `services/expense_update.py:28-56` | `setattr`-based field diff won't capture M2M | Add `expense.tags_update` audit action |
| `services/expense_update.py:140-145` | Blocks edits on budget/installment expenses | Exempt tag edits |

### 3.8 Family-group scoping

Cards/Accounts are per-user rows read group-wide (`get_group_user_ids`). Tags should mirror this: `tag.user_id` + group-wide reads + owner-only writes. Backfilled card-tags must preserve `Card.holder` → person semantics for `/expenses?person=` filters.

### 3.9 Confirmed "no changes needed"

- **Investments** — broker accounts only, zero coupling
- **Budgets** — category-keyed, no card/account refs
- **Card closings** — model exists but never queries expenses; spec drift aside
- **InstallmentsPage.tsx** — doesn't display card
- **Quick pages** (Telegram Mini App) — read-only, null-safe
- **Admin** — row counters only; optionally add `tag_count`
- **smoke.sh** — never POSTs expenses
- **Notifications** — no card types; "untagged" is a new analog
- **check_upcoming_* tasks** — no card/account refs
- **AI trends / analysis** — no card data in LLM context; optional enrichment
- **weekly_summary.py / weekly_report.py** — no card/account breakdown today (tags breakdown will be *added*)

---

## 4. Charts & UI Rework

### 4.1 Dashboard "Métodos de Pago" (`Dashboard.tsx:798-837`)

Currently a flat `CardRow` list fed by `GET /dashboard/card-summary`. Replace with:
- **Clickable tag donut** (recharts PieChart, reuse pattern from `ExpensesPage.tsx:808-851`)
- Fed by new `GET /dashboard/tag-summary` endpoint
- Include "Sin cuenta" bucket for untagged expenses

### 4.2 AccountsPage "Evolución por Cuenta" (`AccountsPage.tsx:563-674`)

Currently a recharts LineChart fed by card-summary. **Remove** this chart and its `evolutionChartData` memo (`131-163`). Also delete orphan `CardEvolutionChart.tsx`. Keep summary lists, switch to tag-summary data.

### 4.3 ExpensesPage

- Tag filter in `useExpenseFilters` (replaces fragile name-based "Cuenta" round-trip at `:661-722`)
- Tag chips in expense rows (colored, like category chips at `:1177-1186`)
- Tags column in CSV export (`:471-513`)
- Bulk-edit tags (M2M bulk endpoint required)
- Remove "Cuenta" filter select; replace with "Tag" select
- Remove "missing data" warning badge concept; repurpose for "untagged"

### 4.4 Reports

**Monthly** (`monthly_report.py` + `pdf_report.py` + `report_template.html`):
- Add `tags_summary` section (per-tag totals + monthly comparison)
- Replace `accounts_summary`/`cards_summary` (199-230) in report JSON + LLM prompt (392-433)
- Replace `payment_methods` (289-307) — now dead data anyway (never rendered in template)
- Rebuild doughnut + comparison chart from tags (pdf_report.py:136-215, 274-283)

**Weekly** (`weekly_summary.py` + `weekly_report.py` + `report_template_weekly.html`):
- New section: "Por método de pago" with tag breakdown
- Add to `bot_reports.build_weekly_report_data` (525-701)
- Add to caption (182-197) and report image context (147-170)

---

## 5. Migration & Backfill Plan

### 5.1 Schema migration (no Alembic)

```python
# scripts/migrate_add_tags.py
# Creates tags, expense_tags tables via Base.metadata.create_all
# Adds indices: ix_tags_user_id, ix_tags_card_id, ix_tags_account_id, ix_expense_tags_tag_id
```

### 5.2 Backfill script

```python
# scripts/backfill_tags_from_cards_accounts.py
# Per user:
#   1. Create Tag per Card: name="Tarjeta {bank} {card_name}", card_id=card.id
#   2. Create Tag per Account: name="Cuenta {name}", account_id=account.id
#   3. For each expense with card_id/account_id:
#      INSERT INTO expense_tags (expense_id, tag_id) VALUES (...)
# Idempotent (skip existing by hmac), dry-run flag, batched commits
```

### 5.3 Historical data

No destructive migration. `Expense.card_id/account_id` columns retained during deprecation window. Existing data untouched; tags are additive.

---

## 6. New Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/tags` | List tags for current user (with expense count) |
| POST | `/tags` | Create tag (name + color + optional card_id/account_id) |
| PUT | `/tags/{id}` | Update tag name/color |
| DELETE | `/tags/{id}` | Delete tag (removes expense_tags rows) |
| GET | `/dashboard/tag-summary` | Spending summary per tag (monthly series + current total), "Sin cuenta" bucket |
| PATCH | `/expenses/bulk-tags` | Bulk assign/remove tags (M2M write) |
| GET | `/expenses` | New params: `tag_id`, `tag_ids`, `untagged` |

---

## 7. Effort Estimation

| Workstream | Effort | Risk |
|---|---|---|
| Tags model + CRUD + schemas | Medium (2 days) | Low |
| Backfill script | Medium (1 day) | Medium (idempotency, name collisions) |
| Remove enforcement + bot skip + frontend none state | Medium (2 days) | Low |
| Dashboard/Accounts chart rework | Medium (1-2 days) | Low |
| ExpensesPage tag filter + chips + CSV | Medium (1-2 days) | Low |
| Tag→card resolution in pasivos/account-expenses/total_by_account | High (2 days) | **High** (money math) |
| Scheduled/recurring tag propagation | Medium (1 day) | Medium |
| Monthly + weekly report tag sections | Medium (1-2 days) | Low |
| Delete guards + audit + auth cleanup | Low (0.5 days) | Low |
| Tests + lint + smoke | Medium (1 day) | Low |
| **Total** | **~12-15 days** | |

### Highest risk items

1. **Credit-card pasivos via tag→card** (Phase 4) — money math; needs thorough tests before FK writes are ever removed.
2. **Backfill name collisions** (Phase 2) — two cards with same display name per user; dedupe via hmac unique + suffix.
3. **Tag filtering double-counting** (Phase 4) — multi-tag expenses summed twice in by-category/by-tag; needs DISTINCT or subquery.

---

## 8. Effort Estimation (from original issue)

| Category | Level |
|---|---|
| Making accounts/cards optional | **Medium** |
| Tags subsystem from scratch | **High** |
| Docs/specs/tests | **Low** |

---

## 9. Acceptance Criteria

- [x] Document with clear list of technical changes and risks (this document)
- [ ] Migration proposal and deployment plan (Section 5)
- [ ] List of UI/UX changes with standard tag examples (Section 4)
- [ ] Time/effort estimate (Section 7)
