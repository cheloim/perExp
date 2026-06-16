#!/bin/sh
set -e

if [ -f "/run/secrets/creditcard_backend_dev_llm_api_key" ]; then
    export LLM_API_KEY=$(cat /run/secrets/creditcard_backend_dev_llm_api_key)
elif [ -f "/run/secrets/creditcard_backend_llm_api_key" ]; then
    export LLM_API_KEY=$(cat /run/secrets/creditcard_backend_llm_api_key)
fi

if [ -f "/run/secrets/creditcard_backend_dev_investments_llm_api_key" ]; then
    export INVESTMENTS_LLM_API_KEY=$(cat /run/secrets/creditcard_backend_dev_investments_llm_api_key)
elif [ -f "/run/secrets/creditcard_backend_investments_llm_api_key" ]; then
    export INVESTMENTS_LLM_API_KEY=$(cat /run/secrets/creditcard_backend_investments_llm_api_key)
fi

if [ -f "/run/secrets/creditcard_backend_dev_messages_bot_llm_api_key" ]; then
    export MESSAGES_BOT_LLM_API_KEY=$(cat /run/secrets/creditcard_backend_dev_messages_bot_llm_api_key)
elif [ -f "/run/secrets/creditcard_backend_messages_bot_llm_api_key" ]; then
    export MESSAGES_BOT_LLM_API_KEY=$(cat /run/secrets/creditcard_backend_messages_bot_llm_api_key)
fi

if [ -f "/run/secrets/creditcard_backend_dev_telegram_bot_token" ]; then
    export TELEGRAM_BOT_TOKEN=$(cat /run/secrets/creditcard_backend_dev_telegram_bot_token)
elif [ -f "/run/secrets/creditcard_backend_telegram_bot_token" ]; then
    export TELEGRAM_BOT_TOKEN=$(cat /run/secrets/creditcard_backend_telegram_bot_token)
fi

if [ -f "/run/secrets/creditcard_backend_dev_google_client_id" ]; then
    export GOOGLE_CLIENT_ID=$(cat /run/secrets/creditcard_backend_dev_google_client_id)
elif [ -f "/run/secrets/creditcard_backend_google_client_id" ]; then
    export GOOGLE_CLIENT_ID=$(cat /run/secrets/creditcard_backend_google_client_id)
fi

if [ -f "/run/secrets/creditcard_backend_dev_google_client_secret" ]; then
    export GOOGLE_CLIENT_SECRET=$(cat /run/secrets/creditcard_backend_dev_google_client_secret)
elif [ -f "/run/secrets/creditcard_backend_google_client_secret" ]; then
    export GOOGLE_CLIENT_SECRET=$(cat /run/secrets/creditcard_backend_google_client_secret)
fi

if [ -f "/run/secrets/creditcard_backend_dev_secret_key" ]; then
    export SECRET_KEY=$(cat /run/secrets/creditcard_backend_dev_secret_key)
elif [ -f "/run/secrets/creditcard_backend_secret_key" ]; then
    export SECRET_KEY=$(cat /run/secrets/creditcard_backend_secret_key)
fi

# Skip Telegram bot for celery workers (avoid duplicate polling)
if [ "$1" = "celery" ]; then
    exec "$@"
fi

exec "$@"