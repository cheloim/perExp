#!/bin/bash
set -euo pipefail

# migrate-db-to-oracle.sh — Migrate PostgreSQL data from old server to Oracle Cloud
# Usage: ./scripts/migrate-db-to-oracle.sh [OPTIONS]
#
# Options:
#   --source-ip IP        Old server IP (required)
#   --target-ip IP        New server IP (required)
#   --source-user USER    SSH user for old server (default: opc)
#   --target-user USER    SSH user for new server (default: rocky)
#   --ssh-port PORT       SSH port for both servers (default: 43422)
#
# Steps:
#   1. Verify connectivity to both servers
#   2. Verify DB containers running on both
#   3. Dump database from source
#   4. Transfer dump to target
#   5. Stop platform services on target
#   6. Restore database on target
#   7. Restart services on target

# ── Parse arguments ──────────────────────────────────────────────
SOURCE_IP=""
TARGET_IP=""
SOURCE_USER="opc"
TARGET_USER="rocky"
SSH_PORT="43422"

while [[ $# -gt 0 ]]; do
    case $1 in
        --source-ip) SOURCE_IP="$2"; shift 2 ;;
        --target-ip) TARGET_IP="$2"; shift 2 ;;
        --source-user) SOURCE_USER="$2"; shift 2 ;;
        --target-user) TARGET_USER="$2"; shift 2 ;;
        --ssh-port) SSH_PORT="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [ -z "$SOURCE_IP" ] || [ -z "$TARGET_IP" ]; then
    echo "Usage: $0 --source-ip <OLD_IP> --target-ip <NEW_IP> [--source-user USER] [--target-user USER] [--ssh-port PORT]"
    exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DUMP_FILE="/tmp/oikonomia_db_${TIMESTAMP}.sql.gz"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ssh_source() {
    ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -p "$SSH_PORT" "${SOURCE_USER}@${SOURCE_IP}" "$@"
}

ssh_target() {
    ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -p "$SSH_PORT" "${TARGET_USER}@${TARGET_IP}" "$@"
}

echo "========================================"
echo " Database Migration to Oracle Cloud"
echo "========================================"
echo ""
echo "  Source:  ${SOURCE_USER}@${SOURCE_IP}:${SSH_PORT}"
echo "  Target:  ${TARGET_USER}@${TARGET_IP}:${SSH_PORT}"
echo ""

# ── Step 1: Verify connectivity ──────────────────────────────────
echo -e "${YELLOW}[1/7] Verifying SSH connectivity...${NC}"
ssh_source "echo 'Source OK'" || { echo -e "${RED}Cannot connect to source server${NC}"; exit 1; }
ssh_target "echo 'Target OK'" || { echo -e "${RED}Cannot connect to target server${NC}"; exit 1; }
echo -e "${GREEN}  Both servers reachable${NC}"
echo ""

# ── Step 2: Verify DB containers ─────────────────────────────────
echo -e "${YELLOW}[2/7] Verifying database containers...${NC}"
OLD_DB=$(ssh_source "podman ps --format '{{.Names}}' | grep -E '_db_' | head -1" || echo "")
if [ -z "$OLD_DB" ]; then
    echo -e "${RED}  ERROR: No db container running on source server${NC}"
    exit 1
fi
echo -e "${GREEN}  Source db: $OLD_DB${NC}"

NEW_DB=$(ssh_target "podman ps --format '{{.Names}}' | grep -E '_db_' | head -1" || echo "")
if [ -z "$NEW_DB" ]; then
    echo -e "${RED}  ERROR: No db container running on target server${NC}"
    echo "  Run the deploy workflow first (workflow_dispatch with action 'full')"
    exit 1
fi
echo -e "${GREEN}  Target db: $NEW_DB${NC}"
echo ""

# ── Step 3: Dump from source ─────────────────────────────────────
echo -e "${YELLOW}[3/7] Dumping database from source...${NC}"
ssh_source "
    BACKUP_DIR=/opt/creditcardanalyzer/backups
    mkdir -p \$BACKUP_DIR
    DUMP=\$BACKUP_DIR/db_${TIMESTAMP}.sql
    echo '  Running pg_dump...'
    podman exec $OLD_DB pg_dump -U expenses_user expenses > \$DUMP
    gzip \$DUMP
    echo '  Dump saved: '\$DUMP.gz
    ls -lh \$DUMP.gz
