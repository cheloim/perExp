#!/bin/bash
set -euo pipefail

# migrate-db-to-oracle.sh — Migrate PostgreSQL data from old server to Oracle Cloud
# Usage: ./scripts/migrate-db-to-oracle.sh <OLD_SERVER_IP> <NEW_SERVER_IP> [SSH_USER] [SSH_PORT]
#
# Steps:
#   1. Dump database from old server
#   2. Copy dump to new server
#   3. Restore database on new server
#   4. Verify restore
#
# Prerequisites:
#   - SSH access to both servers
#   - Database containers running on both servers

OLD_SERVER="${1:?Usage: $0 <OLD_SERVER_IP> <NEW_SERVER_IP> [SSH_USER] [SSH_PORT]}"
NEW_SERVER="${2:?Usage: $0 <OLD_SERVER_IP> <NEW_SERVER_IP> [SSH_USER] [SSH_PORT]}"
SSH_USER="${3:-opc}"
SSH_PORT="${4:-43422}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DUMP_FILE="/tmp/oikonomia_db_${TIMESTAMP}.sql.gz"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ssh_old() {
    ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -p "$SSH_PORT" "${SSH_USER}@${OLD_SERVER}" "$@"
}

ssh_new() {
    ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -p "$SSH_PORT" "${SSH_USER}@${NEW_SERVER}" "$@"
}

echo "========================================"
echo " Database Migration to Oracle Cloud"
echo "========================================"
echo ""
echo "  Source:  ${SSH_USER}@${OLD_SERVER}:${SSH_PORT}"
echo "  Target:  ${SSH_USER}@${NEW_SERVER}:${SSH_PORT}"
echo "  Dump:    ${DUMP_FILE}"
echo ""

# ── Step 1: Verify connectivity ──────────────────────────────────
echo -e "${YELLOW}[1/6] Verifying SSH connectivity...${NC}"
ssh_old "echo 'Source OK'" || { echo -e "${RED}Cannot connect to source server${NC}"; exit 1; }
ssh_new "echo 'Target OK'" || { echo -e "${RED}Cannot connect to target server${NC}"; exit 1; }
echo -e "${GREEN}  Both servers reachable${NC}"
echo ""

# ── Step 2: Verify DB containers ─────────────────────────────────
echo -e "${YELLOW}[2/6] Verifying database containers...${NC}"
OLD_DB=$(ssh_old "podman ps --format '{{.Names}}' | grep -E '_db_' | head -1")
if [ -z "$OLD_DB" ]; then
    echo -e "${RED}  ERROR: No db container running on source server${NC}"
    exit 1
fi
echo -e "${GREEN}  Source db: $OLD_DB${NC}"

NEW_DB=$(ssh_new "podman ps --format '{{.Names}}' | grep -E '_db_' | head -1")
if [ -z "$NEW_DB" ]; then
    echo -e "${RED}  ERROR: No db container running on target server${NC}"
    echo "  Run the deploy workflow first (workflow_dispatch with action 'full')"
    exit 1
fi
echo -e "${GREEN}  Target db: $NEW_DB${NC}"
echo ""

# ── Step 3: Dump from source ─────────────────────────────────────
echo -e "${YELLOW}[3/6] Dumping database from source...${NC}"
ssh_old "
    BACKUP_DIR=/opt/creditcardanalyzer/backups
    mkdir -p \$BACKUP_DIR
    TIMESTAMP=${TIMESTAMP}
    DUMP=\$BACKUP_DIR/db_\${TIMESTAMP}.sql
    echo '  Running pg_dump...'
    podman exec $OLD_DB pg_dump -U expenses_user expenses > \$DUMP
    gzip \$DUMP
    echo '  Dump saved: '\$DUMP.gz
    ls -lh \$DUMP.gz
"

# Copy dump locally
echo "  Copying dump to local machine..."
scp -o StrictHostKeyChecking=no -P "$SSH_PORT" \
    "${SSH_USER}@${OLD_SERVER}:/opt/creditcardanalyzer/backups/db_${TIMESTAMP}.sql.gz" \
    "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo -e "${GREEN}  Dump downloaded: ${DUMP_SIZE}${NC}"
