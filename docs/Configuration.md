# Configuración y entornos

Todo lo que la aplicación lee del entorno, con su default real y su efecto.

## Cómo se carga la configuración

Hay **dos mecanismos distintos** y conviene no confundirlos:

| Mecanismo | Qué resuelve | Dónde |
|---|---|---|
| **Interpolación de Compose** | Valores que `podman-compose.yml` necesita para construir el entorno (`POSTGRES_PASSWORD`, `LLM_PROVIDER`, …) | `.env` en la raíz |
| **Podman secrets** | Credenciales reales, montadas como archivos en `/run/secrets/` y leídas por el backend | `secrets/<env>/` → `./scripts/setup-secrets.sh <env>` |

El backend **no** lee un `.env` por sí solo: en Podman recibe las variables por
`environment:` y los secretos por `secrets:`. Si corrés el backend fuera de Podman, tenés
que exportarlas a mano.

### Puesta en marcha

```bash
cp .env.example .env          # completá POSTGRES_PASSWORD y POSTGRES_PASSWORD_DEV
mkdir -p secrets/dev/backend secrets/dev/frontend
# ... completá los archivos de secrets/dev/ ...
./scripts/setup-secrets.sh dev
podman-compose up -d
```

`setup-secrets.sh` espera exactamente estos archivos:

```
secrets/<env>/backend/POSTGRES_PASSWORD
secrets/<env>/backend/LLM_API_KEY
secrets/<env>/backend/INVESTMENTS_LLM_API_KEY
secrets/<env>/backend/MESSAGES_BOT_LLM_API_KEY
secrets/<env>/backend/TELEGRAM_BOT_TOKEN
secrets/<env>/backend/GOOGLE_CLIENT_ID
secrets/<env>/backend/GOOGLE_CLIENT_SECRET
secrets/<env>/backend/SECRET_KEY
secrets/<env>/frontend/GOOGLE_CLIENT_ID
```

## Variables del backend

### Núcleo

| Variable | Default | Obligatoria | Para qué |
|---|---|---|---|
| `DATABASE_URL` | `postgresql://expenses_user:changeme@localhost:5432/expenses` | prod: sí | Conexión SQLAlchemy. En Compose se construye desde `POSTGRES_PASSWORD`. |
| `SECRET_KEY` | — | **sí** | Clave de cifrado de campos y fallback de firma JWT. Mínimo 32 caracteres. Cambiarla **inutiliza los datos cifrados** (ver `Key-Management.md`). |
| `JWT_SECRET` | `SECRET_KEY` | no | Clave de firma separada. Permite rotar la firma sin tocar el cifrado. |
| `JWT_EXPIRE_DAYS` | `7` | no | Vigencia del access token. |
| `ENCRYPTION_KEY` | `SECRET_KEY` | no | Clave de cifrado de columnas `EncryptedType`. |
| `APP_ENV` | `development` | no | `production` activa nombres de TOTP y desactiva debug de categorización. |
| `BASE_URL` | — | prod: sí | URL pública del backend (callbacks, emails). |
| `FRONTEND_URL` | — | prod: sí | URL pública del frontend (CORS y redirects). |

### LLM

| Variable | Default | Para qué |
|---|---|---|
| `LLM_PROVIDER` | `openai` | `openai` o `google`. **El default de producción es OpenAI**, no Gemini. |
| `LLM_API_KEY` | — | Clave del proveedor por defecto. |
| `LLM_MODEL_NAME` | `gpt-6-luna` (Compose) | Modelo de texto. |
| `LLM_VISION_MODEL` | `LLM_MODEL_NAME` | Modelo para imágenes. |
| `LLM_AUDIO_MODEL` | `gpt-4o-mini-transcribe` | Modelo de transcripción. |
| `LLM_AUDIO_API_KEY` | `LLM_API_KEY` | Clave específica de audio. |
| `LLM_TIMEOUT_SECONDS` | `30` | Timeout por request. |
| `LLM_MONTHLY_BUDGET_USD` | `10` | Presupuesto global mensual. |
| `LLM_CREDIT_AMOUNT_USD`, `LLM_CREDIT_EXPIRES_AT` | — | Saldo de crédito y vencimiento, para el panel de admin. |

### Integraciones

| Variable | Para qué |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth con Google. **Único proveedor OAuth soportado.** |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | Bot de Telegram. |
| `TELEGRAM_OIDC_CLIENT_ID`, `TELEGRAM_OIDC_CLIENT_SECRET` | Login con Telegram (OIDC). |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | WhatsApp Cloud API. Sin `APP_SECRET` la firma del webhook no se valida. |
| `EMAIL_API_KEY`, `SMTP_FROM`, `SMTP_FROM_ADDRESS`, `ADMIN_EMAIL` | Emails transaccionales (Resend). |
| `REDIS_URL`, `REDIS_CACHE_URL` | Broker de Celery y cache. |
| `CACHE_DISABLED_PREFIXES` | Lista separada por comas para apagar prefijos de cache. |

### Operación

| Variable | Default | Para qué |
|---|---|---|
| `GRAFANA_INTERNAL_URL`, `GRAFANA_ADMIN_PASSWORD`, `GF_SECURITY_ADMIN_USER` | — | Integración con Grafana. |
| `GRAFANA_CLOUD_LOKI_*`, `GRAFANA_CLOUD_PROMETHEUS_*` | — | Envío de logs y métricas a Grafana Cloud. |
| `CELERY_BEAT_SCHEDULE_FILENAME` | `/tmp/celerybeat-schedule` | Estado del beat. **No debe versionarse.** |
| `BUDGET_AHORRO_ENABLED` | `true` | Habilita el grupo "Ahorro" del 50/30/20. |
| `DEBUG_CATEGORIZATION` | `0` | Logging verboso del categorizador. |

### Seed (peligroso)

`SEED_USER_EMAIL`, `SEED_USER_NAME` y `SEED_USER_PASSWORD` controlan el usuario que se crea
al arrancar si la tabla está vacía. **El comportamiento por defecto es inseguro y está
registrado en un advisory privado** (`GHSA-p86h-c2xv-j859`): no se detalla acá para no
divulgar una superficie explotable mientras no esté corregido. Definí las tres variables en
producción con una contraseña fuerte y verificá que el usuario sembrado no conserve la
credencial inicial.

## Variables del frontend

Se inyectan en build (Vite), no son secretas:

| Variable | Para qué |
|---|---|
| `VITE_APP_ENV` | Distingue builds. |
| `VITE_GOOGLE_CLIENT_ID` | Client ID público de Google. |
| `VITE_TELEGRAM_OIDC_CLIENT_ID` | Client ID público de Telegram. |

## Diagnóstico rápido

```bash
# ¿el backend ve sus variables?
podman exec creditcardanalyzer_backend_dev_1 env | grep -E 'APP_ENV|LLM_PROVIDER'

# ¿el secreto está montado?
podman exec creditcardanalyzer_backend_dev_1 ls /run/secrets/

# ¿la clave tiene el largo mínimo?
podman exec creditcardanalyzer_backend_dev_1 python -c "import os;print(len(os.environ['SECRET_KEY']))"
```

Si `SECRET_KEY` cambia, los campos cifrados quedan ilegibles. Ver `Key-Management.md`
antes de rotarla.
