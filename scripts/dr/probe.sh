#!/bin/bash
# Live replication probe: insert/update/replace/index/delete/drop on SOURCE coll dr_probe_tmp,
# verify each on the local mirror and report latency. Usage: probe.sh <name>
set -uo pipefail
NAME="$1"
LINE=$(grep "^${NAME}|" /opt/dr/conf/mongo_sources.conf); URI=$(cut -d'|' -f2 <<<"$LINE"); DB=$(cut -d'|' -f3 <<<"$LINE")
export S="${URI%/}/?authSource=admin&directConnection=true" DB
mongosh --nodb --quiet --eval '
const s = new Mongo(process.env.S).getDB(process.env.DB).getCollection("dr_probe_tmp");
const l = new Mongo("mongodb://127.0.0.1:27017/?directConnection=true").getDB(process.env.DB).getCollection("dr_probe_tmp");
let fails = 0;
function check(label, op, ok) {
  op(); const t0 = Date.now();
  while (Date.now() - t0 < 30000) { if (ok()) { print("PASS " + label.padEnd(26) + ((Date.now() - t0) / 1000).toFixed(2) + "s"); return; } sleep(50); }
  print("FAIL " + label); fails++;
}
check("insert", () => s.insertOne({_id: "p1", v: 1, nested: {a: 1}, arr: [1, 2, 3]}), () => (l.findOne({_id: "p1"}) || {}).v === 1);
check("update $set/$unset/$pop", () => s.updateOne({_id: "p1"}, {$set: {v: 2, "nested.b": 2}, $unset: {"nested.a": ""}, $pop: {arr: 1}}),
  () => { const d = l.findOne({_id: "p1"}); return !!d && d.v === 2 && d.nested.b === 2 && d.nested.a === undefined && d.arr.length === 2; });
check("replace", () => s.replaceOne({_id: "p1"}, {w: 9}), () => { const d = l.findOne({_id: "p1"}); return !!d && d.w === 9 && d.v === undefined; });
check("createIndex", () => s.createIndex({w: 1}, {name: "w_probe"}), () => { try { return l.getIndexes().some(i => i.name === "w_probe"); } catch (e) { return false; } });
check("delete", () => s.deleteOne({_id: "p1"}), () => l.countDocuments({_id: "p1"}) === 0);
check("drop collection", () => s.drop(), () => !l.getDB().getCollectionNames().includes("dr_probe_tmp"));
print(fails ? "PROBE FAILED (" + fails + ")" : "PROBE OK");
quit(fails ? 1 : 0);
'
