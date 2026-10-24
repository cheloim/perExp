#!/usr/bin/env bash
#
# Backup de la base de datos, verificable.
#
# Lo usan dos lugares:
#   * deploy.yml (backup-db), antes de un deploy que puede tocar datos
#   * scripts/housekeeping.sh, para el backup diario
#
# Formato custom (-Fc): comprimido por dentro y legible con pg_restore --list,
# que es lo que permite VERIFICARLO. El dump plano de antes podía quedar
# truncado por un disco lleno, pasar el chequeo de "no está vacío" y
# descubrirse recién en el restore.
#
# Variables (todas con default):
#   BACKUP_DIR  /opt/creditcardanalyzer/backups
#   DB_NAME     expenses
#   DB_USER     expenses_user
#
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/creditcardanalyzer/backups}"
DB_NAME="${DB_NAME:-expenses}"
DB_USER="${DB_USER:-expenses_user}"

mkdir -p "$BACKUP_DIR"

DB_CONTAINER=$(podman ps --format '{{.Names}}' | grep -E '_db_' | head -1 || true)
if [ -z "$DB_CONTAINER" ]; then
    echo "::warning::No hay contenedor de base corriendo — backup salteado"
    exit 0
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/db_${TIMESTAMP}.dump"

echo "Backing up database to $BACKUP_FILE ..."
# OJO: sin `2>/dev/null`. Esconder el stderr de pg_dump es lo que hacía que un
# dump roto por disco lleno pareciera un backup válido.
if ! podman exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -Fc "$DB_NAME" >"$BACKUP_FILE"; then
    echo "::error::pg_dump falló"
    rm -f "$BACKUP_FILE"
    exit 1
fi

# Verificar que el dump se puede leer entero antes de confiar en él.
podman cp "$BACKUP_FILE" "$DB_CONTAINER:/tmp/backup.dump"
if ! podman exec "$DB_CONTAINER" pg_restore --list /tmp/backup.dump >/dev/null; then
    echo "::error::El dump no se pudo leer: backup corrupto"
    podman exec "$DB_CONTAINER" rm -f /tmp/backup.dump || true
    rm -f "$BACKUP_FILE"
    exit 1
fi
podman exec "$DB_CONTAINER" rm -f /tmp/backup.dump

echo "Backup verificado: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
ls -lh "$BACKUP_DIR"/db_* 2>/dev/null | tail -5 || true
