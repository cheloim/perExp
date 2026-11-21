# Redis o Celery atascado

Redis es crítico para la app: es broker de Celery (DB 0) y cache (DB 2).
Celery es crítico para imports, tareas programadas y reportes. Si cualquiera
falla, `/health/ready` devuelve 503.

## Síntomas

| Síntoma | Qué significa |
|---|---|
| `/health/ready` 503 con `redis.status = error` | Redis no responde |
| `/health/ready` 503 con `celery_workers.status = error` | No hay worker que haga ping |
| `/health/ready` 200 `degraded` con `celery_beat` unknown | Beat no está escribiendo heartbeat |
| Imports quedan en `PROCESSING` o `QUEUED` | Worker caído, cola atascada o lock de usuario |
| Reportes/installments no corren a horario | Beat caído o reloj/zonas mal |
| Redis con memoria alta o `OOM command not allowed` | Cache o resultados acumulados |

## Diagnóstico

```bash
cd /opt/creditcardanalyzer
export PATH="$HOME/.local/bin:$PATH"
set -a; source .env; set +a

REDIS=$(podman ps -a --format '{{.Names}}' | grep -E '_redis_' | head -1)
WORKER=$(podman ps -a --format '{{.Names}}' | grep -E '_celery_worker_' | head -1)
BEAT=$(podman ps -a --format '{{.Names}}' | grep -E '_celery_beat_' | head -1)

podman ps -a --format 'table {{.Names}}\t{{.Status}}' | grep -E 'redis|celery'
podman logs "$REDIS" --tail 100
podman logs "$WORKER" --tail 200
podman logs "$BEAT" --tail 100

# Redis vivo y uso de memoria
podman exec "$REDIS" redis-cli ping
podman exec "$REDIS" redis-cli INFO memory | grep -E 'used_memory_human|maxmemory_human|maxmemory_policy'
podman exec "$REDIS" redis-cli -n 0 DBSIZE
podman exec "$REDIS" redis-cli -n 2 DBSIZE

# Cola default de Celery y heartbeat del beat
podman exec "$REDIS" redis-cli -n 0 LLEN celery
podman exec "$REDIS" redis-cli -n 0 GET celery_beat:heartbeat
podman exec "$REDIS" redis-cli -n 0 TTL celery_beat:heartbeat

# ¿El worker responde?
podman exec "$WORKER" celery -A app.celery_app inspect ping --timeout 5
podman exec "$WORKER" celery -A app.celery_app inspect active --timeout 5
podman exec "$WORKER" celery -A app.celery_app inspect reserved --timeout 5
```

Notas:

- `celery_beat:heartbeat` lo escribe beat cada minuto con TTL 120 s. Si `TTL`
  es `-2`, no existe; si es `-1`, no tiene expiración (algo lo escribió mal).
- El backend usa `inspect(timeout=2.0)` en `/health/ready`. Un worker saturado
  puede dar 503 aunque esté vivo.
- Los locks de import son `import_lock:user:<id>` con TTL de 10 minutos.

## Acción

### 1. Redis caído

```bash
podman restart "$REDIS"
podman exec "$REDIS" redis-cli ping
```

El volumen `creditcardanalyzer_redis_data` persiste, pero **las colas en vuelo
pueden perderse**. Redis no es fuente de verdad: la base sí. Después de
reiniciar, revisá imports trabados y dejá que se reintenten.

Si Redis no arranca, mirá `podman logs "$REDIS"` antes de recrear. No borres el
volumen para “limpiar”: perderías cache y colas sin necesidad.

### 2. Worker caído o colgado

```bash
podman-compose -p oikonomia-platform -f docker-compose.platform.yml \
  restart celery_worker
podman exec "$WORKER" celery -A app.celery_app inspect ping --timeout 5
```

Si el worker está en loop de crash por memoria, el compose ya lo reinicia cada
100 tareas (`worker_max_tasks_per_child=100`). Si el crash es por código, no
insistas: rollback de imagen ([`deploy-rollback.md`](deploy-rollback.md)) o fix.

### 3. Beat caído

