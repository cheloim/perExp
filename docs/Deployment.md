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

### Celery Beat Schedule

| Schedule               | Task                          | Description                          |
| ---------------------- | ----------------------------- | ------------------------------------ |
| Daily 2:00 AM UTC      | `execute_due_installments`    | Execute pending scheduled expenses   |
| Daily 3:30 AM UTC      | `cleanup_expired_import_jobs` | Delete import jobs older than 24h    |
| Sunday 23:00 UTC       | `send_weekly_reports`         | Generate weekly spending reports     |
| 1st of month 23:00 UTC | `generate_monthly_reports`    | Generate previous month reports      |

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
