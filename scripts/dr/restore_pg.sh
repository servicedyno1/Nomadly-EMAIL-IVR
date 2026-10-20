#!/bin/bash
# Restore the Dynopay Postgres from the DR replica (default) or a point-in-time dump into ANY Postgres
# (e.g. a brand-new Railway Postgres). Run ON the DR droplet.
#
# Usage: restore_pg.sh '<dest-url>' [--dump <file.dump>] [--force]
#   <dest-url> e.g. postgresql://postgres:PASS@xyz.proxy.rlwy.net:12345/railway   (Railway "DATABASE_PUBLIC_URL")
#   --dump     restore a point-in-time file from /opt/dr/dumps/pg_pit/ instead of the live replica
#   --force    allow a target that already has tables (objects are dropped first with --clean)
# Always re-syncs every sequence/identity to MAX(column) on the target — logical replication never copies
# sequence values, so without this the first INSERT on the restored DB would hit duplicate-key errors.
set -euo pipefail
[ $# -ge 1 ] || { sed -n '2,10p' "$0"; exit 2; }
DEST="$1"; shift
DUMP=""; FORCE=0
while [ $# -gt 0 ]; do case "$1" in --dump) DUMP="$2"; shift 2;; --force) FORCE=1; shift;; *) echo "unknown arg: $1"; exit 2;; esac; done
DRDB=dynopay_dr
q(){ psql "$DEST" -v ON_ERROR_STOP=1 -tAc "$1"; }

echo "[1/5] checking target…"
existing=$(q "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')")
if [ "$existing" != "0" ] && [ $FORCE -ne 1 ]; then
  echo "ABORT: target already has $existing tables. Re-run with --force to replace them."; exit 1; fi

mkdir -p /opt/dr/restore_tmp; chown postgres /opt/dr/restore_tmp
if [ -z "$DUMP" ]; then
  DUMP="/opt/dr/restore_tmp/dynopay-$(date -u +%Y%m%dT%H%M%SZ).dump"; CLEAN=1
  trap 'rm -f "$DUMP"' EXIT
  echo "[2/5] dumping live DR replica ($DRDB) → $DUMP"
  sudo -u postgres pg_dump -Fc --no-owner --no-acl --no-subscriptions --no-publications -d "$DRDB" -f "$DUMP"
else CLEAN=0; echo "[2/5] using point-in-time dump $DUMP"; fi

echo "[3/5] restoring…"
opts=(--no-owner --no-acl --no-subscriptions --no-publications)
[ $FORCE -eq 1 ] && opts+=(--clean --if-exists)
errlog=$(mktemp)
if ! pg_restore "${opts[@]}" -d "$DEST" "$DUMP" 2>"$errlog"; then
  # pg_restore exits 1 on ANY warning; only fail on errors other than harmless "already exists" ones.
  real=$(grep -E "ERROR:" "$errlog" | grep -cvE "already exists" || true)
  if [ "${real:-0}" -gt 0 ]; then tail -20 "$errlog"; echo "RESTORE FAILED ($real errors)"; exit 1; fi
fi
rm -f "$errlog"

echo "[4/5] re-syncing sequences to MAX(column)…"
psql "$DEST" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$
DECLARE r record; m bigint; best bigint;
BEGIN
  FOR r IN
    WITH pairs AS (
      SELECT d.objid AS seq, d.refobjid AS tbl, a.attname AS col          -- serial (owned) + identity columns
        FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
       WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a','i')
         AND (SELECT relkind FROM pg_class WHERE oid = d.objid) = 'S'
      UNION
      SELECT dd.refobjid, ad.adrelid, a.attname                           -- DEFAULT nextval('seq') (unowned)
        FROM pg_attrdef ad JOIN pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
        JOIN pg_depend dd ON dd.classid = 'pg_attrdef'::regclass AND dd.objid = ad.oid
                         AND dd.refclassid = 'pg_class'::regclass
       WHERE (SELECT relkind FROM pg_class WHERE oid = dd.refobjid) = 'S')
    SELECT seq::regclass AS seq, array_agg(format('SELECT max(%I)::bigint FROM %s', col, tbl::regclass)) AS qs
      FROM pairs GROUP BY seq
  LOOP
    best := NULL;
    FOR i IN 1..array_length(r.qs, 1) LOOP
      BEGIN EXECUTE r.qs[i] INTO m; EXCEPTION WHEN others THEN m := NULL; END;  -- non-integer column → skip
      IF m IS NOT NULL AND (best IS NULL OR m > best) THEN best := m; END IF;
    END LOOP;
    IF best IS NULL THEN PERFORM setval(r.seq, 1, false); ELSE PERFORM setval(r.seq, best, true); END IF;
  END LOOP;
END $$;
SQL
echo "  sequences fixed: $(q "select count(*) from pg_sequences")"

echo "[5/5] verifying row counts against the dump…"
# exact per-table row counts straight from the dump's COPY blocks (works for live AND point-in-time dumps)
expect=$(pg_restore --data-only -f - "$DUMP" | awk '/^COPY /{t=$2; n=0; inb=1; next} inb && /^\\\.$/{print t, n; inb=0; next} inb{n++}')
[ -n "$expect" ] || { echo "VERIFY FAILED: could not read row counts from the dump"; exit 3; }
bad=0; n=0; rows=0
while read -r t want; do
  got=$(q "select count(*) from $t"); n=$((n+1)); rows=$((rows+got))
  [ "$got" = "$want" ] || { bad=$((bad+1)); echo "  MISMATCH $t dump=$want target=$got"; }
done <<<"$expect"
echo "  $n tables, $rows rows, mismatches=$bad"
[ $bad -eq 0 ] || { echo "VERIFY FAILED"; exit 3; }
echo "RESTORE OK. Point the app at it with DATABASE_URL=<dest-url>."
