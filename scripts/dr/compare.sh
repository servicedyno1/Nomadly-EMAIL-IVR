#!/bin/bash
# Compare per-collection document counts SOURCE vs local mirror. Usage: compare.sh <name>
set -uo pipefail
NAME="$1"
LINE=$(grep "^${NAME}|" /opt/dr/conf/mongo_sources.conf); URI=$(cut -d'|' -f2 <<<"$LINE"); DB=$(cut -d'|' -f3 <<<"$LINE")
export S="${URI%/}/?authSource=admin&directConnection=true" DB
mongosh --nodb --quiet --eval '
const s = new Mongo(process.env.S).getDB(process.env.DB), l = new Mongo("mongodb://127.0.0.1:27017").getDB(process.env.DB);
const sc = s.getCollectionInfos({type: "collection"}).map(c => c.name).filter(n => !n.startsWith("system.")).sort();
const lc = new Set(l.getCollectionNames());
let diff = 0, docs = 0;
for (const c of sc) {
  const a = s.getCollection(c).countDocuments({}), b = lc.has(c) ? l.getCollection(c).countDocuments({}) : -1; docs += a;
  if (a !== b) { diff++; print("  DIFF " + c + " src=" + a + " dr=" + b); }
}
print(process.env.DB + ": " + sc.length + " collections, " + docs + " docs, mismatched=" + diff);
'
