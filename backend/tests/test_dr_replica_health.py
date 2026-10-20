# DR replica (dr-replica-ams3) read-only regression checks over SSH: redis replica, monitor, tailers, prod health
import json
import subprocess
import pytest

DR = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=15", "-i", "/root/.ssh/dr_replica", "root@146.190.229.132"]
PROD = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=15", "-i", "/root/.ssh/nomadly_droplet", "root@146.190.238.190"]


def run(host, cmd, timeout=100):
    p = subprocess.run(host + [cmd], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout)
    return p.stdout


# Redis live replica
def test_redis_replica_link_up():
    out = run(DR, "redis-cli -p 6379 INFO replication | tr -d '\\r'")
    assert "role:slave" in out and "master_link_status:up" in out
    io = int([l for l in out.splitlines() if l.startswith("master_last_io_seconds_ago:")][0].split(":")[1])
    assert io < 10


def test_redis_probe_ok():
    assert "REDIS PROBE OK" in run(DR, "/opt/dr/bin/redis_probe.sh")


def test_redis_snapshot_from_local_replica_and_fresh():
    assert "-h 127.0.0.1 -p 6379" in run(DR, "cat /opt/dr/bin/redis_snapshot.sh")
    age = int(run(DR, "echo $(( $(date +%s) - $(stat -c %Y $(ls -1t /opt/dr/dumps/redis/dump-*.rdb.gz | head -1)) ))").strip())
    assert age < 900


# Mongo tailers + monitor
@pytest.mark.parametrize("n", ["nomadly", "voodoo", "smadav", "proshop"])
def test_mongo_tailer_active(n):
    assert run(DR, f"systemctl is-active dr-mongo-tail@{n}").strip() == "active"


def test_dr_status_ok():
    out = run(DR, "/opt/dr/bin/monitor_dr.sh; dr-status")
    assert "STATUS: OK" in out
    for k in ("redis:replica", "pg:pit-archive", "mongo:pit-archive"):
        assert k in out


# Prod apps (read-only)
def test_prod_active_slots_healthy():
    out = run(PROD, "for p in 5000 5100 5001 5101 5003 5103 5004 5104; do curl -s -m5 127.0.0.1:$p/health | tr -d '\\n'; echo; done")
    healthy = [json.loads(l) for l in out.splitlines() if l.strip().startswith("{")]
    assert len(healthy) >= 4
    assert all(h["status"] == "healthy" and h["database"] == "connected" for h in healthy)
