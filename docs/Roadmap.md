# Roadmap

<!-- AUTO-GENERATED START -->

| Feature | Type | Status | Description | PR | Issue |
|---------|------|--------|-------------|----|----|
| accounts | full | ✅ Done | CRUD management for financial accounts (bank accounts, cash, digital wallets). | - | - |
| admin-panel | full | ✅ Done | Administrative panel for platform management including user oversight, | - | - |
| analysis | full | ✅ Done | Enables users to ask natural language questions about their spending patterns. Q... | - | - |
| auth | full | ✅ Done | Complete authentication system supporting local credentials, Google/Apple OAuth, | - | - |
| budgets | full | ✅ Done | Monthly budget management with 50/30/20 rule support. Budgets are set per | - | - |
| card-closings | full | ✅ Done | Card billing period management allowing users to define closing and due dates | - | - |
| cards | full | ✅ Done | CRUD management for credit and debit cards. Cards are the primary payment method | - | - |
| categories | full | ✅ Done | Hierarchical category system for organizing expenses. Categories support up to | - | - |
| dashboard | full | ✅ Done | Provides aggregated spending summaries and KPIs on the main dashboard. Displays ... | - | - |
| expenses | full | ✅ Done | Core expense and income tracking. Expenses are the central entity of the system, | - | - |
| groups | full | ✅ Done | Enables users to create and join family groups for shared expense tracking. Grou... | - | - |
| import | full | ✅ Done | Smart file import system supporting PDF bank statements, CSV, and Excel files. | - | - |
| investments | full | ✅ Done | Allows users to track their investment portfolio including stocks, bonds, and ot... | - | - |
| notifications | full | ✅ Done | Provides real-time notifications to users via Server-Sent Events (SSE). Notifica... | - | - |
| recurring-expenses | full | ✅ Done | Auto-detection of recurring expenses by analyzing transaction patterns. | - | - |
| scheduled-expenses | full | ✅ Done | Allows users to define recurring expenses that are automatically created on a sc... | - | - |
| suggestions | full | ✅ Done | Provides AI-powered category suggestions based on expense descriptions. When an ... | - | - |
| telegram-bot | full | ✅ Done | Telegram bot integration for quick expense logging, reporting, and financial | - | - |
| income-tracking | full | ⏳ Backlog | Income tracking feature allowing users to record and categorize income sources | - | - |
| whatsapp-bot | full | ⏳ Backlog | WhatsApp bot integration providing the same core features as the Telegram bot: | - | - |

<!-- AUTO-GENERATED END -->

## Platform Focus

**Target**: Personal Use / Family  
**Model**: Freemium  
**Localization**: Argentina-specific (ARS/USD, AFIP taxes, card types)  
**Architecture**: Web-first with mobile support (responsive, PWA planned)  
**Banking**: Manual import only (no API integration)

---

## Phase 1: Quick Wins (Low Effort, High Value)

### 1️⃣ Recurring Expenses Tracking
- **Effort**: Medium | **Freemium**: Free
- Mark expenses as recurring (subscriptions, gym, insurance, etc.)
- Auto-suggest potential recurring expenses based on merchant + amount matching
- Subscriptions dashboard: list all recurring with next charge date
- Monthly summary card on dashboard
- Telegram bot: Parse recurring from messages ("Netflix $5 every month")
- Ability to pause/cancel recurring
- Alert before next charge (configurable days before)

### 2️⃣ Savings Goals
- **Effort**: Low | **Freemium**: Free
- Create goals: name, target amount, target date
- Dashboard card: progress bar, % complete, $remaining
- Multiple concurrent goals tracking
- Goal completion notifications via Telegram
- Monthly insights: "You saved $X towards your goals"
- Integration with budgets: Budget under X to reach goal

### 3️⃣ Bill Reminders
- **Effort**: Low | **Freemium**: Free
- Link bill amounts to expenses ("Electricity $150 on 15th")
- Dashboard: Upcoming bills card (next 5 bills with dates)
- Telegram reminder: Day before due + configurable early alerts
- Snooze reminder (+1, 3, 7 days)
- Mark bill as paid (auto-creates expense if desired)
- Calendar view of monthly bills
- Estimated total bill spending per month

---

## Phase 2: Medium Effort (Higher Value)

### 4️⃣ Income Tracking
- **Effort**: High | **Freemium**: Basic tracking free, advanced analytics premium
- Income types: Salary, Bonus, Investments, Other
- Recurring income: Set salary with frequency (monthly, bi-weekly)
- Dashboard: Total income vs expenses, savings rate % calculation
- Income trends: Month-over-month, YTD total
- Projected income: Based on recurring sources
- **Freemium Premium**: Family dashboard (combined family income), advanced analytics
- Telegram: Log income ("@bot /income 50000 salary")
- **Argentina-specific**: Track ARS and USD income separately
- Income category hierarchy for analysis

### 5️⃣ Receipt OCR Scanning
- **Effort**: Medium | **Freemium**: Limited scans/month (free), unlimited (premium)
- Upload receipt image → Gemini Vision API extracts items, amounts, store, date
- Create multi-item expense from receipt (each item separately)
- Store receipt metadata for price tracking
- Historical price tracking: "Coca-Cola $180 last month, now $200"
- Item-level analytics: Favorite brands, price trends
- Telegram: Photo upload support ("Send receipt to add items")
- **Argentina-specific**: Extract VAT and tax info when available
- Receipt image storage attached to expenses (audit trail)

