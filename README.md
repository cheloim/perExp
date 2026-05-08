# Credit Card Analyzer

Gestión de gastos personales con importación inteligente de extractos bancarios.

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI + SQLAlchemy 2 + Pydantic v2 + SQLite |
| Frontend | React 18 + TypeScript + Vite + TanStack Query v5 + React Router DOM v7 |
| Charts | Recharts |
| LLM | Google Gemini Flash |
| PDF parsing | pdfplumber |

## Requisitos

- Python 3.11+
- Node.js 18+
- npm o yarn

## Instalación

```bash
# Backend
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Configurar variables de entorno

# Frontend
cd frontend
npm install
```

## Ejecutar

```bash
# Backend (desde backend/)
source .venv/bin/activate
uvicorn main:app --reload  # http://localhost:8000

# Frontend (desde frontend/)
npm run dev  # http://localhost:5173
```

## Características

- **Importación inteligente**: PDF y CSV con análisis LLM (Gemini)
- **Gestión de tarjetas**: CRUD de tarjetas de crédito/débito
- **Categorización automática**: Por palabras clave y tipo de transacción
- **Cuotas**: Seguimiento de compras en cuotas
- **Inversiones**: Sincronización con IOL y Portfolio Personal
- **Análisis**: Chat con IA para consultar gastos
- **Grupos familiares**: Compartí gastos con tu familia
- **Bot de Telegram**: Recibí notificaciones y registrá gastos desde Telegram

## Estructura

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

## Configuración

El proyecto usa variables de entorno. Copiá `.env.example` a `.env` y configurá las necesarias:

- `SECRET_KEY`: Clave para JWT
- `GEMINI_API_KEY`: API key de Google Gemini
- `IOL_API_KEY` / `PPI_API_KEY`: Para синхронизацию de inversiones

## Licencia

MIT