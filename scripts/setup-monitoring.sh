#!/bin/bash
set -euo pipefail

# setup-monitoring.sh — Install oikonomia-monitoring as a systemd service
# Run once on the server: sudo bash scripts/setup-monitoring.sh

COMPOSE_FILE="/opt/creditcardanalyzer/docker-compose.monitoring.yml"
ENV_FILE="/opt/creditcardanalyzer/.env"
SERVICE_NAME="oikonomia-monitoring"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: $COMPOSE_FILE not found. Deploy first."
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found."
  exit 1
fi

echo "Creating systemd service: $SERVICE_NAME"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=Oikonomia Monitoring Stack
After=network-online.target podman.socket
Wants=network-online.target
Requires=podman.socket

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/creditcardanalyzer
EnvironmentFile=${ENV_FILE}
ExecStart=$(which podman-compose) -f ${COMPOSE_FILE} up -d --remove-orphans
ExecStop=$(which podman-compose) -f ${COMPOSE_FILE} down
ExecReload=$(which podman-compose) -f ${COMPOSE_FILE} up -d --force-recreate --remove-orphans
TimeoutStartSec=120
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
EOF

# Create wrapper script for heal logic
cat > "/usr/local/bin/oikonomia-monitoring.sh" << 'WRAPPER'
#!/bin/bash
export PATH="/root/.local/bin:$PATH"
cd /opt/creditcardanalyzer
set -a
source .env
set +a

COMPOSE_FILE="docker-compose.monitoring.yml"
PROJECT="oikonomia-monitoring"

case "$1" in
  start)
    podman-compose -p $PROJECT -f $COMPOSE_FILE up -d --remove-orphans
    ;;
  stop)
    podman-compose -p $PROJECT -f $COMPOSE_FILE down
    ;;
  reload)
    podman-compose -p $PROJECT -f $COMPOSE_FILE up -d --force-recreate --remove-orphans
    ;;
  heal)
    # Check if Alloy is actually responding (not just "running")
    if ! podman exec ${PROJECT}_alloy_1 wget -qO- http://localhost:12345/metrics >/dev/null 2>&1; then
      echo "$(date -Iseconds) Alloy not responding — restarting all monitoring containers"
      podman-compose -p $PROJECT -f $COMPOSE_FILE down 2>/dev/null
      podman rm -f $(podman ps -a --filter name=${PROJECT} -q) 2>/dev/null
      podman-compose -p $PROJECT -f $COMPOSE_FILE up -d --remove-orphans
    else
      echo "$(date -Iseconds) Alloy healthy"
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|reload|heal}"
    exit 1
    ;;
esac
WRAPPER
chmod +x "/usr/local/bin/oikonomia-monitoring.sh"

# Create a health-check timer that restarts monitoring if containers die
cat > "/etc/systemd/system/${SERVICE_NAME}-heal.service" << EOF
[Unit]
Description=Oikonomia Monitoring Health Check
After=${SERVICE_NAME}.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/oikonomia-monitoring.sh heal
EnvironmentFile=${ENV_FILE}
EOF

cat > "/etc/systemd/system/${SERVICE_NAME}-heal.timer" << EOF
[Unit]
Description=Oikonomia Monitoring Health Check Timer

[Timer]
OnBootSec=60
OnUnitActiveSec=120
AccuracySec=30

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now ${SERVICE_NAME}
systemctl enable --now ${SERVICE_NAME}-heal.timer

echo ""
echo "✓ ${SERVICE_NAME} installed and started"
echo "✓ ${SERVICE_NAME}-heal.timer running (checks every 2 min)"
echo ""
echo "Commands:"
echo "  systemctl status ${SERVICE_NAME}      # check status"
echo "  systemctl reload ${SERVICE_NAME}       # restart after config change"
echo "  journalctl -u ${SERVICE_NAME} -f       # view logs"
