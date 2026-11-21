# Runbooks de operación

Respuesta a incidentes de Oikonomia en producción. Cada runbook tiene la misma
estructura: **síntoma → diagnóstico → acción → verificación → rollback**.

Esto es un proyecto personal, no un servicio 24/7: no hay guardia. Los SLOs de
`../SLOs.md` son objetivos operativos, no compromisos contractuales.

## Entorno de producción

| Dato | Valor |
|---|---|
| Raíz en el server | `/opt/creditcardanalyzer` |
| Compose de plataforma | `docker-compose.platform.yml`, proyecto `oikonomia-platform` |
| Compose de infra | `docker-compose.infra.yml`, proyecto `oikonomia-infra` |
| Compose de bots | `docker-compose.bots.yml`, proyecto `oikonomia-bots` |
| Compose de borde | `docker-compose.nginx.yml`, proyecto `oikonomia-nginx` |
| Compose de monitoreo | `docker-compose.monitoring.yml`, proyecto `oikonomia-monitoring` |
| Backend en el host | `http://localhost:8000` |
| Backups | `/opt/creditcardanalyzer/backups/db_*.dump` |
| Logs | `/opt/creditcardanalyzer/logs/journal.log` (Loki vía Alloy) |
| Deploy | GitHub Release publicado → `.github/workflows/deploy.yml` |

Los contenedores son rootless Podman. Los nombres reales cambian según el
proyecto, así que **no los escribas a mano**: descubrilos con `podman ps`.

## Preámbulo común

Ejecutá esto en el server antes de cualquier comando de los runbooks:

```bash
cd /opt/creditcardanalyzer
export PATH="$HOME/.local/bin:$PATH"
set -a; source .env; set +a

DB=$(podman ps --format '{{.Names}}' | grep -E '_db_' | head -1)
REDIS=$(podman ps --format '{{.Names}}' | grep -E '_redis_' | head -1)
BACKEND=$(podman ps --format '{{.Names}}' | grep -E '_backend_' | head -1)
WORKER=$(podman ps --format '{{.Names}}' | grep -E '_celery_worker_' | head -1)
BEAT=$(podman ps --format '{{.Names}}' | grep -E '_celery_beat_' | head -1)
BOT=$(podman ps --format '{{.Names}}' | grep -E '_telegram_bot_' | head -1)
```

`.env` tiene secretos. No pegues su contenido en un issue, un chat ni una captura.

## Índice

| Síntoma | Runbook |
|---|---|
| Un release falló, la app quedó vieja o hay que volver atrás | [`deploy-rollback.md`](deploy-rollback.md) |
| El job `migrate` falló o el esquema quedó adelantado | [`migration-failed.md`](migration-failed.md) |
| Postgres no responde, está unhealthy o el disco está lleno | [`postgres.md`](postgres.md) |
| Hay que recuperar datos desde un dump | [`restore-backup.md`](restore-backup.md) |
| Redis o Celery atascado; imports en `PROCESSING`/`QUEUED` | [`redis-celery.md`](redis-celery.md) |
| El LLM falla, no hay presupuesto o cambió la clave | [`llm.md`](llm.md) |
| Telegram no responde o WhatsApp rechaza el webhook | [`bots.md`](bots.md) |
| `/health` o `/health/ready` fallan | [`health-checks.md`](health-checks.md) |

## Triage en 60 segundos

```bash
# 1. ¿El proceso está vivo?
curl -fsS http://localhost:8000/health | jq

# 2. ¿Puede atender tráfico? (503 = DB/Redis/Celery caídos)
curl -sS -o /tmp/ready.json -w '%{http_code}\n' http://localhost:8000/health/ready
jq . /tmp/ready.json

# 3. ¿Qué contenedores están abajo?
podman ps -a --format 'table {{.Names}}\t{{.Status}}'

# 4. ¿Se está llenando el disco?
df -h /

# 5. ¿Hay backups recientes?
ls -lh /opt/creditcardanalyzer/backups/db_* | tail -5
```

Después mirá los dashboards `status`, `application` y `logs` en Grafana
(`https://grafana.<dominio>`), o los logs locales:

```bash
tail -n 200 /opt/creditcardanalyzer/logs/journal.log
podman logs "$BACKEND" --tail 200
podman logs "$WORKER" --tail 200
```

## Severidad

| Nivel | Criterio | Respuesta |
|---|---|---|
| **SEV1** | Pérdida o corrupción de datos, secreto comprometido, plataforma caída > 15 min | Parar cambios, preservar evidencia, seguir el runbook y avisar por el chat de admin |
| **SEV2** | Función crítica caída (imports, bots, login) o disco > 90% | Atender en el día; no hace falta despertar a nadie |
| **SEV3** | Degradación parcial, backup viejo, alerta de presupuesto | Siguiente ventana de trabajo |

Ante **sospecha de compromiso de `SECRET_KEY`, de la base o de una cuenta
admin**, no rotes `SECRET_KEY` a ciegas: cambiarla deja ilegibles todos los
campos cifrados. Seguí `../Key-Management.md` y `../Security.md`.

## Reglas que evitan empeorar el incidente

- **No borres el volumen `creditcardanalyzer_postgres_data`.** Ni con
  `podman volume prune`, ni con `compose down -v`. `scripts/housekeeping.sh`
  justamente **no** poda volúmenes por esta razón.
- **No uses `redis-cli FLUSHALL`.** Redis DB 0 es broker de Celery y DB 2 es
  cache. Si hace falta limpiar cache, usá `redis-cli -n 2 FLUSHDB`.
- **No corras `alembic downgrade` en producción sin leer
  [`migration-failed.md`](migration-failed.md).** El deploy no revierte el
  esquema: las migraciones son expand/contract.
- **No restaures un dump sobre producción sin tomar un dump fresco antes** y
  sin parar la escritura. Ver [`restore-backup.md`](restore-backup.md).
- **No cambies `SECRET_KEY`** para “arreglar” un login. Ver
  `../Key-Management.md`.
- **No reinicies todo el stack a la vez.** Reiniciá el servicio que falla;
  nginx y el monitoreo tienen que quedar arriba para poder diagnosticar.
- **Antes de reiniciar, guardá evidencia**: `podman logs --since`, salida de
  `/health/ready`, `df -h`, `podman ps -a`.

## Después del incidente

1. Verificá que el síntoma no vuelve en 24 h (alertas, backups, imports).
2. Abrí un issue con causa raíz y evidencia, aunque el fix sea de una línea.
3. Si el runbook no alcanzó, corregilo en el mismo PR del fix.
4. Si hubo datos personales expuestos, seguí el canal privado de
   `../Security.md`; no abras un issue público.
