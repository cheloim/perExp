# Deployment

## Development Setup

### Prerequisites

- Podman (or Docker)
- podman-compose (or docker-compose)
- Git

### Quick Start

```bash
# Clone
git clone https://github.com/cheloim/perExp.git
cd perExp

# Create secrets
cp .env.example .env
# Edit .env with your values

# Start all services
podman-compose up -d

# Access
# Frontend: http://localhost:8082
# Backend:  http://localhost:8001
# API docs: http://localhost:8001/docs
```

### Services

| Service             | Image              | Port      | Memory | Purpose                |
| ------------------- | ------------------ | --------- | ------ | ---------------------- |
| `backend_dev`       | python:3.13-slim   | 8001:8000 | 512MB  | FastAPI + Telegram bot |
| `frontend_dev`      | node:20-alpine     | 8082:5173 | 256MB  | Vite dev server        |
| `celery_worker_dev` | python:3.13-slim   | -         | 512MB  | Background tasks       |
| `db`                | postgres:16-alpine | 5432      | 512MB  | Database               |
| `redis`             | redis:7-alpine     | 6379      | 128MB  | Cache + broker         |

### Hot Reload

Both backend and frontend support hot reload via volume mounts:

```yaml
# Backend: ./backend/app:/app/app
# Frontend: ./frontend/src:/app/src
```

### Useful Commands

```bash
# View logs
podman-compose logs -f backend_dev

# Restart a service
podman-compose restart backend_dev

# Rebuild after dependency changes
podman-compose build backend_dev && podman-compose up -d backend_dev

# Run migrations
podman-compose exec backend_dev alembic upgrade head

# Access database
podman-compose exec db psql -U postgres -d creditcard
```

## Production Setup

### Architecture

```
┌─────────────────────────────────────┐
│           nginx (port 80/443)       │
│  └─ / → frontend (static files)     │
│  └─ /api → backend (port 8001)      │
└─────────────────────────────────────┘
                    │
┌───────────────────┴─────────────────┐
│         Podman Containers           │
│  └─ backend (uvicorn, no --reload)  │
│  └─ frontend (nginx static)         │
│  └─ celery_worker                   │
│  └─ db (PostgreSQL)                 │
│  └─ redis                           │
└─────────────────────────────────────┘
```

### CI/CD Pipeline

Push to `main` branch triggers automatic deployment via GitHub Actions:

1. Build Docker images → push to GHCR
2. SSH into server
3. Pull latest images
4. Run migrations
5. Restart services
6. Verify health

### Operación: housekeeping, logs y backups

La limpieza corre **en el server**, no en CI: tiene que ocurrir aunque los
deploys fallen. `scripts/housekeeping.sh` corre desde un timer diario
(`docker/ops/oikonomia-housekeeping.timer`, 04:00) y además desde el deploy,
**antes** de bajar imágenes nuevas.

| Qué | Política | Dónde |
|-----|----------|-------|
| Imágenes de la app | se conservan el release corriente y el de rollback (`IMAGE_TAG` lo comparten backend/frontend/landing); el resto se borra | `scripts/housekeeping.sh` |
| Imágenes base y volúmenes | `podman image prune -f` + `podman volume prune -f` | `scripts/housekeeping.sh` |
| `journal.log` | rotación diaria, máx. 200MB, 14 rotados comprimidos = 15 días | `docker/ops/logrotate-oikonomia` |
| Journal de systemd | 1GB / 15 días | `docker/ops/journald-oikonomia.conf` |
| Backups de la base | 15 días | `scripts/housekeeping.sh` |
| Disco | el deploy aborta con `::error::` por debajo de 2GB libres y corre housekeeping por debajo de 5GB | `deploy.yml` (preflight) |

### Backups de la base

`backup-db` corre antes del deploy y deja un dump **verificable**:

* Formato custom (`pg_dump -Fc`): comprimido por dentro y legible con
  `pg_restore --list`, que es lo que permite verificarlo. El dump plano de antes
  podía quedar truncado por un disco lleno y seguir pasando el chequeo de
  "no está vacío".
* Verificación obligatoria: `pg_restore --list` sobre el dump. Si no se puede
  leer entero, el job falla y borra el archivo.
* Sólo en cambios que pueden tocar datos (platform o infra). Un cambio de
  landing o de nginx no puede corromper la base, y cada dump es I/O y disco.
