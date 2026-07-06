# Bugs

## Todo


## Fixed

1. ~~el boton de eliminar todas las notificaciones no hace nada.~~ → Added `refresh()` call after `deleteAllRead` to force SSE re-sync
2. ~~Cuando agregas una subcategoría deberia seleccionarte la categoria padre desde la que fue seleccionado~~ → Fixed `initial={editing.cat || undefined}` (was `editing.cat?.id` which is falsy for new subcategories)
3. ~~En /main el graph de gastos por categoria puede crecer infinito~~ → Limited to top 7 categories + "Otros" grouping
4. ~~Cuando abris un expense debería abrir un modal~~ → Added row-level click handler to open edit modal
5. ~~Cuando creas tarjeta desde UserPanel, no debería decir Nombre sino Tarjeta~~ → Changed label to "Tarjeta" in AccountsManager, CardsManager, CardAccountModal
6. ~~El boton de crear tarjeta desde Tarjetas de credito en /index te lleva a /accounts pero no te abre un modal para cargar~~ → Added "Crear tarjeta o cuenta" button to AccountsPage that opens CardAccountModal
7. ~~En /expenses los gastos en USD aparecen como $~~ → Prefix USD with "USD " in formatCurrency (e.g., "USD $1,234.56")
8. ~~No está estimando correctamente la "Deuda Tarjeta" — muestra en 0 cuando hay installments configurados~~ → Removed scheduled_date >= today filter, now includes ALL pending installments
9. ~~Filtro by card/account en /expenses no funciona. No filtra.~~ → Fixed currentCuenta to use IDs instead of names, reconstruct Select value from URL params
10. ~~Cuando cargas un gasto en Efectivo/Transferencia pero no tenes una cuenta que corresponda, debería abrirte el warning para crear un account~~ → Added warning when payMethod is 'cash' and no accounts exist, with 'Crear cuenta' button
11. ~~Cuando estas seleccionando una categoría desde el modal de Create Expenses, debería permitir crear una categoría si no está la que buscamos~~ → Added createCategory API call in category onChange handler
12. ~~Unable to add Main Categories.~~ → Fixed `parentCats` filter to show all root categories (removed `childParentIds.has(c.id)` requirement)
13. ~~Unable to add expense from Telegram in caja_ahorro account.~~ → Added `_escape_md()` helper to escape Markdown special characters in LLM-generated descriptions
14. ~~Unable to create expenses from Telegram Bot (Issue #42)~~ → Fixed start() duplicate message, _get_accounts() detached objects, unescaped Markdown in account creation flow
15. ~~Account created from Telegram Bot no refresh (Issue #43)~~ → Same root causes as #42: conversation state corrupted by duplicate messages and Markdown parse errors

# Features

## Backlog:
- ~~Add notifications more visual. Use the same as Import-job started for finish. Effort Low~~ → Visual notification cards with icons, colored borders, progress bars, toast popup
- Monthly analysis resume - Effort medium
- Add Weekly and Resume by telegram bot, Adjustable from UserPanel. Effort medium
- Create Income module and integrate with dashboards. Effort High.
    - Dashboard comparison saving from last months.
- Create ticket scan feature to analyze market buys. Effort Medium.
    - Allow comparison same items last month.
 - Allow creation of budgets for expenses.
- Enable MFA for user accounts. Effort Medium.

## Done
1. ~~Allow edit card/account by clicking in that account in UserPanel --> Accounts~~ → Made card/account rows clickable to enter edit mode; ··· menu now only shows Delete option
2. ~~Click on expense row in /expenses opens summary modal~~ → New ExpenseDetailModal showing category, account, date, description, amount, notes with Cerrar/Editar buttons
3. ~~Notifications more visual with icons, progress bars, toast popup~~ → Visual notification cards with colored borders, status icons (upload/queued/processing/success/failed), determinate upload progress bar, toast on notification arrival, QUEUED status for jobs waiting on Redis lock
