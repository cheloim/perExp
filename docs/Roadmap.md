# Roadmap

## Features

| # | Feature | Status | Effort | PR | Description |
|---|---------|--------|--------|-----|-------------|
| 1 | Click-to-edit cards/accounts | ✅ Done | Low | #37 | Card/account rows clickable to enter edit mode |
| 2 | Expense detail modal | ✅ Done | Low | #38 | Row click opens summary with Cerrar/Editar buttons |
| 3 | Visual notifications | ✅ Done | Low | #41 | Icons, colored borders, progress bars, toast, QUEUED status |
| 4 | Dashboard layout fixes | ✅ Done | Low | #47 | Equal height boxes, category limit, transaction scroll |
| 5 | Installment system fixes | ✅ Done | Medium | #49, #50 | Telegram ScheduledExpenses, projection logic, charts |
| 6 | Monthly analysis resume | ⏳ Backlog | Medium | - | Monthly spending summary report |
| 7 | Weekly Telegram summary | ⏳ Backlog | Medium | - | Weekly digest via bot, adjustable from UserPanel |
| 8 | Income module | ⏳ Backlog | High | - | Track income, dashboard comparison vs last months |
| 9 | Ticket scan | ⏳ Backlog | Medium | - | OCR receipt analysis, compare same items last month |
| 10 | Expense budgets | ⏳ Backlog | Medium | - | Set spending limits per category |
| 11 | Make index.html interactive | ⏳ Backlog | Medium | - | Filter transactions/categories when clicking Deuda Tarjetas or Cuotas este mes |
| 12 | Billing period tracking | ⏳ In Progress | Medium | #36 | closing_day on Card, billing API, billing view toggle in Dashboard |

## Backlog Details

### Monthly Analysis Resume
Generate a monthly summary report with:
- Total income vs expenses
- Savings rate
- Top spending categories
- Month-over-month comparison

### Weekly Telegram Summary
- Send weekly digest every Sunday
- Include: total spent, top categories, budget status
- Configurable day/time from UserPanel settings

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
