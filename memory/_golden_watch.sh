#!/usr/bin/env bash
# Poll golden-build status every 2 min into a log until no build is running.
cd /app
LOG=/app/memory/golden_rebuild_2026-09-24.log
for i in $(seq 1 240); do
  echo "===== $(date -u +%H:%M:%S) UTC =====" >> "$LOG"
  timeout 80 node js/ops/rdp_golden_build.js status >> "$LOG" 2>&1
  running=$(grep -c "running)" "$LOG" >/dev/null 2>&1; timeout 80 node js/ops/rdp_golden_build.js status 2>/dev/null | grep -oE "[0-9]+ running" | grep -oE "^[0-9]+")
  if [ "$running" = "0" ]; then echo "ALL BUILDS DONE at $(date -u +%H:%M:%S)" >> "$LOG"; break; fi
  sleep 120
done
