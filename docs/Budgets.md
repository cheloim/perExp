# Budgets

## Overview

The budget system lets you set monthly spending limits per category, organized into macro groups (50/30/20). It tracks spending against budgets, sends alerts when approaching limits, and supports temporary "event" budgets for vacations or special occasions.

## Key Concepts

### Macro Groups (50/30/20)

Budgets are organized into two macro groups:

- **Necesidades** (60% of income) — Essential: Food, Transport, Health, Housing, Services
- **Gustos** (40% of income) — Discretionary: Entertainment, Clothing, Subscriptions, Dining

> **Note:** The "Ahorro" (Savings) group is planned but not yet enabled. The split will become 50/30/20 when the Income module is ready.

Each category belongs to one group. You can reassign categories to different groups.

### Budget Hierarchy

```
Necesidades (60%)
├── Alimentación (parent)
│   ├── Supermercado — $80,000 budget
│   ├── Delivery — no budget
│   └── Restaurantes — $15,000 budget
├── Transporte (parent)
│   ├── Combustible — $25,000 budget
│   └── Taxi — no budget
└── Hogar (parent)
    ├── Expensas — $120,000 budget
    └── Internet — $8,000 budget
```

Budgets are set **per subcategory** (leaf), not per parent. The parent's budget is the sum of its children's budgets.

### Temporal Events

Temporary budgets for specific time periods (vacations, holidays, trips):

- **Name**: e.g., "Vacaciones Europa"
- **Date range**: start_date — end_date
- **Budget**: total amount for the event
- **Linked expenses**: expenses within the date range can be linked to the event
- **Spent**: auto-calculated from linked expenses

## UI Components

### Budget Page (/budget)

The page shows:

1. **KPI Row** — Presupuestado, Gastado, Quedan (remaining), Sin presupuesto
2. **Donut Circles** — Clickable macro group visualization
3. **Category Groups** — Expandable accordion with per-category bars
4. **Events Section** — Full-width cards for temporal events
5. **Suggestions Banner** — AI-generated budget suggestions

### Donut Circles

Each macro group shows:
- Percentage ring (color-coded)
- Remaining amount
- Assigned / Spent stats

Click a donut to filter categories by that group.

### Category Bars

Each category shows:
- Color dot (category color)
- Gradient bar (green→yellow→orange→red based on % used)
- Remaining amount (or over-budget indicator)
- Status badge: 🟢 Bien / 🟡 Cuidado / 🔴 Alerta

### Event Cards

Each event shows:
- Name, date range
- Stats: total days, days remaining, % used, remaining
- Progress bar
- "Vincular gastos" button to link expenses

Click an event to see linked expenses in a side panel.

## Telegram Bot Integration

When you log an expense via Telegram that falls within an event's date range, the bot asks:

> 📅 ¿Este gasto pertenece a un evento temporal?

- Select an event to link the expense
- Or "No vincular" to save normally

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/budgets` | GET | List budgets |
| `/budgets` | POST | Create budget |
| `/budgets/{id}` | PUT | Update budget |
| `/budgets/{id}` | DELETE | Delete budget |
| `/budgets/summary` | GET | Budget vs actual summary |
| `/budgets/groups` | GET | List macro groups |
| `/budgets/groups/init` | POST | Initialize groups from income |
| `/budgets/groups/{id}` | PUT | Update group |
| `/budgets/events` | GET | List events |
| `/budgets/events` | POST | Create event |
| `/budgets/events/{id}` | PUT | Update event |
| `/budgets/events/{id}` | DELETE | Delete event |
| `/budgets/events/{id}/link-expenses` | POST | Link expenses to event |
| `/budgets/events/{id}/expenses` | GET | Get event expenses |
| `/budgets/config` | GET | Budget config (ahorro_enabled) |
| `/budgets/suggest` | GET | AI budget suggestions |
| `/budgets/auto-assign-groups` | POST | Auto-assign categories to groups |
| `/budgets/category-group/{id}` | PUT | Assign category to group |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BUDGET_AHORRO_ENABLED` | `false` | Enable Ahorro (savings) group |

### Migration

Run `scripts/migrate_add_budgets.py` to create budget tables and migrate data.

Steps:
1. Create `budgets` table
2. Create `budget_groups` table
3. Create `budget_events` table
4. Add `budget_group` column to `categories`
5. Create indexes
6. Auto-assign categories to groups
7. Deactivate Ahorro if disabled
8. Add `budget_event_id` to expenses

## Related Pages

- [Features](Features.md) — Budget feature overview
- [Telegram Bot](Telegram-Bot.md) — Bot event detection
- [API Reference](API-Reference.md) — Full API docs
