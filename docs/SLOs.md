# SLOs y error budget

Objetivos operativos de Oikonomia. Son una herramienta para decidir cuándo
priorizar confiabilidad sobre features, **no** un contrato con usuarios: el
proyecto corre en un solo server, sin guardia 24/7 y sin alta disponibilidad.

## Principios

- Un SLO se mide con lo que ya existe: Prometheus, Loki, `/health/ready`, el
  panel admin y los logs del deploy. No se inventan métricas que el código no
  emite.
- Si el SLI es una aproximación, se dice. Un SLO sobre un gauge no es lo mismo
  que un SLO sobre un contador.
- La ventana de evaluación es **30 días móviles**. El presupuesto se revisa por
  mes calendario para decidir prioridades.
- Los SLOs no reemplazan las alertas: las alertas actuales son por síntoma
  (`oikonomia-target-down`, disco, backup, LLM). No hay alertas de burn-rate
  multi-ventana; si se agregan, se documentan acá.

## SLIs y SLOs

| Servicio | SLI | SLO | Presupuesto (30 días) |
|---|---|---|---|
| **API: proceso** | `up{job="oikonomia-backend"}` = 1 | 99.5% | 3 h 36 min |
| **API: requests** | proporción de requests HTTP sin 5xx | 99.5% | 0.5% de requests |
| **API: latencia** | p95 de requests no-streaming | ≤ 800 ms en ≥ 95% de ventanas de 5 min | 5% de ventanas (~36 h) |
| **Login** | proporción de requests a `/auth/login` sin 5xx | 99.5% | 3 h 36 min |
| **Import** | proporción de jobs en `FAILED` sobre jobs de las últimas 24 h | ≤ 5% | 5% de jobs |
| **Import: stuck** | jobs en `PROCESSING`/`QUEUED` por más de 1 h | 0 sostenido | una hora de margen por el cleanup |
| **Telegram** | `oikonomia_telegram_bot_healthy` = 1 | 99.0% | 7 h 12 min |
| **WhatsApp** | POST a `/webhook/whatsapp` con 2xx | 99.5% | 3 h 36 min |
| **Postgres** | `pg_up` = 1 (exporter) | 99.5% | 3 h 36 min |
| **Backups** | dump más nuevo verificado | < 26 h de antigüedad | no es SLO; alerta a las 48 h |

### API: disponibilidad y errores

```promql
# Proceso del backend scrapeado
avg_over_time(up{job="oikonomia-backend"}[30d])

# Proporción de 5xx (se excluyen /health, /metrics, /docs por el middleware)
sum(rate(http_requests_total{status=~"5.."}[30d]))
/
clamp_min(sum(rate(http_requests_total[30d])), 0.000001)
```

`up` mide que Prometheus puede scrapear el backend. No prueba que un request de
usuario funcione; para eso está la proporción de 5xx. Un 502 de nginx con el
backend caído se ve como `up=0` y como error en el borde, no necesariamente en
`http_requests_total`.

### API: latencia

```promql
histogram_quantile(
  0.95,
  sum by (le) (rate(http_request_duration_seconds_bucket[5m]))
)
```

El histograma incluye SSE (`/analysis`, `/investments`): esos requests duran
minutos a propósito y arruinan el p95. En el panel, excluilos por endpoint o
medí sólo los endpoints CRUD. Si no se excluyen, el SLO no es interpretable.

### Login

```promql
sum(rate(http_requests_total{endpoint="/auth/login",status=~"5.."}[30d]))
/
clamp_min(sum(rate(http_requests_total{endpoint="/auth/login"}[30d])), 0.000001)
```

Esto mide **disponibilidad del endpoint**, no éxito de credenciales. Un 401 por
password incorrecta es comportamiento normal y no consume presupuesto. El
contador `oikonomia_login_attempts_total` sirve como diagnóstico:

```promql
sum(rate(oikonomia_login_attempts_total{status="success"}[30d]))
/
clamp_min(sum(rate(oikonomia_login_attempts_total[30d])), 0.000001)
```

Ojo: solo los intentos por password incrementan `failed`/`locked`; Google,
Telegram y OIDC incrementan `success`. Por eso la tasa de éxito de credenciales
**no** es un SLO: mezcla métodos y errores del usuario.

### Import

No hay un contador de “imports terminados”. El SLI se aproxima con el gauge que
se recalcula en cada scrape:

```promql
sum(oikonomia_import_jobs_total{status="FAILED"})
/
clamp_min(sum(oikonomia_import_jobs_total), 1)
```

Los jobs se borran a las 24 h, así que la ventana real es “las últimas 24 h”,
no 30 días. Es una aproximación: durante una ráfaga de imports, los `PROCESSING`
inflan el denominador y el ratio baja artificialmente. Se complementa con:

```promql
# Jobs trabados (deberían pasar a FAILED por el cleanup)
sum(oikonomia_import_jobs_total{status=~"PROCESSING|QUEUED"})
```

Y con logs de Loki: `container=~".*celery_worker.*"` y mensajes
`[IMPORT JOB] ... failed`.

### Telegram

