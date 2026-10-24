#!/usr/bin/env bash
#
# Housekeeping de producción para Oikonomia.
#
# Corre dos veces:
#   * un timer diario (docker/ops/oikonomia-housekeeping.timer)
#   * desde deploy.yml, ANTES de pull-images — la limpieza tiene que ocurrir
#     aunque los deploys fallen. Ese orden invertido fue el incidente del
#     2026-10-23: primero se llenaba el disco con imágenes nuevas y después
#     se intentaba limpiar, con una limpieza que además sólo corría si todo
#     el deploy había salido bien.
#
# Qué hace:
#   1. Borra tags viejos de las imágenes de la app, conservando el release
#      corriente y el de rollback. IMAGE_TAG lo comparten backend, frontend y
#      landing, y .rollback_platform_tag guarda el tag anterior: conservar sólo
#      la imagen del contenedor corriendo dejaría el release de rollback a
#      medio borrar.
#   2. Poda imágenes dangling y volúmenes huérfanos.
#   3. Purga logs y backups con más de HOUSEKEEPING_RETENTION_DAYS días.
#   4. Vacía el journal de systemd al mismo plazo.
#   5. Publica una métrica de "última limpieza OK" (para la alerta de
#      staleness) y avisa por Telegram si algo falla.
#
# Uso:
#   scripts/housekeeping.sh [--dry-run]
#
# Variables (todas con default, el timer no necesita configuración):
#   HOUSEKEEPING_ROOT            /opt/creditcardanalyzer
#   HOUSEKEEPING_RETENTION_DAYS  15
#   APP_REPO_SUFFIXES            "/backend /frontend /landing"
#   HOUSEKEEPING_TSFILE_DIR      /var/lib/node_exporter/textfile
#
set -euo pipefail

DRY_RUN=false
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        -h | --help)
            sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "argumento desconocido: $arg" >&2
            exit 2
            ;;
    esac
done

ROOT="${HOUSEKEEPING_ROOT:-/opt/creditcardanalyzer}"
LOGS_DIR="$ROOT/logs"
BACKUPS_DIR="$ROOT/backups"
RETENTION_DAYS="${HOUSEKEEPING_RETENTION_DAYS:-15}"
APP_REPO_SUFFIXES="${APP_REPO_SUFFIXES:-/backend /frontend /landing}"
TAG_FILE="$ROOT/.rollback_platform_tag"
TSFILE_DIR="${HOUSEKEEPING_TSFILE_DIR:-/var/lib/node_exporter/textfile}"
BACKUP_SCRIPT="${HOUSEKEEPING_BACKUP_SCRIPT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backup-db.sh}"
METRIC_NAME="oikonomia_housekeeping_last_success_timestamp_seconds"

log() {
    echo "[housekeeping] $*"
}

# Ejecuta un comando destructivo, o sólo lo anuncia en --dry-run.
run() {
    if $DRY_RUN; then
        echo "DRY-RUN $*"
    else
        "$@"
    fi
}

notify_failure() {
    local msg="$1"
    if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_ADMIN_CHAT_ID:-}" ]; then
        curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            --data-urlencode "chat_id=${TELEGRAM_ADMIN_CHAT_ID}" \
            --data-urlencode "text=[housekeeping] $msg" \
            >/dev/null 2>&1 || true
    fi
    log "AVISO: $msg"
}

trap 'notify_failure "falló en la línea $LINENO"' ERR

# ── 1. Imágenes de la app: conservar el release corriente y el de rollback ──

# Tags a conservar: los de las imágenes corriendo más el tag de rollback.
KEEP_TAGS=" "
while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    KEEP_TAGS="$KEEP_TAGS${ref##*:} "
done < <(podman ps --format '{{.Image}}' 2>/dev/null || true)

# El release corriente también se conserva por nombre: si la limpieza corre
# entre que se detienen los contenedores viejos y se levantan los nuevos, las
# imágenes del release ya no están "corriendo" y se borrarían.
if [ -f "$ROOT/.env" ]; then
    env_tag="$(grep '^IMAGE_TAG=' "$ROOT/.env" | cut -d= -f2 || true)"
    [ -n "$env_tag" ] && KEEP_TAGS="$KEEP_TAGS$env_tag "
fi

if [ -f "$TAG_FILE" ]; then
    rollback_tag="$(tr -d '[:space:]' <"$TAG_FILE")"
    if [ -n "$rollback_tag" ]; then
        # Acepta tanto un tag suelto como un ref completo.
        KEEP_TAGS="$KEEP_TAGS${rollback_tag##*:} "
    fi
fi

# Sólo las imágenes de la app son candidatas: las base (postgres, redis, nginx,
# grafana...) las maneja el pull de cada servicio y no se tocan.
is_app_repo() {
    local ref="$1" suffix
    for suffix in $APP_REPO_SUFFIXES; do
        case "$ref" in
            *"$suffix":*) return 0 ;;
        esac
    done
    return 1
}

