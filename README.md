# Credit Card Analyzer

Personal expense management with intelligent bank statement import.

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI + SQLAlchemy 2 + Pydantic v2 + PostgreSQL |
| Frontend | React 18 + TypeScript + Vite + TanStack Query v5 + React Router DOM v7 |
| Charts | Recharts |
| LLM | Google Gemini Flash |
| PDF parsing | pdfplumber |

## Requirements

- Python 3.11+
- Node.js 18+
- npm or yarn

## Installation

```bash
# Backend
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Configure environment variables

# Frontend
cd frontend
npm install
```

## Running

```bash
# Backend (from backend/)
source .venv/bin/activate
uvicorn main:app --reload  # http://localhost:8000

# Frontend (from frontend/)
npm run dev  # http://localhost:5173
```

## Features

- **Smart Import**: PDF and CSV with LLM (Gemini) analysis
- **Card Management**: Credit/debit card CRUD
- **Account Management**: Cash and bank accounts for tracking transfers
- **Payment Methods**: Select account (cash/transfer) or card per expense
- **Auto-categorization**: By keywords and transaction type
- **Installments**: Track installment purchases
- **Investments**: Sync with IOL and Portfolio Personal
- **AI Analysis**: Chat with AI to query expenses
- **Family Groups**: Share expenses with your family
- **Telegram Bot**: Receive notifications and log expenses from Telegram

## Structure

```
backend/
  main.py              # FastAPI app entry
  app/
    models.py          # SQLAlchemy models
    routers/           # API endpoints
    services/          # Business logic

frontend/
  src/
    api/               # Axios API client
    pages/             # React pages
    components/        # Reusable components
    types/             # TypeScript interfaces
```

## Configuration

The project uses environment variables. Copy `.env.example` to `.env` and configure as needed:

- `SECRET_KEY`: JWT secret key
- `GEMINI_API_KEY`: Google Gemini API key
- `IOL_API_KEY` / `PPI_API_KEY`: For investment sync

## GitHub Actions Deployment

### Required Secrets

Add these secrets in `Settings → Secrets → Actions`:

| Secret | Description |
|--------|-------------|
| `LINODE_SERVER_IP` | Server IP address |
| `LINODE_SSH_USER` | SSH username |
| `LINODE_SSH_KEY` | SSH private key |
| `APP_SECRETS_B64` | Base64-encoded JSON with app secrets |

### APP_SECRETS Template

Create a JSON file with your secrets:

```json
{
  "POSTGRES_PASSWORD": "your-postgres-password",
  "LLM_API_KEY": "your-gemini-api-key",
  "INVESTMENTS_LLM_API_KEY": "your-investments-llm-key",
  "MESSAGES_BOT_LLM_API_KEY": "your-messages-bot-llm-key",
  "TELEGRAM_BOT_TOKEN": "your-telegram-bot-token",
  "GOOGLE_CLIENT_ID": "your-google-client-id",
  "GOOGLE_CLIENT_SECRET": "your-google-client-secret",
  "SECRET_KEY": "your-jwt-secret-key"
}
```

### Generate Base64 Secret

```bash
# Option 1: From file
cat app-secrets.json | base64 -w 0

# Option 2: Inline
echo '{"POSTGRES_PASSWORD":"xxx","LLM_API_KEY":"xxx"}' | base64 -w 0
```

### Add to GitHub

1. Copy the base64 output
2. Go to `Settings → Secrets → Actions`
3. Click `New repository secret`
4. Name: `APP_SECRETS_B64`
5. Value: paste the base64 string

## License

MIT