#!/opt/dr/venv/bin/python
# DR change-stream tailer: mirrors one Railway Mongo DB (replica set) into the local mongod.
# Usage: mongo_tail.py <name>   (name from /opt/dr/conf/mongo_sources.conf: name|uri|db)
import json, os, subprocess, sys, time
from datetime import datetime, timezone
from bson import json_util
from pymongo import MongoClient
from pymongo.errors import OperationFailure, PyMongoError

NAME = sys.argv[1]
CONF = "/opt/dr/conf/mongo_sources.conf"
STATE = "/opt/dr/state"
TOKEN_F = f"{STATE}/cs_{NAME}.token"
HB_F = f"{STATE}/cs_{NAME}.heartbeat"
ARCHIVE = f"/opt/dr/dumps/mongo/{NAME}.archive.gz"
LOCAL_URI = "mongodb://127.0.0.1:27017/?directConnection=true"
HISTORY_LOST = {136, 260, 280, 286}  # CappedPositionLost, InvalidResumeToken, ChangeStreamFatalError, ChangeStreamHistoryLost


def log(msg):
    print(f"{datetime.now(timezone.utc).isoformat(timespec='seconds')} [{NAME}] {msg}", flush=True)


def load_source():
    for line in open(CONF):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        n, uri, db = line.split("|")
        if n == NAME:
            base = uri.split("?")[0].rstrip("/")
            return f"{base}/?authSource=admin&directConnection=true&appName=dr-tailer-{NAME}", db
    sys.exit(f"{NAME} not found in {CONF}")


SRC_URI, DB = load_source()


def write_atomic(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write(text)
    os.replace(tmp, path)


def save_token(tok):
    write_atomic(TOKEN_F, json_util.dumps(tok))


def load_token():
    try:
        return json_util.loads(open(TOKEN_F).read())
    except FileNotFoundError:
        return None


def watch(src, **kw):
    return src[DB].watch(full_document="updateLookup", show_expanded_events=True, max_await_time_ms=1000, **kw)


def full_sync(src, local):
    # Capture a resume point BEFORE copying, so every change after it is replayed (all ops are idempotent).
    with watch(src) as cs:
        cs.try_next()
        tok = cs.resume_token
    log("full sync: mongodump → mongorestore --drop")
    subprocess.run(["mongodump", f"--uri={SRC_URI}", f"--db={DB}", "--gzip", f"--archive={ARCHIVE}", "--quiet"], check=True)
    subprocess.run(["mongorestore", f"--uri={LOCAL_URI}", "--gzip", f"--archive={ARCHIVE}", "--drop",
                    f"--nsInclude={DB}.*", "--quiet"], check=True)
    src_colls = set(src[DB].list_collection_names())
    for c in set(local[DB].list_collection_names()) - src_colls:
        local[DB].drop_collection(c)
        log(f"full sync: dropped stale local collection {c}")
    save_token(tok)
    log(f"full sync done ({len(src_colls)} collections)")
    return tok


def apply(ldb, ev):
    op = ev["operationType"]
    coll = (ev.get("ns") or {}).get("coll")
    od = ev.get("operationDescription") or {}
    if op in ("insert", "replace") or (op == "update" and ev.get("fullDocument") is not None):
        ldb[coll].replace_one(ev["documentKey"], ev["fullDocument"], upsert=True)
    elif op == "update":
        pass  # doc deleted after this update; the delete event follows
    elif op == "delete":
        ldb[coll].delete_one(ev["documentKey"])
    elif op == "drop":
        ldb.drop_collection(coll)
    elif op == "rename":
        to = ev["to"]
        if to["db"] == DB:
            ldb.client.admin.command("renameCollection", f"{DB}.{coll}", to=f"{DB}.{to['coll']}", dropTarget=True)
        else:
            ldb.drop_collection(coll)
    elif op == "dropDatabase":
        ldb.client.drop_database(DB)
    elif op == "create":
        if coll not in ldb.list_collection_names():
            if od.get("viewOn"):
                ldb.command("create", coll, viewOn=od["viewOn"], pipeline=od.get("pipeline", []))
            else:
                ldb.create_collection(coll)
    elif op == "createIndexes":
        for idx in od.get("indexes", []):
            try:
                ldb.command("createIndexes", coll, indexes=[idx])
            except OperationFailure as e:
                log(f"createIndexes {coll}.{idx.get('name')} skipped: {e}")
    elif op == "dropIndexes":
        for idx in od.get("indexes", []):
            try:
                ldb[coll].drop_index(idx["name"])
            except OperationFailure:
                pass
    elif op == "invalidate":
        return "invalidate"
    else:
        log(f"ignored event {op} on {coll}")


def tail(src, local, tok):
    ldb = local[DB]
    applied, last_save, last_hb, last_ev_ts, lag = 0, 0.0, 0.0, None, None
    log("tailing change stream")
    with watch(src, resume_after=tok) as cs:
        while cs.alive:
            ev = cs.try_next()
            if ev is not None:
                if apply(ldb, ev) == "invalidate":
                    log("stream invalidated → full resync")
                    os.remove(TOKEN_F)
                    return
                applied += 1
                ct = ev.get("clusterTime")
                if ct:
                    last_ev_ts = ct.as_datetime()
                    lag = round(time.time() - ct.time, 1)
            now = time.time()
            if now - last_save >= 1 and cs.resume_token is not None:
                save_token(cs.resume_token)
                last_save = now
            if now - last_hb >= 5:
                write_atomic(HB_F, json.dumps({
                    "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "applied_since_start": applied,
                    "last_event": last_ev_ts.isoformat() if last_ev_ts else None,
                    "last_lag_s": lag,
                }))
                last_hb = now


def main():
    os.makedirs("/opt/dr/dumps/mongo", exist_ok=True)
    local = MongoClient(LOCAL_URI)
    while True:
        src = MongoClient(SRC_URI, serverSelectionTimeoutMS=15000)
        try:
            tok = load_token() or full_sync(src, local)
            tail(src, local, tok)
        except OperationFailure as e:
            if e.code in HISTORY_LOST:
                log(f"resume point lost ({e.code}) → full resync")
                if os.path.exists(TOKEN_F):
                    os.remove(TOKEN_F)
            else:
                log(f"operation failure: {e}")
                time.sleep(5)
        except (PyMongoError, subprocess.CalledProcessError) as e:
            log(f"error: {e!r} — retry in 5s")
            time.sleep(5)
        finally:
            src.close()


if __name__ == "__main__":
    main()
