# Migración fallida

El release aplica `alembic upgrade head` **antes** de recrear la app. Si la
migración falla, `deploy-platform` no corre y producción sigue con la versión
anterior. Si la migración pasa y después falla la app, el esquema queda
adelantado y la imagen vieja vuelve por rollback.

> **Regla:** en producción no se edita el esquema a mano ni se agregan scripts
> `migrate_*.py`. Se escribe una revisión de Alembic en
> `src/backend/alembic/versions/` y se publica un release. Ver
> `../Migrations.md`.

## Síntomas

| Síntoma | Qué significa |
|---|---|
| Job `migrate` en rojo, `deploy-platform` skipeado | La app nueva no arrancó; producción sigue vieja |
| `alembic current` no coincide con `alembic heads` | Hay revisión pendiente o una rama de revisiones |
| `deploy-platform` falló después de migrar y volvió la imagen vieja | Esquema adelantado; verificar compatibilidad |
| La app nueva arranca pero falla al leer una columna | Migración incompleta o modelo desalineado |
| `alembic upgrade` se queda esperando | Lock de tabla o transacción abierta |

## Diagnóstico

```bash
cd /opt/creditcardanalyzer
export PATH="$HOME/.local/bin:$PATH"
set -a; source .env; set +a

DB_URL="postgresql://expenses_user:${POSTGRES_PASSWORD}@db:5432/expenses"
IMAGE="${BACKEND_IMAGE}:${IMAGE_TAG}"

# Revisión aplicada y revisión que trae la imagen
podman run --rm --network "${NETWORK_NAME:-oikonomia}" \
  -e DATABASE_URL="$DB_URL" --entrypoint alembic "$IMAGE" current
podman run --rm --network "${NETWORK_NAME:-oikonomia}" \
  -e DATABASE_URL="$DB_URL" --entrypoint alembic "$IMAGE" heads

# ¿Hay locks o transacciones largas?
DB=$(podman ps --format '{{.Names}}' | grep -E '_db_' | head -1)
podman exec "$DB" psql -U expenses_user -d expenses -c \
  "SELECT pid, state, wait_event_type, now()-xact_start AS age, left(query,120) AS query
   FROM pg_stat_activity
   WHERE datname='expenses' AND state <> 'idle'
   ORDER BY age DESC NULLS LAST;"

# ¿Alembic dejó la revisión marcada?
podman exec "$DB" psql -U expenses_user -d expenses -c "SELECT * FROM alembic_version;"
```

Buscá el error real en el log del job `migrate` (Actions) y en el backend:

```bash
podman logs "$(podman ps --format '{{.Names}}' | grep -E '_backend_' | head -1)" --tail 200
```

## Acción

### 1. La migración falló y la app vieja sigue arriba

No hay urgencia por bajar nada: producción está en la versión anterior y el
backup previo existe. El camino es **forward fix**:

1. Reproducí la migración sobre una base con datos representativos (fixture
   anonimizado, `migration-fixture.yml`) o al menos sobre una base local con
   `alembic upgrade head`.
2. Corregí la revisión (idempotencia, tipo, default, backfill por lotes).
3. Abrí PR, pasá el gate y cortá un patch release.

Si el error fue “relation/column already exists”, la revisión no es idempotente
sobre una base que ya tenía ese objeto. No lo parchees a mano en producción:
corregí la revisión y volvé a desplegar.

### 2. La migración se quedó esperando por un lock

Identificá el bloqueador antes de matar nada:

```bash
podman exec "$DB" psql -U expenses_user -d expenses -c \
  "SELECT pid, pg_blocking_pids(pid) AS blockers, state, left(query,120)
   FROM pg_stat_activity WHERE datname='expenses';"
```

Si el bloqueador es una transacción `idle in transaction` de la app, primero
revisá si es una sesión real de usuario. Recién después:

```bash
podman exec "$DB" psql -U expenses_user -d expenses -c \
  "SELECT pg_terminate_backend(<pid>);"
```

No termines sesiones en masa: podés cortar una importación o un request real.
Si el lock vuelve, el problema es la migración (DDL que bloquea una tabla
caliente), no Postgres.

### 3. La migración pasó, la app falló y volvió la imagen vieja

El esquema está adelantado. Antes de tocar nada, comprobá que la app vieja
pueda convivir:

- La columna nueva es nullable o tiene default.
- No se renombró ni borró nada que la app vieja lea.
- No se cambió un tipo de forma incompatible.

Si es compatible, dejá la app vieja corriendo y sacá un patch release con el
fix. Si **no** es compatible, el rollback de imagen no alcanza: hay que elegir
entre restaurar el backup (pérdida de lo escrito desde el backup) o completar
la migración y desplegar la app nueva. Documentá la decisión en el issue.

### 4. Hay que revertir una revisión

Sólo si la revisión tiene `downgrade()` real y no destruye datos que la app
vieja necesite:

```bash
podman run --rm --network "${NETWORK_NAME:-oikonomia}" \
  -e DATABASE_URL="$DB_URL" --entrypoint alembic "$IMAGE" downgrade -1
podman run --rm --network "${NETWORK_NAME:-oikonomia}" \
  -e DATABASE_URL="$DB_URL" --entrypoint alembic "$IMAGE" current
```

Si la migración borró una columna o hizo backfill destructivo, **no hay
downgrade seguro**. Restaurá backup o hacé forward fix, nunca las dos cosas a
la vez.

## Verificación

```bash
# Revisión aplicada = heads
podman run --rm --network "${NETWORK_NAME:-oikonomia}" \
  -e DATABASE_URL="$DB_URL" --entrypoint alembic "$IMAGE" current
podman run --rm --network "${NETWORK_NAME:-oikonomia}" \
  -e DATABASE_URL="$DB_URL" --entrypoint alembic "$IMAGE" heads

# Modelos y esquema coinciden
podman run --rm --network "${NETWORK_NAME:-oikonomia}" \
  -e DATABASE_URL="$DB_URL" --entrypoint alembic "$IMAGE" check

# La app puede leer y escribir
curl -fsS http://localhost:8000/health/ready | jq
```

Además, probá el flujo que tocaba la migración: un import, una lista de gastos,
un alta de gasto. `alembic check` solo no prueba que los datos se lean bien.

## Rollback

| Situación | Acción |
|---|---|
| Migración falló, app vieja intacta | No hay rollback: se corrige y se relanza |
| Migración pasó, app nueva falló, esquema compatible | Rollback de imagen ([`deploy-rollback.md`](deploy-rollback.md)) |
| Migración pasó, esquema incompatible | Forward fix o restaurar backup; el rollback de imagen solo no alcanza |
| Migración destructiva aplicada por error | Restaurar backup ([`restore-backup.md`](restore-backup.md)); asumir pérdida desde el dump |

## Prevención

- Toda revisión es idempotente y tiene `downgrade()` o explica por qué no.
- Los cambios destructivos van en expand/contract, en releases distintos.
- El PR que toca `alembic/**` pasa `migration-fixture.yml` sobre el dump
  anonimizado; no se mergea con el gate en rojo.
- El deploy nunca depende de `create_all`.
