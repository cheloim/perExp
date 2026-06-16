# Credit Card Analyzer - Project Context

## Estructura del Proyecto

```
creditCardAnalyzer/
├── backend/               # FastAPI backend (Python)
│   ├── app/
│   │   ├── models.py          # SQLAlchemy models
│   │   ├── routers/           # API endpoints
│   │   │   ├── cards.py       # Cards CRUD API
│   │   │   ├── accounts.py    # Accounts CRUD API
│   │   │   └── ...
│   │   ├── telegram_bot.py    # Telegram bot integration
│   │   └── ...
│   ├── migrations/         # Alembic DB migrations
│   ├── scripts/           # Migration scripts
│   └── Dockerfile.dev     # Dev container (WITH volume mounts - hot reload)
│
├── frontend/              # React/Vite frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── AccountsManager.tsx  # Account/Card creation form
│   │   │   ├── CardsManager.tsx      # Cards management UI
│   │   │   └── ...
│   │   ├── api/
│   │   │   └── client.ts      # API client functions
│   │   ├── types/
│   │   │   └── index.ts       # TypeScript interfaces
│   │   └── pages/
│   └── Dockerfile.dev     # Dev container (WITH volume mounts)
│
└── podman-compose.dev.yml  # Dev environment orchestration
```

## Dev Environment - Hot Reload

### Volumenes y Hot Changes

| Container | Código | Hot Reload |
|-----------|--------|------------|
| `backend_dev` | **MAPPED** via `./backend/app:/app/app` | ✅ Live reload (uvicorn --reload) |
| `frontend_dev` | **MAPPED** via `./frontend/src:/app/src` | ✅ Live reload |

### Para aplicar cambios en backend_dev:

Los cambios en `./backend/app/` se recargan automáticamente gracias a uvicorn --reload.

Si el container no responde o hay errores, reiniciar:
```bash
podman-compose -f podman-compose.dev.yml restart backend_dev
```

Para rebuild completo (si cambiaron dependencias o archivos no mapeados):
```bash
podman-compose -f podman-compose.dev.yml build backend_dev && podman-compose -f podman-compose.dev.yml up -d backend_dev
```

## Modelo de Datos - Cards

```
Card {
  id: int (PK)
  card_name: str          # Franquicia: "Visa", "Mastercard"
  bank: str               # Banco emisor
  holder: str             # Nombre del titular (primer nombre, para grupo familiar)
  card_type: str          # "credito" | "debito"
  user_id: int (FK)
  created_at: datetime
}
```

**Campos requeridos para crear tarjeta**:
- `card_name` (obligatorio - franquicia)
- `bank` (opcional)
- `card_type` (default: "credito")
- `holder` (auto-populated from user full_name)

## API Endpoints - Cards

```
POST /cards          # Crear tarjeta (CardCreate schema)
GET /cards           # Listar tarjetas del usuario
PUT /cards/{id}      # Actualizar tarjeta
DELETE /cards/{id}   # Eliminar tarjeta
```

## Frontend Components - Cards

### AccountsManager.tsx
Formulario para crear tarjetas desde UserPanel → Accounts:
- Campo "Tipo de cuenta" (dropdown: Efectivo, Banco Digital, Tarjeta)
- Cuando `type === 'tarjeta'` muestra:
  - Tipo de tarjeta (Crédito/Débito)
  - Banco (dropdown)
  - Marca (`card_name`)

### CardsManager.tsx
UI para gestionar tarjetas directamente:
- Lista de tarjetas existentes
- Formulario de creación/edición
- Eliminar tarjeta

## Telegram Bot

El bot corre **dentro** del container `backend_dev` (no hay container separado).

El bot se inicia en `main.py`:
```python
from app.telegram_bot import start_bot
threading.Thread(target=start_bot, args=(token,), daemon=True).start()
```

### Estados del ConversationHandler
- `WAITING_PAYMENT` - Selección de método de pago
- `WAITING_CARD_BANK` - Selección de banco
- `WAITING_CARD_TYPE` - Selección de tarjeta
- `WAITING_CARD_CREATE_*` - Flow de creación de tarjeta
- `WAITING_CONFIRM` - Confirmación del gasto

## Troubleshooting

### Telegram bot no toma cambios
El código de `telegram_bot.py` está mapeado por volumen. Los cambios se recargan automáticamente.
Si el bot no responde, reiniciar el container:
```bash
podman-compose -f podman-compose.dev.yml restart backend_dev
```

### AccountsManager no muestra "Nombre personalizado"
1. Seleccionar "Tarjeta" en el dropdown "Tipo de cuenta"
2. El campo debe aparecer dentro del bloque `{type === 'tarjeta' && (...)}`
3. Hard refresh del navegador

### Campo card_last4 en Expense
El modelo `Expense` NO tiene columna `card_last4`. Si aparece en código de telegram_bot, es error - remover.