```bash
podman-compose -p oikonomia-platform -f docker-compose.platform.yml \
  restart celery_beat
sleep 70
podman exec "$REDIS" redis-cli -n 0 GET celery_beat:heartbeat
podman exec "$REDIS" redis-cli -n 0 TTL celery_beat:heartbeat
```

Si el heartbeat sigue sin aparecer:

- Verificá que haya **un solo** beat. Dos beats duplican tareas programadas.
- Revisá que `CELERY_BEAT_SCHEDULE_FILENAME` apunte a un path escribible
  (`/tmp/celerybeat-schedule` por defecto).
- Revisá la hora del host: el schedule está en UTC.

### 4. Cola atascada

```bash
# ¿Hay tareas esperando?
podman exec "$REDIS" redis-cli -n 0 LLEN celery

# ¿Qué está ejecutando el worker?
podman exec "$WORKER" celery -A app.celery_app inspect active --timeout 5
podman exec "$WORKER" celery -A app.celery_app inspect reserved --timeout 5
```

Si hay una tarea colgada más de 10 minutos, Celery la corta por
`task_time_limit=600`. Si no se libera, reiniciá el worker. No borres la cola a
mano salvo que sepas qué tareas se pierden:

```bash
# Destructivo: descarta tareas pendientes. La base no se toca.
# podman exec "$REDIS" redis-cli -n 0 DEL celery
```

### 5. Lock de import trabado

Un worker muerto puede dejar `import_lock:user:<id>`. El lock tiene TTL de 10
minutos, así que normalmente se libera solo. Para verlo:

```bash
podman exec "$REDIS" redis-cli -n 0 --scan --pattern 'import_lock:user:*'
```

Antes de borrar un lock, confirmá que no hay una tarea activa para ese usuario:

```bash
podman exec "$WORKER" celery -A app.celery_app inspect active --timeout 5
```

Si no hay tarea activa y el TTL no baja, borralo:

```bash
podman exec "$REDIS" redis-cli -n 0 DEL 'import_lock:user:<id>'
```

Después, el job puede quedar en `PROCESSING`. El cleanup diario lo pasa a
`FAILED` después de una hora; para no esperar, ejecutá el cleanup ahora:

```bash
podman exec "$WORKER" python -c \
  "from app.tasks.cleanup_import_jobs import cleanup_expired_import_jobs; print(cleanup_expired_import_jobs())"
```

### 6. Redis con memoria alta

`maxmemory_policy` no está configurada, así que Redis no evicta: si llega al
límite, empieza a rechazar escrituras. Los resultados de Celery expiran solos a
la hora (`result_expires=3600`).

Si el problema es cache, limpiá **sólo DB 2**:

```bash
podman exec "$REDIS" redis-cli -n 2 FLUSHDB
```

No uses `FLUSHALL`: borra también DB 0 (broker y locks). Si el problema es la
cola, primero identificá qué la llena (`LLEN celery`, `inspect active`) y
reiniciá el worker; no vacíes Redis por reflejo.

## Verificación

```bash
curl -fsS http://localhost:8000/health/ready | jq '.checks.redis, .checks.celery_workers, .checks.celery_beat'

podman exec "$REDIS" redis-cli ping
podman exec "$REDIS" redis-cli -n 0 LLEN celery
podman exec "$WORKER" celery -A app.celery_app inspect ping --timeout 5
```

Y un flujo real: subí un import pequeño y confirmá que llega a
`READY_PREVIEW`. Consultá `oikonomia_import_jobs_total{status="FAILED"}` y
`oikonomia_import_jobs_total{status="PROCESSING"}` en Grafana.

## Rollback

| Cambio | Cómo volver |
|---|---|
| Se reinició Redis | No hay rollback de colas; las tareas en vuelo se pierden. Reintentar imports y tareas |
| Se borró la cola `celery` | Igual: las tareas pendientes se pierden; el cleanup marca los jobs viejos como `FAILED` |
| Se limpió cache DB 2 | Se repuebla sola; no hay pérdida de datos |
| Se reinició worker/beat | Sin pérdida; sólo se interrumpen tareas en ejecución, que se reintentan si `acks_late` las vuelve a entregar |
| Se cambió configuración de Celery | Rollback de imagen a un tag sano y recrear worker/beat |
