# Telegram o WhatsApp caídos

Los dos canales tienen caminos distintos:

- **Telegram** corre en un contenedor aparte (`telegram_bot`) con long polling.
  En producción la plataforma tiene `TELEGRAM_BOT_ENABLED=false` para no
  levantar un segundo poller.
- **WhatsApp** no tiene contenedor propio: Meta llama al webhook del backend
  (`/webhook/whatsapp`) y el backend procesa el mensaje en una tarea asíncrona.

## Síntomas

| Síntoma | Qué significa |
|---|---|
| Telegram no responde, pero la web anda | Bot caído, token inválido o conflicto de poller |
| `oikonomia_telegram_bot_healthy` en 0 | No hay thread ni heartbeat `bot:heartbeat` |
| Log `409 Conflict: terminated by other getUpdates request` | Hay dos instancias haciendo polling |
| WhatsApp no recibe mensajes | Webhook mal configurado en Meta, firma inválida o backend caído |
| Meta muestra entregas fallidas | El webhook devuelve 4xx/5xx o tarda más de 5 s |
| `403 Invalid signature` en el log | `WHATSAPP_APP_SECRET` no coincide |
| `403 Forbidden` en la verificación GET | `WHATSAPP_VERIFY_TOKEN` no coincide |

## Diagnóstico

```bash
cd /opt/creditcardanalyzer
export PATH="$HOME/.local/bin:$PATH"
set -a; source .env; set +a

BOT=$(podman ps -a --format '{{.Names}}' | grep -E '_telegram_bot_' | head -1)
REDIS=$(podman ps --format '{{.Names}}' | grep -E '_redis_' | head -1)
BACKEND=$(podman ps --format '{{.Names}}' | grep -E '_backend_' | head -1)

podman ps -a --format 'table {{.Names}}\t{{.Status}}' | grep -E 'telegram|backend'
podman logs "$BOT" --tail 200
podman logs "$BACKEND" --since 30m | grep -iE 'whatsapp|webhook|signature' | tail -50

# Heartbeat del bot (TTL 60 s)
podman exec "$REDIS" redis-cli -n 0 GET bot:heartbeat
podman exec "$REDIS" redis-cli -n 0 TTL bot:heartbeat

# Salud desde el backend
curl -sS http://localhost:8000/health/ready | jq '.checks.telegram_bot'
```

Telegram:

```bash
# ¿El token sigue siendo válido? No imprime el token, sólo el bot.
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" | jq '{ok, result: .result.username}'
```

WhatsApp (verificación GET de Meta):

```bash
curl -sS -o /tmp/wa.txt -w '%{http_code}\n' \
  "https://${PLATFORM_DOMAIN}/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${WHATSAPP_VERIFY_TOKEN}&hub.challenge=test"
cat /tmp/wa.txt
```

Esperado: `200` y el cuerpo `test`. Si da `403`, el verify token no coincide.
Para probar el POST firmado, usá el botón de prueba de Meta; replicar
`X-Hub-Signature-256` a mano no aporta.

## Acción

### Telegram

#### El contenedor está caído

```bash
podman-compose -p oikonomia-bots -f docker-compose.bots.yml up -d telegram_bot
podman logs "$BOT" --tail 100
```

El entrypoint espera DB y Redis hasta 60/30 s y después arranca. Si sale con
“TELEGRAM_BOT_TOKEN is not set” o “SECRET_KEY must be at least 32 characters”,
el problema es el entorno, no el bot.

#### Token inválido o revocado

`getMe` devuelve `ok: false` o 401. Generá un token nuevo con BotFather,
actualizalo en `.env` y en el secret de GitHub, y recreá:

```bash
podman-compose -p oikonomia-bots -f docker-compose.bots.yml \
  up -d --force-recreate telegram_bot
```

#### Dos pollers (409 Conflict)

Sólo puede haber un proceso haciendo `getUpdates`. Revisá:

```bash
podman ps --format '{{.Names}}' | grep -E 'telegram_bot|backend'
```

Si el backend de plataforma tiene `TELEGRAM_BOT_ENABLED=true`, está compitiendo
con el contenedor. En producción debe ser `false`; corregí `.env` y recreá el
backend. No levantes el bot dentro de la plataforma “para probar”.

#### El bot está vivo pero no procesa

Puede estar esperando DB/Redis o atascado en un handler. Mirá el log y
`/health/ready`. Si la DB o Redis están caídos, seguí sus runbooks:
[`postgres.md`](postgres.md) y [`redis-celery.md`](redis-celery.md).

### WhatsApp

#### El webhook no verifica

- Confirmá que la URL pública es la del backend detrás de `/api`:
  `https://<PLATFORM_DOMAIN>/api/webhook/whatsapp`.
- Compará `WHATSAPP_VERIFY_TOKEN` con el valor configurado en Meta. Si lo
  rotás, actualizá los dos lados.
- Reiniciá el backend después de cambiar el token.

#### Los POST llegan con 403

`WHATSAPP_APP_SECRET` no coincide con el secret de la app de Meta, o falta. En
producción el backend **no arranca** si WhatsApp está habilitado y falta el
app secret. Revisá el log de arranque:

```bash
podman logs "$BACKEND" --since 10m | grep -i 'WHATSAPP_APP_SECRET'
```

Corregí el secret en `.env` y en GitHub, y recreá:

```bash
podman-compose -p oikonomia-platform -f docker-compose.platform.yml \
  up -d --force-recreate backend
```

#### Meta reintenta o marca fallos

Meta espera respuesta 200 en menos de 5 s. El endpoint responde rápido y
procesa en background; si el backend está lento o caído, Meta reintenta. El
webhook deduplica por `message_id` durante 7 días (`wa_message:<id>`), así que
un reintento no debería crear un gasto doble.

Si el backend está sano y Meta sigue fallando, revisá la configuración del
callback en Meta Business Suite y que el certificado TLS sea válido.

## Verificación

```bash
# Telegram: heartbeat y respuesta
podman exec "$REDIS" redis-cli -n 0 TTL bot:heartbeat
podman logs "$BOT" --since 5m | tail -20

# WhatsApp: verificación y salud
curl -sS -o /tmp/wa.txt -w '%{http_code}\n' \
  "https://${PLATFORM_DOMAIN}/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${WHATSAPP_VERIFY_TOKEN}&hub.challenge=test"
cat /tmp/wa.txt

# Backend listo
curl -fsS http://localhost:8000/health/ready | jq
```

Además, mandá un mensaje real desde cada canal:

- Telegram: “gasté 1500 en farmacia” devuelve un borrador.
- WhatsApp: el mensaje aparece en el log como inbound y el bot responde.
- `oikonomia_telegram_messages_total{direction="inbound"}` y
  `oikonomia_whatsapp_messages_total{direction="inbound"}` incrementan.

## Rollback

| Cambio | Cómo volver |
|---|---|
| Token de Telegram rotado | Restaurar el token anterior y recrear el bot |
| Verify token de WhatsApp rotado | Restaurar el valor anterior **y** actualizarlo en Meta |
| App secret de WhatsApp rotado | Restaurar el secret anterior y recrear el backend |
| Se levantó un segundo poller | Parar el contenedor o el flag `TELEGRAM_BOT_ENABLED` duplicado |
| Se cambió el código del bot | Rollback de imagen ([`deploy-rollback.md`](deploy-rollback.md)) y recrear bots |

Los mensajes no se guardan en Telegram ni en Meta: si se pierde un mensaje
durante la caída, el usuario tiene que reenviarlo. No hay cola persistente de
mensajes de bots.
