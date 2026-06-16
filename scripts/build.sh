#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SECRETS_DIR="${PROJECT_ROOT}/secrets"

export VITE_GOOGLE_CLIENT_ID="$(cat "${SECRETS_DIR}/prod/frontend/GOOGLE_CLIENT_ID")"

COMPOSE_FILE="${1:-podman-compose.yml}"
shift

BUILD_ARGS=()
SERVICES=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-cache)
            BUILD_ARGS+=(--no-cache)
            shift
            ;;
        *)
            SERVICES+=("$1")
            shift
            ;;
    esac
done

echo "=== Building with secrets ==="
echo "Compose file: ${COMPOSE_FILE}"
[[ ${#BUILD_ARGS[@]} -gt 0 ]] && echo "Build args: ${BUILD_ARGS[*]}"
[[ ${#SERVICES[@]} -gt 0 ]] && echo "Services: ${SERVICES[*]}"
echo ""

podman-compose -f "${COMPOSE_FILE}" build "${BUILD_ARGS[@]}" "${SERVICES[@]}"