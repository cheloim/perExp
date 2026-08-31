# CLAUDE.md

## Project: Oikonomia (creditCardAnalyzer)

Personal finance app with Telegram bot, WhatsApp bot, FastAPI backend, React frontend.

## Lint Commands

Run before every commit:

```bash
./scripts/lint.sh
```

Run with auto-fix:

```bash
./scripts/lint.sh --fix
```

Individual commands:

```bash
# Frontend
cd src/frontend && npm run lint && npx prettier --check src/ && npm run typecheck

# Backend
cd src/backend && ruff check app/ && ruff format --check app/ && mypy app/
```

## Test Commands

```bash
cd src/backend && SECRET_KEY="test-secret-key-that-is-at-least-32-chars-long-for-testing" pytest tests/ -v
```

## Key Paths

| Path | Description |
|------|-------------|
| `src/backend/app/` | Backend application code |
| `src/frontend/src/` | Frontend application code |
| `.sdd/` | SDD framework (submodule) |
| `scripts/` | Build and utility scripts |
| `docs/` | Documentation |
| `.sdd/guides/` | Framework guides and rules |

## SDD Framework

Follow the rules in `.sdd/guides/ai-agent-guide.md`:

1. **Never auto-apply** — Present a plan before any code modification
2. **Read specs before code** — Understand requirements before implementing
3. **Documentation is mandatory** — Update docs with every feature
4. **Pre-commit verification** — Run linters before committing (Rule 8)

## Architecture

- **Backend**: FastAPI + SQLAlchemy + PostgreSQL
- **Frontend**: React + TanStack Query + TypeScript
- **Bots**: Telegram + WhatsApp integration
- **Deployment**: Podman Compose
- **Specs**: OpenAPI + feature specs in `docs/specs/`
