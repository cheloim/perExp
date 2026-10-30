# Cómo contribuir

## Antes de empezar

- Leé `CLAUDE.md` (convenciones y comandos) y `docs/README.md` (qué documento es canónico).
- Si el cambio toca un área con documento de diseño, leelo primero: `Frontend.md`,
  `Data-Model.md`, `Authentication.md`, `Security.md`, `Design-System.md`.
- Si vas a trabajar en paralelo con otros agentes, seguí `AGENTS.md`.

## Flujo

```bash
# 1. Rama desde main
git switch -c feat/mi-cambio origin/main

# 2. Desarrollo
#    Loop interno: solo el test del archivo que tocás
cd src/frontend && npx vitest run src/pages/MiPagina.test.tsx
cd src/backend && SECRET_KEY="test-secret-key-that-is-at-least-32-chars-long-for-testing" pytest tests/test_mi_modulo.py

# 3. Antes de cada commit
./scripts/lint.sh

# 4. Antes del PR (una sola vez)
./scripts/verify.sh

# 5. Solo si tocaste routers, imports o deploy
./scripts/smoke.sh
```

## Reglas de código

### Backend

- Ruff (100 columnas, target Python 3.12) y mypy sin errores.
- `snake_case` para funciones y variables, `PascalCase` para clases.
- Toda query de dominio filtra por usuario o grupo aceptado.
- Campos con PII: `EncryptedType` + `*_hmac` para búsqueda por igualdad.
- No agregues `except Exception` sin `logger.exception` o `raise`.
- No agregues `noqa` sin un comentario que explique por qué.

### Frontend

- TypeScript estricto; `npm run typecheck` limpio.
- Prettier para formato.
- Nada de `style={{}}` en pantallas nuevas: usá tokens.
- Todo click en `<button>` o `<Link>`.
- Estado del servidor en TanStack Query; estado de UI local o en la URL.
- Un solo formato de moneda.

### Datos

- Cambios de esquema por Alembic, nunca a mano. Ver `Migrations.md`.
- Montos nuevos: `Numeric(12,2)`, no `Float`.
- Índices declarados en la migración.

## Tests

| Nivel | Herramienta | Cuándo |
|---|---|---|
| Unit backend | pytest | Lógica de servicio, routers, autorización |
| Unit frontend | Vitest | Hooks, utilidades, componentes con lógica |
| E2E | Playwright | Flujos críticos: login, import, gasto, presupuesto |
| Accesibilidad | Playwright + contrato | Ver `Accessibility.md` |

Una feature no está terminada sin tests del camino feliz y del camino de error.

## Documentación

- Actualizá el documento canónico del tema que tocaste.
- Si agregás un endpoint, actualizá `docs/specs/openapi.yaml` y regenerá el cliente.
- Si tomás una decisión de arquitectura, escribí un ADR en `docs/adr/`.
- No crees un documento nuevo si ya existe uno para ese tema.

## Pull requests

Usá `.github/PULL_REQUEST_TEMPLATE.md`. El PR debe incluir:

- Qué cambia y por qué (no solo el qué).
- Cómo se verificó, con el comando y el resultado observado.
- Issues que cierra.
- Riesgos y rollback si aplica.

## Reportar un problema de seguridad

No abras un issue público. Ver `SECURITY.md`.
