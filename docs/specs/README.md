# Specs

- `architecture/` — System overview, data model, tech stack, API rules
- `features/` — One feature spec per domain
- `openapi.yaml` — The API contract (curated)

## Two OpenAPI files, two jobs

| File | What it is | Committed | Used by |
|------|------------|-----------|---------|
| `openapi.yaml` | **Curated** contract. Hand-maintained 3.0.3 spec with stable `operationId`s. | yes | orval (`src/frontend/orval.config.ts`), humans |
| `openapi.generated.yaml` | **Raw** export: everything FastAPI infers from the code, 3.1.0, ~179 paths. | no (gitignored) | nobody — a diagnostic |

The curated file is the source of truth for the client. It is a curated subset:
it documents the endpoints the frontend client is written against, with
hand-chosen `operationId`s and response shapes that stay stable while the
backend evolves. `export_openapi.py` cannot produce it and must never overwrite
it — the script refuses to write to it without `--force`.

The code and `features/*.spec.yaml` are the truth for behavior. Where the
curated file and the code disagree, the code wins and the curated file is wrong.

## Regenerating the raw export

From the repo root:

```bash
python src/backend/scripts/export_openapi.py
```

From the dev container (`docs/specs` is mounted at `/app/docs/specs`, see
`podman-compose.yml`):

```bash
podman exec -u root creditcardanalyzer_backend_dev_1 \
  /app/docker-entrypoint.sh python /app/scripts/export_openapi.py
```

That mount is what gives the script its default destination in the container:
it looks for the nearest ancestor holding `docs/specs`, which is the mounted
directory. Two wrinkles in that command, both real:

- Go through `docker-entrypoint.sh`. A bare `podman exec` runs without the
  secrets it loads from `/run/secrets`, and importing the app then fails on the
  missing `SECRET_KEY`.
- Run as root. `podman-compose.yml` runs the app as uid 1000, which under
  rootless podman is an unmapped id that cannot write to the bind mounts; root
  is the host user, so the file lands owned by you.

Outside a checkout, or with no `docs/specs` reachable, pass `--output`.

## Known drift

The raw export and the curated file are not the same thing and are not kept in
lockstep on purpose. As of 2026-10-24 the raw export is 3.1.0 with 181 paths
and 87 schemas, while the curated file is 3.0.3 with 88 paths and 51 schemas.
Only the `analysis` section has been aligned
against the real routes (`POST /analysis/stream`, `GET /analysis/history`,
`DELETE /analysis/history/{hist_id}`) — see #451. Everything else in the
curated file is unreviewed, and `POST /analysis/summarize` is still
undocumented there.

When you touch an endpoint the frontend uses, update the curated file and
regenerate the orval client:

```bash
cd src/frontend && npx orval && npx prettier --write src/api/client-generated.ts src/types/generated/
```

CI regenerates the client from the curated file and diffs the generated types
against the committed ones, so changing `openapi.yaml` without regenerating
fails the `specs` job. It does not check the curated file against the code —
that comparison is manual, using the raw export.