log "Imágenes de la app — se conservan los tags:${KEEP_TAGS% }"
while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    [ "$ref" = "<none>:<none>" ] && continue
    is_app_repo "$ref" || continue

    tag="${ref##*:}"
    case "$KEEP_TAGS" in
        *" $tag "*)
            echo "KEEP $ref"
            ;;
        *)
            echo "REMOVE $ref"
            run podman rmi -f "$ref"
            ;;
    esac
done < <(podman images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null || true)

# ── 2. Imágenes dangling ──
# NO se hace `podman volume prune`: borra todo volumen que ningún contenedor
# esté usando, y el volumen de postgres queda "sin usar" en cuanto el
# contenedor de la base se recrea — o cuando esa recreación falla, que es
# justo cuando corre la limpieza. Sería perder la base mientras se "arregla"
# un disco lleno.

log "Podando imágenes dangling"
run podman image prune -f

# ── 3. Logs y backups viejos ──

purge_old() {
    local dir="$1" pattern="$2" label="$3"
    [ -d "$dir" ] || return 0

    local old
    old="$(find "$dir" -type f -name "$pattern" -mtime +"$RETENTION_DAYS" 2>/dev/null || true)"
    if [ -z "$old" ]; then
        log "$label: nada para purgar (>${RETENTION_DAYS} días)"
        return 0
    fi
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        echo "REMOVE-FILE $f"
    done <<<"$old"
    run find "$dir" -type f -name "$pattern" -mtime +"$RETENTION_DAYS" -delete
}

purge_old "$LOGS_DIR" "*.gz" "Logs rotados"
purge_old "$LOGS_DIR" "journal.log-*" "Logs de journal"
purge_old "$BACKUPS_DIR" "db_*.sql.gz" "Backups de la base"
purge_old "$BACKUPS_DIR" "db_*.dump" "Backups de la base (custom format)"

# ── 4. Backup diario ──
# Los deploys sólo respaldan cuando el cambio puede tocar datos, así que sin
# esto una semana tranquila dispararía la alerta de "backup viejo" — la alarma
# falsa que enseña a ignorar las alarmas. Se toma uno sólo si el más nuevo
# tiene más de 20 horas.

newest_epoch="$(
    find "$BACKUPS_DIR" -type f \( -name 'db_*.sql.gz' -o -name 'db_*.dump' \) -printf '%T@\n' 2>/dev/null |
        sort -n | tail -1 || true
)"
newest_epoch="${newest_epoch%%.*}"
[ -n "$newest_epoch" ] || newest_epoch=0

if [ $(( $(date +%s) - newest_epoch )) -gt 72000 ]; then
    log "El backup más nuevo tiene más de 20h — tomando el diario"
    if $DRY_RUN; then
        echo "DRY-RUN bash $BACKUP_SCRIPT"
    else
        bash "$BACKUP_SCRIPT"
    fi
else
    log "Backup diario al día"
fi

# ── 5. Tope de journal.log ──
# El logrotate.timer del sistema debería bastar. Si no lo hiciera, el archivo
# crece sin techo y nadie se entera hasta que el disco se llena — ése fue el
# incidente del 2026-10-23. Acá se avisa antes de que eso pase.

JOURNAL_LOG="$LOGS_DIR/journal.log"
JOURNAL_MAX_BYTES="${HOUSEKEEPING_JOURNAL_MAX_BYTES:-209715200}" # 200MB
if [ -f "$JOURNAL_LOG" ]; then
    journal_size="$(stat -c%s "$JOURNAL_LOG" 2>/dev/null || echo 0)"
    if [ "$journal_size" -gt "$JOURNAL_MAX_BYTES" ]; then
        notify_failure "journal.log ocupa $((journal_size / 1048576))MB y el tope es $((JOURNAL_MAX_BYTES / 1048576))MB: la rotación no está funcionando"
    else
        log "journal.log dentro del tope ($((journal_size / 1048576))MB)"
    fi
fi

# ── 6. Métricas para las alertas ──
# Se escriben también en --dry-run: no son destructivas, y así la alerta de
# staleness se puede probar sin limpiar nada. `0` significa "nunca hubo
# backup", y la alerta dispara igual.

newest_backup="$(
    find "$BACKUPS_DIR" -type f \( -name 'db_*.sql.gz' -o -name 'db_*.dump' \) -printf '%T@\n' 2>/dev/null |
        sort -n | tail -1 || true
)"
newest_backup="${newest_backup%%.*}"
[ -n "$newest_backup" ] || newest_backup=0

if [ -d "$TSFILE_DIR" ] && [ -w "$TSFILE_DIR" ]; then
    {
        echo "$METRIC_NAME $(date +%s)"
        echo "oikonomia_backup_newest_timestamp_seconds $newest_backup"
    } >"$TSFILE_DIR/oikonomia_housekeeping.prom"
    log "Métricas publicadas en $TSFILE_DIR/oikonomia_housekeeping.prom"
else
    log "Textfile collector no disponible en $TSFILE_DIR — métricas omitidas"
fi

log "Housekeeping completo (retención: ${RETENTION_DAYS} días)"
