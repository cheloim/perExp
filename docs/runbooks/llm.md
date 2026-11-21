# LLM caído, sin presupuesto o con clave inválida

El LLM no es crítico para leer datos, pero sí para importar extractos, analizar
gastos, sugerir categorías, transcribir audio y parsear mensajes de los bots.
Cuando falla, la app sigue en pie y esas funciones devuelven error o degradan.

## Síntomas

| Síntoma | Qué significa |
|---|---|
| Imports terminan en `FAILED` con error de LLM | Clave, cuota, timeout o proveedor caído |
| `/analysis` o `/investments` devuelven 5xx | El proveedor no responde o bloqueó la cuenta |
| El bot responde “no pude interpretar el gasto” | Parseo por LLM fallando |
| `oikonomia-llm-budget-nearly-exhausted` / `exhausted` | Presupuesto mensual consumido |
| `oikonomia-llm-high-error-rate` | Más del 5% de llamadas fallan |
| `oikonomia-llm-metrics-failing` | Redis no registra uso; el panel queda ciego |
| Captura de audio/imagen devuelve “no disponible” | Proveedor o modelo sin capability |

## Diagnóstico

```bash
cd /opt/creditcardanalyzer
export PATH="$HOME/.local/bin:$PATH"
set -a; source .env; set +a

BACKEND=$(podman ps --format '{{.Names}}' | grep -E '_backend_' | head -1)
WORKER=$(podman ps --format '{{.Names}}' | grep -E '_celery_worker_' | head -1)

podman logs "$BACKEND" --since 30m | grep -iE 'llm|openai|google|budget|quota|401|403|429|timeout' | tail -50
podman logs "$WORKER" --since 30m | grep -iE 'llm|import|budget|quota|timeout' | tail -50
```

En Grafana (`application` y `llm`) o por PromQL:

```promql
# Tasa de error del LLM
sum(rate(oikonomia_llm_requests_total{status!="ok"}[10m]))
/
clamp_min(sum(rate(oikonomia_llm_requests_total[10m])), 0.000001)

# Presupuesto y crédito
oikonomia_llm_spend_usd_month_to_date
oikonomia_llm_budget_used_ratio
oikonomia_llm_credit_balance_usd
oikonomia_llm_credit_expires_timestamp_seconds

# ¿Se está registrando el uso?
rate(oikonomia_llm_metrics_record_failures_total[15m])
```

Para distinguir “proveedor caído” de “nuestra clave está mal”, mirá el status
HTTP en el log: 401/403 es credencial o permisos; 429 es cuota/rate limit;
timeout/5xx es proveedor o red. Los estados de OpenAI están en
<https://status.openai.com>.

## Acción

### 1. Presupuesto agotado

El cliente bloquea llamadas cuando `spend_usd >= LLM_MONTHLY_BUDGET_USD` y las
registra como `status="budget_blocked"`. No es una caída: es el control de
costos funcionando.

Opciones, en orden:

1. Esperar el próximo mes calendario.
2. Subir el presupuesto de forma deliberada y documentada.
3. Si hay crédito prepago, verificar que no esté vencido
   (`oikonomia_llm_credit_expires_timestamp_seconds`) y actualizar
   `LLM_CREDIT_AMOUNT_USD` / `LLM_CREDIT_EXPIRES_AT` si corresponde.

Para cambiar el presupuesto en producción, editá `.env` y recreá los servicios
que usan LLM:

```bash
cd /opt/creditcardanalyzer
cp .env ".env.bak.$(date +%Y%m%d_%H%M%S)"
# editar LLM_MONTHLY_BUDGET_USD (y LLM_CREDIT_* si aplica)
podman-compose -p oikonomia-platform -f docker-compose.platform.yml \
  up -d --force-recreate backend celery_worker celery_beat
```

El próximo deploy reescribe `.env`: actualizá también el secret/variable de
GitHub si el cambio tiene que sobrevivir.

### 2. Clave inválida, revocada o sin permisos

