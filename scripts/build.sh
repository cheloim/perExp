#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SECRETS_DIR="${PROJECT_ROOT}/secrets"

export VITE_GOOGLE_CLIENT_ID="$(cat "${SECRETS_DIR}/frontend/GOOGLE_CLIENT_ID")"

COMPOSE_FILE="${1:-podman-compose.yml}"

echo "=== Building with secrets ==="
echo "Compose file: ${COMPOSE_FILE}"
echo ""

podman-compose -f "${COMPOSE_FILE}" build