* Retención de 15 días, en `scripts/housekeeping.sh`: una sola regla, que
  además corre aunque los deploys fallen.

Pendiente: la copia fuera del server. Hoy los backups viven en el mismo disco
que tienen que proteger.

#### Restaurar un backup

Los dumps son formato custom, no SQL plano: **no** se pueden meter con `psql`.

```bash
# Qué hay, con fecha y tamaño
ls -lh /opt/creditcardanalyzer/backups/db_*

# Qué contiene un dump (también es la verificación que hace el deploy)
podman exec -i <db_container> pg_restore --list < db_20261024_040000.dump | head

# Restaurar en una base nueva para probar
podman exec <db_container> createdb -U expenses_user expenses_restore
podman exec -i <db_container> pg_restore -U expenses_user -d expenses_restore < db_20261024_040000.dump

# Restaurar por encima de la base de producción (¡destructivo!)
podman exec -i <db_container> pg_restore -U expenses_user -d expenses --clean --if-exists < db_20261024_040000.dump
```

Los archivos se llaman `db_<AAAAmmdd_HHMMSS>.dump` y viven en
`/opt/creditcardanalyzer/backups`. Desvío conocido: `.sdd/guides/deployment-checklist.md`
documenta `backup_*.sql.gz` y `psql`, que era el formato viejo.

Además, `housekeeping.sh` avisa por Telegram si `journal.log` supera el tope
(señal de que la rotación no está funcionando) y publica
`oikonomia_housekeeping_last_success_timestamp_seconds` para que la alerta de
staleness detecte una limpieza que dejó de correr.

### Borde: nginx y landing

`docker/nginx/nginx.conf` define tres vhosts sobre el mismo nginx:

| Host | Upstream | Durante un deploy de la plataforma |
|------|----------|-----------------------------------|
| `oikonomia.ar` | `landing:80` | **queda arriba** |
| `platform.oikonomia.ar` | `platform-frontend:80` | muestra la página de mantenimiento |
| `grafana.oikonomia.ar` | `grafana:3000` | queda arriba |

La landing corre en su propio contenedor (`docker-compose.web-landing.yml`) con
la **misma imagen que el frontend**: el SPA ya renderiza el sitio institucional
cuando el hostname es el apex (`App.tsx`), así que no hace falta un build
aparte. `deploy-landing` corre **después** de `deploy-platform` y sólo si quedó
sano: si el deploy falla y hay rollback, la landing se queda con el bundle que
se sabe que anda.

Dos reglas para no perder el borde:

* Los cambios de config se aplican con `nginx -t` + `nginx -s reload`. Recrear
  el contenedor que publica 443 es una ventana de caída para los tres vhosts.
* Grafana se alcanza por nombre de servicio (`grafana:3000`) en la red
  compartida `oikonomia`, y su puerto queda sólo en loopback en el host.

### Grafana: quién entra y por qué

La **autenticación** de Grafana es de Google: no depende de la plataforma.
Antes pasaba por el backend de Oikonomia, así que la plataforma caída dejaba el
tablero inaccesible justamente cuando hacía falta leerlo.

La **autorización** sigue siendo el flag `is_admin` de Oikonomia, pero
*materializado*: `app/services/grafana_sync.py` crea a los admins en Grafana
con rol Admin y borra al resto. Con `allow_sign_up=false`, quien no está
pre-provisionado no puede entrar. La consistencia es eventual a propósito —
reconcilia cuando cambia el flag y cada hora desde celery beat, nunca durante
un login.

Grafana identifica a los usuarios OAuth por `(auth_module, auth_id)`, no por
email, así que un usuario creado por el proveedor viejo (Generic OAuth) o por
el sync no tiene identidad Google y el login devolvía "Sign up is disabled"
aunque existiera y fuera admin. Por eso corre
`GF_AUTH_OAUTH_ALLOW_INSECURE_EMAIL_LOOKUP=true`: el primer login con Google
empata al usuario ya provisionado por email y le pega la identidad. Es
aceptable porque Google es el único IdP y verifica el email — el caso que los
docs de Grafana señalan como razonable — y porque `allow_sign_up` sigue cerrado:
quien no está pre-provisionado no tiene nada con qué empatar.

