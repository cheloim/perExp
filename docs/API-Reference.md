# Referencia de API

> **Este documento ya no mantiene una tabla manual de endpoints.** La versión anterior
> documentaba 90 endpoints, de los cuales **23 no existían** y faltaban 7 routers completos.
> El contrato real está en `specs/openapi.yaml` y se valida en CI.

## Fuentes de verdad

| Recursos | Dónde |
|---|---|
| Contrato curado (entrada de orval) | `docs/specs/openapi.yaml` — 184 paths |
| Contrato inferido por FastAPI | `GET /docs` (Swagger UI) y `GET /openapi.json` |
| Gate de sincronía | `src/backend/tests/test_openapi_contract.py` |

El gate falla si el contrato curado queda atrás de los routers o si un gap documentado se
arregla sin achicar el baseline (`tests/openapi_contract_baseline.yaml`, hoy vacío).

## Prefijos `/v1` y `/api`

La API se publica bajo dos prefijos equivalentes:

| Prefijo | Estado | Para quién |
|---|---|---|
| `/v1/...` | Canónico | Clientes nuevos. Es la versión que va a sobrevivir a cambios incompatibles. |
| `/api/...` | Alias de transición | Web, MiniApp, bots y cualquier cliente ya desplegado. |

Los dos los resuelve nginx (`src/frontend/nginx.conf`), no FastAPI: la location strippea
el prefijo y el backend sigue sirviendo sus routers en `/` (`/v1/expenses` y
`/api/expenses` llegan los dos como `/expenses`). Como es una sola location para ambos,
no pueden divergir. Todavía no hay endpoints exclusivos de `/v1` ni negociación de
versión; eso llega con la política de compatibilidad de #527.

En desarrollo, el proxy de Vite replica el alias (`/api` y `/v1`); el backend directo
(`http://localhost:8001`) sigue sin prefijo, igual que en producción detrás de nginx.

Para clientes nuevos, usá `/v1`. El alias `/api` no se retira sin un período de aviso y
una actualización coordinada de web, bots y MiniApp. El contrato de que ambos prefijos
responden igual está en `tests/test_nginx_api_prefix.py` (corre el nginx real contra un
upstream falso y cubre routing, query string, uploads multipart, SSE sin buffering y el
bloqueo de `/metrics`).

## Mapa de routers

| Router | Prefijo | Endpoints | Responsabilidad |
|---|---|---|---|
| `admin` | `/admin` | 33 | Usuarios, flags, impersonación, health, logs |
| `auth` | `/auth` | 26 | Login, registro, OAuth, Telegram, sesión |
| `investments` | `/investments` | 22 | Portfolio, brokers, precios, asistente |
| `budgets` | `/budgets` | 19 | Presupuestos y grupos 50/30/20 |
| `expenses` | `/expenses` | 18 | CRUD, bulk, stats, export |
| `dashboard` | `/dashboard` | 17 | KPIs, tendencias, categorías, próximos vencimientos |
| `notifications` | `/notifications` | 9 | Bandeja y stream SSE |
| `recurring` | `/recurring` | 8 | Detección y confirmación de recurrentes |
| `admin_categorization` | `/admin/categorization-reviews` | 7 | Revisión de categorización |
| `import_jobs` | `/import-jobs` | 6 | Subida, preview y confirmación |
| `suggestions` | `/suggestions` | 5 | Sugerencias de categoría |
| `groups` | `/groups` | 5 | Grupos familiares e invitaciones |
| `categories` | `/categories` | 5 | Árbol de categorías |
| `cards` | `/cards` | 5 | Tarjetas |
| `tags` | `/tags` | 4 | Etiquetas |
| `scheduled_expenses` | `/scheduled-expenses` | 4 | Gastos programados |
| `mfa` | `/mfa` | 4 | TOTP |
| `analysis` | `/analysis` | 4 | Asistente de gastos (SSE) |
| `accounts` | `/accounts` | 4 | Cuentas |
| `whatsapp_webhook` | `/webhook/whatsapp` | 3 | Webhook de Meta |
| `health` | `/health` | 2 | Liveness |
| `card_closings` | `/card-closings` | 2 | Cierres de tarjeta |
| `capture` | `/capture` | 2 | Transcripción de voz e import por imagen |

**Total: 23 routers, 214 operaciones.** Coincide exactamente con `operationId` en
`specs/openapi.yaml`.

## Autenticación

Todas las rutas salvo `/health`, `/auth/*` y `/webhook/whatsapp` requieren
`Authorization: Bearer <jwt>`. Ver `Authentication.md`.

## Convenciones

- Los prefijos de la tabla son relativos: no incluyen `/v1` ni `/api` (ver arriba).
- Errores: `{"detail": "..."}` con el código HTTP correspondiente.
- Paginación: `limit`/`offset` o `page` según el router (no está unificado; ver #527).
- Fechas: ISO 8601 en UTC.
- Dinero: `amount` numérico + `currency` (`ARS`/`USD`). **No sumar monedas distintas.**

## Cómo cambiar la API

1. Modificá el router.
2. Actualizá `docs/specs/openapi.yaml` (path, params, schemas).
3. Regenerá el cliente:
   ```bash
   cd src/frontend
   npm run generate:api
   npx prettier --write src/types/generated/ src/api/client-generated.ts
   ```
4. Corré el gate:
   ```bash
   cd src/backend
   SECRET_KEY="test-secret-key-that-is-at-least-32-chars-long-for-testing" \
     pytest tests/test_openapi_contract.py -q
   ```

Si el cambio rompe compatibilidad, ver `Migrations.md` y el issue de versionado
[#527](https://github.com/cheloim/perExp/issues/527).
