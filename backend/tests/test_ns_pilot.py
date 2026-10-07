"""Backend tests for NS-Pilot (read-only safe tests)."""
import os
import uuid
import json
import time
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://vault-key-manager.preview.emergentagent.com").rstrip("/")

# Read secrets from backend .env directly (test only)
def _load_env():
    env = {}
    with open("/app/backend/.env") as f:
        for line in f:
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.strip().split("=", 1)
                env[k] = v.strip().strip('"').strip("'")
    return env

ENV = _load_env()
ADMIN_KEY = ENV["SESSION_SECRET"][:16]
CRON_SECRET = ENV["WEBHOOK_CRON_SECRET"]
NC_API_KEY = ENV.get("NAMECHEAP_API_KEY", "")


# ── Status endpoint ─────────────────────────────────────────
class TestStatusEndpoint:
    def test_status_unauthorized_no_key(self):
        r = requests.get(f"{BASE}/api/admin/ns-pilot/status", timeout=15)
        assert r.status_code == 403
        assert r.json().get("error") == "Unauthorized"

    def test_status_unauthorized_wrong_key(self):
        r = requests.get(f"{BASE}/api/admin/ns-pilot/status?key=wrongkey", timeout=15)
        assert r.status_code == 403
        assert r.json().get("error") == "Unauthorized"

    def test_status_ok_with_checks_limit(self):
        r = requests.get(f"{BASE}/api/admin/ns-pilot/status?key={ADMIN_KEY}&checks=2", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        cfg = data.get("config", {})
        assert cfg.get("domain") == "hosta.sh"
        assert cfg.get("vanity") == ["ns1.hosta.sh", "ns2.hosta.sh"]
        assert cfg.get("probeHost") == "pilot.hosta.sh"
        assert cfg.get("days") == 14
        assert cfg.get("autoRevert") is True
        state = data.get("state", {})
        assert state.get("phase") in ("monitoring", "passed")
        assert state.get("zoneId") == "0f8c3ca124ab1a5c2ccdaae8d5391143"
        cfns = state.get("cfAssignedNs") or []
        assert sorted(cfns) == sorted(["anderson.ns.cloudflare.com", "leanna.ns.cloudflare.com"])
        assert "glue" in state
        assert isinstance(state.get("events"), list)
        rc = data.get("recentChecks")
        assert isinstance(rc, list)
        assert len(rc) <= 2


# ── Admin tick endpoint ─────────────────────────────────────
class TestAdminTick:
    def test_tick_returns_verdict(self):
        r = requests.post(f"{BASE}/api/admin/ns-pilot/tick?key={ADMIN_KEY}", timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        if data.get("skipped") == "already-running":
            pytest.skip("Tick already running from another source")
        assert data.get("ok") is True
        assert "phase" in data
        assert "steps" in data
        verdict = data.get("verdict", {})
        for k in ("zoneActive", "dnsAnswered", "proxied", "originLeak", "cfEdge", "protected"):
            assert k in verdict, f"missing verdict.{k}"
        # Expected per request
        assert verdict.get("protected") is True, f"protected not true: {verdict}"
        assert data.get("zoneStatus") == "active", f"zoneStatus={data.get('zoneStatus')}"
        assert "delegation" in data


# ── Cron endpoint ───────────────────────────────────────────
class TestCronEndpoint:
    def test_cron_no_auth(self):
        r = requests.post(f"{BASE}/api/cron/ns-pilot-tick", timeout=15)
        assert r.status_code == 401
        assert r.json().get("error") == "unauthorized"

    def test_cron_wrong_auth(self):
        r = requests.post(f"{BASE}/api/cron/ns-pilot-tick",
                          headers={"Authorization": "Bearer wrong"}, timeout=15)
        assert r.status_code == 401

    def test_cron_valid_and_duplicate(self):
        wid = str(uuid.uuid4())
        headers = {"Authorization": f"Bearer {CRON_SECRET}", "X-Webhook-Id": wid}
        r1 = requests.post(f"{BASE}/api/cron/ns-pilot-tick", headers=headers, timeout=20)
        assert r1.status_code == 202, r1.text
        j1 = r1.json()
        assert j1.get("accepted") is True
        assert j1.get("runId") == wid

        # Duplicate
        r2 = requests.post(f"{BASE}/api/cron/ns-pilot-tick", headers=headers, timeout=20)
        assert r2.status_code == 200, r2.text
        j2 = r2.json()
        assert j2.get("accepted") is False
        assert j2.get("duplicate") is True


# ── Health & reseller still mounted ─────────────────────────
class TestHealth:
    def test_health_ok(self):
        r = requests.get(f"{BASE}/api/health", timeout=15)
        assert r.status_code == 200

    def test_reseller_still_mounted_401_not_404(self):
        r = requests.get(f"{BASE}/api/reseller/v1/vps/plans", timeout=15)
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"
