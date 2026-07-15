#!/bin/sh
set -e

# Load Google Client ID from podman secret
if [ -f "/run/secrets/creditcard_frontend_dev_google_client_id" ]; then
  export VITE_GOOGLE_CLIENT_ID="$(cat /run/secrets/creditcard_frontend_dev_google_client_id)"
fi

exec npm run dev -- --host 0.0.0.0
