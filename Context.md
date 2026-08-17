# Project Context

This project follows Spec-Driven Development.

## Getting Started

Read `.sdd/guides/ai-agent-guide.md` for core rules and workflow.

## Project-Specific Context

- `specs/architecture/` — System overview, data model, tech stack, API rules
- `specs/features/` — Feature specifications (one per domain)
- `specs/openapi.yaml` — API contract (auto-generated from FastAPI)

## Conventions

- Backend: `.sdd/conventions/backend/fastapi.md`
- Frontend: `.sdd/conventions/frontend/react-query.md`

## Context Bundles

Read the appropriate bundle before starting work:

- `.sdd/bundles/full-stack.md` — Full-stack feature work
- `.sdd/bundles/backend-only.md` — Backend-only work
- `.sdd/bundles/frontend-only.md` — Frontend-only work
- `.sdd/bundles/migration-only.md` — Database migration work
- `.sdd/bundles/bugfix.md` — Debugging and fixing
