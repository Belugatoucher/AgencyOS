#!/usr/bin/env bash
# Agency OS database backup (docs/98 + roadmap wk10).
# - pg_dump custom format, gzipped
# - encrypted with age when BACKUP_AGE_RECIPIENT is set (docs/98: encrypt
#   BEFORE upload)
# - uploaded to R2 with SEPARATE write-only credentials when the R2_BACKUP_*
#   vars are set (ransomware posture: the backup key cannot delete)
# - restore drill: scripts/restore-check.sh (run monthly per docs/98)
#
# Usage: DATABASE_URL=postgres://… ./scripts/backup.sh [output-dir]
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
OUT_DIR="${1:-/var/backups/agencyos}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"

RAW="$OUT_DIR/agencyos-$STAMP.dump.gz"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" | gzip > "$RAW"

ARTIFACT="$RAW"
if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  command -v age >/dev/null || { echo "age not installed but BACKUP_AGE_RECIPIENT set" >&2; exit 1; }
  age -r "$BACKUP_AGE_RECIPIENT" -o "$RAW.age" "$RAW"
  rm -f "$RAW"
  ARTIFACT="$RAW.age"
fi

echo "backup written: $ARTIFACT ($(du -h "$ARTIFACT" | cut -f1))"

if [[ -n "${R2_BACKUP_ACCESS_KEY:-}" && -n "${R2_BACKUP_SECRET:-}" && -n "${R2_ENDPOINT:-}" ]]; then
  command -v aws >/dev/null || { echo "aws cli not installed; skipping upload" >&2; exit 0; }
  AWS_ACCESS_KEY_ID="$R2_BACKUP_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET" \
    aws s3 cp "$ARTIFACT" "s3://${R2_BACKUP_BUCKET:-agencyos-backups}/$(basename "$ARTIFACT")" \
    --endpoint-url "$R2_ENDPOINT"
  echo "uploaded to R2 bucket ${R2_BACKUP_BUCKET:-agencyos-backups}"
fi
