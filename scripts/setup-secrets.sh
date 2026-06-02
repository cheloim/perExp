#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_DIR="${PROJECT_ROOT}/secrets"

NAMESPACE="creditcard"

ENV="${1:-prod}"

if [ "$ENV" != "prod" ] && [ "$ENV" != "dev" ]; then
    echo "Usage: $0 <prod|dev>"
    exit 1
fi

declare -A SECRETS=(
    ["backend/POSTGRES_PASSWORD"]="${NAMESPACE}_backend_${ENV}_postgres_password"
    ["backend/LLM_API_KEY"]="${NAMESPACE}_backend_${ENV}_llm_api_key"
    ["backend/INVESTMENTS_LLM_API_KEY"]="${NAMESPACE}_backend_${ENV}_investments_llm_api_key"
    ["backend/TELEGRAM_BOT_TOKEN"]="${NAMESPACE}_backend_${ENV}_telegram_bot_token"
    ["backend/GOOGLE_CLIENT_ID"]="${NAMESPACE}_backend_${ENV}_google_client_id"
    ["backend/GOOGLE_CLIENT_SECRET"]="${NAMESPACE}_backend_${ENV}_google_client_secret"
    ["backend/SECRET_KEY"]="${NAMESPACE}_backend_${ENV}_secret_key"
)

FRONTEND_SECRET="${NAMESPACE}_frontend_${ENV}_google_client_id"
FRONTEND_SECRET_PATH="${SECRETS_DIR}/${ENV}/frontend/GOOGLE_CLIENT_ID"

echo "=== Podman Secrets Setup (${ENV}) ==="
echo "Project root: ${PROJECT_ROOT}"
echo "Secrets dir: ${SECRETS_DIR}/${ENV}"
echo ""

count=0
for filepath in "${!SECRETS[@]}"; do
    secretname="${SECRETS[$filepath]}"
    fullpath="${SECRETS_DIR}/${ENV}/${filepath}"

    if [ ! -f "$fullpath" ]; then
        echo "[ERROR] Secret file not found: ${fullpath}"
        exit 1
    fi

    echo "[${ENV}] Creating/Updating: ${secretname}"
    cat "${fullpath}" | podman secret create --replace "${secretname}" -
    ((count++))
done

echo ""
echo "[${ENV}] Creating/Updating frontend secret: ${FRONTEND_SECRET}"
if [ ! -f "${FRONTEND_SECRET_PATH}" ]; then
    echo "[ERROR] Secret file not found: ${FRONTEND_SECRET_PATH}"
    exit 1
fi
cat "${FRONTEND_SECRET_PATH}" | podman secret create --replace "${FRONTEND_SECRET}" -
((count++))

echo ""
echo "=== ${ENV^} Setup Complete (${count} secrets) ==="
echo ""
echo "Secrets for ${ENV}:"
podman secret ls | grep "${NAMESPACE}_.*_${ENV}" | awk '{print "  " $2, "-", $3}'