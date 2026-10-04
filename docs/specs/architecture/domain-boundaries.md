# Domain Boundaries

This document defines the logical domain boundaries within the Oikonomia monolith. These boundaries guide future modularization and potential service extraction.

## Domain Map

```
┌─────────────────────────────────────────────────────────────────┐
│                         CORE DOMAIN                             │
│  User, Group, GroupMember, Notification, Setting                │
│  Auth service, MFA, OAuth, Email, Encryption                    │
│                                                                  │
│  Everything depends on Core. Extract last.                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│   FINANCIAL   │ │   BUDGETS     │ │  INVESTMENTS  │
│  Expense      │ │  Budget       │ │  Investment   │
│  Card         │ │  BudgetGroup  │ │  Setting      │
│  Account      │ │  BudgetEvent  │ │               │
│  Tag          │ │               │ │  Self-        │
│  ExpenseTag   │ │  Depends:     │ │  contained    │
│  CardClosing  │ │  Core, Cat,   │ │               │
│               │ │  Financial    │ │  Depends:     │
│  Depends:     │ │               │ │  Core only    │
│  Core only    │ │               │ │               │
└───────┬───────┘ └───────────────┘ └───────────────┘
        │
        ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  CATEGORIES   │ │    IMPORTS    │ │      AI       │
│  Category     │ │  ImportJob    │ │  AnalysisHist │
│               │ │  ScheduledExp │ │  CatSuggestion│
│  Self-ref:    │ │  RecurringExp │ │  MerchantPref │
│  parent/child │ │               │ │               │
│               │ │  Depends:     │ │  Depends:     │
│  Depends:     │ │  Core, Fin,   │ │  Core, Cat,   │
│  Core only    │ │  Cat          │ │  Financial    │
└───────────────┘ └───────┬───────┘ └───────────────┘
                          │
                          ▼
                ┌───────────────┐
                │     BOTS      │
                │  Telegram     │
                │  WhatsApp     │
                │               │
                │  Depends:     │
                │  Core, Fin,   │
                │  Cat, Budgets │
                └───────────────┘
```

## Dependency Rules

| Domain | Can depend on | Cannot depend on |
|--------|--------------|------------------|
| Core | (none) | Everything |
| Financial | Core | Budgets, Investments, AI, Bots |
| Categories | Core | Financial, Budgets, AI |
| Budgets | Core, Categories, Financial | Investments, AI, Bots |
| Investments | Core | Everything else |
| Imports | Core, Financial, Categories | Budgets, AI, Bots |
| AI | Core, Categories, Financial | Budgets, Investments, Bots |
| Bots | Core, Financial, Categories, Budgets | Investments, AI |

## Extraction Candidates (ordered by feasibility)

###1. Investments (easiest)
- **Models:** Investment, Setting (2 models)
- **Routers:** investments.py (1 router)
- **Services:** price_refresh.py (1 service)
- **External deps:** Yahoo Finance, IOL, PPI APIs
- **Why easy:** Self-contained, no cross-domain dependencies beyond Core

###2. Telegram Bot
- Already a separate process in production (docker-compose.bots.yml)
- Currently accesses DB directly — needs API wrapper
- **Sub-tasks:** create internal API, migrate bot to use it

###3. AI / Analysis
- **Models:** AnalysisHistory, CategorySuggestion, MerchantPreference
- **Services:** categorization.py (LLM-dependent)
- **External deps:** Google Gemini API
- **Challenge:** LLM calls are slow, need async handling

###4. Imports
- **Models:** ImportJob, ScheduledExpense, RecurringExpense
- **Services:** smart_import_core.py, import_utils.py
- **External deps:** LLM for parsing
- **Challenge:** Heavily coupled to Financial domain (creates Expenses)

###5. Budgets (hardest to extract)
- **Models:** Budget, BudgetGroup, BudgetEvent
- **Challenge:** Tightly coupled to Expenses and Categories
- Real-time budget checking on every expense creation

## Shared Services

These services cross domain boundaries and must be accessible to all:

| Service | Used by | Purpose |
|---------|---------|---------|
| `auth.py` | All routers | JWT validation, user loading |
| `encryption.py` | Financial, AI, Admin, Bots | Field-level AES encryption |
| `notify.py` | Budgets, Imports, Bots | Notification creation + delivery |
| `groups.py` (router helper) | Financial, Budgets, Imports | Group-scoped queries |

## Migration Path

When extracting a domain into a service:

1. **Define API contract** — what endpoints does the service expose?
2. **Create internal API** — endpoints only accessible within the network
3. **Migrate callers** — switch from direct DB access to API calls
4. **Separate DB** — move domain tables to service's own database
5. **Event bus** — replace direct calls with async events where possible

Each step is independently deployable and reversible.