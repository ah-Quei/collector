#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${COLLECTOR_INSTALL_DIR:-$HOME/.local/bin}"
APP_DIR="${COLLECTOR_APP_DIR:-$HOME/.local/lib/collector}"
CONFIG_DIR="${COLLECTOR_CONFIG_DIR:-$HOME/.collector}"
PURGE="${COLLECTOR_PURGE:-0}"

log() {
    printf '%s\n' "$*"
}

if [ -x "$INSTALL_DIR/collector" ]; then
    "$INSTALL_DIR/collector" stop >/dev/null 2>&1 || true
fi

rm -f "$INSTALL_DIR/collector"
rm -rf "$APP_DIR"

log "Removed collector binary: $INSTALL_DIR/collector"
log "Removed collector app bundle: $APP_DIR"

case "$PURGE" in
    1|true|TRUE|yes|YES)
        rm -rf "$CONFIG_DIR"
        log "Removed collector config/data: $CONFIG_DIR"
        ;;
    *)
        log "Kept collector config/data: $CONFIG_DIR"
        log "Set COLLECTOR_PURGE=1 to remove config, database, logs, and skills."
        ;;
esac
