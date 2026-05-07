# Migración: Separación de Tarjetas y Cuentas

## Resumen

Este cambio separa **tarjetas** y **cuentas** como entidades formales en la base de datos, reemplazando los campos de texto libre (`card`, `bank`) con referencias estructuradas.

## Cambios en la Base de Datos

### Nuevas Tablas

#### `accounts` (Cuentas)
- `id`: Primary key
- `name`: Nombre de la cuenta (ej: "Efectivo", "MercadoPago", "Cuenta Galicia")
- `type`: Tipo (efectivo, cuenta_corriente, caja_ahorro, mercadopago, otro)
- `user_id`: Foreign key a `users`
- `created_at`: Timestamp

#### `cards` (Tarjetas)
- `id`: Primary key
- `name`: Nombre de la tarjeta (ej: "Visa", "Mastercard")
- `bank`: Banco emisor
- `last4_digits`: Últimos 4 dígitos (opcional)
- `card_type`: Tipo (credito, debito)
- `user_id`: Foreign key a `users`
- `created_at`: Timestamp

### Tabla `expenses` Modificada
Nuevas columnas:
- `account_id`: Foreign key a `accounts` (nullable)
- `card_id`: Foreign key a `cards` (nullable)

**Campos legacy mantenidos por compatibilidad:**
- `card`, `bank`, `person`, `notes`, `card_last4`

## Backend

### Nuevos Endpoints

#### Cuentas
- `GET /accounts` - Listar cuentas del usuario
- `POST /accounts` - Crear cuenta
- `PUT /accounts/{id}` - Actualizar cuenta
- `DELETE /accounts/{id}` - Eliminar cuenta (falla si tiene gastos)

#### Tarjetas
- `GET /cards` - Listar tarjetas del usuario
- `POST /cards` - Crear tarjeta
- `PUT /cards/{id}` - Actualizar tarjeta
- `DELETE /cards/{id}` - Eliminar tarjeta (falla si tiene gastos)

### Validación en POST /expenses

Cuando se crea un gasto en efectivo/transferencia (campo legacy `card` contiene "efectivo" o "transferencia") **sin** `account_id`, el endpoint retorna error 400:

```json
{
  "error": "account_required",
  "message": "Para gastos en efectivo o transferencia, debes seleccionar o crear una cuenta."
}
```

## Bot de Telegram

### Nuevo Flujo para Efectivo/Transferencia

1. Usuario envía gasto (ej: "farmacity 3200")
2. Bot parsea y pregunta: "¿Cómo pagaste?" → Efectivo/Transferencia / Tarjeta
3. Si elige **Efectivo/Transferencia**:
   - Muestra lista de cuentas existentes
   - Si no hay cuentas → Pide crear una (nombre + tipo)
   - Guarda el gasto con `account_id`

4. Si elige **Tarjeta**:
   - Flujo actual (banco → tarjeta)
   - Guarda con `card_id` (por ahora solo campos legacy, migración futura)

## Frontend

### Gestión de Cuentas y Tarjetas

Nuevo en el **Panel de Usuario** (accesible desde el avatar):

- Tab **Cuentas**: CRUD de cuentas
- Tab **Tarjetas**: CRUD de tarjetas

Ambos componentes están en:
- `frontend/src/components/AccountsManager.tsx`
- `frontend/src/components/CardsManager.tsx`

### Tipos TypeScript Actualizados

```typescript
interface Account {
  id: number
  name: string
  type: string
  user_id: number
  created_at: string
}

interface Card {
  id: number
  name: string
  bank: string
  last4_digits: string | null
  card_type: string
  user_id: number
  created_at: string
}

interface Expense {
  // ... campos existentes ...
  account_id?: number | null
  card_id?: number | null
  account_rel?: Account | null
  card_rel?: Card | null
}
```

## Migración de Datos Existentes

### Script de Migración Automática

```bash
# Ver qué haría (dry-run)
python backend/scripts/migrate_to_accounts_cards.py --dry-run

# Ejecutar migración
python backend/scripts/migrate_to_accounts_cards.py
```

El script:
1. Crea una cuenta "Efectivo" para cada usuario que tenga gastos en efectivo/transferencia
2. Asigna todos los gastos en efectivo/transferencia a esa cuenta
3. Crea registros en `cards` para cada combinación única de (card, bank) por usuario
4. Asigna los gastos correspondientes a cada tarjeta

### Migración Manual

Alternativamente, los usuarios pueden:
1. Crear cuentas manualmente desde el panel
2. Crear tarjetas manualmente
3. Los gastos futuros usarán las nuevas entidades
4. Los gastos viejos seguirán mostrando los campos legacy

## Compatibilidad

- Los campos legacy (`card`, `bank`) se mantienen para **no romper** imports existentes, análisis históricos, y código legacy
- Los nuevos gastos pueden usar `account_id` o `card_id` O los campos legacy
- El frontend muestra `account_rel.name` / `card_rel.name` si existen, sino fallback a `card` / `bank`

## Próximos Pasos (Opcional)

1. Migrar el flujo de tarjetas del bot para guardar `card_id` en vez de solo strings
2. Modificar el formulario de creación de gastos en la web para usar dropdowns de cuentas/tarjetas
3. Agregar saldo/balance calculado en cuentas
4. Dashboard de gastos por cuenta/tarjeta
5. Deprecar y ocultar campos legacy una vez migrados todos los datos