Queda además una llave de emergencia: el formulario de login local con
`GRAFANA_ADMIN_PASSWORD` (secret de GitHub, **obligatorio**: `validate-config`
aborta si falta, porque una Grafana pública con password por default es peor
que no tener tablero). Es el camino que no depende de nadie más.

> Ojo: Grafana sólo aplica `GF_SECURITY_ADMIN_PASSWORD` la **primera vez** que
> se inicializa el volumen. Un deploy posterior no la cambia. El deploy
> sincroniza el admin con el secret (`/api/user/password`) justamente por eso,
> y si no puede converge dice cómo resetearla a mano.

Requisito manual, una vez: agregar `https://grafana.<dominio>/login/google`
como redirect URI autorizado en Google Cloud Console.

### Alertas

Todo alerta por Telegram, al chat del admin. Las reglas viven en
`docker/grafana/provisioning/alerting/rules.yml` (Grafana-managed) y **no** en
`docker/prometheus/rules.yml`: ahí se evaluaban y quedaban en `firing`, pero sin
Alertmanager ni provisioning en Grafana no notificaban a nadie.

| Alerta | Dispara | Severidad |
|--------|---------|-----------|
| `oikonomia-disk-critical` | disco con menos del 10% libre por 5m | critical |
| `oikonomia-disk-warning` | disco con menos del 20% libre por 10m | warning |
| `oikonomia-disk-filling` | `predict_linear`: se llena en menos de 24h | warning |
| `oikonomia-target-down` | un target de Prometheus caído 5m | critical |
| `oikonomia-cert-expiring` | certificado por vencer en menos de 14 días | warning |
| `oikonomia-housekeeping-stale` | sin limpieza hace más de 2 días | warning |
| `oikonomia-backup-stale` | backup más nuevo con más de 2 días, o ninguno | critical |
| `oikonomia-llm-*` | presupuesto, crédito, errores y métricas del LLM | warning / critical |

Dos piezas sostienen las alertas de staleness: `node-exporter` corre con el
textfile collector (`/var/lib/node_exporter/textfile`) y `scripts/housekeeping.sh`
escribe ahí `oikonomia_housekeeping_last_success_timestamp_seconds` y
`oikonomia_backup_newest_timestamp_seconds` (0 significa que nunca hubo backup,
y dispara igual).

El contact point es de Telegram y **los secretos no se commitean**: `deploy.yml`
reemplaza los placeholders desde `.env`. Si falta `TELEGRAM_ADMIN_CHAT_ID`, el
deploy borra el contact point y avisa — las alertas se siguen evaluando y quedan
visibles en Grafana, pero no notifican.

El provisioning se verificó levantando un Grafana real con los archivos del
repo: 13 reglas cargadas, contact point y política raíz correctos, sin errores.

### Celery Beat Schedule

| Schedule               | Task                          | Description                          |
| ---------------------- | ----------------------------- | ------------------------------------ |
| Daily 2:00 AM UTC      | `execute_due_installments`    | Execute pending scheduled expenses   |
| Daily 3:30 AM UTC      | `cleanup_expired_import_jobs` | Delete import jobs older than 24h    |
| Sunday 23:00 UTC       | `send_weekly_reports`         | Generate weekly spending reports     |
| 1st of month 23:00 UTC | `generate_monthly_reports`    | Generate previous month reports      |
| Hourly                 | `reconcile_grafana_admins`    | Grafana users follow the `is_admin` flag |

### Report Failure Handling

Monthly report generation has built-in resilience:

- **Auto-retry**: `generate_single_report` retries up to 3 times with exponential backoff on transient errors (TimeoutError, OSError, ConnectionError)
- **Failure marking**: Failed reports are marked as `FAILED` in the database with an error message
- **Admin email alerts**: When all retries fail, an email is sent via Resend with error details
- **In-app notifications**: Users receive a `monthly_report_failed` notification

### Investment Price Refresh

APScheduler runs every 15 minutes during BYMA trading hours:

- Days: Monday–Friday
- Hours: 11:00–17:00 (Argentina time)
- Skips Argentine public holidays

## Dockerfiles

### Backend (Multi-stage)

```dockerfile
# Build stage
FROM python:3.13-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Production stage
FROM python:3.13-slim
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Frontend (Multi-stage)

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json .
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```
