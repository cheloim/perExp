# Deploy y rollback de plataforma

Cubre el release normal y la vuelta atrás cuando la app nueva no queda sana.
No cubre cambios de esquema: esos tienen su propio runbook en
[`migration-failed.md`](migration-failed.md).

> **El deploy no sale de un merge.** Sale de un GitHub Release publicado. Un
> merge a `main` no mueve producción; el tag es el `IMAGE_TAG` y lo que está en
> producción es un release, no un commit suelto.

## Cómo se despliega

1. Se publica un release `vMAJOR.MINOR.PATCH` en GitHub.
2. `.github/workflows/deploy.yml` construye backend y frontend con ese tag.
3. Hace un backup verificable de la base antes de tocar datos
   (`scripts/backup-db.sh`).
4. Aplica `alembic upgrade head` con la imagen nueva.
5. Recrea `backend`, `platform-frontend`, `celery_worker` y `celery_beat`.
6. Verifica `http://localhost:8000/health` y el healthcheck del frontend.
7. Si el paso 6 falla, corre el rollback automático a
   `.rollback_platform_tag`.

El deploy guarda el tag anterior en `/opt/creditcardanalyzer/.rollback_platform_tag`
y una copia del entorno en `.env.rollback.platform`.

## Síntomas

| Síntoma | Qué significa |
|---|---|
| El job `migrate` falló | La app nueva **no** se recreó; producción sigue en la versión anterior |
| `deploy-platform` falló y corrió `Rollback on failure` | La app volvió al tag anterior; el esquema puede haber quedado adelantado |
| `/health` responde 200 pero `/health/ready` da 503 | El proceso nuevo arrancó pero no ve DB/Redis/Celery |
| El frontend muestra mantenimiento o 502 | nginx está arriba y el upstream `platform-frontend` no |
| El deploy “pasó” pero la UI no tiene el cambio | Se deployó un tag viejo o el build no se publicó; revisar `IMAGE_TAG` |

## Diagnóstico

```bash
cd /opt/creditcardanalyzer
export PATH="$HOME/.local/bin:$PATH"
set -a; source .env; set +a

BACKEND=$(podman ps --format '{{.Names}}' | grep -E '_backend_' | head -1)
PREV_TAG=$(cat .rollback_platform_tag 2>/dev/null || true)

echo "Tag actual: ${IMAGE_TAG:-?}"
echo "Tag de rollback: ${PREV_TAG:-<ninguno>}"
podman ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
curl -sS -o /tmp/ready.json -w '%{http_code}\n' http://localhost:8000/health/ready
jq . /tmp/ready.json
podman logs "$BACKEND" --tail 200
```

Para ver el detalle del release, abrí **Actions → Deploy** y mirá el job que
falló. El rollback automático imprime el tag al que volvió y el resultado del
health check.

## Acción: rollback manual

Usalo si el rollback automático no corrió, si corrió a medias, o si el defecto
apareció después del deploy y no hay tiempo para un fix.

```bash
cd /opt/creditcardanalyzer
export PATH="$HOME/.local/bin:$PATH"

PREV_TAG=$(cat .rollback_platform_tag)
test -n "$PREV_TAG" || { echo "No hay tag de rollback"; exit 1; }
test -f .env.rollback.platform || { echo "Falta .env.rollback.platform"; exit 1; }

# Entorno del release anterior
set -a; source .env.rollback.platform; set +a
export IMAGE_TAG="$PREV_TAG"

# Bajar sólo plataforma; nginx y monitoreo quedan arriba
podman-compose -p oikonomia-platform -f docker-compose.platform.yml \
  stop backend platform-frontend celery_worker celery_beat 2>/dev/null || true

podman-compose -p oikonomia-platform -f docker-compose.platform.yml up -d
```

Si además se tocaron los bots, volvé a levantar el bot con el tag anterior:

```bash
podman-compose -p oikonomia-bots -f docker-compose.bots.yml \
  up -d --force-recreate telegram_bot
```

### Qué NO hace el rollback

- **No baja el esquema.** `alembic` queda en la revisión que aplicó el release
  fallido. Por eso toda migración destructiva va en expand/contract: la app
  vieja tiene que poder leer el esquema nuevo.
- **No restaura datos.** Si el release escribió datos corruptos, el rollback de
  imagen no los arregla; hay que evaluar [`restore-backup.md`](restore-backup.md).
- **No borra la imagen nueva.** Queda en el registry y en el server hasta el
  próximo housekeeping; sirve para volver a intentar.

Si el esquema quedó incompatible con la app anterior, no fuerces el rollback:
seguí [`migration-failed.md`](migration-failed.md).

## Verificación

```bash
# Backend vivo y listo
curl -fsS http://localhost:8000/health | jq
curl -fsS http://localhost:8000/health/ready | jq

# Frontend servido por nginx
curl -skI "https://${PLATFORM_DOMAIN}/" | head

# Contenedores de plataforma, todos healthy/running
podman ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'backend|platform-frontend|celery'
```

Además:

- Un login real (o `POST /auth/login` con credenciales de prueba) devuelve 200.
- El dashboard `status` de Grafana muestra el backend arriba.
- Los imports dejan de fallar y Celery tiene workers (`/health/ready`,
  `celery_workers`).
- Si el release anterior tenía un bug conocido, confirmá que volvió el
  comportamiento viejo, no sólo que el proceso arrancó.

## Rollback del rollback

Si el tag anterior también está roto, se vuelve a subir el tag nuevo o se corta
un patch release con el fix:

```bash
cd /opt/creditcardanalyzer
export PATH="$HOME/.local/bin:$PATH"
set -a; source .env; set +a
export IMAGE_TAG="<tag-verificado>"
podman-compose -p oikonomia-platform -f docker-compose.platform.yml up -d --force-recreate
```

Preferí un release nuevo a editar `.env` a mano: el próximo deploy reescribe
`.env` y se pierde el cambio manual.

## Cierre

1. Dejá el release fallido sin borrar; el tag y los logs son la evidencia.
2. Abrí un issue con el job que falló y la causa.
3. Cortá un patch release con el fix; no reutilices el tag fallido.
4. Si el rollback automático no se disparó cuando debía, corregí el workflow en
   el mismo PR del fix.