```promql
avg_over_time(oikonomia_telegram_bot_healthy[30d])
```

El gauge se actualiza en cada scrape mirando el thread o el heartbeat
`bot:heartbeat` (TTL 60 s). Un bot que responde pero no procesa mensajes puede
dar 1; el SLO es de presencia, no de correctness.

### WhatsApp

```promql
sum(rate(http_requests_total{endpoint="/webhook/whatsapp",status=~"2.."}[30d]))
/
clamp_min(sum(rate(http_requests_total{endpoint="/webhook/whatsapp"}[30d])), 0.000001)
```

Sólo cuenta lo que llega a nuestro backend. No mide entrega en el teléfono del
usuario ni errores de Meta antes del webhook.

### Postgres

```promql
avg_over_time(pg_up[30d])
```

`pg_up` viene del `postgres-exporter`. Si el exporter cae pero Postgres sigue
vivo, el SLI se pierde; en ese caso se usa `/health/ready` y los logs. No hay
métrica de latencia de queries; no se promete un SLO de latencia de DB.

### LLM (dependencia externa)

No es un SLO de plataforma porque el proveedor no está bajo nuestro control,
pero se monitorea:

```promql
sum(rate(oikonomia_llm_requests_total{status="ok"}[30d]))
/
clamp_min(sum(rate(oikonomia_llm_requests_total[30d])), 0.000001)
```

Objetivo operativo: **≥ 95% de llamadas OK**. Un 5% de fallos no rompe la app;
rompe imports y análisis. El presupuesto es un límite de costo, no un SLO.

## Cómo se observa

| Señal | Dónde |
|---|---|
| Disponibilidad, latencia, 5xx | Grafana `application`, Prometheus |
| Salud de servicios y targets | Grafana `status`, `up`, `probe_success` |
| Postgres | Grafana `database`, `pg_up`, exporters |
| Logs por contenedor y nivel | Grafana `logs`, Loki (`container`, `level`) |
| LLM, gasto y presupuesto | Grafana `llm` |
| Estado puntual | `curl http://localhost:8000/health/ready`, panel admin `/x/<slug>/system/health` |
| Deploy y rollback | GitHub Actions `Deploy`, logs del server |

`/health/ready` es la fuente más directa para incidentes: devuelve 503 con el
detalle de DB/Redis/Celery y 200 `degraded` si sólo falla beat o Telegram.

Prometheus retiene 30 días de métricas. Una consulta de `[30d]` en el borde de
la retención puede tener huecos: para evaluar el mes, usá `[29d]` o la copia
externa si está configurada. Loki retiene 15 días, así que los SLOs de
disponibilidad no se calculan con logs.

## Error budget: qué hacer cuando se gasta

| Presupuesto restante | Regla |
|---|---|
| > 50% | Trabajo normal: features y mejoras |
| 25–50% | Priorizar el fix de la causa; no lanzar cambios riesgosos sin necesidad |
| < 25% | Congelar features no críticas hasta recuperar; sólo fixes, seguridad y dependencias |
| Agotado | No hay releases no esenciales. Un patch de seguridad siempre se permite |

El presupuesto se evalúa por servicio, no global. Un mes con la API en 99.6% no
compensa un import al 80%.

Ejemplos de qué **no** cuenta como gasto:

- Mantenimiento anunciado y ejecutado dentro de la ventana.
- Errores 4xx del usuario (401, 404, 422) en la API.
- Un LLM caído que no afecta los endpoints de lectura.
- Un deploy fallido que nunca llegó a producción (rollback automático sano).

## Qué NO se promete

- **99.9% ni 24/7.** No hay guardia, ni réplicas, ni failover.
- **Cero downtime en deploy.** El release recrea contenedores; hay una ventana
  breve con la página de mantenimiento.
- **RPO 0 / RTO instantáneo.** El backup diario deja hasta ~24 h de pérdida; una
  restauración es una ventana de mantenimiento.
- **Backup fuera del server.** Hoy el dump vive en el mismo disco que la base.
- **Alta disponibilidad de Postgres o Redis.** Son contenedores únicos.
- **Disponibilidad del LLM, de Telegram o de Meta.** Son dependencias externas.
- **Entrega garantizada de WhatsApp.** El webhook acepta el mensaje; la entrega
  al teléfono es de Meta.
- **Latencia por usuario o por endpoint crítico.** El SLO es agregado.
- **Revocación instantánea de access tokens.** El access JWT vive hasta 60 min;
  el refresh sí se revoca. Ver `Authentication.md`.
- **Resistencia a DDoS o a un atacante con acceso al host.** No hay WAF ni
  aislamiento de red más allá del firewall del server.
- **Cobertura completa de auditoría.** `audit_logs` cubre login, MFA y acciones
  admin; no todas las acciones de usuario.

## Revisión

Se revisan estos SLOs cuando cambia la arquitectura, cuando un incidente
muestra que el objetivo no era realista, o como parte del cierre de un lote de
confiabilidad. Si un SLO no se puede medir con una consulta concreta, se
corrige el SLO o se instrumenta la métrica; no se deja como intención.
