# DR RESTORE RUNBOOK — restore Nomadly/Dynopay data into NEW databases (e.g. new Railway services)

Backups live on the DigitalOcean droplet **`dr-replica-ams3` — 146.190.229.132** (setup/architecture: `memory/DR_REPLICA_SETUP_2026-10-20.md`).
Every restore is ONE command run **on that droplet**. Each script refuses a non-empty target unless `--force`, verifies the
result, and prints `RESTORE OK` on success. Proven end-to-end by the drill `/opt/dr/bin/restore_selftest.sh` (see §6).

## 0. Get access (fresh pod)
```bash
VAULT_PASSWORD='<passphrase from memory/test_credentials.md>' bash /app/scripts/vault.sh unlock        # → /app/backend/.env
VAULT_PASSWORD='<same>' bash /app/scripts/restore_infra_keys.sh                                       # → /root/.ssh/{dr_replica,nomadly_droplet,...}
ssh -i /root/.ssh/dr_replica root@146.190.229.132
dr-status                      # health of every copy; must end with "STATUS: OK ✅" before you rely on the live copy
```
Long restores (nomadly ≈ 2–3 min) → run with `nohup … > /opt/dr/logs/restore.log 2>&1 &` and tail the log (tool calls time out at 120 s).

## 1. What can be restored
| Data | Live copy on droplet (≈ realtime) | Point-in-time files (for "bad write/delete was replicated") |
|---|---|---|
| Mongo `nomadly` (db `test`), `voodoo`, `smadav`, `proshop` | local mongod 127.0.0.1:27017 (change-stream tailers) | `/opt/dr/dumps/mongo_pit/<name>-<UTC>.archive.gz` hourly, last 24 |
| Postgres Dynopay (`railway` db) | local db `dynopay_dr` (logical replication) | `/opt/dr/dumps/pg_pit/dynopay-<UTC>.dump` hourly, last 24 |
| Redis Dynopay (db0 + db1) | local redis 127.0.0.1:6379 (read-only replica) | `/opt/dr/dumps/redis/dump-<UTC>.rdb.gz` every 10 min, last 144 |
| Pre-replica-set safety dumps of all 4 Mongos | — | `/opt/dr/safety_backups/pre-rs-20261020T142208Z/*.archive.gz` |

Pick the PIT file just BEFORE the incident (`ls -lt /opt/dr/dumps/...`). The live copy keeps the last known state if Railway dies.

