#!/bin/sh
set -e

# Load secrets from podman secrets if available
# Priority: Environment variables > Podman secrets
load_secret() {
    VAR_NAME=$1
    SECRET_NAME=$2
    DEV_SECRET_NAME=$3

    # Skip if already set in environment
    eval "VAL=\$$VAR_NAME"
    if [ -n "$VAL" ]; then
        return
    fi

    # Try dev secret first, then prod
    if [ -f "/run/secrets/$DEV_SECRET_NAME" ]; then
        export "$VAR_NAME=$(cat /run/secrets/$DEV_SECRET_NAME)"
    elif [ -f "/run/secrets/$SECRET_NAME" ]; then
        export "$VAR_NAME=$(cat /run/secrets/$SECRET_NAME)"
    fi
}

# Load all secrets
load_secret "LLM_API_KEY" "creditcard_backend_llm_api_key" "creditcard_backend_dev_llm_api_key"
load_secret "INVESTMENTS_LLM_API_KEY" "creditcard_backend_investments_llm_api_key" "creditcard_backend_dev_investments_llm_api_key"
load_secret "MESSAGES_BOT_LLM_API_KEY" "creditcard_backend_messages_bot_llm_api_key" "creditcard_backend_dev_messages_bot_llm_api_key"
load_secret "TELEGRAM_BOT_TOKEN" "creditcard_backend_telegram_bot_token" "creditcard_backend_dev_telegram_bot_token"
load_secret "GOOGLE_CLIENT_ID" "creditcard_backend_google_client_id" "creditcard_backend_dev_google_client_id"
load_secret "GOOGLE_CLIENT_SECRET" "creditcard_backend_google_client_secret" "creditcard_backend_dev_google_client_secret"
load_secret "SECRET_KEY" "creditcard_backend_secret_key" "creditcard_backend_dev_secret_key"

# Skip Telegram bot for celery workers (avoid duplicate polling)
if [ "$1" = "celery" ]; then
    exec "$@"
fi

exec "$@"