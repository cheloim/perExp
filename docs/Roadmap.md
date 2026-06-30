# Roadmap

## Features Tracking

| # | Feature | Status | Effort | Description |
|---|---------|--------|--------|-------------|
| 1 | Notifications visual | ✅ Done | Low | Icons, colored borders, progress bars, toast popup |
| 2 | Monthly analysis resume | ⏳ Backlog | Medium | Monthly spending summary report |
| 3 | Weekly Telegram summary | ⏳ Backlog | Medium | Weekly digest via bot, adjustable from UserPanel |
| 4 | Income module | ⏳ Backlog | High | Track income, dashboard comparison vs last months |
| 5 | Ticket scan | ⏳ Backlog | Medium | OCR receipt analysis, compare same items last month |
| 6 | Expense budgets | ⏳ Backlog | Medium | Set spending limits per category |

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

## Completed Features

| # | Feature | PR | Description |
|---|---------|-----|-------------|
| 1 | Click-to-edit cards/accounts | #37 | Card/account rows clickable to enter edit mode |
| 2 | Expense detail modal | #38 | Row click opens summary with Cerrar/Editar buttons |
| 3 | Visual notifications | #41 | Icons, colored borders, progress bars, toast, QUEUED status |
| 4 | Dashboard layout fixes | #47 | Equal height boxes, category limit, transaction scroll |
| 5 | Installment system fixes | #49 | Telegram ScheduledExpenses, projection logic, pattern detection |
| 6 | Future installment display | #50 | Charts show ScheduledExpense amounts directly |