Síntoma típico: 401/403, “invalid api key”, “project does not have access to
model”. Rotá la clave:

1. Generá la clave nueva en el proveedor.
2. Actualizá `LLM_API_KEY`, `INVESTMENTS_LLM_API_KEY` y
   `MESSAGES_BOT_LLM_API_KEY` según corresponda. Son claves distintas y pueden
   tener permisos distintos.
3. Actualizá el secret de GitHub para que el próximo deploy no vuelva a la
   clave vieja.
4. Recreá backend, worker y, si cambió la clave del bot, el bot:

```bash
cd /opt/creditcardanalyzer
export PATH="$HOME/.local/bin:$PATH"
set -a; source .env; set +a
podman-compose -p oikonomia-platform -f docker-compose.platform.yml \
  up -d --force-recreate backend celery_worker celery_beat
podman-compose -p oikonomia-bots -f docker-compose.bots.yml \
  up -d --force-recreate telegram_bot
```

No hace falta tocar `SECRET_KEY`: las claves del LLM no cifran datos de la app.

### 3. Proveedor caído o rate limit

Si el proveedor devuelve 5xx, timeout o 429:

- No cambies a `LLM_PROVIDER=google` a ciegas. Google solo cubre texto; visión y
  audio no tienen adapter equivalente y la captura devuelve “no disponible”.
- No desactives el presupuesto para “destrabar”: el problema no es el límite.
- Avisá a los usuarios (o esperá): los imports quedan en `FAILED` y se pueden
  reintentar cuando el proveedor vuelva.
- Si el 429 es por rate limit, bajá la concurrencia o esperá; no hay retry
  infinito. El cliente reintenta una vez y luego falla.

### 4. Modelo o configuración cambiada

Si el fallo empezó después de tocar `LLM_MODEL_NAME`, `LLM_VISION_MODEL` o
`LLM_AUDIO_MODEL`, volvé al valor anterior y recreá:

```bash
# restaurar la línea del modelo en .env
podman-compose -p oikonomia-platform -f docker-compose.platform.yml \
  up -d --force-recreate backend celery_worker
```

El proyecto de OpenAI deployado no garantiza todos los modelos: por ejemplo,
`whisper-1` puede no estar habilitado aunque sea un default histórico. La
configuración vigente está en `../AI-Integration.md`.

### 5. El uso no se registra

`oikonomia_llm_metrics_record_failures_total` subiendo significa que Redis
rechazó los registros. La app sigue funcionando, pero el panel y el control de
presupuesto quedan ciegos. Revisá Redis
([`redis-celery.md`](redis-celery.md)) y la memoria del broker.

## Verificación

```bash
# El error rate vuelve a cero y hay llamadas OK
curl -sS http://localhost:8000/metrics | grep -E 'oikonomia_llm_requests_total|oikonomia_llm_budget_used_ratio'

# Una operación real: import pequeño o análisis
# (consume presupuesto; usar un archivo de prueba)
```

Además:

- Un import termina en `READY_PREVIEW`, no en `FAILED`.
- El bot parsea “gasté 1500 en farmacia” y devuelve un borrador.
- El dashboard `llm` muestra la llamada con `status="ok"`.
- No hay alertas de presupuesto nuevas.

## Rollback

| Cambio | Cómo volver |
|---|---|
| Se subió el presupuesto | Restaurar `.env` anterior y recrear; el gasto ya hecho no se revierte |
| Se rotó una clave | Restaurar la clave anterior desde el secret manager y recrear |
| Se cambió el modelo | Restaurar `LLM_MODEL_NAME` / `LLM_VISION_MODEL` / `LLM_AUDIO_MODEL` y recrear |
| Se cambió el proveedor | Volver a `LLM_PROVIDER=openai` y al modelo anterior; Google no cubre visión/audio |
| Se perdieron métricas por Redis | No hay rollback de datos; se reanuda el registro cuando Redis vuelve |

Las claves del LLM no están acopladas a los datos cifrados. Rotarlas no pierde
gastos ni obliga a re-login.
