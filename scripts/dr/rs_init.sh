#!/bin/bash
# Wait for a just-redeployed Railway mongod (started with --replSet rs0) and initiate the
# single-node replica set as soon as it answers. Usage: rs_init.sh <name> [timeout_s]
set -uo pipefail
NAME="$1"; TIMEOUT="${2:-900}"
URI=$(grep "^${NAME}|" /opt/dr/conf/mongo_sources.conf | cut -d'|' -f2)
U="${URI%/}/?authSource=admin&directConnection=true&serverSelectionTimeoutMS=3000&connectTimeoutMS=3000"
end=$((SECONDS + TIMEOUT))
while [ $SECONDS -lt $end ]; do
  r=$(mongosh "$U" --quiet --eval '
    try { const s = db.adminCommand({replSetGetStatus: 1});
      if (s.ok) { print("STATE " + s.members[0].stateStr); }
      else if (s.code === 94) { const i = rs.initiate({_id: "rs0", members: [{_id: 0, host: "localhost:27017"}]}); print("INITIATED " + JSON.stringify(i.ok)); }
      else if (s.code === 76) { print("STANDALONE"); }
      else { print("OTHER " + s.code + " " + s.errmsg); }
    } catch (e) { if (e.code === 94) { const i = rs.initiate({_id: "rs0", members: [{_id: 0, host: "localhost:27017"}]}); print("INITIATED " + JSON.stringify(i.ok)); }
                  else if (e.code === 76) { print("STANDALONE"); } else { print("ERR " + e.code + " " + e.message); } }' 2>&1 | tail -1)
  echo "$(date -u +%T) $NAME: ${r:-no-answer}"
  case "$r" in "STATE PRIMARY") echo "$NAME: replica set PRIMARY ✅"; exit 0;; esac
  sleep 2
done
echo "$NAME: TIMEOUT waiting for PRIMARY"; exit 1
