#!/bin/bash
# DR health monitor: Mongo change-stream tailers, Redis live replica, Postgres logical-replication
# liveness + source WAL-slot retention, and freshness of the local point-in-time archives.
# Writes /opt/dr/state/health.txt and (optionally) Telegram-alerts on problems
# if /opt/dr/conf/alert.conf exists (format: BOT_TOKEN|CHAT_ID).
set -uo pipefail
NOW=$(date +%s)
LOG=/opt/dr/logs/health.log
SRC="$(cat /opt/dr/conf/pg_source.conf 2>/dev/null)"
problems=()
out=""
emit(){ out+="$1"$'\n'; }
check_age(){ # file max_sec label
  if [ ! -f "$1" ]; then problems+=("$3: NO state file"); emit "$3: MISSING"; return; fi
  local ts age; ts=$(date -d "$(cat "$1")" +%s 2>/dev/null || echo 0); age=$(( NOW - ts ))
  emit "$3: age=${age}s"
  [ "$age" -gt "$2" ] && problems+=("$3: STALE ${age}s")
}
emit "=== DR health $(date -u +%FT%TZ) ==="
for n in nomadly voodoo proshop smadav; do
  if systemctl is-enabled --quiet "dr-mongo-tail@$n" 2>/dev/null; then
    hb=/opt/dr/state/cs_${n}.heartbeat
    if [ -f "$hb" ]; then age=$(( NOW - $(stat -c %Y "$hb") )); emit "mongo:$n stream hb_age=${age}s $(cat "$hb")"
      [ "$age" -gt 90 ] && problems+=("mongo:$n tailer heartbeat STALE ${age}s")
    else problems+=("mongo:$n tailer NO heartbeat"); emit "mongo:$n stream MISSING"; fi
    systemctl is-active --quiet "dr-mongo-tail@$n" || problems+=("mongo:$n tailer service not active")
  else check_age "/opt/dr/state/mongo_${n}.ok" 420 "mongo:$n"; fi
done
check_age /opt/dr/state/mongo_pit.ok 7500 "mongo:pit-archive"
check_age /opt/dr/state/pg_pit.ok 7500 "pg:pit-archive"
check_age /opt/dr/state/redis.ok 1800 "redis:snapshot"
# Redis live replica (redis-server REPLICAOF Railway)
rinfo=$(redis-cli -p 6379 INFO replication 2>/dev/null | tr -d '\r')
rlink=$(grep '^master_link_status:' <<<"$rinfo" | cut -d: -f2); rio=$(grep '^master_last_io_seconds_ago:' <<<"$rinfo" | cut -d: -f2)
emit "redis:replica link=${rlink:-?} last_io=${rio:-?}s keys=$(redis-cli -p 6379 DBSIZE 2>/dev/null)"
[ "${rlink:-}" = "up" ] || problems+=("redis: replica link ${rlink:-unknown}")
[ -n "${rio:-}" ] && [ "${rio}" -gt 60 ] && problems+=("redis: no data from master for ${rio}s")
# Postgres subscriber liveness
recv_age=$(sudo -u postgres psql -tAd dynopay_dr -c "select coalesce(extract(epoch from (now()-last_msg_receipt_time))::int,-1) from pg_stat_subscription where subname='dr_sub';" 2>/dev/null)
enabled=$(sudo -u postgres psql -tAd dynopay_dr -c "select subenabled from pg_subscription where subname='dr_sub';" 2>/dev/null)
notready=$(sudo -u postgres psql -tAd dynopay_dr -c "select count(*) from pg_subscription_rel where srsubstate<>'r';" 2>/dev/null)
emit "pg:sub recv_age=${recv_age:-?}s enabled=${enabled:-?} not_streaming=${notready:-?}"
[ "${enabled:-f}" = "t" ] || problems+=("pg: subscription DISABLED")
[ -n "${recv_age:-}" ] && [ "${recv_age}" -gt 180 ] && problems+=("pg: no stream msgs ${recv_age}s")
[ "${notready:-0}" != "0" ] && problems+=("pg: ${notready} tables not streaming")
# Source WAL-slot retention (if slot grows unbounded the SOURCE disk fills -> danger)
if [ -n "$SRC" ]; then
  slotb=$(psql "$SRC" -tAc "select coalesce(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn),0)::bigint from pg_replication_slots where slot_name='dr_sub';" 2>/dev/null)
  if [ -n "${slotb:-}" ]; then
    emit "pg:slot retained_wal=$(( slotb/1048576 ))MB"
    [ "$slotb" -gt 2147483648 ] && problems+=("pg: source WAL slot >2GB (${slotb} bytes) — DR falling behind")
  fi
fi
if [ ${#problems[@]} -eq 0 ]; then emit "STATUS: OK ✅"; else emit "STATUS: PROBLEM ❌"; for p in "${problems[@]}"; do emit " - $p"; done; fi
printf '%s' "$out" | tee -a "$LOG" >/dev/null
printf '%s' "$out" > /opt/dr/state/health.txt
# optional Telegram alert
if [ ${#problems[@]} -gt 0 ] && [ -f /opt/dr/conf/alert.conf ]; then
  IFS='|' read -r tok chat < /opt/dr/conf/alert.conf
  msg="⚠️ DR replica (dr-replica-ams3) problems:%0A"; for p in "${problems[@]}"; do msg+="• ${p}%0A"; done
  curl -s "https://api.telegram.org/bot${tok}/sendMessage" -d chat_id="${chat}" --data-urlencode "text=${msg}" >/dev/null 2>&1
fi
exit 0
