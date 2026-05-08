# Credit Card Analyzer

Personal expense management with intelligent bank statement import.

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI + SQLAlchemy 2 + Pydantic v2 + SQLite |
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

## License

MIT