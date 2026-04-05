#!/usr/bin/env bash
set -euo pipefail

# DataFlow backup script
# Copies dataflow.db to backups/ with timestamp

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="${DB_DIR:-$PROJECT_DIR/data}"
BACKUP_DIR="$PROJECT_DIR/backups"
DB_FILE="$DATA_DIR/dataflow.db"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/dataflow-$TIMESTAMP.db"

# Create backup directory if needed
mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_FILE" ]; then
  echo "Error: Database file not found at $DB_FILE"
  exit 1
fi

# Copy with WAL checkpoint for consistency
cp "$DB_FILE" "$BACKUP_FILE"

# Also copy WAL file if it exists (for consistency)
if [ -f "${DB_FILE}-wal" ]; then
  cp "${DB_FILE}-wal" "${BACKUP_FILE}-wal"
fi

echo "Backup created: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# Optional: prune old backups (keep last 7)
RETAIN=${BACKUP_RETAIN_COUNT:-7}
BACKUPS=($(ls -t "$BACKUP_DIR"/dataflow-*.db 2>/dev/null))
if [ ${#BACKUPS[@]} -gt "$RETAIN" ]; then
  for OLD in "${BACKUPS[@]:$RETAIN}"; do
    rm -f "$OLD" "${OLD}-wal" "${OLD}-shm"
    echo "Pruned old backup: $(basename "$OLD")"
  done
fi
