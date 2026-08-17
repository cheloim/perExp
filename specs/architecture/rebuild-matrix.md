# Rebuild Matrix

## Decision Table

| Change Type                           | Action              | Services Affected                           |
|---------------------------------------|---------------------|---------------------------------------------|
| Python code in `backend/app/`         | Auto-reload (none)  | `backend_dev`                               |
| `backend/main.py`                     | Auto-reload (none)  | `backend_dev`                               |
| `backend/scripts/`                    | Auto-reload (none)  | `backend_dev`                               |
| `backend/requirements.txt`            | **Rebuild**         | `backend_dev`, `celery_worker_dev`, `celery_beat_dev` |
| `backend/Dockerfile.dev`              | **Rebuild**         | `backend_dev`, `celery_worker_dev`, `celery_beat_dev` |
| `backend/docker-entrypoint.sh`        | **Rebuild**         | `backend_dev`, `celery_worker_dev`, `celery_beat_dev` |
| React code in `frontend/src/`         | Auto-reload (none)  | `frontend_dev`                              |
| `frontend/index.html`                 | Auto-reload (none)  | `frontend_dev`                              |
| `frontend/package.json`               | **Rebuild**         | `frontend_dev`                              |
| `frontend/vite.config.ts`             | **Rebuild**         | `frontend_dev`                              |
| `frontend/tsconfig.json`              | **Rebuild**         | `frontend_dev`                              |
| `frontend/tsconfig.node.json`         | **Rebuild**         | `frontend_dev`                              |
| `frontend/tsconfig.workers.json`      | **Rebuild**         | `frontend_dev`                              |
| `frontend/tailwind.config.js`         | **Rebuild**         | `frontend_dev`                              |
| `frontend/postcss.config.js`          | **Rebuild**         | `frontend_dev`                              |
| `frontend/docker-entrypoint.sh`       | **Rebuild**         | `frontend_dev`                              |
| Environment variables                 | **Restart**         | Changed service only                        |
| Secrets (external secrets)            | **Restart**         | Services that mount the secret              |
| Container unresponsive                | **Restart**         | Unresponsive service                        |
| Alembic migration files               | **Restart**         | `backend_dev` (runs on entrypoint)          |
| `podman-compose.yml` structure        | **Recreate**        | `podman-compose down && up -d`              |

## Hot Reload Paths (Volume Mounts)

These paths are bind-mounted into containers. Changes are reflected immediately without rebuild.

### backend_dev

```yaml
volumes:
  - ./backend/app:/app/app:z          # All Python code in app/
  - ./backend/main.py:/app/main.py:z  # FastAPI app + bot startup
  - ./backend/scripts:/app/scripts:z  # Migration/utility scripts
```

- uvicorn runs with `--reload` — file changes trigger automatic restart
- Telegram bot code in `app/telegram_bot.py` is included in the watched path
- Alembic migrations in `app/` are also mounted

### frontend_dev

```yaml
volumes:
  - ./frontend/src:/app/src:Z          # All React source code
  - ./frontend/index.html:/app/index.html:Z  # HTML entry point
```

- Vite dev server provides HMR (Hot Module Replacement)
- CSS changes apply instantly without page refresh
- Component changes trigger fast refresh

### celery_worker_dev / celery_beat_dev

```yaml
volumes:
  - ./backend/app:/app/app:z
  - ./backend/main.py:/app/main.py:z
```

Same mount paths as `backend_dev`. Celery does NOT auto-reload — changes require restart.

## Rebuild Triggers

These files are `COPY`-ed into the image at build time. Changing them requires a rebuild.

### Backend (`backend/Dockerfile.dev`)

```dockerfile
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install chromium
COPY docker-entrypoint.sh .
```

| File                       | Why rebuild                                    |
|----------------------------|------------------------------------------------|
| `requirements.txt`         | New/updated Python packages                    |
| `Dockerfile.dev`           | Base image or build steps changed              |
| `docker-entrypoint.sh`     | Startup logic (migrations, admin seed) changed |

### Frontend (`frontend/Dockerfile.dev`)

```dockerfile
COPY package*.json ./
RUN npm ci
COPY vite.config.ts tsconfig.json tsconfig.node.json tsconfig.workers.json tailwind.config.js postcss.config.js ./
COPY docker-entrypoint.sh .
```

| File                       | Why rebuild                                    |
|----------------------------|------------------------------------------------|
| `package.json` / `package-lock.json` | New/updated npm packages            |
| `vite.config.ts`           | Build/dev server config changed                |
| `tsconfig.json`            | TypeScript config changed                      |
| `tsconfig.node.json`       | TypeScript node config changed                 |
| `tsconfig.workers.json`    | TypeScript workers config changed              |
| `tailwind.config.js`       | Tailwind theme/plugins changed                 |
| `postcss.config.js`        | PostCSS plugins changed                        |
| `docker-entrypoint.sh`     | Startup command changed                        |

## Restart Triggers

These don't require a rebuild, just a container restart.

| Trigger                          | Command                                    |
|----------------------------------|--------------------------------------------|
| Environment variable changed     | `podman-compose restart <service>`         |
| Secret value rotated             | `podman-compose restart <service>`         |
| Container unresponsive / hung    | `podman-compose restart <service>`         |
| Database connection lost         | `podman-compose restart backend_dev`       |
| Redis connection lost            | `podman-compose restart backend_dev`       |
| Telegram bot not responding      | `podman-compose restart backend_dev`       |
| New Alembic migration added      | `podman-compose restart backend_dev`       |

## Commands

### Restart (no rebuild)

```bash
# Single service
podman-compose restart backend_dev

# All services
podman-compose restart
```

### Rebuild + Restart

```bash
# Rebuild single service and start it
podman-compose build backend_dev && podman-compose up -d backend_dev

# Rebuild all services
podman-compose build && podman-compose up -d
```

### Full Recreate (compose file changed)

```bash
podman-compose down && podman-compose up -d
```

### Force Rebuild (no cache)

```bash
podman-compose build --no-cache backend_dev && podman-compose up -d backend_dev
```

## Services Overview

| Service              | Container        | Port Mapping   | Auto-reload |
|----------------------|------------------|----------------|-------------|
| PostgreSQL 16        | `db`             | 5432:5432      | N/A         |
| Redis 7              | `redis`          | (internal)     | N/A         |
| FastAPI + Bot        | `backend_dev`    | 8001:8000      | Yes (uvicorn) |
| Vite React           | `frontend_dev`   | 8082:5173      | Yes (HMR)   |
| Celery Worker        | `celery_worker_dev` | (internal)  | **No**      |
| Celery Beat          | `celery_beat_dev`   | (internal)  | **No**      |

### When Celery needs restart

Celery workers do NOT watch for file changes. After modifying any code in `backend/app/` that Celery tasks import:

```bash
podman-compose restart celery_worker_dev celery_beat_dev
```
