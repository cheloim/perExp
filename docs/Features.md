# Features

## Core Features

### Smart Import

Upload bank/credit card statements (PDF, CSV, XLSX) and let AI parse them automatically. The system extracts transactions, detects installments, identifies cardholders, and auto-categorizes expenses.

- **PDF parsing**: pdfplumber extracts text → Gemini LLM parses transactions
- **CSV/XLSX parsing**: Also uses LLM for unified approach
- **Installment expansion**: "C.03/12" creates 12 future scheduled expenses
- **Duplicate detection**: Two-layer protection (during processing + at confirm time)
- **Card mapping**: Detects multiple cards in a single statement, maps to existing or new cards

See [Smart Import](Smart-Import.md) for details.

### Expense Management

Full CRUD for expenses with comprehensive filtering:

- Filter by: date range, category, bank, person, card, account, text search
- Bulk operations: bulk category update, bulk delete
- Click-to-view detail modal with edit capability
- Notes field for additional context
- Currency support: ARS and USD

### Card & Account Management

- **Cards**: Visa, Mastercard, etc. with bank, holder (for family groups), type (credit/debit)
- **Accounts**: Cash, bank accounts (caja de ahorro, cuenta corriente), digital wallets (MercadoPago)
- Click-to-edit from UserPanel → Accounts tab
- Create cards/accounts from Telegram bot

### Dashboard

Comprehensive financial summary:

- Total expenses by period
- Category breakdown with treemap visualization
- Transaction list with days filter (3d/5d/7d/10d)
- By-currency breakdown
- By-card spending analysis
- Top merchants
- AI-powered trend analysis with projections

### Auto-Categorization

Keyword-based matching against a hierarchical category tree:

- Parent-child relationships (up to 3 levels)
- Custom keywords per category
- Category colors for visualization
- User-specific or global categories
- Create categories on-the-fly from expense creation modal

### Installment Tracking

Automatic handling of installment purchases:

- Detects installment patterns (e.g., "C.03/12")
- Creates `ScheduledExpense` records for future months
- Daily auto-execution via Celery Beat (2:00 AM)
- Installments page shows all groups, remaining amounts, next dates
- Cancel individual installments or entire groups

### Card Closing Dates

Track credit card billing cycles:

- Closing date and due date per card
- Next closing date auto-calculated
- Visual indicators on dashboard

## AI Features

### Financial Analysis Chat

Chat with AI about your expenses:

- Natural language queries in Spanish
- Month-specific or all-time analysis
- Streaming responses via SSE
- Analysis history saved for reference
- Powered by Gemini Flash

### AI Trends

Structured financial analysis:

- Trend direction (increasing/decreasing/stable)
- 3-month projections
- Alerts for unusual spending
- Personalized recommendations

### Investment Assistant

Separate AI chat for investment queries:

- Portfolio analysis
- Market insights
- SSE streaming responses
- Uses dedicated LLM API key

See [AI Integration](AI-Integration.md) for details.

## Telegram Bot

Log expenses via natural language:

- "gasté 1500 en farmacity" → parsed automatically
- Select payment method (card/account)
- Installment detection for eligible categories
- Create cards/accounts on-the-fly
- @NikoFin_bot

See [Telegram Bot](Telegram-Bot.md) for details.

## Investment Tracking

Manual and automated investment monitoring:

- CRUD for investments (ticker, type, broker, quantity, cost)
- **IOL sync**: OAuth2 → portfolio from bCBA, nYSE, cFondos
- **PPI sync**: API Key → balance and positions
- Yahoo Finance price lookups
- USD/ARS rate calculation (BNA, ADR-implied)
- Auto-refresh every 15 min during trading hours

See [Investments](Investments.md) for details.

## Family Groups

Share finances with household members:

- Create group, generate invite code
- Invite via 8-character code
- Accept/reject via notification panel
- Shared expenses, cards, investments
- Max 5 members per group
- Holder field on cards for per-person tracking

See [Family Groups](Family-Groups.md) for details.

## Notifications

Real-time notification system:

- SSE streaming (SharedWorker for cross-tab)
- Import status (processing → ready/failed)
- Group invitations
- Toast popups for import completion
- Visual cards with icons and colored borders
- Mark all as read, bulk delete

## Authentication

Multiple login methods:

- Email + password (JWT, 7-day expiry)
- Google OAuth (id_token or authorization code)
- Apple Sign-In (JWT RS256 verification)
- Password reset via email (Resend API)
- Telegram bot key authentication

See [Authentication](Authentication.md) for details.

## UI/UX

- GNOME HIG-inspired design (Adwaita patterns)
- Light/dark mode via CSS variables
- Responsive layout (mobile-friendly)
- Bottom navigation on mobile
- Skeleton loading states
- Modal-based interactions
- Keyboard navigation support