## 2. Get the new database's connection string from Railway
In the Railway UI → new service → Variables: Mongo `MONGO_PUBLIC_URL`, Postgres `DATABASE_PUBLIC_URL`, Redis `REDIS_PUBLIC_URL`
(the public `*.proxy.rlwy.net:<port>` form — the droplet is outside Railway's private network).
Via API — run ON THE POD (not the droplet), token = vault `RAILWAY_DB_ACCOUNT_TOKEN` (account database@dyno.pt):
```bash
cd /app/scripts/dr && export RTOK=$(grep '^RAILWAY_DB_ACCOUNT_TOKEN=' /app/backend/.env | cut -d= -f2-)
python3 rw.py projects                                    # every project / service with projectId, serviceId, environmentId
python3 rw.py vars <projectId> <environmentId> <serviceId>  # that service's variables → copy the *_PUBLIC_URL value
```

## 3. MongoDB
```bash
/opt/dr/bin/restore_mongo.sh nomadly 'mongodb://mongo:PASS@HOST.proxy.rlwy.net:PORT'                 # live copy → db "test"
/opt/dr/bin/restore_mongo.sh voodoo  'mongodb://…' --archive /opt/dr/dumps/mongo_pit/voodoo-20261020T151701Z.archive.gz   # point-in-time
/opt/dr/bin/restore_mongo.sh smadav  'mongodb://…' --to-db smadav_restored                           # different target db name
```
- Names: `nomadly`→db `test` · `voodoo`→`voodoo` · `smadav`→`smadav` · `proshop`→`proshop` (from `/opt/dr/conf/mongo_sources.conf`).
- The script adds `authSource=admin` + `directConnection=true` to the URI automatically, copies all collections + indexes,
  then checks every collection's count on the target against the archive (`N collections, N docs, mismatches=0`). Temp archives are always removed.
- App switch: set `MONGO_URL=<new uri>/?directConnection=true` in `/opt/nomadly/shared/<app>/backend.env` on the PROD droplet
  (146.190.238.190; app-main=nomadly, app-voodoo=voodoo, app-wl=smadav, app-proshop=proshop), keep `DB_NAME` the same, then
  zero-downtime reload: `/opt/nomadly/deploy.sh <app> rollback $(readlink -f /opt/nomadly/current/<app>)` (re-activates the SAME
  release blue/green; it posts a harmless "rolled back" Telegram notice) → `curl -s 127.0.0.1:<port>/health` shows `"database":"connected"`.
  Also update `RESELLER_DB_URL` in `/app/backend/.env` (preview pod) if nomadly moved, then re-lock the vault (`vault.sh lock`).

## 4. Postgres (Dynopay)
```bash
/opt/dr/bin/restore_pg.sh 'postgresql://postgres:PASS@HOST.proxy.rlwy.net:PORT/railway'               # live copy
/opt/dr/bin/restore_pg.sh 'postgresql://…' --dump /opt/dr/dumps/pg_pit/dynopay-20261020T151530Z.dump   # point-in-time
```
- ⚠️ Logical replication never copies SEQUENCE values (`dynopay_dr` sequences are all at their start). The script ALWAYS
  re-syncs every serial/identity/`DEFAULT nextval()` sequence on the target to MAX(column) — never restore with a bare
  `pg_restore`, or the first INSERT will fail with duplicate keys. Drill proves `98 sequences, 0 behind`.
- Excludes the DR subscription/publication objects; verifies every table's row count on the target against the dump itself (live and PIT).
- App switch: set `DATABASE_URL` of the Dynopay app (it is NOT hosted on our droplets — wherever Dynopay runs).

## 5. Redis (Dynopay)
```bash
/opt/dr/venv/bin/python /opt/dr/bin/restore_redis.py 'redis://default:PASS@HOST.proxy.rlwy.net:PORT'                        # live replica
/opt/dr/venv/bin/python /opt/dr/bin/restore_redis.py 'redis://…' --from-rdb /opt/dr/dumps/redis/dump-2026-10-20T15:20:01Z.rdb.gz   # PIT
```
- Copies every key of every db (db0, db1) with DUMP/RESTORE and keeps TTLs; verifies key counts + type sample per db.
- Use the URL as Railway gives it (no `/<db>` needed — any `/0` path is ignored so db0→db0, db1→db1). Wrong password/host → clean `ABORT:` message.
- Target must be Redis ≥ 8.x (DUMP payloads from 8.10 cannot be loaded by older Redis). Railway's template is 8.x.
- `--from-rdb` boots a throwaway redis on :6391 from the snapshot, copies from it, then removes it.
- App switch: set `REDIS_URL` of the Dynopay app.

## 6. Restore drill (run after ANY change to the DR setup, and before trusting a restore)
```bash
nohup /opt/dr/bin/restore_selftest.sh > /opt/dr/logs/restore_selftest.log 2>&1 &   # ~4 min; then: cat /opt/dr/logs/restore_selftest.log
```
Spins up temporary password-protected targets (mongod :27100 with auth, Postgres role/db `dr_selftest*`, redis :6390 with
requirepass), restores every DB from the live copy AND from point-in-time files, checks counts, sequences, TTLs and the
non-empty-target guard, then deletes all temporary targets. Must end with `RESTORE DRILL: ALL PASSED ✅`. Nothing on Railway is touched.

## 7. After failing over: point the DR droplet at the NEW sources (otherwise it keeps mirroring the dead ones)
- **Mongo**: make the new Railway Mongo a replica set (`scripts/dr/railway_convert.py` with RTOK/PID/EID/SID/KB, then
  `/opt/dr/bin/rs_init.sh <name>`; apps MUST use `?directConnection=true`), edit its line in `/opt/dr/conf/mongo_sources.conf`, then
  `systemctl stop dr-mongo-tail@<name>; rm -f /opt/dr/state/cs_<name>.token; systemctl start dr-mongo-tail@<name>` (auto full sync).
- **Postgres**: on the new source `ALTER SYSTEM SET wal_level=logical;` + restart (Railway redeploy), `CREATE PUBLICATION dr_pub FOR ALL TABLES;`.
  On the droplet: `sudo -u postgres psql -d dynopay_dr -c "ALTER SUBSCRIPTION dr_sub DISABLE; ALTER SUBSCRIPTION dr_sub SET (slot_name=NONE); DROP SUBSCRIPTION dr_sub;"`,
  keep the old copy (`ALTER DATABASE dynopay_dr RENAME TO dynopay_dr_old_<date>` as postgres from db `postgres`), put the new URL in
  `/opt/dr/conf/pg_source.conf`, run `/opt/dr/bin/pg_setup_subscriber.sh`. Drop the old slot on the OLD source if it still exists.
- **Redis**: first `/opt/dr/bin/redis_snapshot.sh` (keeps the last data), then update `/opt/dr/conf/redis_source.conf` and
  `replicaof`/`masterauth` in `/etc/redis/dr-replica.conf`, `systemctl restart redis-server` (full resync from the new master).
- Finally `/opt/dr/bin/monitor_dr.sh; dr-status` → `STATUS: OK ✅`, and `probe.sh <name>` / `redis_probe.sh` for live proof.

## 8. Gotchas
- Temp/manual `mongod` started from a shell needs `ulimit -n 64000` (≈450 collections → >1024 files → WiredTiger EMFILE crash).
- mongosh: `db._x` is not a collection — use `db.getCollection('_x')`.
- Restoring while the source is still being written shows small count drifts on the live copy — expected; stop the app first for an exact cut-over.
- Railway Mongo URIs have no db path → auth db defaults to `admin` (scripts force `authSource=admin` anyway).
