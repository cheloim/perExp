#!/bin/bash
set -euo pipefail

# Smoke test: functional validation of the running dev stack.
# Verifies: import gate, clean restart, healthy logs, API responses.
# Usage: ./scripts/smoke.sh
# Exit 1 on any failure, 0 on all-pass. No auto-recovery.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/podman-compose.yml"
BACKEND_CONTAINER="creditcardanalyzer_backend_dev_1"
FRONTEND_CONTAINER="creditcardanalyzer_frontend_dev_1"
BACKEND_URL="http://localhost:8001"
FRONTEND_URL="http://localhost:8082"
SMOKE_START=""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

failed=0
phase_results=()

run_phase() {
    local name="$1"
    shift
    echo -e "${YELLOW}Phase: ${name}${NC}"
    if "$@"; then
        echo -e "${GREEN}✓ ${name} passed${NC}"
        phase_results+=("✓ ${name}")
    else
        echo -e "${RED}✗ ${name} FAILED${NC}"
        phase_results+=("✗ ${name}")
        failed=1
    fi
    echo ""
}

# ── Phase 1: Import gate (fast, no restart) ─────────────────────────────────
phase1_import() {
    # Secrets are loaded by docker-entrypoint.sh into env vars.
    # podman exec spawns a new shell without them, so we source them manually.
    podman exec "$BACKEND_CONTAINER" bash -c '
        for f in /run/secrets/creditcard_backend_dev_*; do
            var=$(basename "$f" | sed "s/creditcard_backend_dev_//" | tr "[:lower:]" "[:upper:]")
            export "$var=$(cat "$f")"
        done
        export PYTHONPATH=/app
        python -c "import main"
    ' 2>&1
}

# ── Phase 2: Clean restart ───────────────────────────────────────────────────
phase2_restart() {
    SMOKE_START=$(date -u +%Y-%m-%dT%H:%M:%S)
    echo "Restarting backend + celery (force-recreate)..."
    podman-compose -f "$COMPOSE_FILE" \
        up -d --force-recreate backend_dev celery_worker_dev celery_beat_dev 2>&1
    echo "Waiting 5s for startup..."
    sleep 5
}

# ── Phase 3: Health wait (poll up to 90s) ────────────────────────────────────
phase3_health() {
    local timeout=90
    local elapsed=0
    echo "Waiting for backend (max ${timeout}s)..."
    while [ $elapsed -lt $timeout ]; do
        if curl -sf "$BACKEND_URL/docs" > /dev/null 2>&1; then
            echo "Backend ready after ${elapsed}s"
            break
        fi
        sleep 3
        elapsed=$((elapsed + 3))
    done
    if [ $elapsed -ge $timeout ]; then
        echo "ERROR: Backend did not start within ${timeout}s"
        return 1
    fi

    echo "Checking frontend..."
    if curl -sf "$FRONTEND_URL" > /dev/null 2>&1; then
        echo "Frontend ready"
    else
        echo "WARNING: Frontend not responding (non-blocking)"
    fi
}

