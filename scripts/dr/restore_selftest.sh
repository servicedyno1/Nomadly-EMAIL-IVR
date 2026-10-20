#!/bin/bash
# DR RESTORE DRILL — proves every backup can be restored into a brand-new, password-protected database.
# Creates temporary targets on this droplet (Mongo :27100 with auth, Postgres role/db dr_selftest*, Redis :6390
# with a password), runs restore_mongo.sh / restore_pg.sh / restore_redis.py (live copy AND point-in-time files),
# verifies, then deletes every temporary target. Nothing on Railway is touched. Usage: restore_selftest.sh
set -uo pipefail
B=/opt/dr/bin; T=/opt/dr/restore_tmp/selftest; PW=$(openssl rand -hex 16); rc=0
pass(){ echo "PASS $*"; }; fail(){ echo "FAIL $*"; rc=1; }
cleanup(){
  mongosh "mongodb://mongo:$PW@127.0.0.1:27100/admin" --quiet --eval 'db.adminCommand({shutdown:1, force:true})' >/dev/null 2>&1
  redis-cli -p 6390 -a "$PW" --no-auth-warning SHUTDOWN NOSAVE >/dev/null 2>&1
  for d in dr_selftest dr_selftest_pit; do sudo -u postgres dropdb --if-exists --force "$d" >/dev/null 2>&1; done
  sudo -u postgres psql -qc "DROP ROLE IF EXISTS dr_selftest" >/dev/null 2>&1
  sleep 1; [ $rc -ne 0 ] && cp -f "$T"/*.log /opt/dr/logs/ 2>/dev/null && echo "cleanup: temp db logs kept in /opt/dr/logs/{mongod,redis}.log"
  rm -rf "$T"; echo "cleanup: temporary targets removed"
}
trap cleanup EXIT
rm -rf "$T"; mkdir -p "$T/mongo" "$T/redis"
ulimit -n 64000  # temp mongod needs >1024 files for ~450 collections (systemd mongod already has 64000)

echo "=== MongoDB → fresh mongod :27100 (auth on, root user 'mongo', like Railway) ==="
mongod --port 27100 --bind_ip 127.0.0.1 --dbpath "$T/mongo" --auth --wiredTigerCacheSizeGB 0.25 --fork --logpath "$T/mongod.log" >/dev/null
mongosh --port 27100 --quiet --eval "db.getSiblingDB('admin').createUser({user:'mongo',pwd:'$PW',roles:['root']})" >/dev/null
MURI="mongodb://mongo:$PW@127.0.0.1:27100"
for n in proshop voodoo smadav nomadly; do
  out=$("$B/restore_mongo.sh" "$n" "$MURI" 2>&1); echo "$out" | grep -E "restored successfully|collections,|MISMATCH" | sed 's/^/   /'
  grep -q "RESTORE OK" <<<"$out" && pass "mongo live restore $n" || { fail "mongo live restore $n"; tail -6 <<<"$out" | sed 's/^/   | /'; }
done
pit=$(ls -1t /opt/dr/dumps/mongo_pit/voodoo-*.archive.gz 2>/dev/null | head -1)
if [ -n "$pit" ]; then
  out=$("$B/restore_mongo.sh" voodoo "$MURI" --archive "$pit" --to-db voodoo_pit 2>&1)
  grep -q "RESTORE OK" <<<"$out" && pass "mongo point-in-time restore ($(basename "$pit") → voodoo_pit)" || fail "mongo PIT restore: $(tail -2 <<<"$out")"
else fail "no mongo PIT archive found"; fi
g=$("$B/restore_mongo.sh" proshop "$MURI" 2>&1); grep -q "^ABORT" <<<"$g" && pass "mongo refuses non-empty target without --force" || fail "mongo non-empty-target guard"

echo "=== Postgres → fresh database (password login over TCP, like Railway) ==="
sudo -u postgres psql -qc "CREATE ROLE dr_selftest LOGIN SUPERUSER PASSWORD '$PW'" >/dev/null
sudo -u postgres createdb -O dr_selftest dr_selftest; sudo -u postgres createdb -O dr_selftest dr_selftest_pit
PURL="postgresql://dr_selftest:$PW@127.0.0.1:5432/dr_selftest"
out=$("$B/restore_pg.sh" "$PURL" 2>&1); echo "$out" | grep -E "tables,|MISMATCH|sequences fixed" | sed 's/^/   /'
grep -q "RESTORE OK" <<<"$out" && pass "postgres live restore" || { fail "postgres live restore"; tail -5 <<<"$out"; }
# every serial/identity sequence must now be >= MAX(column) → the next INSERT cannot collide
psql "$PURL" -v ON_ERROR_STOP=1 -q <<'SQL' && pass "postgres sequences >= MAX(id) on every serial/identity column" || fail "postgres sequences behind data"
DO $$ DECLARE r record; m bigint; lv bigint; bad int := 0; n int := 0;
BEGIN
  FOR r IN SELECT d.objid::regclass AS seq, d.refobjid::regclass AS tbl, a.attname AS col
             FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
            WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a','i')
              AND (SELECT relkind FROM pg_class WHERE oid = d.objid) = 'S'
  LOOP
    n := n + 1; EXECUTE format('SELECT max(%I)::bigint FROM %s', r.col, r.tbl) INTO m; lv := pg_sequence_last_value(r.seq);
    IF m IS NOT NULL AND (lv IS NULL OR lv < m) THEN bad := bad + 1; RAISE NOTICE 'behind: % (% max=% seq=%)', r.seq, r.tbl, m, lv; END IF;
  END LOOP;
  RAISE NOTICE 'checked % sequences, % behind', n, bad;
  IF bad > 0 THEN RAISE EXCEPTION 'sequences behind data'; END IF;
END $$;
SQL
ppit=$(ls -1t /opt/dr/dumps/pg_pit/dynopay-*.dump 2>/dev/null | head -1)
if [ -n "$ppit" ]; then
  out=$("$B/restore_pg.sh" "postgresql://dr_selftest:$PW@127.0.0.1:5432/dr_selftest_pit" --dump "$ppit" 2>&1)
  grep -q "RESTORE OK" <<<"$out" && pass "postgres point-in-time restore ($(basename "$ppit"))" || { fail "postgres PIT restore"; tail -5 <<<"$out"; }
else fail "no postgres PIT dump found"; fi
g=$("$B/restore_pg.sh" "$PURL" 2>&1); grep -q "^ABORT" <<<"$g" && pass "postgres refuses non-empty target without --force" || fail "postgres non-empty-target guard"

echo "=== Redis → fresh redis-server :6390 (requirepass, like Railway) ==="
redis-server --port 6390 --bind 127.0.0.1 --requirepass "$PW" --dir "$T/redis" --save "" --appendonly no --daemonize yes --logfile "$T/redis.log"
sleep 1; RURL="redis://default:$PW@127.0.0.1:6390"
out=$("$B/restore_redis.py" "$RURL" 2>&1); echo "$out" | grep -E "^  db" | sed 's/^/   /'
grep -q "RESTORE OK" <<<"$out" && pass "redis live restore" || { fail "redis live restore"; tail -5 <<<"$out"; }
ttl_src=$(redis-cli -p 6379 INFO keyspace | grep -oE "db0:keys=[0-9]+,expires=[0-9]+" | cut -d, -f2)
ttl_dst=$(redis-cli -p 6390 -a "$PW" --no-auth-warning INFO keyspace | grep -oE "db0:keys=[0-9]+,expires=[0-9]+" | cut -d, -f2)
echo "   TTL keys db0: source ${ttl_src} target ${ttl_dst}"
[ -n "$ttl_dst" ] && [ "${ttl_dst#expires=}" -gt 0 ] && pass "redis TTLs preserved" || fail "redis TTLs missing"
g=$("$B/restore_redis.py" "$RURL" 2>&1); grep -q "^ABORT" <<<"$g" && pass "redis refuses non-empty target without --force" || fail "redis non-empty-target guard"
rpit=$(ls -1t /opt/dr/dumps/redis/dump-*.rdb.gz 2>/dev/null | head -1)
redis-cli -p 6390 -a "$PW" --no-auth-warning FLUSHALL >/dev/null
out=$("$B/restore_redis.py" "$RURL" --from-rdb "$rpit" 2>&1)
grep -q "RESTORE OK" <<<"$out" && pass "redis point-in-time restore ($(basename "$rpit"))" || { fail "redis PIT restore"; tail -5 <<<"$out"; }

echo; [ $rc -eq 0 ] && echo "RESTORE DRILL: ALL PASSED ✅" || echo "RESTORE DRILL: FAILURES ❌"
exit $rc
