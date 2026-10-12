# API Cache (Redis)

Cache-aside in `src/backend/app/services/cache.py`. Postgres is always the
source of truth: a miss or Redis error runs the DB path unchanged.

## Isolation

`REDIS_CACHE_URL` points at Redis DB **2** (broker stays on `/0` in prod,
`/1` in podman dev). A `FLUSHDB` or broker pressure must never evict API
cache. `REDIS_URL` remains the broker/locks backend.

## Keys and TTLs

| Prefix | Content | TTL | Invalidated on |
|---|---|---|---|
| `v1:dash:{group_hash}:summary:…` | dashboard summary | 90s | expense/card/tag writes |
| `v1:cards:{group_hash}:distinct/options` | filter dropdowns | 600s | card writes |
| `v1:uncat:{user}` | uncategorized count | 30s | expense writes |
| `v1:aitrends:{user}:{month}` | AI trends (shared) | 300s | explicit refresh only |

Never cached: writes, `check-duplicate`, paginated expense pages past page 1.

## Weekly hit-rate review

Metric: `oikonomia_cache_requests_total{prefix,result}` (`hit_l1`,
`hit_redis`, `miss`, `error`, `circuit_open`, `disabled`).

Hit rate per prefix (7 days):

```promql
sum by (prefix) (rate(oikonomia_cache_requests_total{result=~"hit_.*"}[7d]))
/
sum by (prefix) (rate(oikonomia_cache_requests_total[7d]))
```

**Revert rule:** any prefix with 7-day hit rate **<30%** goes on the
kill-switch — no code change needed:

```bash
CACHE_DISABLED_PREFIXES=v1:uncat,v1:prices
```

Set it in compose env (or `.env`), restart the backend. `get_json` then
returns `None` and `set_json` no-ops for those prefixes, including L1 —
traffic falls back to Postgres with ~0ms overhead. Remove from the list to
re-enable. Record every revert here with date + measured rate so a dead key
isn't re-added blindly.