echo ""

# ── Step 4: Upload to target ─────────────────────────────────────
echo -e "${YELLOW}[4/6] Uploading dump to target...${NC}"
scp -o StrictHostKeyChecking=no -P "$SSH_PORT" \
    "$DUMP_FILE" \
    "${SSH_USER}@${NEW_SERVER}:/tmp/db_${TIMESTAMP}.sql.gz"
echo -e "${GREEN}  Upload complete${NC}"
echo ""

# ── Step 5: Stop platform services (avoid connection conflicts) ──
echo -e "${YELLOW}[5/6] Stopping platform services on target...${NC}"
ssh_new "
    cd /opt/creditcardanalyzer
    export PATH=\$HOME/.local/bin:\$PATH
    set -a; source .env; set +a
    echo '  Stopping platform and bots...'
    podman-compose -p oikonomia-platform -f docker-compose.platform.yml stop backend platform-frontend celery_worker celery_beat 2>/dev/null || true
    podman-compose -p oikonomia-bots -f docker-compose.bots.yml stop telegram_bot 2>/dev/null || true
    echo '  Services stopped'
"
echo ""

# ── Step 6: Restore on target ────────────────────────────────────
echo -e "${YELLOW}[6/6] Restoring database on target...${NC}"
ssh_new "
    DB=\$(podman ps --format '{{.Names}}' | grep -E '_db_' | head -1)
    if [ -z \"\$DB\" ]; then
        echo 'ERROR: db container not found'
        exit 1
    fi

    echo '  Dropping and recreating database...'
    podman exec \$DB psql -U expenses_user -d postgres -c 'DROP DATABASE IF EXISTS expenses;'
    podman exec \$DB psql -U expenses_user -d postgres -c 'CREATE DATABASE expenses OWNER expenses_user;'

    echo '  Restoring dump...'
    gunzip -c /tmp/db_${TIMESTAMP}.sql.gz | podman exec -i \$DB psql -U expenses_user -d expenses

    echo '  Verifying restore...'
    TABLE_COUNT=\$(podman exec \$DB psql -U expenses_user -d expenses -t -c \"SELECT count(*) FROM information_schema.tables WHERE table_schema='public';\")
    echo \"  Tables restored: \$TABLE_COUNT\"

    ROW_SAMPLE=\$(podman exec \$DB psql -U expenses_user -d expenses -t -c 'SELECT count(*) FROM users;')
    echo \"  Users count: \$ROW_SAMPLE\"

    # Cleanup temp file
    rm -f /tmp/db_${TIMESTAMP}.sql.gz

    echo '  Restore complete'
"
echo ""

# ── Restart services ─────────────────────────────────────────────
echo -e "${YELLOW}Restarting services on target...${NC}"
ssh_new "
    cd /opt/creditcardanalyzer
    export PATH=\$HOME/.local/bin:\$PATH
    set -a; source .env; set +a
    echo '  Starting platform...'
    podman-compose -p oikonomia-platform -f docker-compose.platform.yml up -d
    echo '  Starting bots...'
    podman-compose -p oikonomia-bots -f docker-compose.bots.yml up -d
    echo '  Waiting for backend health...'
    for i in \$(seq 1 20); do
        STATUS=\$(curl -sk -o /dev/null -w '%{http_code}' http://localhost:8000/docs 2>/dev/null)
        if [ \"\$STATUS\" = '200' ]; then
            echo \"  Backend healthy after \${i} attempt(s)\"
            break
        fi
        sleep 3
    done
"
echo ""

# ── Cleanup local dump ───────────────────────────────────────────
rm -f "$DUMP_FILE"
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Migration Complete${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Verify: ./scripts/verify-oracle-deploy.sh $NEW_SERVER $SSH_USER $SSH_PORT"
echo "  2. Switch DNS A records to: $NEW_SERVER"
echo "  3. After DNS propagates: ./scripts/smoke.sh"