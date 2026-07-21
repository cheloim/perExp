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
| 10 | Expense budgets | 🔨 In Progress | Medium | #83 | Set spending limits per category. 50/30/20 macro groups, daily Celery alerts, in-app + Telegram notifications, Dashboard widget, budget events for vacations |
| 11 | Make index.html interactive | ✅ Done | Medium | #73 | Click KPI cards to filter expenses, uncategorized warnings |
| 12 | Billing period tracking | ❌ Not Done | Medium | #63 | Cancelled: Monthly filtering is sufficient. Billing view adds complexity without enough value for expense analysis and saving plans |
| 13 | Missing categories notification | ✅ Done | Medium | #73 | Real-time notifications for uncategorized expenses on save + login |
| 14 | FCI, Plazos Fijos y Cauciones | ⏳ Backlog | Medium | - | Support for Fondos Comunes de Inversión, Plazos Fijos, and Cauciones in investments module |
| 15 | Enable MFA for user accounts | ✅ Done | Medium | #94 | Multi-factor authentication (TOTP) for enhanced account security. QR code setup in UserPanel, MFA login step, enable/disable flow |
| 16 | Integración caja de ahorro ↔ tarjeta débito | ✅ Done | Medium | #96 | Vincular cuentas de caja de ahorro con tarjetas débito. Bidireccional (desde tarjeta o desde cuenta). Solo caja_ahorro ↔ débito. Gastos con tarjeta vinculada se reflejan automáticamente en la cuenta |
| 17 | Auto-categorización de gastos con IA | ✅ Done | Medium | #99 | Usar LLM para sugerir automáticamente la categoría correcta al cargar un gasto, basándose en la descripción, monto y historial del usuario |
| 18 | Mensaje completo del bot: transacción + tarjeta + banco | ✅ Done | Medium | #128 | Cuando el bot recibe una notificación bancaria, envía un único mensaje consolidado con monto, descripción, fecha, tarjeta + banco y categoría. Incluye detección de cuotas para montos altos en crédito |
| 19 | Google OAuth login | ✅ Done | Medium | #112, #115, #116, #117 | Login con Google OAuth con renderButton (FedCM compatible). MFA respeta configuración del usuario. CSP configurado para Google Identity Services |
| 20 | Gestión automática de cuotas desde Telegram | ✅ Done | Medium | #128 | Cuando se registra un gasto con tarjeta de crédito, preguntar automáticamente si fue en cuotas. El monto total se divide por la cantidad de cuotas. Aplica para montos > $10.000 en crédito o categorías especiales (Viajes, Educación, Indumentaria). Flujo completo: división de monto, mensaje de confirmación con desglose, ScheduledExpenses con monto por cuota |

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

### Expense Budgets 🔨
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
