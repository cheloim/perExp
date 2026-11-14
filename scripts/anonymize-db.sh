#!/usr/bin/env bash
#
# Genera un dump anonimizado a partir de un backup de producción.
#
#   ./scripts/anonymize-db.sh [backup.dump]
#
# Restaura el backup en una base scratch, la anonimiza con
# src/backend/scripts/anonymize_db.py, verifica y deja el resultado en
# $OUT (por defecto /opt/creditcardanalyzer/backups/db_anonymized.dump).
#
# La base de producción no se toca: el trabajo ocurre en $WORK_DB, que debe
# terminar en `_anon`. La key de anonimización es pública a propósito (sólo
# protege datos sintéticos) y por eso el fixture se puede verificar en CI.
#
# Variables (todas con default):
#   APP_DIR         /opt/creditcardanalyzer
#   BACKUP_DIR      $APP_DIR/backups
#   WORK_DB         expenses_anon
#   OUT             $BACKUP_DIR/db_anonymized.dump
#   KEEP_WORK_DB    0 (si es 1, no borra la base scratch al terminar)
#   SRC_DIR         directorio con anonymize_db.py y anonymization_registry.py
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-/opt/creditcardanalyzer}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
WORK_DB="${WORK_DB:-expenses_anon}"
OUT="${OUT:-$BACKUP_DIR/db_anonymized.dump}"
SRC_DIR="${SRC_DIR:-$SCRIPT_DIR}"
if [[ ! -f "$SRC_DIR/anonymize_db.py" ]]; then
    SRC_DIR="$SCRIPT_DIR/../src/backend/scripts"
fi

if [[ "$WORK_DB" == "expenses" || "$WORK_DB" == "postgres" ]]; then
    echo "::error::WORK_DB=$WORK_DB es una base real; elegí otra (ej. expenses_anon)" >&2
    exit 1
fi

DB_CONTAINER="${DB_CONTAINER:-$(podman ps --format '{{.Names}}' | grep -E '_db_' | head -1 || true)}"
APP_CONTAINER="${APP_CONTAINER:-$(podman ps --format '{{.Names}}' | grep -E '_backend_' | head -1 || true)}"
if [[ -z "$DB_CONTAINER" || -z "$APP_CONTAINER" ]]; then
    echo "::error::No encontré los contenedores de db y backend" >&2
    exit 1
fi

SOURCE="${1:-}"
if [[ -z "$SOURCE" ]]; then
    SOURCE="$(find "$BACKUP_DIR" -maxdepth 1 -name 'db_*.dump' ! -name 'db_anonymized*' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
fi
if [[ -z "$SOURCE" || ! -f "$SOURCE" ]]; then
    echo "::error::No hay backup de origen. Pasalo como argumento." >&2
    exit 1
fi
if [[ ! -f "$SRC_DIR/anonymize_db.py" || ! -f "$SRC_DIR/anonymization_registry.py" ]]; then
    echo "::error::Faltan los scripts en $SRC_DIR" >&2
    exit 1
fi

# shellcheck disable=SC1091
set -a
source "$APP_DIR/.env"
set +a
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD no está en $APP_DIR/.env}"

cleanup() {
    if [[ "${KEEP_WORK_DB:-0}" != "1" ]]; then
        podman exec "$DB_CONTAINER" dropdb -U expenses_user --if-exists "$WORK_DB" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

echo "Origen: $SOURCE"
echo "Base scratch: $WORK_DB (contenedor $DB_CONTAINER)"
echo "Salida: $OUT"

echo "Restaurando el backup en la base scratch..."
podman exec "$DB_CONTAINER" dropdb -U expenses_user --if-exists "$WORK_DB" >/dev/null
podman exec "$DB_CONTAINER" createdb -U expenses_user -O expenses_user "$WORK_DB"
set +e
podman exec -i "$DB_CONTAINER" pg_restore -U expenses_user -d "$WORK_DB" \
    --no-owner --no-privileges <"$SOURCE" 2>&1 | sed '/transaction_timeout/d'
RESTORE_STATUS=${PIPESTATUS[0]}
set -e
if [[ "$RESTORE_STATUS" -ne 0 ]]; then
    echo "::error::pg_restore falló (status $RESTORE_STATUS)" >&2
    exit 1
fi

echo "Copiando el anonimizador al contenedor del backend..."
podman cp "$SRC_DIR/anonymize_db.py" "$APP_CONTAINER:/app/scripts/anonymize_db.py"
podman cp "$SRC_DIR/anonymization_registry.py" "$APP_CONTAINER:/app/scripts/anonymization_registry.py"

echo "Anonimizando y verificando..."
# PGHOST=db usa la red de compose; DATABASE_URL del contenedor (producción) se
# ignora porque el script conecta con las PG* env.
podman exec \
    -e PGHOST=db \
    -e PGUSER=expenses_user \
    -e PGPASSWORD="$POSTGRES_PASSWORD" \
    -e PGDATABASE="$WORK_DB" \
    -w /app \
    "$APP_CONTAINER" \
    python -m scripts.anonymize_db

echo "Generando el dump anonimizado..."
TMP_OUT="${OUT}.tmp"
podman exec "$DB_CONTAINER" pg_dump -U expenses_user -Fc "$WORK_DB" >"$TMP_OUT"

echo "Verificando que el dump se pueda leer entero..."
podman cp "$TMP_OUT" "$DB_CONTAINER:/tmp/anonymized.dump"
if ! podman exec "$DB_CONTAINER" pg_restore --list /tmp/anonymized.dump >/dev/null; then
    echo "::error::El dump anonimizado no se pudo leer" >&2
    rm -f "$TMP_OUT"
    exit 1
fi
podman exec "$DB_CONTAINER" rm -f /tmp/anonymized.dump

mv "$TMP_OUT" "$OUT"
(cd "$(dirname "$OUT")" && sha256sum "$(basename "$OUT")" >"$(basename "$OUT").sha256")
echo "Listo: $OUT ($(du -h "$OUT" | cut -f1))"
echo "SHA256: $(cut -d' ' -f1 "$OUT.sha256")"
