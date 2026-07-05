#!/bin/bash
# Production deployment script for creditCardAnalyzer
# Usage: ./scripts/deploy_prod.sh [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

cd "$BACKEND_DIR"

echo "============================================================"
echo "Production Deployment - $(date)"
echo "============================================================"

# Parse args
DRY_RUN=false
for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
  esac
done

# Step 1: Database migration
echo ""
echo "[Step 1/3] Running database migration..."
if [ "$DRY_RUN" = true ]; then
  echo "  Would run: podman-compose run --rm --no-deps backend python -m scripts.migrate_add_reset_token"
  echo "  Would run: podman-compose run --rm --no-deps backend python -m scripts.migrate_remove_haberes"
else
  podman-compose run --rm --no-deps backend python -m scripts.migrate_add_reset_token
  podman-compose run --rm --no-deps backend python -m scripts.migrate_remove_haberes
fi

# Step 2: Restart services
echo ""
echo "[Step 2/3] Restarting backend..."
if [ "$DRY_RUN" = true ]; then
  echo "  Would restart backend container"
else
  if command -v podman-compose &> /dev/null; then
    podman-compose restart backend_dev 2>/dev/null || echo "  Note: Could not restart via podman-compose"
  elif command -v docker-compose &> /dev/null; then
    docker-compose restart backend_dev 2>/dev/null || echo "  Note: Could not restart via docker-compose"
  else
    echo "  Note: No compose command found. Restart manually."
  fi
fi

# Step 3: Verify
echo ""
echo "[Step 3/3] Verifying..."
if [ "$DRY_RUN" = true ]; then
  echo "  Would check API health"
else
  sleep 2
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/docs 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo "  Backend is healthy (HTTP 200)"
  else
    echo "  Warning: Backend returned HTTP $STATUS"
  fi
fi

echo ""
echo "============================================================"
echo "Deployment complete! - $(date)"
echo "============================================================"
