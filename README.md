# NikoFin

Personal finance management with intelligent bank statement import.

> **[Technical Documentation](docs/Home.md)** — Architecture, API reference, data model, and more.

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI + SQLAlchemy 2 + Pydantic v2 + PostgreSQL |
| Frontend | React 18 + TypeScript + Vite + TanStack Query v5 + React Router DOM v7 |
| Charts | Recharts |
| LLM | Google Gemini Flash |
| PDF parsing | pdfplumber |
| Task queue | Celery + Redis |
| Telegram | python-telegram-bot |

## Features

- **Smart Import**: PDF (LLM-powered) and CSV/XLSX (deterministic) bank statement import
- **Card Management**: Credit/debit card CRUD
- **Account Management**: Cash and bank accounts for tracking transfers
- **Payment Methods**: Select account (cash/transfer) or card per expense
- **Auto-categorization**: By keywords and transaction type
- **Installments**: Track installment purchases with automatic expansion
- **Investments**: Sync with IOL and Portfolio Personal
- **AI Analysis**: Chat with AI to query expenses
- **Family Groups**: Share expenses with your family
- **Telegram Bot**: Log expenses via Telegram (@NikoFin_bot)

## Import Protection

### Per-User FIFO Queue

Import jobs are processed sequentially per user using Redis locks. This prevents duplicate expenses when importing multiple files.

```
User A uploads File 1 → Lock(A) → Process → Release
User A uploads File 2 → Lock(A) → WAIT → Process (FIFO)

User B uploads File 3 → Lock(B) → Process (parallel with A)
```

### Duplicate Validation

Two layers of protection:
1. **During LLM processing**: `_is_duplicate()` checks against existing expenses
2. **At confirm time**: Re-checks `_is_duplicate()` as safety net for parallel imports

### Deterministic CSV/XLSX

CSV and XLSX files bypass the LLM entirely — parsed deterministically with pandas. Faster (<1s), cheaper ($0), and more reliable.

## Requirements

- Python 3.11+
- Node.js 18+
- PostgreSQL 14+
- Redis 7+
- Docker or Podman

## Local Development with Podman

### Prerequisites

```bash
# Install Podman (Fedora/RHEL)
sudo dnf install -y podman podman-docker podman-compose

# Install Podman (Ubuntu/Debian)
sudo apt install -y podman podman-compose

# Or via pip
pip install podman-compose
```

### Environment Setup

```bash
# Create secrets directory
mkdir -p backend/secrets/dev

# Create password file for PostgreSQL
echo -n "your-postgres-password" > backend/secrets/dev/postgres_password.txt

# Create .env file in backend/
cat > backend/.env << 'EOF'
DATABASE_URL=postgresql://expenses_user:your-postgres-password@db:5432/expenses
REDIS_URL=redis://redis:6379/0
LLM_API_KEY=your-gemini-api-key
SECRET_KEY=your-jwt-secret-key
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
EOF
```

### Build and Run

```bash
# Build images
podman-compose build

# Start all services
podman-compose up -d

# View logs
podman-compose logs -f backend_dev
podman-compose logs -f celery_worker_dev

# Stop services
podman-compose down
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| `backend_dev` | 8001 | FastAPI backend |
| `celery_worker_dev` | - | Background task processor |
| `frontend_dev` | 8082 | Vite dev server |
| `db` | 5432 | PostgreSQL database |
| `redis` | 6379 | Redis (Celery broker) |

### First Run

```bash
# Run database migrations
podman-compose run --rm backend_dev python -m scripts.migrate_add_reset_token
podman-compose run --rm backend_dev python -m scripts.migrate_remove_haberes

