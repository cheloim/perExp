# Roadmap

<!-- AUTO-GENERATED START -->

| Feature | Type | Status | Description | PR | Issue |
|---------|------|--------|-------------|----|----|
| accounts | full | ✅ Done | CRUD management for financial accounts (bank accounts, cash, digital wallets). | - | - |
| admin-panel | full | ✅ Done | Administrative panel for platform management including user oversight, | - | - |
| analysis | full | ✅ Done | Enables users to ask natural language questions about their spending patterns. Q... | - | - |
| card-closings | full | ✅ Done | Card billing period management allowing users to define closing and due dates | - | - |
| cards | full | ✅ Done | CRUD management for credit and debit cards. Cards are the primary payment method | - | - |
| categories | full | ✅ Done | Hierarchical category system for organizing expenses. Categories support up to | - | - |
| dashboard | full | ✅ Done | Provides aggregated spending summaries and KPIs on the main dashboard. Displays ... | - | - |
| expenses | full | ✅ Done | Core expense and income tracking. Expenses are the central entity of the system, | - | - |
| groups | full | ✅ Done | Enables users to create and join family groups for shared expense tracking. Grou... | - | - |
| investments | full | ✅ Done | Allows users to track their investment portfolio including stocks, bonds, and ot... | - | - |
| notifications | full | ✅ Done | Provides real-time notifications to users via Server-Sent Events (SSE). Notifica... | - | - |
| recurring-expenses | full | ✅ Done | Auto-detection of recurring expenses by analyzing transaction patterns. | - | - |
| scheduled-expenses | full | ✅ Done | Allows users to define recurring expenses that are automatically created on a sc... | - | - |
| suggestions | full | ✅ Done | Provides AI-powered category suggestions based on expense descriptions. When an ... | - | - |
| whatsapp-bot | full | ⏳ Backlog | WhatsApp bot integration providing the same core features as the Telegram bot: | - | - |

<!-- AUTO-GENERATED END -->

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

### Expense Budgets ✅
- Set monthly budget per category
- Track spending vs budget
- Alerts when approaching/exceeding limit (daily Celery task at 10:00 UTC)
- In-app notifications + Telegram alerts for all users
- 50/30/20 macro groups (Necesidades, Gustos, Ahorro)
- Budget events for temporary budgets (vacations, holidays)
- Dashboard widget showing top categories by percentage
- QuickConfigModal for easy initial setup

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

### Enable MFA for User Accounts ✅
- TOTP-based multi-factor authentication (Google Authenticator, Authy, etc.)
- QR code setup flow in UserPanel settings
- MFA verification step on login
- Enable/disable toggle with TOTP confirmation
- Backend: /mfa/status, /mfa/setup, /mfa/verify, /mfa/disable endpoints

### Integración caja de ahorro ↔ tarjeta débito ✅
- Vincular cuenta de tipo "caja_ahorro" con tarjeta de tipo "debito" (exclusivo)
- Bidireccional: vincular desde la tarjeta (CardsManager) o desde la cuenta (AccountsManager)
- Gastos pagados con tarjeta débito vinculada se reflejan automáticamente en la cuenta
- Una cuenta solo puede estar vinculada a una tarjeta débito
- Dropdown de cuenta vinculada al crear/editar tarjeta débito
- Badge de tarjeta vinculada en cuentas de caja de ahorro
- Filtro de gastos por cuenta vinculada en /expenses

### Auto-categorización de gastos con IA ✅
- Usar LLM (Gemini Flash) para sugerir la categoría correcta al cargar un gasto
- Analizar descripción, monto, merchant y historial de categorías del usuario
- Sugerencia en tiempo real mientras el usuario escribe la descripción
- Aprendizaje del historial: cuanto más gastos categorizados, mejores las sugerencias
- Fallback a categoría por defecto si la IA no tiene confianza suficiente
- Opción de desactivar en UserPanel para usuarios que prefieren categorizar manualmente

### Mensaje completo del bot: transacción + tarjeta + banco ✅
- Cuando el bot recibe una notificación bancaria, envía un único mensaje consolidado
- Incluye: monto, descripción/merchant, fecha, tarjeta + banco, categoría con árbol
- Si la tarjeta no está registrada, muestra la info y pide seleccionar medio de pago
- Flujo de cuotas integrado: para montos > $10.000 en crédito, pregunta "¿Lo pagaste en cuotas?"
- Parseo con LLM (`BANK_NOTIFICATION_PARSE_PROMPT`) para extraer campos relevantes
- Fallback a flujo normal si el parseo falla

