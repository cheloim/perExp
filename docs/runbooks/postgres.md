# Postgres caído o sin disco

Postgres es crítico: si no responde, `/health/ready` devuelve 503, el login y
toda la API fallan, y Celery no puede procesar imports.

## Síntomas

| Síntoma | Qué significa |
|---|---|
| `/health/ready` 503 con `checks.database.status = error` | El backend no conecta |
| Contenedor `db` en `unhealthy` o `restarting` | Proceso, volumen o disco |
| `could not extend file ... No space left on device` | Disco o volumen lleno |
| `FATAL: remaining connection slots are reserved` | Pool agotado |
| `database system is in recovery mode` | Postgres se está recuperando; no lo mates |
| API con 500 en todo, `/health` sigue 200 | Liveness no chequea DB: es este runbook |

## Diagnóstico

```bash
cd /opt/creditcardanalyzer
export PATH="$HOME/.local/bin:$PATH"
set -a; source .env; set +a

DB=$(podman ps -a --format '{{.Names}}' | grep -E '_db_' | head -1)
podman ps -a --format 'table {{.Names}}\t{{.Status}}' | grep -E 'db|redis'
podman inspect "$DB" --format '{{.State.Health.Status}} exit={{.State.ExitCode}}'
podman logs "$DB" --tail 200

# ¿Responde dentro del contenedor?
podman exec "$DB" pg_isready -U expenses_user -d expenses

# Disco del host y del volumen
df -h /
podman system df -v

# ¿Quién está conectado y qué está esperando?
podman exec "$DB" psql -U expenses_user -d expenses -c \
  "SELECT state, count(*) FROM pg_stat_activity WHERE datname='expenses' GROUP BY state;"
podman exec "$DB" psql -U expenses_user -d expenses -c \
  "SELECT pid, state, wait_event_type, now()-xact_start AS age, left(query,100)
   FROM pg_stat_activity WHERE datname='expenses' ORDER BY age DESC NULLS LAST;"
```

Si el contenedor no existe, el volumen puede haber quedado huérfano. **No crees
un volumen vacío con el mismo nombre**: primero confirmá que existe:

```bash
podman volume inspect creditcardanalyzer_postgres_data
```

## Acción

### 1. El contenedor está parado o unhealthy

```bash
cd /opt/creditcardanalyzer
export PATH="$HOME/.local/bin:$PATH"
set -a; source .env; set +a

# No uses --force-recreate si sospechás del volumen: primero intentá arrancar.
podman start "$DB" 2>/dev/null || \
  podman-compose -p oikonomia-infra -f docker-compose.infra.yml up -d db

# Esperar healthy (máximo ~60 s)
for i in $(seq 1 20); do
  STATUS=$(podman inspect "$DB" --format '{{.State.Health.Status}}' 2>/dev/null || echo missing)
  echo "$i: $STATUS"
  [ "$STATUS" = healthy ] && break
  sleep 3
done
```

Si queda en `restarting`, mirá `podman logs "$DB"` antes de volver a arrancar.
Un loop de crash por configuración no se arregla reiniciando.

### 2. Disco lleno

Primero la limpieza segura del repo:

```bash
bash /opt/creditcardanalyzer/scripts/housekeeping.sh
df -h /
```

`housekeeping.sh` borra tags viejos de la app, imágenes dangling, logs y backups
con más de 15 días. **No poda volúmenes** a propósito.

Si sigue sin espacio, identificá qué ocupa:

```bash
du -xhd1 /opt/creditcardanalyzer 2>/dev/null | sort -h
du -sh /opt/creditcardanalyzer/backups /opt/creditcardanalyzer/logs 2>/dev/null
podman system df -v
```

Acciones seguras, en orden:

1. Forzar la rotación de logs: `sudo logrotate -f /etc/logrotate.d/oikonomia`.
2. Acotar el journal: `sudo journalctl --vacuum-size=1G` y
   `sudo journalctl --vacuum-time=15d`.
3. Borrar backups viejos **sólo** si hay al menos uno reciente verificado:
   `ls -lh /opt/creditcardanalyzer/backups/db_*`.
4. `podman image prune -f` para imágenes dangling.

**Nunca** borres `creditcardanalyzer_postgres_data` ni archivos dentro de
`/var/lib/postgresql/data`. Si el volumen es el que se llenó, el problema se
resuelve ampliando disco o moviendo el volumen, no borrando la base.

Si el disco está lleno porque `pg_wal` creció, no borres WAL a mano. Reiniciá
Postgres con espacio libre y revisá si hay una transacción o replicación
colgada.

### 3. Pool de conexiones agotado

```bash
podman exec "$DB" psql -U expenses_user -d expenses -c \
  "SELECT count(*), state FROM pg_stat_activity WHERE datname='expenses' GROUP BY state;"
```

Si hay muchas `idle in transaction`, identificá la más vieja y evaluá terminarla
(igual que en [`migration-failed.md`](migration-failed.md)). Si el backend se
quedó sin pool por un bug, reiniciá **sólo** backend y workers, no la base:

```bash
podman-compose -p oikonomia-platform -f docker-compose.platform.yml \
  restart backend celery_worker celery_beat
```

### 4. La base no arranca por corrupción

No improvises `pg_resetwal` ni borres el volumen. Tomá el último dump
verificado y seguí [`restore-backup.md`](restore-backup.md). Si el volumen
todavía responde aunque sea parcialmente, copiá el directorio de datos antes de
cualquier intento.

## Verificación

```bash
cd /opt/creditcardanalyzer
export PATH="$HOME/.local/bin:$PATH"
set -a; source .env; set +a

DB=$(podman ps --format '{{.Names}}' | grep -E '_db_' | head -1)
podman exec "$DB" pg_isready -U expenses_user -d expenses
podman exec "$DB" psql -U expenses_user -d expenses -c "SELECT 1;"
curl -fsS http://localhost:8000/health/ready | jq '.checks.database'
```

Y un flujo real: login, listar gastos, un import pequeño. Que `SELECT 1` ande
no prueba que las tablas estén sanas.

## Rollback

| Cambio | Cómo volver |
|---|---|
| Se recreó el contenedor sin querer | `podman-compose -p oikonomia-infra -f docker-compose.infra.yml up -d`, sin tocar el volumen |
| Se cambió `.env` (password, puerto) | Restaurar el `.env` anterior y recrear `db`; si la password cambió, actualizarla también en el backend |
| Se restauró un dump equivocado | Restaurar el dump fresco que tomaste antes; si no existe, el último backup verificado |
| Se borró/corrompió el volumen | Restaurar backup en un volumen nuevo; no hay vuelta atrás sin dump |

El backup diario y el previo al deploy están en
`/opt/creditcardanalyzer/backups`. La copia fuera del server **todavía no
existe**: si se pierde el disco, se pierde también el backup. Es un riesgo
aceptado y documentado en `../Threat-Model.md`.
