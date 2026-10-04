# Monitoring

## Health Endpoints

| Endpoint       | Auth   | Purpose                    | Status Codes |
| -------------- | ------ | -------------------------- | ------------ |
| `/health`      | Public | Liveness (process alive)   | 200 always   |
| `/health/ready`| Public | Readiness (can serve traffic) | 200 / 503 |
| `/metrics`     | Public | Prometheus exposition      | 200          |

### Liveness (`GET /health`)

Always returns 200 if the process is running. Includes version, uptime, and timestamp.
Does NOT check DB, Redis, or any dependency.

Use for: container orchestrator liveness probes, uptime monitoring.

### Readiness (`GET /health/ready`)

Checks critical and optional services:

| Service        | Critical | Impact if down              |
| -------------- | -------- | --------------------------- |
| PostgreSQL     | Yes      | 503 — no data access        |
| Redis          | Yes      | 503 — no cache/locks        |
| Celery Workers | Yes      | 503 — no background tasks   |
| Celery Beat    | No       | Degraded — no scheduled jobs|
| Telegram Bot   | No       | Degraded — bot unavailable  |

Status values:
- `healthy`: all services OK
- `degraded`: critical OK, optional down
- `unhealthy`: critical service down → 503

Use for: load balancer readiness, blackbox exporter, deploy verification.

### Admin Health (`GET /x/{slug}/system/health`)

Extended health check (admin-only). Includes:
- Redis latency and memory usage
- DB connection and user count
- Celery worker names and active tasks
- Celery Beat heartbeat
- Telegram bot thread status
- Prometheus metrics summary (request count, error rate, p95 latency)

## Grafana Dashboards

| Dashboard      | Content                                         |
| -------------- | ----------------------------------------------- |
| `status`       | Services UP/DOWN, SSL expiry, probe latency     |
| `application`  | Request rate, latency, errors, business metrics |
| `system`       | CPU, Memory, Disk, Network (host-level)         |
| `database`     | PostgreSQL connections, cache hit, locks        |
| `logs`         | Log volume by container, error logs             |

## Prometheus Metrics

Exported at `/metrics` (Prometheus exposition format):

### HTTP Metrics
- `http_requests_total` — counter by method, endpoint, status
- `http_request_duration_seconds` — histogram by method, endpoint

### Service Health
- `oikonomia_telegram_bot_healthy` — gauge (1=up, 0=down)
- `oikonomia_celery_worker_healthy` — gauge (1=up, 0=down)
- `oikonomia_celery_beat_healthy` — gauge (1=up, 0=down)

### Business Metrics
- `oikonomia_users_total` — total registered users
- `oikonomia_active_users_total` — active in last 24h
- `oikonomia_expenses_total` — total expenses per user
- `oikonomia_investments_total` — total investments per user
- `oikonomia_import_jobs_total` — import jobs by status

## Infrastructure Monitoring

Exporters running on host network:

| Exporter         | Port  | Scrapes                 |
| ---------------- | ----- | ----------------------- |
| postgres-exporter| 9187  | PostgreSQL metrics      |
| redis-exporter   | 9121  | Redis metrics           |
| node-exporter    | 9100  | Host CPU/Memory/Disk    |
| nginx-exporter   | 9113  | Nginx connections/rps   |
| blackbox-exporter| 9115  | External probes (SSL, uptime) |
| cadvisor         | 8080  | Container resource usage|

## Celery Beat Heartbeat

Beat writes a timestamp to Redis key `celery_beat:heartbeat` every minute (TTL: 120s).
Health check reads this key — if older than 2 minutes, beat is considered down.

Task: `app/tasks/heartbeat.py`
Schedule: every minute (crontab `* * * * *`)

## Log Retention

| Service | Retention |
| ------- | --------- |
| Prometheus (metrics) | 30 days |
| Loki (logs) | 15 days |
| Grafana (dashboards) | Permanent |