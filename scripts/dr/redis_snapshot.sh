#!/bin/bash
# DR: Redis point-in-time snapshot taken from the LOCAL live replica (zero Railway egress).
# The replica itself (redis-server, /etc/redis/dr-replica.conf) follows Railway Dynopay Redis in realtime.
set -uo pipefail
LOG=/opt/dr/logs/redis_snapshot.log
mkdir -p /opt/dr/dumps/redis /opt/dr/logs /opt/dr/state
ts=$(date -u +%FT%TZ)
out="/opt/dr/dumps/redis/dump-${ts}.rdb"
if redis-cli -h 127.0.0.1 -p 6379 --rdb "$out" >>"$LOG" 2>&1 && [ -s "$out" ]; then
  gzip -f "$out"
  echo "$ts" > /opt/dr/state/redis.ok
  echo "$ts OK size=$(du -h "${out}.gz" 2>/dev/null | cut -f1)" >>"$LOG"
  # retain last 144 snapshots (~24h at 10-min cadence)
  ls -1t /opt/dr/dumps/redis/dump-*.rdb.gz 2>/dev/null | tail -n +145 | xargs -r rm -f
else
  echo "$ts FAIL" >>"$LOG"; rm -f "$out"
fi
