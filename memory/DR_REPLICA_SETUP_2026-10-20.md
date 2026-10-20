# DR Replica (DigitalOcean) — realtime/near-realtime backup of Railway DBs — 2026-10-20

Disaster-recovery mirror of the Railway-hosted production databases onto a single
self-managed DigitalOcean droplet in `ams3`. Railway stays the PRIMARY; this is backup only.

## Droplet
- `dr-replica-ams3` — DO id `610871808`, IP **146.190.229.132**, region ams3, size s-2vcpu-4gb ($24/mo), Ubuntu 24.04.
- DO account: moxxcompany@gmail.com (token in vault `DIGITALOCEAN_API_TOKEN`, DO ssh key id 60238823).
- SSH: `ssh -i /root/.ssh/dr_replica root@146.190.229.132` (146.190.238.190 is the PROD app droplet, not DR) (key also in vault: `DR_REPLICA_SSH_KEY_B64`, restore with `base64 -d`).
- Firewall: ufw, inbound SSH only. All DB engines bind to 127.0.0.1. Replication/backups are OUTBOUND to Railway.
- Engines: MongoDB 8.0, PostgreSQL 18 (matches source 18.6), Redis 8.10.2 server+tools (packages.redis.io, matches source).

## What is backed up (sources all on Railway)
| Source | Engine | Method | RPO | Target on droplet |
|---|---|---|---|---|
| Nomadly `test` (~760MB), voodoo, proshop, smadav | MongoDB (single-node replica set `rs0`) | change-stream tailer per DB (systemd `dr-mongo-tail@<name>`) | realtime (lag ~0.1–1s) | local mongod dbs: test/voodoo/proshop/smadav |
| same 4 DBs | MongoDB | hourly local mongodump of the MIRROR (zero Railway egress), keep 24/DB | 1h point-in-time | /opt/dr/dumps/mongo_pit/<name>-<ts>.archive.gz |
| Dynopay `railway` (142MB, 109 tbls) | PostgreSQL 18 | logical replication SUBSCRIPTION (streaming) | realtime (~secs) | db `dynopay_dr`, subscription `dr_sub` |
| Dynopay Redis (8.10.2, ~7k keys db0+db1) | Redis | local **redis-server 8.10.2 REPLICAOF** Railway (native replication stream) | realtime (~10–15 ms) | local redis :6379 (read-only replica) |
| same Redis | Redis | 10-min RDB snapshot taken from the LOCAL replica (zero egress), keep 144 | 10 min PIT | /opt/dr/dumps/redis/dump-*.rdb.gz |
| Dynopay `railway` | PostgreSQL | hourly `pg_dump -Fc` of local `dynopay_dr` (zero egress), keep 24 | 1h PIT | /opt/dr/dumps/pg_pit/dynopay-<ts>.dump |

## MongoDB realtime (2026-10-20, replaces the 2-min snapshot cron)
All 4 Railway Mongos were converted STANDALONE → single-node replica set so change streams work:
| name | Railway project / service | proxy | db | prod app |
|---|---|---|---|---|
| nomadly | Nomadly Database `753bf146…` / MongoDB `5b402f63…` (env `b7dd408f…`) | roundhouse:52715 | test | app-main |
| voodoo | Vland `7639437f…` / VLAND `c9a9dd08…` (env `f8b7f19a…`) | zephyr:53512 | voodoo | app-voodoo |
| smadav | SMADAV `6be6b30d…` / MongoDB `1f913453…` (env `9eeb1dcb…`) | sakura:51284 | smadav | app-wl |
| proshop | PROSHOP `d8d02c21…` / ProShop `4729c43e…` (env `70f8f501…`) | iriguchi:51413 | proshop | app-proshop |
Railway token for these projects (account database@dyno.pt): vault key `RAILWAY_DB_ACCOUNT_TOKEN` (use as `RTOK` for scripts/dr/rw.py + railway_convert.py).
- Conversion = Railway var `MONGO_KEYFILE_B64` + startCommand `bash -c '…write /data/db/rs.key… exec docker-entrypoint.sh mongod --replSet rs0 --keyFile … --ipv6 --bind_ip ::,0.0.0.0 …'`
  + redeploy (`scripts/dr/railway_convert.py`) → `rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})` (`/opt/dr/bin/rs_init.sh <name>` polls & initiates). Downtime ≈30s per DB.
- ⚠️ RS member host is `localhost:27017` → EVERY client MUST use `?directConnection=true` (else the driver discovers
  "localhost" and fails). Done in: prod `/opt/nomadly/shared/{app-main,app-wl,app-voodoo,app-proshop}/backend.env` (backups `*.bak.pre-rs.<ts>`),
  preview `/app/backend/.env` RESELLER_DB_URL + vault re-locked. Verified on source via $currentOp: no other clients.
  directConnection=true also works against a standalone, so it is harmless if a DB is ever reverted.
- To REVERT a DB to standalone: set startCommand back to `docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false` + redeploy, then `systemctl disable --now dr-mongo-tail@<name>` (snapshot cron would need re-enabling).
- Tailer `/opt/dr/bin/mongo_tail.py <name>` (venv /opt/dr/venv, pymongo 4.19): db-level change stream (fullDocument=updateLookup,
  showExpandedEvents) → applies insert/update/replace/delete/drop/rename/create/createIndexes/dropIndexes/dropDatabase to local mongod.
  Resume token saved every 1s to `/opt/dr/state/cs_<name>.token`; heartbeat `/opt/dr/state/cs_<name>.heartbeat` (lag, last event).
  First start / history-lost / invalidate → automatic full sync (token captured BEFORE dump, then replay — idempotent). Logs `/opt/dr/logs/tail_<name>.log`.
  Ops: `systemctl status|restart dr-mongo-tail@nomadly`; force a full resync = stop, `rm /opt/dr/state/cs_<name>.token`, start.