### Gestión automática de cuotas desde Telegram ✅
- Pregunta por cuotas por categorías (Viajes, Educación, Indumentaria) O por monto > $10.000 en tarjeta de crédito
- Aplica tanto para el flujo normal como para notificaciones bancarias
- Implementado en `telegram_bot.py` con `_should_ask_installments(category_id, db, amount, card_type)`
- Cuando el usuario confirma cuotas, el monto total se divide por la cantidad de cuotas
- Cada cuota se guarda como un expense con el monto dividido
- Las cuotas futuras (2..N) se crean como ScheduledExpenses automáticamente
- Mensaje de confirmación muestra desglose: `$6.000 → 4× $1.500`
- Mensaje de guardado muestra info de cuotas: `💳 Visa Galicia — 4 cuotas`

### Recurring Expenses Tracking ✅
- Auto-detect recurring expenses from transaction history (2+ occurrences, 10% amount tolerance)
- Unified Programados page showing installments + recurring together
- Pause/resume and delete recurring expenses
- Edit amount and next charge date
- Filter by Cuotas/Recurrentes
- Category breakdown horizontal bar chart
- Trend line on BarChart
- Telegram commands: /suscripciones, /pausar, /cancelar, /ver
- Alerts 3 days before next charge via notifications

### Savings Goals (Phase 1)
- Create goals: name, target amount, target date
- Dashboard card: progress bar, % complete, $remaining
- Multiple concurrent goals tracking
- Goal completion notifications via Telegram
- Monthly insights: "You saved $X towards your goals"
- Integration with budgets: Budget under X to reach goal

### Auto-detect Recurring Expenses (23)
- Celery task runs daily at 03:00 UTC to analyze expense history
- Detect recurring patterns: same merchant_key + similar amount (10% tolerance)
- Minimum 2 occurrences within 90 days to qualify
- Auto-create RecurringExpense entries with:
  - merchant_key, description, amount (average)
  - frequency (monthly default)
  - next_charge_date (estimated from last occurrence)
  - category_id, card_id (from most recent occurrence)
- User can review and adjust auto-detected entries in Programados page

### Bill Reminder Notifications (24)
- Daily Celery task at 09:00 UTC to check upcoming charges
- Query: `WHERE is_active = True AND next_charge_date <= today + alert_days_before`
- Send Telegram notification via `send_message_to_chat()`:
  - "Tu pago de Netflix ($5.000) vence en 3 días"
  - Include merchant, amount, date, card info
- Send in-app notification via Notification model
- Auto-advance next_charge_date after charge is detected:
  - Monthly: +1 month
  - Weekly: +1 week
  - Yearly: +1 year
- User-level preference: enable/disable reminders per recurring expense

### Upcoming Bills Dashboard Card (25)
- Dashboard widget showing next 5 upcoming bills
- Display: merchant name, amount, date, days remaining
- Color-coded urgency:
  - Green: 7+ days
  - Yellow: 3-6 days
  - Red: 0-2 days
- Click to filter expenses by that merchant
- Link to full Programados page

### Field-level Encryption ✅
- Application-level encryption using Fernet (AES-128-CBC) derived from SECRET_KEY
- Encrypted fields: User (full_name, telegram_chat_id, mfa_secret), Card (card_name, bank, holder), Expense (description, notes), Investment (notes), AuditLog (ip_address, user_agent), MonthlyReport (report_data), Account (name)
- HMAC-SHA256 columns for duplicate detection (description_hmac, card_name_hmac, bank_hmac, name_hmac)
- HMAC for Telegram bot lookups (O(1) index seek)
- Search columns removed (description_search, card_name_search, bank_search, holder_search) — no more plaintext exposure
- Application-level filtering for bank, person, card, account filters
- Text search bar removed from frontend
- Automatic migration on startup (idempotent)
- Dry-run migration script (encrypt → verify HMAC → rollback)
- Encryption verification script (verify all fields decrypt)
- CI/CD integration with automatic database rollback if verification fails
- 27 unit tests passing

### Telegram Bot Improvements ✅
- Debit card detection from bank notifications (débito automático, débito en cuenta, extracción cajero)
- Installment parsing from bank notifications ("Cuota 3 de 12" → auto-populate, skip question)
- card_last4 regex extraction from notification text + Pass 0 matching by last 4 digits
- Account name matching from natural language ("transferencia galicia", "mercado pago", "efectivo")
- Account fallback for debit notifications when no card matches
- Cancel button (❌) on all conversation flows (payment, bank, card, account selection)
- Improved /start flow: bot capabilities shown before auth, commands shown after connect
- Enhanced /ayuda with full command list
- Recurring expense auto-linking on expense save

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
