#!/bin/bash
# Hourly point-in-time archive of the LOCAL Mongo mirror (zero Railway egress).
# Protects against bad writes/deletes that the live tailer replicates instantly. Keeps 24 per DB.
set -uo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ); D=/opt/dr/dumps/mongo_pit; LOG=/opt/dr/logs/mongo_local_archive.log
mkdir -p "$D"
while IFS='|' read -r name uri db; do
  [ -z "${name:-}" ] && continue; case "$name" in \#*) continue;; esac
  out="$D/${name}-${TS}.archive.gz"
  if mongodump --uri=mongodb://127.0.0.1:27017 --db="$db" --gzip --archive="$out" --quiet 2>>"$LOG"; then
    echo "$TS OK $name $(du -h "$out" | cut -f1)" >>"$LOG"
  else echo "$TS FAIL $name" >>"$LOG"; rm -f "$out"; fi
  ls -1t "$D/${name}-"*.archive.gz 2>/dev/null | tail -n +25 | xargs -r rm -f
done < /opt/dr/conf/mongo_sources.conf
date -u +%FT%TZ > /opt/dr/state/mongo_pit.ok