"

echo "  Copying dump to local machine..."
scp -o StrictHostKeyChecking=no -P "$SSH_PORT" \
    "${SOURCE_USER}@${SOURCE_IP}:/opt/creditcardanalyzer/backups/db_${TIMESTAMP}.sql.gz" \
    "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo -e "${GREEN}  Dump downloaded: ${DUMP_SIZE}${NC}"
echo ""

# ── Step 4: Upload to target ─────────────────────────────────────
echo -e "${YELLOW}[4/7] Uploading dump to target...${NC}"
scp -o StrictHostKeyChecking=no -P "$SSH_PORT" \
    "$DUMP_FILE" \
    "${TARGET_USER}@${TARGET_IP}:/tmp/db_${TIMESTAMP}.sql.gz"
echo -e "${GREEN}  Upload complete${NC}"
echo ""

# ── Step 5: Stop platform services ───────────────────────────────
echo -e "${YELLOW}[5/7] Stopping platform services on target...${NC}"
ssh_target "
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
echo -e "${YELLOW}[6/7] Restoring database on target...${NC}"
ssh_target "
    DB=\$(podman ps --format '{{.Names}}' | grep -E '_db_' | head -1)
    if [ -z \"\$DB\" ]; then
        echo 'ERROR: db container not found'
        exit 1
    fi

    echo '  Dropping and recreating database...'
    podman exec \$DB psql -U expenses_user -d postgres -c 'DROP DATABASE IF EXISTS expenses;'
    podman exec \$DB psql -U expenses_user -d postgres -c 'CREATE DATABASE expenses OWNER expenses_user;'

    echo '  Restoring dump...'
    gunzip -c /tmp/db_${TIMESTAMP}.sql.gz | podman exec -i \$DB psql -U expenses_user -d expenses 2>&1 | tail -5

    echo '  Verifying restore...'
    TABLE_COUNT=\$(podman exec \$DB psql -U expenses_user -d expenses -t -c \"SELECT count(*) FROM information_schema.tables WHERE table_schema='public';\" | tr -d ' ')
    echo \"  Tables: \$TABLE_COUNT\"

    USER_COUNT=\$(podman exec \$DB psql -U expenses_user -d expenses -t -c 'SELECT count(*) FROM users;' | tr -d ' ')
    echo \"  Users: \$USER_COUNT\"

    EXPENSE_COUNT=\$(podman exec \$DB psql -U expenses_user -d expenses -t -c 'SELECT count(*) FROM expenses;' | tr -d ' ')
    echo \"  Expenses: \$EXPENSE_COUNT\"

    rm -f /tmp/db_${TIMESTAMP}.sql.gz
    echo '  Restore complete'
"
echo ""

# ── Step 7: Restart services ─────────────────────────────────────
echo -e "${YELLOW}[7/7] Restarting services on target...${NC}"
ssh_target "
    cd /opt/creditcardanalyzer
    export PATH=\$HOME/.local/bin:\$PATH
    set -a; source .env; set +a
    echo '  Starting platform...'
    podman-compose -p oikonomia-platform -f docker-compose.platform.yml up -d
    echo '  Starting bots...'
    podman-compose -p oikonomia-bots -f docker-compose.bots.yml up -d
    echo '  Waiting for backend health...'
    for i in \$(seq 1 30); do
        STATUS=\$(curl -sk -o /dev/null -w '%{http_code}' http://localhost:8000/docs 2>/dev/null)
        if [ \"\$STATUS\" = '200' ]; then
            echo \"  Backend healthy after \${i} attempt(s)\"
            break
        fi
        if [ \"\$i\" = '30' ]; then
            echo '  WARNING: Backend did not become healthy in 90s'
        fi
        sleep 3
    done
"
echo ""

# ── Cleanup ──────────────────────────────────────────────────────
rm -f "$DUMP_FILE"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Migration Complete${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Switch DNS A records to: $TARGET_IP"
echo "  2. After DNS propagates, run deploy workflow to get SSL certs"
echo "  3. Verify: ./scripts/smoke.sh"