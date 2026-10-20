#!/bin/bash
# Redis replication probe: SET/HSET/EXPIRE/DEL a throwaway key on SOURCE, confirm on the local replica.
set -uo pipefail
IFS='|' read -r H P PW < /opt/dr/conf/redis_source.conf
src(){ redis-cli -h "$H" -p "$P" -a "$PW" --no-auth-warning "$@"; }
loc(){ redis-cli -p 6379 "$@"; }
K="dr:probe:$(date +%s%N)"; fails=0
wait_for(){ # label cmd... expected
  local label="$1" exp="$2"; shift 2; local t0=$(date +%s%N)
  for i in $(seq 1 200); do [ "$(loc "$@")" = "$exp" ] && { printf "PASS %-22s %4dms\n" "$label" $(( ($(date +%s%N) - t0) / 1000000 )); return; }; sleep 0.05; done
  echo "FAIL $label"; fails=$((fails+1))
}
src SET "$K" v1 EX 120 >/dev/null;           wait_for "SET (string)" v1 GET "$K"
src SET "$K" v2 KEEPTTL >/dev/null;          wait_for "overwrite" v2 GET "$K"
src HSET "$K:h" f 7 >/dev/null; src EXPIRE "$K:h" 120 >/dev/null; wait_for "HSET (hash)" 7 HGET "$K:h" f
src DEL "$K" "$K:h" >/dev/null;              wait_for "DEL" 0 EXISTS "$K" "$K:h"
echo "replication: $(loc INFO replication | grep -E '^master_link_status|^master_last_io_seconds_ago' | tr -d '\r' | tr '\n' ' ')"
[ $fails -eq 0 ] && echo "REDIS PROBE OK" || { echo "REDIS PROBE FAILED ($fails)"; exit 1; }
