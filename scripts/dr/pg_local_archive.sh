#!/bin/bash
# Hourly point-in-time pg_dump of the LOCAL Postgres replica `dynopay_dr` (zero Railway egress). Keeps 24.
# NOTE: sequences in dynopay_dr are NOT replicated (logical replication) — restore_pg.sh fixes them on the target.
set -uo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ); D=/opt/dr/dumps/pg_pit; LOG=/opt/dr/logs/pg_local_archive.log
mkdir -p "$D"; chown postgres "$D"
out="$D/dynopay-${TS}.dump"
if sudo -u postgres pg_dump -Fc --no-owner --no-acl --no-subscriptions --no-publications -d dynopay_dr -f "$out" 2>>"$LOG"; then
  echo "$TS OK $(du -h "$out" | cut -f1)" >>"$LOG"; date -u +%FT%TZ > /opt/dr/state/pg_pit.ok
else echo "$TS FAIL" >>"$LOG"; rm -f "$out"; fi
ls -1t "$D"/dynopay-*.dump 2>/dev/null | tail -n +25 | xargs -r rm -f
