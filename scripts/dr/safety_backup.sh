#!/bin/bash
# Independent point-in-time safety dump of ALL source Mongo DBs before the
# risky replica-set conversion. Stored (not rotated) under /opt/dr/safety_backups/.
set -uo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
DIR=/opt/dr/safety_backups/pre-rs-${TS}
mkdir -p "$DIR"
LOG=/opt/dr/logs/safety_backup.log
CONF=/opt/dr/conf/mongo_sources.conf
echo "=== safety backup ${TS} -> ${DIR} ===" | tee -a "$LOG"
ok=0; fail=0
while IFS='|' read -r name uri db; do
  [ -z "${name:-}" ] && continue; case "$name" in \#*) continue;; esac
  case "$uri" in *\?*) u="$uri";; *) u="${uri%/}/?authSource=admin";; esac
  arc="$DIR/${name}.archive.gz"
  if mongodump --uri="$u" --db="$db" --gzip --archive="$arc" --quiet 2>>"$LOG"; then
    # validate the archive is readable/restorable (dry run)
    if mongorestore --gzip --archive="$arc" --dryRun --quiet 2>>"$LOG"; then
      echo "OK ${name} ($db) $(du -h "$arc"|cut -f1) [verified]" | tee -a "$LOG"; ok=$((ok+1))
    else echo "WARN ${name} dump saved but dryRun failed" | tee -a "$LOG"; ok=$((ok+1)); fi
  else echo "FAIL ${name}" | tee -a "$LOG"; fail=$((fail+1)); fi
done < "$CONF"
echo "${DIR}" > /opt/dr/state/last_safety_backup.txt
echo "=== safety backup done ok=${ok} fail=${fail} $(date -u +%FT%TZ) ===" | tee -a "$LOG"