- Verify: `/opt/dr/bin/probe.sh <name>` (live insert/update/replace/index/delete/drop on source coll `dr_probe_tmp`, ~0.1s each) and
  `/opt/dr/bin/compare.sh <name>` (per-collection counts). 2026-10-20: all 4 PROBE OK, counts identical (test 153 colls/190,395 docs).
- Egress now ≈ changed docs only (~1 event/s on nomadly) instead of ~9 TB/month of 2-min dumps.
- Old `mongo_snapshot.sh` cron is commented out (it also auto-skips any DB whose tailer is enabled).

## Layout on droplet (/opt/dr)
- `bin/mongo_tail.py` + systemd `dr-mongo-tail@{nomadly,voodoo,smadav,proshop}` — live Mongo mirror (change streams)
- `bin/mongo_local_archive.sh` — hourly PIT dump of the local mirror (cron 17 * * * *)
- `bin/mongo_snapshot.sh`   — OLD 2-min dump mirror (cron disabled; skips DBs that have a tailer)
- `/etc/redis/dr-replica.conf` — live Redis replica of Railway (systemd `redis-server`)
- `bin/redis_snapshot.sh`   — Redis RDB snapshot from the LOCAL replica (cron */10)
- `bin/pg_local_archive.sh` — hourly PIT pg_dump of dynopay_dr (cron 27 * * * *)
- `bin/restore_mongo.sh`, `bin/restore_pg.sh`, `bin/restore_redis.py`, `bin/restore_selftest.sh` — restores + drill (see DR_RESTORE_RUNBOOK.md)
- `bin/probe.sh`, `bin/compare.sh`, `bin/redis_probe.sh` — live replication checks
- `bin/monitor_dr.sh`       — health check (cron */5) → /opt/dr/state/health.txt ; `dr-status` prints it
- `bin/pg_setup_subscriber.sh` — (re)creates the PG subscription
- `conf/mongo_sources.conf` — `name|mongo_uri|db` (chmod 600) — authSource=admin auto-appended
- `conf/redis_source.conf`  — `host|port|password`
- `conf/pg_source.conf`     — source PG URL
- `conf/alert.conf`         — OPTIONAL `BOT_TOKEN|CHAT_ID` → monitor Telegram-alerts on problems
- `dumps/`, `logs/`, `state/`

## Redis realtime (2026-10-20)
- `redis-server` 8.10.2 from packages.redis.io (MUST be ≥ source version — older Redis cannot load a newer RDB on full sync).
- `/etc/redis/redis.conf` ends with `include /etc/redis/dr-replica.conf` (root:redis 640): `replicaof <host> <port>`,
  `masteruser default`, `masterauth "<pw>"`, `replica-read-only yes`. Bound to 127.0.0.1 only. Source conf `/opt/dr/conf/redis_source.conf`.
- Railway Redis config is untouched (repl-backlog 1 MB → after a link drop the replica does a full resync, ~20 MB).
- Egress: replication stream ≈ 115 KB/s (≈ 300 GB/month) — the Redis is very write-heavy (~2k ops/s).
- Verify: `/opt/dr/bin/redis_probe.sh` (SET/overwrite/HSET/DEL on throwaway `dr:probe:*` keys, ~10–15 ms) and
  `redis-cli INFO replication` → `master_link_status:up`. Monitor alerts if link down or no data > 60 s.

## Postgres replication details
- SOURCE: `wal_level=logical` (set via ALTER SYSTEM + 1 restart, done 2026-10-20), publication `dr_pub` FOR ALL TABLES.
- SUBSCRIBER: `dynopay_dr` / subscription `dr_sub` (slot `dr_sub` on source). All 109 tables PK'd → UPDATE/DELETE replicate.
- Schema is NOT auto-replicated — DDL on source must be re-applied to `dynopay_dr` then `ALTER SUBSCRIPTION dr_sub REFRESH PUBLICATION`.
- ⚠️ If the DR droplet is DOWN for long, the source WAL slot `dr_sub` retains WAL and can fill the SOURCE disk.
  monitor_dr.sh warns if retained WAL > 2GB. To abandon: on source `select pg_drop_replication_slot('dr_sub');`.

## Verify / restore
**Full restore procedures → `memory/DR_RESTORE_RUNBOOK.md`** (one-command restore of every DB into a new Railway DB + drill).
- `dr-status` (on droplet) → health snapshot.
- Mongo restore: the local mongod holds the live mirror → `mongodump --uri=mongodb://127.0.0.1 --db=test --gzip --archive=x.gz` then `mongorestore --gzip --archive=x.gz <dest-uri>`. Point-in-time (bad write replicated): use `/opt/dr/dumps/mongo_pit/<name>-<ts>.archive.gz` (last 24h hourly).
- PG restore: `pg_dump` from `dynopay_dr` (it is a full live copy) → restore anywhere.
- Realtime PG proven 2026-10-20: insert on source visible on target in <4s.

## Cost / egress
RESOLVED 2026-10-20: the 2-min full dumps (~9 TB/month egress) were replaced by change streams (deltas only).

## Pending / optional enhancements
- Off-site archive to DO Spaces (hourly compressed dumps) — not yet set up.
- Telegram alerting — drop `BOT_TOKEN|CHAT_ID` into /opt/dr/conf/alert.conf.
- DO weekly droplet backups (enable in DO panel) for bare-metal recovery.
