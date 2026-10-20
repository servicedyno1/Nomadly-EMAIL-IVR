#!/bin/bash
# DR: live MongoDB mirror — dump each Railway Mongo + restore into local mongod.
# Runs every 2 min via cron. flock prevents overlap. Config (with secrets) at
# /opt/dr/conf/mongo_sources.conf  (lines: name|mongo_uri|db ; '#' comments).
set -uo pipefail
CONF=/opt/dr/conf/mongo_sources.conf
LOG=/opt/dr/logs/mongo_snapshot.log
LOCK=/opt/dr/state/mongo_snapshot.lock
mkdir -p /opt/dr/dumps/mongo /opt/dr/logs /opt/dr/state
exec 9>"$LOCK"
flock -n 9 || { echo "$(date -u +%FT%TZ) SKIP previous run still active" >>"$LOG"; exit 0; }
ts=$(date -u +%FT%TZ)
start=$(date +%s)
while IFS='|' read -r name uri db; do
  [ -z "${name:-}" ] && continue
  case "$name" in \#*) continue;; esac
  systemctl is-enabled --quiet "dr-mongo-tail@$name" 2>/dev/null && continue  # live change-stream tailer owns it
  # Railway Mongo users live in authSource=admin; bare URIs have no query string.
  case "$uri" in *\?*) u="$uri";; *) u="${uri%/}/?authSource=admin";; esac
  arc="/opt/dr/dumps/mongo/${name}.archive.gz"
  if mongodump --uri="$u" --db="$db" --gzip --archive="$arc" --quiet 2>>"$LOG"; then
    if mongorestore --gzip --archive="$arc" --drop --nsInclude="${db}.*" --quiet 2>>"$LOG"; then
      echo "$ts" > "/opt/dr/state/mongo_${name}.ok"
      echo "$ts OK ${name}(${db}) size=$(du -h "$arc" 2>/dev/null | cut -f1)" >>"$LOG"
    else echo "$ts RESTORE_FAIL ${name}" >>"$LOG"; fi
  else echo "$ts DUMP_FAIL ${name}" >>"$LOG"; fi
done < "$CONF"
echo "$ts cycle_done in $(( $(date +%s) - start ))s" >>"$LOG"