### 6️⃣ Data Export & Tax Reports
- **Effort**: Medium | **Freemium**: Basic CSV export free, tax reports premium
- Export formats: CSV, Excel, PDF
- **Tax report**: Group expenses by tax category (business, donations, medical, etc.)
- **Argentina-specific**: Categorize by AFIP requirements for tax filing
- Date range filtering: Export specific periods
- Reconciliation report: Compare with bank/card statements
- Scheduled auto-export: Email monthly reports
- Income/expense summary for tax filing
- Category-based breakdown for deductions
- **Freemium Premium**: Multi-year comparison for tax planning

---

## Phase 3: Out of Scope (Deferred)

The following features are explicitly out of scope for this platform's focus:

- ❌ **Bank API Integration** — Manual import is sufficient; APIs add maintenance burden
- ❌ **Automated Transaction Sync** — No banking integration (manual import only)
- ❌ **Webhook Support** — Not needed without external service integration
- ❌ **IFTTT/Zapier Integration** — Overkill for personal/family use case
- ❌ **Public API** — Freemium model focuses on app, not third-party integrations
- ❌ **End-to-End Encryption** — Freemium tier doesn't justify infrastructure complexity
- ❌ **Gamification** — Streaks, badges, leaderboards out of scope
- ❌ **Expense Splitting** — Manual tracking sufficient; revisit if high-demand
- ❌ **Mobile Native Apps** — Web-first with responsive design; PWA planned later
- ❌ **Predictive ML Models** — Advanced ML reserved for premium tier (future)

---

## Backlog Details

### Monthly Analysis Resume
Generate a monthly summary report with:
- Total income vs expenses
- Savings rate
- Top spending categories
- Month-over-month comparison

### Weekly Telegram Report
- PNG image report sent via Telegram bot every Sunday at 20:00 UTC-3
- Report content: weekly spent, accumulated monthly, upcoming installments (next week only), Top 10 expenses by category, LLM analysis
- Image caption includes key metrics + LLM tip
- Configurable enable/disable from UserPanel → Telegram Bot section
- Uses Gemini Flash for brief LLM analysis (always active)

### Recurring Expenses Tracking (Phase 1)
- Mark expenses as recurring (subscriptions, gym, insurance, etc.)
- Auto-suggest potential recurring expenses based on merchant + amount matching
- Subscriptions dashboard: list all recurring with next charge date
- Monthly summary card on dashboard
- Telegram bot: Parse recurring from messages ("Netflix $5 every month")
- Ability to pause/cancel recurring
- Alert before next charge (configurable days before)

### Savings Goals (Phase 1)
- Create goals: name, target amount, target date
- Dashboard card: progress bar, % complete, $remaining
- Multiple concurrent goals tracking
- Goal completion notifications via Telegram
- Monthly insights: "You saved $X towards your goals"
- Integration with budgets: Budget under X to reach goal

### Bill Reminders (Phase 1)
- Link bill amounts to expenses ("Electricity $150 on 15th")
- Dashboard: Upcoming bills card (next 5 bills with dates)
- Telegram reminder: Day before due + configurable early alerts
- Snooze reminder (+1, 3, 7 days)
- Mark bill as paid (auto-creates expense if desired)
- Calendar view of monthly bills
- Estimated total bill spending per month

### Income Module (Phase 2)
- Track salary, investments, other income
- Dashboard: income vs expenses comparison
- Savings rate calculation
- Historical comparison (last 3/6/12 months)
- **Premium**: Family group income aggregation

### Ticket Scan (Phase 2)
- Upload receipt photo → OCR → extract items + amounts
- Compare same items across months (price tracking)
- Market basket analysis

### Data Export & Tax Reports (Phase 2)
- Export formats: CSV, Excel, PDF
- Tax report: Group expenses by tax category
- **Argentina-specific**: Categorize by AFIP requirements for tax filing
- Date range filtering: Export specific periods
- Reconciliation report: Compare with bank/card statements
- Scheduled auto-export: Email monthly reports
- Income/expense summary for tax filing
- Category-based breakdown for deductions

### Expense Budgets
- Set monthly budget per category
- Track spending vs budget
- Alerts when approaching/exceeding limit
- Flexible (not rigid) budget periods

### Make Index.html Interactive
- Click on "Deuda Tarjetas" card → filter to credit card expenses
- Click on "Cuotas este mes" card → filter to installment expenses
- Make dashboard info boxes clickable and interactive

### Missing Categories Notification
- Alert user when expenses are created without a category
- Notification via Telegram bot or dashboard toast
- Help ensure all expenses are properly categorized for better analysis

### FCI, Plazos Fijos y Cauciones
- **FCI (Fondos Comunes de Inversión)**: Track money market, fixed income, and equity funds
- **Plazos Fijos**: Track fixed-term deposits with maturity dates and rates
- **Cauciones**: Track overnight lending operations
- Integration with existing investment portfolio
- Separate tracking from stocks/ETFs
- Maturity date alerts and reminders

### WhatsApp Bot
- **Effort**: High | **Freemium**: Premium feature
- WhatsApp Business API integration via Meta Cloud API or Twilio
- Same core features as Telegram bot:
  - Natural language expense parsing (LLM-powered)
  - Bank notification detection and parsing
  - Installment handling (auto-detect from notifications)
  - Account and card matching
  - Category auto-categorization
- Authentication flow: link WhatsApp number to Oikonomia account
- Proactive messaging: weekly reports, budget alerts, recurring reminders
- Media support: receipt photo upload → OCR → expense creation
- Group chat support: log expenses from family WhatsApp group
- **Implementation options**:
  - Meta Cloud API (official, requires Business verification)
  - Twilio WhatsApp API (easier setup, per-message cost)
- **Challenges**: Message template approval, 24h session window, phone number verification
