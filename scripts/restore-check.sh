#!/usr/bin/env bash
# Restore drill (docs/98: "restore tested monthly"). Restores the newest
# backup into a scratch database and sanity-checks table + row counts.
# Usage: DATABASE_URL=postgres://… ./scripts/restore-check.sh [backup-file]
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP="${1:-$(ls -t /var/backups/agencyos/agencyos-*.dump.gz 2>/dev/null | head -1)}"
[[ -n "$BACKUP" && -f "$BACKUP" ]] || { echo "no backup file found" >&2; exit 1; }

SCRATCH_DB="agencyos_restore_check"
ADMIN_URL="${DATABASE_URL%/*}/postgres"

psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $SCRATCH_DB;"
psql "$ADMIN_URL" -qc "CREATE DATABASE $SCRATCH_DB;"
gunzip -c "$BACKUP" | pg_restore --no-owner --dbname="${DATABASE_URL%/*}/$SCRATCH_DB"

TABLES=$(psql "${DATABASE_URL%/*}/$SCRATCH_DB" -tAc \
  "select count(*) from information_schema.tables where table_schema='public'")
USERS=$(psql "${DATABASE_URL%/*}/$SCRATCH_DB" -tAc "select count(*) from users")

echo "restore check: $TABLES tables, $USERS users restored from $(basename "$BACKUP")"
[[ "$TABLES" -gt 20 ]] || { echo "FAIL: expected >20 tables" >&2; exit 1; }
psql "$ADMIN_URL" -qc "DROP DATABASE $SCRATCH_DB;"
echo "restore drill passed ✓"
