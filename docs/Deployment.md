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

Changes to `./backend/app/` are auto-reloaded by uvicorn.
Changes to `./frontend/src/` are auto-reloaded by Vite HMR.

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

### Prerequisites

- Linux server (tested on Linode)
- Podman + podman-compose
- Domain with SSL (nginx)
- GitHub account (for CI/CD)

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

### Secrets Management

Production uses Docker secrets (not env vars for sensitive data):

```bash
# Create secrets directory
mkdir -p /opt/creditcardanalyzer/secrets

# Base64-encoded JSON with all secrets
echo $APP_SECRETS_B64 | base64 -d > /opt/creditcardanalyzer/secrets/app-secrets.json
```

The `app-secrets.json` contains:

```json
{
  "SECRET_KEY": "...",
  "LLM_API_KEY": "...",
  "INVESTMENTS_LLM_API_KEY": "...",
  "MESSAGES_BOT_LLM_API_KEY": "...",
  "RESEND_API_KEY": "...",
  "POSTGRES_PASSWORD_PROD": "...",
  "TELEGRAM_BOT_TOKEN_PROD": "...",
  "TELEGRAM_BOT_TOKEN_DEV": "..."
}
```

### CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci.yml`):

1. **Build**: Docker images built and pushed to GHCR
2. **Deploy**: SSH into Linode server
3. **Pull**: Latest images pulled
4. **Migrate**: Alembic migrations run
5. **Restart**: Services restarted

**Required GitHub secrets**:

- `LINODE_SERVER_IP`
- `LINODE_SSH_USER`
- `LINODE_SSH_KEY`
- `APP_SECRETS_B64`

### Celery Beat Schedule

| Schedule      | Task                          | Description                        |
| ------------- | ----------------------------- | ---------------------------------- |
| Daily 2:00 AM | `execute_due_installments`    | Execute pending scheduled expenses |
| Daily 3:30 AM | `cleanup_expired_import_jobs` | Delete import jobs older than 24h  |

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

## Environment Variables

### Backend

| Variable                   | Description                  | Default                     |
| -------------------------- | ---------------------------- | --------------------------- |
| `DATABASE_URL`             | PostgreSQL connection string | -                           |
| `REDIS_URL`                | Redis connection string      | redis://localhost:6379/0    |
| `SECRET_KEY`               | JWT signing key              | -                           |
| `LLM_API_KEY`              | Gemini API key               | -                           |
| `INVESTMENTS_LLM_API_KEY`  | Investment LLM key           | (falls back to LLM_API_KEY) |
| `MESSAGES_BOT_LLM_API_KEY` | Telegram bot LLM key         | -                           |
| `TELEGRAM_BOT_TOKEN_PROD`  | Production bot token         | -                           |
| `TELEGRAM_BOT_TOKEN_DEV`   | Development bot token        | -                           |
| `RESEND_API_KEY`           | Email service key            | -                           |
| `JWT_EXPIRE_DAYS`          | Token expiry                 | 7                           |

### Frontend

| Variable       | Description     | Default               |
| -------------- | --------------- | --------------------- |
| `VITE_API_URL` | Backend API URL | http://localhost:8001 |
