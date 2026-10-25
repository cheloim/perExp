# CLAUDE.md

## Project: Oikonomia (creditCardAnalyzer)

Personal finance app with Telegram bot, WhatsApp bot, FastAPI backend, React frontend.

## Lint Commands

Flujo por niveles — cada nivel tiene su comando:

1. **Loop interno** — el test puntual del archivo que estés tocando (`npx vitest run <archivo>`, `pytest tests/<archivo>`).
2. **Antes de cada commit** — `./scripts/lint.sh` (solo estático).
3. **Antes de abrir un PR** — `./scripts/verify.sh` (todo, una sola vez).
4. **Solo si tocás routers, imports o deploy** — `./scripts/smoke.sh`, y una sola vez, no dos.

Auto-fix:

```bash
./scripts/lint.sh --fix
```

## Functional Verification

`./scripts/smoke.sh` solo si tocás routers, imports o deploy — y una sola vez, no dos:

```bash
./scripts/smoke.sh
```

## Test Commands

Loop interno — el test puntual del archivo que estés tocando:

```bash
# Frontend
cd src/frontend && npx vitest run <archivo>

# Backend
cd src/backend && SECRET_KEY="test-secret-key-that-is-at-least-32-chars-long-for-testing" pytest tests/<archivo>
```

La suite completa (estáticos + tests unitarios) corre con `./scripts/verify.sh` antes de abrir un PR. `./scripts/lint.sh` no corre tests.

## Key Paths

| Path | Description |
|------|-------------|
| `src/backend/app/` | Backend application code |
| `src/frontend/src/` | Frontend application code |
| `.sdd/` | SDD framework (submodule) |
| `scripts/` | Build and utility scripts |
| `docs/` | Documentation |
| `.sdd/guides/` | Framework guides and rules |

## Contrato OpenAPI

`docs/specs/openapi.yaml` es el contrato **curado** (a mano, entrada de orval).
`python src/backend/scripts/export_openapi.py` exporta el **crudo** que FastAPI
infiere del código a `docs/specs/openapi.generated.yaml` (gitignored) para comparar.
El gate `src/backend/tests/test_openapi_contract.py` falla si el curado queda atrás
de los routers, o si un gap documentado se arregla sin achicar el baseline.

- **Agregaste un query param o endpoint**: declaralo en `docs/specs/openapi.yaml`
  y regenera el cliente:
  `cd src/frontend && npm run generate:api && npx prettier --write src/types/generated/ src/api/client-generated.ts`
  (sin el paso de prettier el diff trae churn de estilo de orval).
- **Gap a propósito**: registralo en `src/backend/tests/openapi_contract_baseline.yaml`.
  Esa lista **solo achica**: al resolver un gap, sacarlo de ahí.

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

## Agentes en paralelo

Cuando un trabajo se divide entre varios agentes, coordinar según `AGENTS.md`: clasificar
por archivos (disjuntos → paralelo; solapados → ramas separadas más rama de integración;
dependientes → en orden), un agente = un worktree + una rama, declarar en el brief el
estado global compartido (Postgres de tests, `node_modules`, containers), y correr la
verificación completa una sola vez sobre la integración.