# Seed default categories
podman-compose run --rm backend_dev python -c "from app.database import SessionLocal; from app.seed import _apply_base_hierarchy; db = SessionLocal(); _apply_base_hierarchy(db); db.commit()"
```

### Access

- **App**: http://localhost:8082
- **API docs**: http://localhost:8001/docs

## Production Deployment

### Architecture

```
Internet → :80 (redirect) → :443 (nginx SSL) → :80 (frontend nginx) → backend:8000
```

Production runs on a Linode server with the following services:

| Service | Description |
|---------|-------------|
| `nginx` | Reverse proxy with SSL termination (ports 80/443) |
| `frontend` | React SPA served by nginx (internal only) |
| `backend` | FastAPI backend (internal only) |
| `celery_worker` | Background task processor |
| `db` | PostgreSQL 16 |
| `redis` | Redis 7 |

### GitHub Actions

Push to `main` branch triggers automatic deployment:

1. Build Docker images → push to GHCR
2. Setup server (podman, SSL certs, firewall)
3. Deploy containers → run migrations → verify health

### SSL Certificates

SSL is handled by Let's Encrypt via certbot:

- Certs stored at `/opt/creditcardanalyzer/certbot/conf/`
- Auto-renewal via systemd timer (`certbot-renew.timer`)
- Nginx mounts certs as read-only with SELinux `:Z` flag

### Idempotent Setup Steps

Each setup step validates before acting:

| Step | Validation | Action |
|------|------------|--------|
| Podman | `command -v podman` | Install via dnf |
| podman-compose | `command -v podman-compose` | Install via pip |
| SSL cert | `ls certbot/conf/live/.../fullchain.pem` | Run certbot container |
| Certbot timer | `ls /etc/systemd/system/certbot-renew.timer` | Create systemd timer |
| Firewall | `firewall-cmd --list-ports` | Open 80/443 |

### Required Secrets

Add in `Settings → Secrets → Actions`:

| Secret | Description |
|--------|-------------|
| `LINODE_SERVER_IP` | Server IP address |
| `LINODE_SSH_USER` | SSH username |
| `LINODE_SSH_KEY` | SSH private key |
| `GHCR_PAT` | GitHub PAT for GHCR login |
| `APP_SECRETS_B64` | Base64-encoded JSON with app secrets |

### APP_SECRETS Template

```json
{
  "POSTGRES_PASSWORD": "your-postgres-password",
  "LLM_API_KEY": "your-gemini-api-key",
  "INVESTMENTS_LLM_API_KEY": "your-investments-llm-key",
  "MESSAGES_BOT_LLM_API_KEY": "your-messages-bot-llm-key",
  "TELEGRAM_BOT_TOKEN": "your-telegram-bot-token",
  "GOOGLE_CLIENT_ID": "your-google-client-id",
  "GOOGLE_CLIENT_SECRET": "your-google-client-secret",
  "SECRET_KEY": "your-jwt-secret-key",
  "RESEND_API_KEY": "your-resend-api-key"
}
```

### Generate Base64 Secret

```bash
cat app-secrets.json | base64 -w 0
```

### Manual Deploy

```bash
# On the server
cd /opt/creditcardanalyzer
source .env

# Run migrations
podman-compose run --rm --no-deps backend python -m scripts.migrate_add_reset_token
podman-compose run --rm --no-deps backend python -m scripts.migrate_remove_haberes

# Restart services
podman-compose down
podman-compose up -d

# Verify
curl -sk https://yourdomain.com/api/docs
```

### Health Checks

Deployment verifies the full stack:

```bash
# Primary: domain-based (validates DNS + SSL + nginx + backend)
curl -sk https://yourdomain.com/api/docs

# Fallback: localhost (validates nginx container only)
curl -sf http://localhost/api/docs
```

## Telegram Bot

The bot is available at [@NikoFin_bot](https://t.me/NikoFin_bot).

1. Open the bot in Telegram
2. Send `/start`
3. Go to the app → Settings → Telegram Bot
4. Copy the key and paste it in the bot

### Bot Commands

- `/start` — Authenticate with your account
- `/help` — Show usage instructions

### Logging Expenses

Just send a message describing your expense:
- "gasté 1500 en farmacity"
- "uber 3200 ayer"
- "Netflix USD 5"

## License

MIT
