#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_DIR="${PROJECT_ROOT}/secrets"

NAMESPACE="creditcard"

declare -A SECRETS=(
    ["backend/LLM_API_KEY"]="${NAMESPACE}_backend_llm_api_key"
    ["backend/INVESTMENTS_LLM_API_KEY"]="${NAMESPACE}_backend_investments_llm_api_key"
    ["backend/TELEGRAM_BOT_TOKEN"]="${NAMESPACE}_backend_telegram_bot_token"
    ["backend/GOOGLE_CLIENT_ID"]="${NAMESPACE}_backend_google_client_id"
    ["backend/GOOGLE_CLIENT_SECRET"]="${NAMESPACE}_backend_google_client_secret"
    ["backend/SECRET_KEY"]="${NAMESPACE}_backend_secret_key"
    ["frontend/GOOGLE_CLIENT_ID"]="${NAMESPACE}_frontend_google_client_id"
)

echo "=== Podman Secrets Setup ==="
echo "Project root: ${PROJECT_ROOT}"
echo ""

for filepath in "${!SECRETS[@]}"; do
    secretname="${SECRETS[$filepath]}"
    fullpath="${SECRETS_DIR}/${filepath}"

    if [ ! -f "$fullpath" ]; then
        echo "[ERROR] Secret file not found: ${fullpath}"
        exit 1
    fi

    echo "[MANAGE] Secret: ${secretname}"
    cat "${fullpath}" | podman secret create --replace "${secretname}" -
done

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Secrets created:"
podman secret ls | grep "${NAMESPACE}_"