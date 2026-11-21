# Restaurar un backup de la base

Los backups son `pg_dump -Fc` (formato custom), no SQL plano. **No se restauran
con `psql`**: se leen y se aplican con `pg_restore`.

- Directorio: `/opt/creditcardanalyzer/backups`
- Nombre: `db_<AAAmmdd_HHMMSS>.dump`
- Retención: 15 días (`scripts/housekeeping.sh`)
- Verificación: `pg_restore --list` sobre el dump

## Cuándo usar este runbook

- Corrupción o pérdida de datos confirmada.
- Una migración destructiva aplicada por error.
- Hay que volver a un estado anterior porque el fix forward no llega a tiempo.

**No** lo uses para “probar” un deploy ni para arreglar una app que no arranca:
en la mayoría de esos casos alcanza con rollback de imagen
([`deploy-rollback.md`](deploy-rollback.md)).

## Antes de tocar producción

1. Avisá en el chat de admin y declaralo SEV1.
2. Tomá un **dump fresco** del estado actual, aunque esté corrupto: es la única
   forma de volver si la restauración sale mal.

```bash
cd /opt/creditcardanalyzer
bash scripts/backup-db.sh
ls -lh backups/db_* | tail -5
```

3. Elegí el dump y verificá que se puede leer entero:

```bash
DUMP=/opt/creditcardanalyzer/backups/db_20261120_040000.dump
DB=$(podman ps --format '{{.Names}}' | grep -E '_db_' | head -1)

podman cp "$DUMP" "$DB:/tmp/restore.dump"
podman exec "$DB" pg_restore --list /tmp/restore.dump | head -30
podman exec "$DB" rm -f /tmp/restore.dump
```

Si `pg_restore --list` falla, el dump está truncado o corrupto: probá el
anterior. No sigas con un dump que no se puede leer.

4. Confirmá que hay espacio para el dump y la base restaurada:

```bash
df -h /
du -h "$DUMP"
```

## Ensayo en una base scratch

Nunca restaures por primera vez sobre producción. Creá una base descartable y
probá el dump completo:

```bash
DB=$(podman ps --format '{{.Names}}' | grep -E '_db_' | head -1)
DUMP=/opt/creditcardanalyzer/backups/db_20261120_040000.dump

podman exec "$DB" dropdb -U expenses_user --if-exists expenses_restore
podman exec "$DB" createdb -U expenses_user expenses_restore
podman cp "$DUMP" "$DB:/tmp/restore.dump"
podman exec "$DB" pg_restore -U expenses_user -d expenses_restore \
  --no-owner --no-privileges /tmp/restore.dump
podman exec "$DB" psql -U expenses_user -d expenses_restore -c \
  "SELECT count(*) AS users FROM users; SELECT count(*) AS expenses FROM expenses;"
podman exec "$DB" psql -U expenses_user -d expenses_restore -c \
  "SELECT version_num FROM alembic_version;"
```

Si el ensayo falla, no toques producción. El error suele ser de rol, extensión
o versión de Postgres, no del dump.

## Restauración sobre producción

### 1. Parar la escritura

Backend, frontend y bots pueden seguir escribiendo. Pará plataforma y bots:

```bash
cd /opt/creditcardanalyzer
export PATH="$HOME/.local/bin:$PATH"
set -a; source .env; set +a

podman-compose -p oikonomia-platform -f docker-compose.platform.yml \
  stop backend platform-frontend celery_worker celery_beat 2>/dev/null || true
podman-compose -p oikonomia-bots -f docker-compose.bots.yml \
  stop telegram_bot 2>/dev/null || true
```

nginx queda arriba y muestra la página de mantenimiento; el monitoreo también
queda arriba.

### 2. Reemplazar la base

```bash
DB=$(podman ps --format '{{.Names}}' | grep -E '_db_' | head -1)
DUMP=/opt/creditcardanalyzer/backups/db_20261120_040000.dump

# Cortar conexiones que hayan quedado
podman exec "$DB" psql -U expenses_user -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
   WHERE datname='expenses' AND pid <> pg_backend_pid();"

podman exec "$DB" dropdb -U expenses_user --if-exists expenses
podman exec "$DB" createdb -U expenses_user expenses
podman cp "$DUMP" "$DB:/tmp/restore.dump"
podman exec "$DB" pg_restore -U expenses_user -d expenses \
  --no-owner --no-privileges /tmp/restore.dump
podman exec "$DB" rm -f /tmp/restore.dump
```

`--no-owner` evita que el restore falle si el dump referencia roles que ya no
existen. La base queda propiedad de `expenses_user`, que es el usuario de la
app.

### 3. Alinear el esquema

Si el dump es del release corriente, `alembic_version` ya está en `head`. Si es
de un release anterior y vas a correr la app nueva:

```bash
DB_URL="postgresql://expenses_user:${POSTGRES_PASSWORD}@db:5432/expenses"
IMAGE="${BACKEND_IMAGE}:${IMAGE_TAG}"

podman run --rm --network "${NETWORK_NAME:-oikonomia}" \
  -e DATABASE_URL="$DB_URL" --entrypoint alembic "$IMAGE" current
podman run --rm --network "${NETWORK_NAME:-oikonomia}" \
  -e DATABASE_URL="$DB_URL" --entrypoint alembic "$IMAGE" upgrade head
```

Si vas a correr una imagen vieja, no corras `upgrade head`: usá la imagen y el
esquema compatibles.

### 4. Volver a levantar

```bash
podman-compose -p oikonomia-platform -f docker-compose.platform.yml up -d
podman-compose -p oikonomia-bots -f docker-compose.bots.yml up -d
```

## Verificación

```bash
# Salud
curl -fsS http://localhost:8000/health/ready | jq

# Conteos y revisión
DB=$(podman ps --format '{{.Names}}' | grep -E '_db_' | head -1)
podman exec "$DB" psql -U expenses_user -d expenses -c \
  "SELECT version_num FROM alembic_version;
   SELECT count(*) AS users FROM users;
   SELECT count(*) AS expenses FROM expenses;"

# Un login real y una lista de gastos
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<cuenta-de-prueba>","password":"<password>"}'
```

Además:

- El dashboard `status` muestra DB y backend arriba.
- Un import pequeño termina en `READY_PREVIEW`, no en `FAILED`.
- No hay alertas nuevas de `oikonomia-backup-stale`.
- La fecha de los datos coincide con el dump elegido.

## Rollback de la restauración

El dump fresco que tomaste en el paso 1 es la vuelta atrás. Restauralo con el
mismo procedimiento. Si no lo tomaste, no hay rollback: estás bajando a un
estado anterior a propósito y perdés lo escrito después de ese dump.

## Lo que este backup no cubre

- **No hay copia fuera del server.** Los dumps viven en el mismo disco que la
  base. Si el disco muere, se pierden base y backups.
- **No hay cifrado del dump.** Los campos `EncryptedType` siguen cifrados, pero
  emails, montos, fechas y relaciones no. Tratá el dump como dato sensible.
- **RPO:** el backup diario deja hasta ~24 h de pérdida; el previo al deploy es
  el más cercano a un cambio riesgoso.
- **RTO:** una restauración completa en el server actual es una ventana de
  mantenimiento, no un cambio en caliente.
