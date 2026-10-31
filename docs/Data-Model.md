# Modelo de datos

> Reescrito el 2026-10-30 contra `src/backend/app/models/`. La versión anterior mostraba 10
> entidades; el esquema real tiene **28 tablas**.

## Cómo leer este documento

Las columnas exactas viven en el código (`app/models/*.py`). Acá se documentan las
relaciones, las decisiones y las invariantes que no se ven en una tabla.

## Núcleo de usuario y grupo

```
User 1───N GroupMember N───1 Group
  │
  ├──N Expense
  ├──N Account 1───N Card 1───N CardClosing
  ├──N Category (auto-referenciada: padre/hijo)
  ├──N Tag N───N Expense (ExpenseTag)
  ├──N Budget 1───N BudgetGroup
  ├──N RecurringExpense
  ├──N ScheduledExpense
  ├──N Investment
  └──N Notification
```

| Tabla | Notas |
|---|---|
| `users` | `is_admin`, `mfa_enabled`, `email_verified`, `force_password_change`, tokens de Google y WhatsApp |
| `groups`, `group_members` | Membresía con `role` y estado `accepted`/`pending`. Los queries de grupo deben filtrar `accepted`. |
| `accounts`, `cards`, `card_closings` | Una cuenta agrupa tarjetas. El cierre define período de facturación y vencimiento. |
| `categories` | Jerárquica (auto-FK), con `budget_group` (`necesidades`/`gustos`/`ahorro`) para 50/30/20. |
| `expenses` | Entidad central. `is_income` distingue ingreso; `amount` es `Float`. |

## Gastos, cuotas y recurrencia

| Tabla | Rol |
|---|---|
| `expenses` | Gasto o ingreso. Campos cifrados: `description`. `description_hmac` para igualdad exacta. |
| `expense_tags` | N:M entre gasto y tag. |
| `recurring_expenses` | Detecta patrones (comercio + monto) y propone confirmar/pausar. |
| `scheduled_expenses` | Define un gasto futuro recurrente que se materializa por tarea. |

**Invariantes:**

- `is_income` se deriva de la categoría (`is_income_category()`), no se elige a mano.
- Un gasto pertenece a un usuario; el acceso familiar se resuelve consultando el grupo, no
  duplicando la fila.
- `amount` es `Float`, lo que impide comparar por igualdad exacta con seguridad. Migrar a
  `Numeric(12,2)` está trackeado en [#200](https://github.com/cheloim/perExp/issues/200).

## Presupuesto

```
Budget 1───N BudgetGroup 1───N (límites por categoría)
   │
   └──N BudgetEvent   (histórico de cambios)
```

- Un `Budget` es mensual y pertenece a un usuario.
- `BudgetGroup` representa necesidades/gustos/ahorro.
- `BudgetEvent` guarda el histórico para auditoría y para explicar cambios.
- El modelo 50/30/20 se calcula sobre ingresos declarados, no sobre el total gastado.

## Importaciones

```
ImportJob 1───N Expense (creados al confirmar)
```

- `raw_text` está cifrado (hasta 10 MB por fila).
- Estados: `PENDING` → `PROCESSING` → `PREVIEW` → `CONFIRMED` / `FAILED`.
- La confirmación no es idempotente todavía ([#522](https://github.com/cheloim/perExp/issues/522)).

## Inversiones

`investments` guarda posiciones manuales (ticker, cantidad, precio, moneda) y saldos de
efectivo. Los precios se refrescan por tarea (`services/price_refresh.py`), no en el request.

## IA y categorización

| Tabla | Rol |
|---|---|
| `analysis_history` | Historial de consultas al asistente |
| `category_suggestions` | Sugerencias de categoría por descripción |
| `merchant_preferences` | Preferencia aprendida por comercio |
| `categorization_reviews` | Detección de gastos mal categorizados (admin) |

## Administración y auditoría

| Tabla | Rol |
|---|---|
| `audit_logs` | Login, MFA y acciones admin |
| `platform_logs` | Logs de aplicación consultables desde el panel |
| `impersonation_sessions`, `impersonation_messages` | Suplantación con historial |
| `settings` | Configuración global clave/valor |
| `monthly_reports` | Reportes generados, payload cifrado |
| `notifications` | Bandeja por usuario |

## Convenciones de esquema

1. **Toda tabla de dominio tiene `user_id`** con índice, salvo catálogos globales.
2. **Los borrados en cascada se declaran explícitamente**; no se confía en el default.
3. **Los campos con PII usan `EncryptedType`** y, si se buscan, un `*_hmac` acompañante.
4. **Los índices se nombran `ix_<tabla>_<columna>`** y se agregan en la migración, no al
   arrancar.
5. **Los montos deberían ser `Numeric(12,2)`.** Hoy `Float` es deuda conocida.

## Verificar el esquema real

```bash
cd src/backend
python -c "
from app.models import Base
for t in sorted(Base.metadata.tables):
    print(t)
"
```
