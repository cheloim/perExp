# Health checks fallando

Hay tres chequeos y no significan lo mismo:

| Endpoint | Qué prueba | Esperado |
|---|---|---|
| `GET /health` | Sólo que el proceso responde. No toca DB, Redis ni Celery | 200 siempre |
| `GET /health/ready` | DB, Redis y workers Celery (críticos); beat y Telegram (opcionales) | 200 `healthy`/`degraded`, 503 `unhealthy` |
| `GET /x/<slug>/system/health` | Panel admin: latencias, memoria, workers, métricas | 200 con auth de admin |

En producción el backend escucha en `http://localhost:8000`. Públicamente se
llega por `https://<PLATFORM_DOMAIN>/api/health` (el frontend proxya `/api/` al
backend). `/metrics` está bloqueado en nginx y no es un health check.

## Síntomas

| Síntoma | Qué significa |
|---|---|
| `curl /health` falla o da timeout | Proceso/backend/contenedor caído, no una dependencia |
| `/health` 200, `/health/ready` 503 | DB, Redis o Celery caídos |
| `/health/ready` 200 `degraded` | Beat o Telegram opcional caídos |
| `/health` 200 y `/health/ready` 200, pero la UI falla | Problema de aplicación, no de readiness |
| Contenedor `unhealthy` pero `curl` desde el host anda | Healthcheck interno, puerto o `start_period` |
| Blackbox marca `platform.oikonomia.ar` caído | nginx, TLS o frontend; el backend puede estar bien |

## Diagnóstico

```bash
cd /opt/creditcardanalyzer
export PATH="$HOME/.local/bin:$PATH"
set -a; source .env; set +a

# Liveness
curl -sS -o /tmp/live.json -w '%{http_code}\n' http://localhost:8000/health
jq . /tmp/live.json

# Readiness: guardar el cuerpo aunque sea 503
curl -sS -o /tmp/ready.json -w '%{http_code}\n' http://localhost:8000/health/ready
jq . /tmp/ready.json

# Contenedores y healthchecks de Podman
podman ps -a --format 'table {{.Names}}\t{{.Status}}'
BACKEND=$(podman ps -a --format '{{.Names}}' | grep -E '_backend_' | head -1)
podman inspect "$BACKEND" --format '{{.State.Health.Status}}'
podman logs "$BACKEND" --tail 200
```

El cuerpo de `/health/ready` dice exactamente qué falla:

```json
{
  "status": "unhealthy",
  "checks": {
    "database": {"status": "error"},
    "redis": {"status": "error"},
    "celery_workers": {"status": "error", "worker_count": 0},
    "celery_beat": {"status": "unknown"},
    "telegram_bot": {"status": "down"}
  }
}
```

## Árbol de decisión

### `/health` falla

El proceso no está. No pierdas tiempo mirando DB:

```bash
BACKEND=$(podman ps -a --format '{{.Names}}' | grep -E '_backend_' | head -1)
podman ps -a --format 'table {{.Names}}\t{{.Status}}' | grep backend
podman logs "$BACKEND" --tail 200
```

- Si el contenedor no existe o está `exited`: `podman-compose -p oikonomia-platform -f docker-compose.platform.yml up -d backend`.
- Si está en crash loop: leé el log. Un `SECRET_KEY` inválido, una migración
  faltante o un import roto impiden arrancar; no es un problema de health check.
- Si el contenedor está `running` pero el puerto no responde: verificá
  `podman port "$BACKEND"` y que el proceso escuche en `0.0.0.0:8000`.

Si el backend está bien pero la URL pública falla, el problema es nginx o TLS:
mirá `podman logs` del contenedor `_nginx_` y probá
`curl -skI https://<PLATFORM_DOMAIN>/`.

### `/health/ready` 503

Usá el `checks` del JSON:

| Check en error | Runbook |
|---|---|
| `database` | [`postgres.md`](postgres.md) |
| `redis` | [`redis-celery.md`](redis-celery.md) |
| `celery_workers` | [`redis-celery.md`](redis-celery.md) |
| Varios a la vez | Empezá por infraestructura: DB/Redis; el resto suele seguir |

`/health/ready` hace `inspect(timeout=2.0)` a Celery. Un worker saturado puede
dar 503 aunque esté vivo; en ese caso mirá `inspect active` antes de reiniciar.

### `/health/ready` 200 `degraded`

Los críticos están bien; falla un opcional:

- `celery_beat` `unknown`: no hay heartbeat en Redis. Ver
  [`redis-celery.md`](redis-celery.md), sección beat.
- `telegram_bot` `down`: el bot no tiene thread ni heartbeat. Ver
  [`bots.md`](bots.md).

`degraded` no bloquea el tráfico, pero no lo ignores: los reportes semanales y
mensuales dependen de beat.

### Todo verde pero hay errores

El health check es de dependencias, no de correctness. Mirá:

```bash
podman logs "$BACKEND" --since 30m | grep -E 'ERROR|CRITICAL|Traceback' | tail -50
```

Y en Grafana:

- `application`: tasa de 5xx, latencia, endpoints.
- `logs`: errores por contenedor.
- `llm`: si el fallo es de import/análisis.

Si los 5xx vienen de un release reciente, seguí
[`deploy-rollback.md`](deploy-rollback.md).

### El healthcheck de Podman falla pero el host responde

El healthcheck corre **dentro** del contenedor:

```bash
podman exec "$BACKEND" python -c \
  "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/health').status)"
```

Si esto falla pero `curl` desde el host anda, el contenedor no se ve a sí mismo
(proceso en otra interfaz/puerto) o el healthcheck está mal configurado. Si el
proceso tarda en arrancar, revisá `start_period` antes de bajar el intervalo.

## Verificación

```bash
# Los dos endpoints, con status y cuerpo
curl -fsS http://localhost:8000/health | jq
curl -fsS http://localhost:8000/health/ready | jq

# Healthchecks de los contenedores de plataforma
podman ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'backend|platform-frontend|celery'

# Público (nginx + TLS + frontend proxy)
curl -fsS "https://${PLATFORM_DOMAIN}/api/health" | jq
```

Además, un login y una operación real. Un readiness verde con la base vacía o
con un esquema roto sigue siendo un incidente.

## Rollback

| Causa | Acción |
|---|---|
| Release nuevo rompió el arranque | Rollback de imagen ([`deploy-rollback.md`](deploy-rollback.md)) |
| Dependencia caída (DB/Redis/Celery) | Seguir su runbook; no hay rollback de la app |
| Se cambió un healthcheck o un probe | Revertir el cambio y recrear el servicio; el healthcheck no debe ser más estricto que el servicio real |
| nginx/TLS | Revertir `nginx.conf` o el certificado; `nginx -t` antes de `nginx -s reload` |
