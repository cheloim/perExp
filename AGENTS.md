# AGENTS.md — Oikonomia

Fuente de verdad para trabajar en este repo. El **proceso genérico de desarrollo**
(planificar, testear, documentar, commitear) vive en `.sdd/guides/`; acá está lo
específico de Oikonomia. Si una guía del framework contradice este archivo en algo del
proyecto, gana este archivo.

## 1. Proyecto y stack

App personal de finanzas: bot de Telegram, bot de WhatsApp, backend FastAPI, frontend
React, deploy con Podman Compose.

- **Backend**: FastAPI + SQLAlchemy + PostgreSQL
- **Frontend**: React + TanStack Query + TypeScript
- **Bots**: Telegram + WhatsApp
- **Deploy**: Podman Compose, release taggeado
- **Specs**: OpenAPI + feature specs en `docs/specs/`

## 2. Cómo trabajar

1. **Plan antes de tocar código** (`.sdd/guides/ai-agent-guide.md` Rule 1). El plan
   escala con el cambio: un fix chico son tres líneas, una feature usa el template
   completo.
2. **Leé la spec** de la feature si existe (`docs/specs/features/`).
3. **Un cambio = una rama desde `origin/main` + un PR.** Nunca commit directo a `main`.
4. **Verificá por niveles** (§3). No corras la suite completa en cada checkpoint.

## 3. Verificación por niveles

| Nivel | Cuándo | Comando |
|---|---|---|
| Loop interno | mientras editás | `npx vitest run <archivo>` / `pytest tests/<archivo>` |
| Antes de commit | cada commit | `./scripts/lint.sh` (sólo estático) |
| Antes del PR | una vez, al terminar | `./scripts/verify.sh` |
| Funcional | sólo si tocás routers, imports o deploy | `./scripts/smoke.sh`, una vez |

Auto-fix: `./scripts/lint.sh --fix`

`verify.sh` corre estáticos + tests + coverage. **No** corre E2E: Playwright tiene su
propio job de CI.

Tests puntuales:

```bash
cd src/frontend && npx vitest run src/pages/LoginPage.test.tsx

cd src/backend && SECRET_KEY="test-secret-key-that-is-at-least-32-chars-long-for-testing" \
  pytest tests/test_expenses_crud.py
```

El backend tiene un gate de cobertura por área (`src/backend/scripts/coverage_gate.py`):
los pisos suben con tests nuevos y no bajan. No borres tests para destrabar un PR.

## 4. Paths

| Path | Descripción |
|------|-------------|
| `src/backend/app/` | Código del backend |
| `src/backend/tests/` | Tests del backend |
| `src/backend/alembic/versions/` | Migraciones (única vía) |
| `src/frontend/src/` | Código del frontend |
| `docs/specs/` | OpenAPI curado + feature specs |
| `scripts/` | Lint, verify, smoke, housekeeping |
| `.sdd/guides/` | Proceso de desarrollo (submodule) |

## 5. Contrato OpenAPI

`docs/specs/openapi.yaml` es el contrato **curado** (a mano, entrada de orval).
`python src/backend/scripts/export_openapi.py` exporta el **crudo** que FastAPI infiere
del código a `docs/specs/openapi.generated.yaml` (gitignored) para comparar. El gate
`src/backend/tests/test_openapi_contract.py` falla si el curado queda atrás de los
routers, o si un gap documentado se arregla sin achicar el baseline.

- **Agregaste un query param o endpoint**: declaralo en `docs/specs/openapi.yaml` y
  regenerá el cliente:
  `cd src/frontend && npm run generate:api && npx prettier --write src/types/generated/ src/api/client-generated.ts`
  (sin el paso de prettier el diff trae churn de estilo de orval).
- **Gap a propósito**: registralo en `src/backend/tests/openapi_contract_baseline.yaml`.
  Esa lista **sólo achica**: al resolver un gap, sacarlo de ahí.

## 6. Política de tests

- **Testeá comportamiento.** Un test tiene que fallar cuando se rompe el comportamiento,
  no cuando se renombra o reformatea el código.
- **Prohibido**: leer un archivo fuente y assertear su texto, hacer regex sobre `.py` o
  `.tsx`, o assertear el contenido de `deploy.yml` / `nginx.conf`. Si una regla sólo se
  puede chequear parseando el código, va a un linter (ESLint, Ruff, mypy), al sistema de
  tipos, o a un test que ejecute el script.
- **Un test por comportamiento.** Duplicar el mismo chequeo en dos archivos es deuda sin
  señal extra.
- **Los tests de ops ejecutan el script** contra fakes (`test_ops_contracts.py`); los de
  DB usan Postgres real.
- La suite no debe crecer por costumbre: si un test no puede fallar por una razón real,
  no entra.

## 7. Agentes en paralelo

Protocolo para cuando el trabajo se divide entre varios agentes. **No paralelizar por
costumbre**: paralelizá cuando hay solapamiento cero o cuando el conflicto se resuelve
una sola vez arriba.

### 7.1 Clasificar por archivos, no por "tarea"

| Relación | Estrategia |
|---|---|
| **Disjuntos** | Agentes en paralelo, sin más. |
| **Solapados** | En paralelo, cada uno en su rama. La fusión se resuelve **una sola vez** en la rama de integración. Ningún agente reescribe trabajo ajeno. |
| **Dependientes** | Consecutivos, en orden. Si el gate de CI no puede entrar antes de la corrección que lo habilita, `main` queda rojo. |

