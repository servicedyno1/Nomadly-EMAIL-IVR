#!/bin/bash
# Restore one MongoDB database from the DR mirror (default) or a point-in-time archive into ANY MongoDB
# (e.g. a brand-new Railway Mongo). Run ON the DR droplet.
#
# Usage: restore_mongo.sh <name> '<dest-uri>' [--archive <file.archive.gz>] [--to-db <db>] [--force]
#   <name>     nomadly | voodoo | smadav | proshop   (source db is read from /opt/dr/conf/mongo_sources.conf)
#   <dest-uri> e.g. mongodb://mongo:PASS@xyz.proxy.rlwy.net:12345   (Railway "MONGO_PUBLIC_URL")
#   --archive  restore a point-in-time file from /opt/dr/dumps/mongo_pit/ instead of the live mirror
#   --to-db    target db name (default: same as source, e.g. nomadly → test)
#   --force    allow restoring into a target db that already has data (its collections are dropped+replaced)
set -euo pipefail
[ $# -ge 2 ] || { sed -n '2,12p' "$0"; exit 2; }
NAME="$1"; DEST="$2"; shift 2
ARCHIVE=""; TODB=""; FORCE=0
while [ $# -gt 0 ]; do case "$1" in
  --archive) ARCHIVE="$2"; shift 2;; --to-db) TODB="$2"; shift 2;; --force) FORCE=1; shift;;
  *) echo "unknown arg: $1"; exit 2;; esac; done
DB=$(grep "^${NAME}|" /opt/dr/conf/mongo_sources.conf | cut -d'|' -f3 || true)
[ -n "$DB" ] || { echo "unknown name '$NAME' (see /opt/dr/conf/mongo_sources.conf)"; exit 2; }
TODB="${TODB:-$DB}"
LOCAL="mongodb://127.0.0.1:27017/?directConnection=true"

# Normalise target URI: Railway users live in admin; directConnection works for standalone AND single-node RS.
D="$DEST"
if [[ "$D" != mongodb+srv://* ]]; then
  rest="${D#mongodb://}"
  if [[ "$D" != *\?* ]]; then [[ "$rest" == */* ]] && D="${D}?" || D="${D}/?"; else D="${D}&"; fi
  [[ "$D" == *authSource=* ]] || D="${D}authSource=admin&"
  [[ "$D" == *directConnection=* ]] || D="${D}directConnection=true&"
  D="${D%&}"; D="${D%\?}"
fi
export D TODB DB

echo "[1/4] checking target…"
existing=$(mongosh "$D" --quiet --eval 'const d=db.getSiblingDB(process.env.TODB); print(d.getCollectionNames().filter(c=>!c.startsWith("system.")).length)')
if [ "$existing" != "0" ] && [ $FORCE -ne 1 ]; then
  echo "ABORT: target db '$TODB' already has $existing collections. Re-run with --force to overwrite them."; exit 1; fi

mkdir -p /opt/dr/restore_tmp
if [ -z "$ARCHIVE" ]; then
  ARCHIVE="/opt/dr/restore_tmp/${NAME}-$(date -u +%Y%m%dT%H%M%SZ).archive.gz"; CLEAN=1
  trap 'rm -f "$ARCHIVE"' EXIT
  echo "[2/4] dumping live DR mirror ($DB) → $ARCHIVE"
  mongodump --uri="$LOCAL" --db="$DB" --gzip --archive="$ARCHIVE" --quiet
else CLEAN=0; echo "[2/4] using point-in-time archive $ARCHIVE"; fi

echo "[3/4] restoring into target db '$TODB'…"
out=$(mongorestore --uri="$D" --gzip --archive="$ARCHIVE" --nsInclude="${DB}.*" --nsFrom="${DB}.*" --nsTo="${TODB}.*" \
      --drop --numInsertionWorkersPerCollection=4 2>&1) || { echo "$out" | tail -20; echo "RESTORE FAILED"; exit 1; }
summary=$(grep -E "document\(s\) restored successfully" <<<"$out" | tail -1); echo "  $summary"

echo "[4/4] verifying target counts against the archive…"
if [[ "$summary" != *" 0 document(s) failed"* ]]; then echo "VERIFY FAILED: some documents failed to restore"; exit 1; fi
export EXPECT=$(tr -d '`' <<<"$out" | grep -oE "finished restoring [^. ]+\.[^ ]+ \([0-9]+ documents?, [0-9]+ failures?\)" \
  | sed -E "s/finished restoring [^. ]+\.([^ ]+) \(([0-9]+) documents?.*/\1=\2/" | tr '\n' ' ')
[ -n "${EXPECT// /}" ] || { echo "VERIFY FAILED: could not read per-collection counts from mongorestore output"; exit 3; }
mongosh "$D" --quiet --eval '
  const t = db.getSiblingDB(process.env.TODB); let bad = 0, n = 0, docs = 0;
  for (const kv of process.env.EXPECT.trim().split(/\s+/).filter(Boolean)) {
    const i = kv.lastIndexOf("="), c = kv.slice(0, i), want = +kv.slice(i + 1), got = t.getCollection(c).countDocuments({});
    n++; docs += got; if (got !== want) { bad++; print("  MISMATCH " + c + " archive=" + want + " target=" + got); }
  }
  print("  " + n + " collections, " + docs + " docs, mismatches=" + bad); quit(bad ? 3 : 0);' || { echo "VERIFY FAILED"; exit 3; }
echo "RESTORE OK → db '$TODB'. Point the app at it with: MONGO_URL=<dest-uri> (keep ?directConnection=true if you convert it to a replica set)."
