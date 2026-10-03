#!/bin/bash
set -euo pipefail

# verify-oracle-deploy.sh — Verify all services are running on Oracle Cloud
# Usage: ./scripts/verify-oracle-deploy.sh <SERVER_IP> [SSH_USER] [SSH_PORT]
#
# Checks that all containers are healthy before switching DNS.
# Run this from your local machine against the new Oracle server.

SERVER_IP="${1:?Usage: $0 <SERVER_IP> [SSH_USER] [SSH_PORT]}"
SSH_USER="${2:-opc}"
SSH_PORT="${3:-43422}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

errors=0
warnings=0

ssh_cmd() {
    ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -p "$SSH_PORT" "${SSH_USER}@${SERVER_IP}" "$@"
}

check() {
    local name="$1"
    shift
    echo -n "  $name ... "
    if "$@" >/dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${RED}FAIL${NC}"
        errors=$((errors + 1))
    fi
}

warn_check() {
    local name="$1"
    shift
    echo -n "  $name ... "
    if "$@" >/dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${YELLOW}WARN${NC}"
        warnings=$((warnings + 1))
    fi
}

echo "========================================"
echo " Oracle Cloud Deploy Verification"
echo " Target: ${SSH_USER}@${SERVER_IP}:${SSH_PORT}"
echo " $(date)"
echo "========================================"
echo ""

# ── 1. SSH connectivity ──────────────────────────────────────────
echo "1. SSH Connectivity"
check "SSH connection" ssh_cmd "echo ok"
echo ""

# ── 2. System prerequisites ──────────────────────────────────────
echo "2. System Prerequisites"
check "podman installed" ssh_cmd "command -v podman"
check "podman-compose installed" ssh_cmd "export PATH=\$HOME/.local/bin:\$PATH && command -v podman-compose"
check "podman socket active" ssh_cmd "systemctl is-active podman.socket"
echo ""

# ── 3. Project directory ─────────────────────────────────────────
echo "3. Project Directory"
check "/opt/creditcardanalyzer exists" ssh_cmd "test -d /opt/creditcardanalyzer"
check ".env file exists" ssh_cmd "test -f /opt/creditcardanalyzer/.env"
check "compose files present" ssh_cmd "test -f /opt/creditcardanalyzer/docker-compose.platform.yml"
check "nginx.conf present" ssh_cmd "test -f /opt/creditcardanalyzer/nginx/nginx.conf"
echo ""

# ── 4. Firewall ──────────────────────────────────────────────────
echo "4. Firewall"
check "Port 80 open" ssh_cmd "firewall-cmd --list-ports | grep -q '80/tcp'"
check "Port 443 open" ssh_cmd "firewall-cmd --list-ports | grep -q '443/tcp'"
echo ""

# ── 5. Podman network ────────────────────────────────────────────
echo "5. Podman Network"
check "oikonomia network exists" ssh_cmd "podman network ls | grep -q oikonomia"
echo ""

# ── 6. Containers ────────────────────────────────────────────────
echo "6. Containers"

check "db running" ssh_cmd "podman ps --format '{{.Names}}' | grep -qE '_db_'"
check "redis running" ssh_cmd "podman ps --format '{{.Names}}' | grep -qE '_redis_'"
check "backend running" ssh_cmd "podman ps --format '{{.Names}}' | grep -qE '_backend_'"
check "frontend running" ssh_cmd "podman ps --format '{{.Names}}' | grep -qE '_platform-frontend_'"
check "celery_worker running" ssh_cmd "podman ps --format '{{.Names}}' | grep -qE '_celery_worker_'"
check "celery_beat running" ssh_cmd "podman ps --format '{{.Names}}' | grep -qE '_celery_beat_'"
check "nginx running" ssh_cmd "podman ps --format '{{.Names}}' | grep -qE '_nginx_'"
warn_check "telegram_bot running" ssh_cmd "podman ps --format '{{.Names}}' | grep -qE '_telegram_bot_'"
echo ""

# ── 7. Health checks ─────────────────────────────────────────────
echo "7. Health Checks"

check "db healthy" ssh_cmd "
  DB=\$(podman ps --format '{{.Names}}' | grep -E '_db_' | head -1)
  [ -n \"\$DB\" ] && [ \"\$(podman inspect --format='{{.State.Health.Status}}' \$DB)\" = 'healthy' ]
"

check "redis healthy" ssh_cmd "
  REDIS=\$(podman ps --format '{{.Names}}' | grep -E '_redis_' | head -1)
  [ -n \"\$REDIS\" ] && [ \"\$(podman inspect --format='{{.State.Health.Status}}' \$REDIS)\" = 'healthy' ]
"

check "frontend healthy" ssh_cmd "
  FE=\$(podman ps --format '{{.Names}}' | grep -E '_platform-frontend_' | head -1)
  [ -n \"\$FE\" ] && [ \"\$(podman inspect --format='{{.State.Health.Status}}' \$FE)\" = 'healthy' ]
"
echo ""

# ── 8. Backend API ───────────────────────────────────────────────
echo "8. Backend API"
check "GET /docs returns 200" ssh_cmd "curl -sf http://localhost:8000/docs >/dev/null"
check "GET /openapi.json" ssh_cmd "curl -sf http://localhost:8000/openapi.json | grep -q 'openapi'"
echo ""

# ── 9. Nginx ─────────────────────────────────────────────────────
echo "9. Nginx"
check "HTTPS responds (via IP)" ssh_cmd "curl -sk -o /dev/null -w '%{http_code}' https://127.0.0.1/ | grep -qE '200|301'"
warn_check "SSL cert exists" ssh_cmd "test -f /opt/creditcardanalyzer/certbot/conf/live/*/fullchain.pem"
echo ""

# ── 10. Monitoring ───────────────────────────────────────────────
echo "10. Monitoring"
warn_check "alloy running" ssh_cmd "podman ps --format '{{.Names}}' | grep -qE '_alloy_'"
warn_check "node-exporter running" ssh_cmd "podman ps --format '{{.Names}}' | grep -qE '_node-exporter_'"
warn_check "postgres-exporter running" ssh_cmd "podman ps --format '{{.Names}}' | grep -qE '_postgres-exporter_'"
echo ""

# ── Summary ──────────────────────────────────────────────────────
echo "========================================"
echo " Results"
echo "========================================"
echo ""
echo -e "  Errors:   ${RED}${errors}${NC}"
echo -e "  Warnings: ${YELLOW}${warnings}${NC}"
echo ""

if [ "$errors" -gt 0 ]; then
    echo -e "${RED}FAILED — $errors critical check(s) failed${NC}"
    echo ""
    echo "Run 'ssh -p $SSH_PORT ${SSH_USER}@${SERVER_IP}' to debug."
    exit 1
else
    echo -e "${GREEN}ALL CRITICAL CHECKS PASSED${NC}"
    if [ "$warnings" -gt 0 ]; then
        echo -e "${YELLOW}($warnings non-critical warning(s))${NC}"
    fi
    echo ""
    echo "Next steps:"
    echo "  1. Migrate database (if needed): see scripts/migrate-db-to-oracle.sh"
    echo "  2. Switch DNS A records to: $SERVER_IP"
    echo "  3. Run: ./scripts/smoke.sh (after DNS propagates)"
    exit 0
fi