# ── Phase 4: Log scan (only since restart) ───────────────────────────────────
phase4_logs() {
    local errors_found=0

    echo "Scanning backend logs (since ${SMOKE_START})..."
    local backend_logs
    backend_logs=$(podman logs --since "$SMOKE_START" "$BACKEND_CONTAINER" 2>&1)

    if echo "$backend_logs" | grep -q "Application startup complete"; then
        echo "  ✓ Backend startup complete"
    else
        echo "  ✗ Backend startup NOT complete"
        errors_found=1
    fi

    if echo "$backend_logs" | grep -qE "Telegram bot started|TELEGRAM_BOT_TOKEN not set"; then
        echo "  ✓ Bot status reported"
    else
        echo "  ✗ Bot status missing"
        errors_found=1
    fi

    if echo "$backend_logs" | grep -qiE "ERROR|CRITICAL|Traceback"; then
        echo "  ✗ Backend has errors in log:"
        echo "$backend_logs" | grep -iE "ERROR|CRITICAL|Traceback" | head -5
        errors_found=1
    else
        echo "  ✓ No errors in backend logs"
    fi

    echo "Scanning celery worker logs..."
    local worker_logs
    worker_logs=$(podman logs --since "$SMOKE_START" creditcardanalyzer_celery_worker_dev_1 2>&1)
    if echo "$worker_logs" | grep -q "ready\."; then
        echo "  ✓ Worker ready"
    else
        echo "  ✗ Worker NOT ready"
        errors_found=1
    fi
    if echo "$worker_logs" | grep -qiE "ERROR|CRITICAL|Traceback"; then
        echo "  ✗ Worker has errors:"
        echo "$worker_logs" | grep -iE "ERROR|CRITICAL|Traceback" | head -3
        errors_found=1
    else
        echo "  ✓ No errors in worker logs"
    fi

    echo "Scanning celery beat logs..."
    local beat_logs
    beat_logs=$(podman logs --since "$SMOKE_START" creditcardanalyzer_celery_beat_dev_1 2>&1)
    if echo "$beat_logs" | grep -q "beat: Starting\.\.\."; then
        echo "  ✓ Beat started"
    else
        echo "  ✗ Beat NOT started"
        errors_found=1
    fi
    if echo "$beat_logs" | grep -qiE "ERROR|CRITICAL|Traceback"; then
        echo "  ✗ Beat has errors:"
        echo "$beat_logs" | grep -iE "ERROR|CRITICAL|Traceback" | head -3
        errors_found=1
    else
        echo "  ✓ No errors in beat logs"
    fi

    echo "Checking frontend for proxy errors..."
    local frontend_logs
    frontend_logs=$(podman logs --since "$SMOKE_START" "$FRONTEND_CONTAINER" 2>&1)
    if echo "$frontend_logs" | grep -q "ECONNREFUSED"; then
        echo "  ✗ Frontend has ECONNREFUSED (backend may be down)"
        errors_found=1
    else
        echo "  ✓ No proxy errors"
    fi

    [ $errors_found -eq 0 ]
}

# ── Phase 5: CSP / security headers (hits prod) ─────────────────────────────
phase5_csp() {
    echo "Checking production CSP headers..."
    local headers
    headers=$(curl -sfI "https://platform.oikonomia.ar/" 2>&1)
    if [ -z "$headers" ]; then
        echo "  WARNING: Could not fetch prod headers (non-blocking)"
        return 0
    fi

    local csp
    csp=$(echo "$headers" | grep -i "content-security-policy" | head -1)

    if echo "$csp" | grep -q "script-src.*telegram.org"; then
        echo "  ✓ script-src allows telegram.org"
    else
        echo "  ⚠ script-src MISSING telegram.org (expected pre-deploy, will pass after merge)"
    fi

    if echo "$csp" | grep -q "frame-src.*oauth.telegram.org"; then
        echo "  ✓ frame-src allows oauth.telegram.org"
    else
        echo "  ⚠ frame-src MISSING oauth.telegram.org (expected pre-deploy, will pass after merge)"
    fi

    # Always pass — this is a post-deploy validation
    return 0
}

# ── Phase 6: API smoke ───────────────────────────────────────────────────────
phase6_api() {
    echo "GET /openapi.json..."
    local openapi
    openapi=$(curl -sf "$BACKEND_URL/openapi.json" 2>&1)
    if echo "$openapi" | grep -q "telegram/webapp"; then
        echo "  ✓ /openapi.json 200, telegram/webapp endpoint registered"
    else
        echo "  ✗ /openapi.json missing telegram/webapp endpoint"
        return 1
    fi

    echo "POST /auth/login (bad creds)..."
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BACKEND_URL/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"email":"nonexistent@test.com","password":"wrong"}' 2>&1)
    if [ "$status" = "401" ]; then
        echo "  ✓ POST /auth/login → 401 (expected)"
    else
        echo "  ✗ POST /auth/login → ${status} (expected 401)"
        return 1
    fi
}

# ── Main ─────────────────────────────────────────────────────────────────────
echo "======================================"
echo " Oikonomia Smoke Test"
echo "======================================"
echo ""

run_phase "Import gate" phase1_import
run_phase "Restart services" phase2_restart
run_phase "Health wait" phase3_health
run_phase "Log scan" phase4_logs
run_phase "CSP / security headers" phase5_csp
run_phase "API smoke" phase6_api

echo "======================================"
echo " Results"
echo "======================================"
for result in "${phase_results[@]}"; do
    echo "  $result"
done
echo ""

if [ $failed -eq 0 ]; then
    echo -e "${GREEN}All phases passed${NC}"
    exit 0
else
    echo -e "${RED}Some phases failed${NC}"
    exit 1
fi
