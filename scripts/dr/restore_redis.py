#!/opt/dr/venv/bin/python
# Restore the Dynopay Redis from the DR live replica (default) or a point-in-time RDB snapshot into ANY Redis
# (e.g. a brand-new Railway Redis). Copies every key in every db with DUMP/RESTORE, keeping TTLs. Run ON the DR droplet.
#
# Usage: restore_redis.py '<dest-url>' [--from-rdb <dump-*.rdb.gz>] [--force]
#   <dest-url>  e.g. redis://default:PASS@xyz.proxy.rlwy.net:12345   (Railway "REDIS_PUBLIC_URL")
#   --from-rdb  restore a point-in-time snapshot from /opt/dr/dumps/redis/ instead of the live replica
#   --force     allow a target that already has keys (same-name keys are replaced, others kept)
import argparse, gzip, os, shutil, subprocess, sys, tempfile, time
from urllib.parse import urlsplit, urlunsplit
import redis

ap = argparse.ArgumentParser()
ap.add_argument("dest"); ap.add_argument("--from-rdb"); ap.add_argument("--force", action="store_true")
args = ap.parse_args()
# The script copies db N → db N itself, so any "/<db>" path in the URL must not override it (redis-py lets it win).
u = urlsplit(args.dest)
if u.path.strip("/"):
    print(f"note: ignoring '/{u.path.strip('/')}' in the target URL — every source db is restored into the same db number")
DEST = urlunsplit(u._replace(path=""))


def keyspace(r):
    return {int(k[2:]): v["keys"] for k, v in r.info("keyspace").items()}


def start_rdb_server(path):
    tmp = tempfile.mkdtemp(prefix="dr_rdb_", dir="/opt/dr/restore_tmp")
    with gzip.open(path) if path.endswith(".gz") else open(path, "rb") as f, open(f"{tmp}/dump.rdb", "wb") as o:
        shutil.copyfileobj(f, o)
    subprocess.run(["redis-server", "--port", "6391", "--bind", "127.0.0.1", "--dir", tmp, "--dbfilename", "dump.rdb",
                    "--save", "", "--appendonly", "no", "--daemonize", "yes", "--logfile", f"{tmp}/redis.log"], check=True)
    r = redis.Redis(port=6391)
    for _ in range(120):
        try:
            if r.info("persistence").get("loading") == 0:
                return tmp, r
        except redis.ConnectionError:
            pass
        time.sleep(0.5)
    sys.exit("temporary redis for the RDB did not start — see " + tmp + "/redis.log")


os.makedirs("/opt/dr/restore_tmp", exist_ok=True)
tmpdir = None
if args.from_rdb:
    print(f"[1/4] loading point-in-time snapshot {args.from_rdb} into a temporary redis :6391")
    tmpdir, src0 = start_rdb_server(args.from_rdb)
    src_port = 6391
else:
    print("[1/4] source = live DR replica 127.0.0.1:6379")
    src0, src_port = redis.Redis(port=6379), 6379

try:
    dest0 = redis.Redis.from_url(DEST, socket_timeout=60)
    try:
        dest0.ping()
    except redis.RedisError as e:
        sys.exit(f"ABORT: cannot connect/authenticate to the target ({type(e).__name__}: {e}) — check host/port/password")
    print(f"[2/4] target reachable — redis {dest0.info('server')['redis_version']}")
    tks = keyspace(dest0)
    if sum(tks.values()) and not args.force:
        sys.exit(f"ABORT: target already has keys {tks}. Re-run with --force.")
    sks = keyspace(src0)
    print(f"[3/4] copying {sum(sks.values())} keys from dbs {sorted(sks)}")
    copied = {}
    for db in sorted(sks):
        s = redis.Redis(port=src_port, db=db)
        d = redis.Redis.from_url(DEST, db=db, socket_timeout=60)
        n, cur = 0, 0
        while True:
            cur, keys = s.scan(cur, count=1000)
            if keys:
                p = s.pipeline(transaction=False)
                for k in keys:
                    p.dump(k); p.pttl(k)
                res = p.execute()
                w = d.pipeline(transaction=False)
                for i, k in enumerate(keys):
                    payload, ttl = res[2 * i], res[2 * i + 1]
                    if payload is None or ttl == -2:
                        continue  # expired between SCAN and DUMP
                    w.restore(k, max(ttl, 0), payload, replace=True)
                    n += 1
                w.execute()
            if cur == 0:
                break
        copied[db] = n
        print(f"  db{db}: {n} keys")
    print("[4/4] verifying…")
    bad = 0
    for db, n in copied.items():
        d = redis.Redis.from_url(DEST, db=db)
        size = d.dbsize()
        s = redis.Redis(port=src_port, db=db)
        sample = [s.randomkey() for _ in range(50)]
        type_mismatch = sum(1 for k in sample if k and s.type(k) != d.type(k))
        ok = size >= n * 0.99 and type_mismatch == 0
        bad += 0 if ok else 1
        print(f"  db{db}: source={s.dbsize()} copied={n} target={size} sample-type-mismatch={type_mismatch} {'OK' if ok else 'MISMATCH'}")
    if bad:
        sys.exit("VERIFY FAILED")
    print("RESTORE OK. Point the app at it with REDIS_URL=<dest-url>.")
finally:
    if tmpdir:
        try:
            redis.Redis(port=6391).shutdown(nosave=True)
        except Exception:
            pass
        shutil.rmtree(tmpdir, ignore_errors=True)
