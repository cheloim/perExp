# Roadmap

## Features

| # | Feature | Status | Effort | PR | Description |
|---|---------|--------|--------|-----|-------------|
| 1 | Click-to-edit cards/accounts | ✅ Done | Low | #37 | Card/account rows clickable to enter edit mode |
| 2 | Expense detail modal | ✅ Done | Low | #38 | Row click opens summary with Cerrar/Editar buttons |
| 3 | Visual notifications | ✅ Done | Low | #41 | Icons, colored borders, progress bars, toast, QUEUED status |
| 4 | Dashboard layout fixes | ✅ Done | Low | #47 | Equal height boxes, category limit, transaction scroll |
| 5 | Installment system fixes | ✅ Done | Medium | #49, #50 | Telegram ScheduledExpenses, projection logic, charts |
| 6 | Monthly analysis resume | ✅ Done | Medium | #76 | PNG report (1080px, GNOME HIG + Material Design) with KPIs, charts (categories, trends, polar area), Top 5 expenses, LLM analysis. Auto-generate monthly via Celery Beat |
| 7 | Weekly Telegram report | ✅ Done | Medium | #76 | PNG image report sent via Telegram bot. Includes weekly spent, accumulated monthly, upcoming installments (next week), Top 10 expenses by category, LLM analysis. Scheduled Sundays 20:00 UTC-3. Configurable from UserPanel |
| 8 | Income module | ⏳ Backlog | High | - | Track income, dashboard comparison vs last months |
| 9 | Ticket scan | ⏳ Backlog | Medium | - | OCR receipt analysis, compare same items last month |
| 10 | Expense budgets | ⏳ Backlog | Medium | - | Set spending limits per category |
| 11 | Make index.html interactive | ✅ Done | Medium | #73 | Click KPI cards to filter expenses, uncategorized warnings |
| 12 | Billing period tracking | ⏳ In Progress | Medium | #36 | closing_day on Card, billing API, billing view toggle in Dashboard |
| 13 | Missing categories notification | ✅ Done | Medium | #73 | Real-time notifications for uncategorized expenses on save + login |
| 14 | FCI, Plazos Fijos y Cauciones | ⏳ Backlog | Medium | - | Support for Fondos Comunes de Inversión, Plazos Fijos, and Cauciones in investments module |

## Backlog Details

### Monthly Analysis Resume
Generate a monthly summary report with:
- Total income vs expenses
- Savings rate
- Top spending categories
- Month-over-month comparison

### Weekly Telegram Report
- PNG image report sent via Telegram bot every Sunday at 20:00 UTC-3
- Report content: weekly spent, accumulated monthly, upcoming installments (next week only), Top 10 expenses, category breakdown with bar chart, LLM analysis
- Image caption includes key metrics + LLM tip
- Configurable enable/disable from UserPanel → Telegram Bot section
- Uses Gemini Flash for brief LLM analysis (always active)

### Income Module
- Track salary, investments, other income
- Dashboard: income vs expenses comparison
- Savings rate calculation
- Historical comparison (last 3/6/12 months)

### Ticket Scan
- Upload receipt photo → OCR → extract items + amounts
- Compare same items across months (price tracking)
- Market basket analysis

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