### 7.2 Un agente = un worktree + una rama

- Worktree fuera del repo: `/tmp/opencode/wt-<nombre>`.
- Rama desde `origin/main`, o desde la rama de integración si depende de otro.
- Frontend: `ln -s $REPO/src/frontend/node_modules $WT/src/frontend/node_modules`.
- El agente escribe **sólo** en su worktree.

### 7.3 Estado global compartido

| Recurso | Regla |
|---|---|
| **Postgres de tests** | Un solo agente corre `pytest` a la vez. Una vez al final, no por iteración. |
| **`node_modules`** | Compartido por symlink. Nadie lo reinstala ni lo borra. |
| **Containers / `smoke.sh`** | No se ejecuta con otros agentes corriendo: reinicia servicios que otros usan. |
| **Secretos, `.env`, `deploy.yml`, branch protection** | Sólo el coordinador. |
| **Issues / PRs** | Sólo el coordinador, salvo que el brief lo asigne. |

### 7.4 Rama de integración

Cuando hay solapamiento **o** dependencia de orden: `integration/<lote>` desde
`origin/main`, merge de cada rama en orden del DAG con `--no-ff`, conflictos resueltos
una sola vez ahí, verificación completa una vez, **un solo PR** a `main`. Con trabajo
disjunto y sin orden, dos PRs directos están bien.

### 7.5 Brief mínimo

```
TRABAJO: <qué se hace, en una oración>
WORKTREE: /tmp/opencode/wt-<nombre> (rama <rama>, ya creada desde <base>)
ARCHIVOS PERMITIDOS: <lista explícita>
ARCHIVOS PROHIBIDOS: <todo lo demás; nombrar los que dan tentación>
ESTADO COMPARTIDO: <qué recursos globales usa y cuáles no>
TAREA: <pasos, con archivo:línea donde se pueda>
VERIFICACIÓN: <comandos exactos, con el resultado esperado>
COMMIT: uno solo, Conventional Commits, body que explica el porqué.
       Firmar con: Co-Authored-By: OpenCode <noreply@opencode.ai>
PUSH + PR: <rama>, PR contra <base>, con la verificación observada
REGLAS: no crear archivos de plan, no ampliar alcance, no tocar <lo sensible>
REPORTE: URL del PR, verificación observada, decisiones, qué dejó afuera
```

Decirle al agente qué **no** hacer funciona mejor que esperar que lo adivine.

### 7.6 Roles y espera

- **Coordinador**: arma el DAG, crea worktrees y briefs, mergea en orden, corre la
  verificación final, maneja branch protection y mutaciones externas (issues, PRs).
- **Agente**: su slice, nada más. Reporta la verificación que corrió y su salida real.
- Agentes independientes se lanzan en background, todos juntos. **No se sondea**: se
  espera la notificación de fin.

## 8. Deploy, releases y migraciones

- **Un merge a `main` no deploya.** El deploy sale de un GitHub Release publicado
  (`release: released`). "Qué está en producción" es un tag, no un commit suelto.
- **Versionado `vMAJOR.MINOR.PATCH`**: PATCH = fixes, backend, infra, migraciones,
  deploy; MINOR = cambios importantes de UI/UX; MAJOR = incompatible o de plataforma.
  El tag es el `IMAGE_TAG` del deploy; no cambia la versión de producto en Novedades
  (`src/frontend/src/data/changes.ts`, `LATEST_VERSION`).
- **Migraciones: sólo Alembic** en `src/backend/alembic/versions/`. **No se agregan
  scripts `migrate_*.py`**; `create_all`/`add_indices` no corren al arrancar. El release
  hace `backup → alembic upgrade head → recrear la app`; si la migración falla, la
  versión anterior sigue corriendo.
- **Gate de migraciones**: un PR que toca `alembic/**` pasa `migration-fixture.yml`, que
  aplica `alembic upgrade head` sobre un dump anonimizado de producción. El fixture se
  regenera sólo después de un release sano (`refresh-fixture`).
- **Quién corta el release**: el coordinador, después de mergear y con la verificación
  completa en verde. Los agentes de un lote no cortan releases.
- **Rollback**: si falla la app después de migrar, se revierte la imagen; el esquema
  queda adelante. Por eso toda migración destructiva es expand/contract.
- Referencias: `docs/Deployment.md` y `docs/Migrations.md`.

## 9. Historial de lotes

| Lote | Trabajo | Ramas | Resultado |
|---|---|---|---|
| `ci-hardening` | 17 errores de `mypy` + gates de CI y pipeline de tests | `fix/backend-types`, `chore/ci-gates` → `integration/ci-hardening` | mergeado (#440) |
| `deps-batch` | Dependabot agrupado: deps frontend/backend, fix de carreras en e2e | `fix/frontend-deps`, `fix/backend-deps`, `fix/e2e-axe-race` | mergeado (#441–#443) |
| `assistant-v2` | Ventana de datos de 3 meses + hilo único con Limpiar | `feat/analysis-window`, `refactor/single-thread` → `integration/assistant-v2` | mergeado (#448) |
