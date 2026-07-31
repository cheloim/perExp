# Roadmap

## Features

| # | Feature | Status | Effort | PR | Deps | Description |
|---|---------|--------|--------|-----|------|-------------|
| 1 | Click-to-edit cards/accounts | ✅ Done | Low | #37 | - | Card/account rows clickable to enter edit mode |
| 2 | Expense detail modal | ✅ Done | Low | #38 | - | Row click opens summary with Cerrar/Editar buttons |
| 3 | Visual notifications | ✅ Done | Low | #41 | - | Icons, colored borders, progress bars, toast, QUEUED status |
| 4 | Dashboard layout fixes | ✅ Done | Low | #47 | - | Equal height boxes, category limit, transaction scroll |
| 5 | Installment system fixes | ✅ Done | Medium | #49, #50 | - | Telegram ScheduledExpenses, projection logic, charts |
| 6 | Monthly analysis resume | ✅ Done | Medium | #76 | - | PNG report (1080px, GNOME HIG + Material Design) with KPIs, charts (categories, trends, polar area), Top 5 expenses, LLM analysis. Auto-generate monthly via Celery Beat |
| 7 | Weekly Telegram report | ✅ Done | Medium | #76 | - | PNG image report sent via Telegram bot. Includes weekly spent, accumulated monthly, upcoming installments (next week), Top 10 expenses by category, LLM analysis. Scheduled Sundays 20:00 UTC-3. Configurable from UserPanel |
| 8 | Income module | ⏳ Backlog | High | - | - | Track income, dashboard comparison vs last months |
| 9 | Ticket scan | ⏳ Backlog | Medium | - | - | OCR receipt analysis, compare same items last month |
| 10 | Expense budgets | ✅ Done | Medium | #130 | - | Set spending limits per category. 50/30/20 macro groups, daily Celery alerts, in-app + Telegram notifications, Dashboard widget, budget events for vacations |
| 11 | Make index.html interactive | ✅ Done | Medium | #73 | - | Click KPI cards to filter expenses, uncategorized warnings |
| 12 | Billing period tracking | ❌ Not Done | Medium | #63 | - | Cancelled: Monthly filtering is sufficient. Billing view adds complexity without enough value for expense analysis and saving plans |
| 13 | Missing categories notification | ✅ Done | Medium | #73 | - | Real-time notifications for uncategorized expenses on save + login |
| 14 | FCI, Plazos Fijos y Cauciones | ⏳ Backlog | Medium | - | - | Support for Fondos Comunes de Inversión, Plazos Fijos, and Cauciones in investments module |
| 15 | Enable MFA for user accounts | ✅ Done | Medium | #94 | - | Multi-factor authentication (TOTP) for enhanced account security. QR code setup in UserPanel, MFA login step, enable/disable flow |
| 16 | Integración caja de ahorro ↔ tarjeta débito | ✅ Done | Medium | #96 | - | Vincular cuentas de caja de ahorro con tarjetas débito. Bidireccional (desde tarjeta o desde cuenta). Solo caja_ahorro ↔ débito. Gastos con tarjeta vinculada se reflejan automáticamente en la cuenta |
| 17 | Auto-categorización de gastos con IA | ✅ Done | Medium | #99 | - | Usar LLM para sugerir automáticamente la categoría correcta al cargar un gasto, basándose en la descripción, monto y historial del usuario |
| 18 | Mensaje completo del bot: transacción + tarjeta + banco | ✅ Done | Medium | #128 | - | Cuando el bot recibe una notificación bancaria, envía un único mensaje consolidado con monto, descripción, fecha, tarjeta + banco y categoría. Incluye detección de cuotas para montos altos en crédito |
| 19 | Google OAuth login | ✅ Done | Medium | #112, #115, #116, #117 | - | Login con Google OAuth con renderButton (FedCM compatible). MFA respeta configuración del usuario. CSP configurado para Google Identity Services |
| 20 | Gestión automática de cuotas desde Telegram | ✅ Done | Medium | #128 | - | Cuando se registra un gasto con tarjeta de crédito, preguntar automáticamente si fue en cuotas. El monto total se divide por la cantidad de cuotas. Aplica para montos > $10.000 en crédito o categorías especiales (Viajes, Educación, Indumentaria). Flujo completo: división de monto, mensaje de confirmación con desglose, ScheduledExpenses con monto por cuota |
| 21 | Recurring expenses tracking | ✅ Done | Medium | #135, #145 | - | Auto-detect subscriptions, unified Programados page with installments + recurring, pause/edit/delete, Telegram commands (/suscripciones, /pausar, /cancelar) |
| 22 | Savings goals | ⏳ Backlog | Low | - | #8 | Create, track, and visualize savings targets with progress indicators |
| 23 | Auto-detect recurring expenses | ⏳ Backlog | Medium | - | #21 | Celery task to analyze expense history and detect recurring patterns (2+ occurrences, 10% tolerance). Auto-create RecurringExpense entries |
| 24 | Bill reminder notifications | ⏳ Backlog | Medium | - | #23 | Daily Celery task to check upcoming charges. Send Telegram alerts and in-app notifications. Auto-advance next_charge_date |
| 25 | Upcoming bills dashboard card | ⏳ Backlog | Low | - | #24 | Dashboard widget showing next 5 upcoming bills with merchant, amount, date, and days remaining |
| 26 | Field-level encryption | ✅ Done | High | #141, #149 | - | Encrypt sensitive user data (PII, financial) at rest using Fernet (AES-128-CBC). Protects against database breaches. Includes HMAC for duplicate detection, Account.name encryption, dry-run migration, verification scripts, CI/CD integration with automatic rollback. Search columns removed, replaced with application-level filtering |
| 27 | Email validation | ✅ Done | Low | #134 | - | Validate email format and domain existence. Block fake domains (test.com, mailinator.com, etc.). DNS MX record validation. Frontend + backend validation |
| 28 | Merchant preference learning | ✅ Done | Medium | #137 | - | Track user category preferences per merchant. Prioritize user preferences over LLM suggestions. Include user history in LLM prompt |

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
