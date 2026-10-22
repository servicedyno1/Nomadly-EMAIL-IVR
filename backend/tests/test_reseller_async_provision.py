"""Test async provisioning (202) refactor for reseller hosting/vps/rdp create endpoints."""
import os
import re
import subprocess
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://vault-preview-122.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api/reseller/v1"


def _seed_once():
    """Re-seed the test owner and capture the freshly-rotated API key (avoids stale hardcoded keys)."""
    env_key = os.environ.get("TEST_RESELLER_API_KEY")
    if env_key:
        return env_key
    out = subprocess.run(
        ["node", "scripts/seed_reseller_test_owner.js"],
        cwd="/app", capture_output=True, text=True, timeout=60,
    )
    m = re.search(r"TEST_RESELLER_API_KEY=(\S+)", out.stdout)
    if not m:
        pytest.fail(f"Could not seed owner / parse key: {out.stdout}\n{out.stderr}")
    return m.group(1)


API_KEY = _seed_once()

HEADERS = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}


def _rand(n=8):
    return uuid.uuid4().hex[:n]


def _wallet():
    r = requests.get(f"{API}/account", headers=HEADERS, timeout=15)
    assert r.status_code == 200, r.text
    return r.json().get("wallet_balance_usd")


# ---------- HOSTING ----------
class TestHostingAsync:
    def test_hosting_202_contract(self):
        domain = f"test-{_rand()}.example.com"
        client_ref = f"ref-{_rand()}"
        body = {
            "plan_id": "premium-monthly",
            "domain": domain,
            "domain_mode": "external",
            "client_ref": client_ref,
        }
        r = requests.post(f"{API}/hosting", json=body, headers=HEADERS, timeout=20)
        assert r.status_code == 202, f"expected 202 got {r.status_code}: {r.text}"
        d = r.json()
        assert d.get("status") == "provisioning"
        for k in ("job_id", "username", "domain", "plan", "price_usd", "poll_url", "credentials_url"):
            assert k in d, f"missing {k} in response: {d}"
        assert d["domain"] == domain
        assert d["poll_url"] == f"/hosting/{d['username']}"
        pytest.hosting_ctx = {"domain": domain, "client_ref": client_ref, "username": d["username"], "job_id": d["job_id"], "body": body}

    def test_hosting_idempotency(self):
        ctx = pytest.hosting_ctx
        w_before = _wallet()
        r = requests.post(f"{API}/hosting", json=ctx["body"], headers=HEADERS, timeout=20)
        assert r.status_code == 202, r.text
        d = r.json()
        assert d.get("job_id") == ctx["job_id"], f"job_id mismatch: {d}"
        assert d.get("username") == ctx["username"]
        assert d.get("idempotent") is True, f"missing idempotent flag: {d}"
        w_after = _wallet()
        assert w_before == w_after, f"wallet changed {w_before} -> {w_after}"

    def test_hosting_invalid_plan(self):
        r = requests.post(f"{API}/hosting", json={"plan_id": "bogus", "domain": f"x-{_rand()}.ex.com", "domain_mode": "external"}, headers=HEADERS, timeout=15)
        assert r.status_code == 400, r.text
        assert r.json().get("error") == "invalid_plan"

    def test_hosting_invalid_domain(self):
        r = requests.post(f"{API}/hosting", json={"plan_id": "premium-monthly", "domain": "not a domain!!", "domain_mode": "external"}, headers=HEADERS, timeout=15)
        assert r.status_code == 400, r.text
        assert r.json().get("error") == "invalid_domain"

    def test_hosting_invalid_domain_mode(self):
        r = requests.post(f"{API}/hosting", json={"plan_id": "premium-monthly", "domain": f"x-{_rand()}.ex.com", "domain_mode": "foo"}, headers=HEADERS, timeout=15)
        assert r.status_code == 400, r.text
        assert r.json().get("error") == "invalid_domain_mode"

    def test_hosting_duplicate_domain(self):
        ctx = pytest.hosting_ctx
        # wait briefly so dry_run job completes
        time.sleep(2)
        body2 = dict(ctx["body"])
        body2["client_ref"] = f"ref-{_rand()}"
        r = requests.post(f"{API}/hosting", json=body2, headers=HEADERS, timeout=20)
        assert r.status_code == 409, f"expected 409 got {r.status_code}: {r.text}"
        assert r.json().get("error") == "domain_in_use"

    def test_hosting_read_transition(self):
        ctx = pytest.hosting_ctx
        time.sleep(2)
        r = requests.get(f"{API}/hosting/{ctx['username']}", headers=HEADERS, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        state = d.get("state") or d.get("provision_state") or d.get("status")
        assert state in ("online", "provisioning", "active"), f"unexpected state: {d}"
        # list
        r2 = requests.get(f"{API}/hosting", headers=HEADERS, timeout=15)
        assert r2.status_code == 200
        items = r2.json().get("accounts") or r2.json().get("items") or []
        found = any((it.get("id") == ctx["username"] or it.get("username") == ctx["username"]) for it in items)
        assert found, f"username {ctx['username']} not found in list"

    def test_no_auth(self):
        r = requests.post(f"{API}/hosting", json={"plan_id": "premium-monthly", "domain": f"x-{_rand()}.ex.com", "domain_mode": "external"}, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"


# ---------- VPS ----------
class TestVpsAsync:
    def test_vps_202(self):
        client_ref = f"vref-{_rand()}"
        body = {"plan_id": "s-1vcpu-1gb", "client_ref": client_ref}
        r = requests.post(f"{API}/vps", json=body, headers=HEADERS, timeout=20)
        assert r.status_code == 202, r.text
        d = r.json()
        assert d.get("status") == "provisioning"
        for k in ("job_id", "id", "plan", "region", "price_usd", "poll_url"):
            assert k in d, f"missing {k}: {d}"
        assert d["poll_url"] == f"/vps/{d['id']}"
        pytest.vps_ctx = {"body": body, "id": d["id"], "job_id": d["job_id"]}

    def test_vps_idempotency(self):
        ctx = pytest.vps_ctx
        w_before = _wallet()
        r = requests.post(f"{API}/vps", json=ctx["body"], headers=HEADERS, timeout=20)
        assert r.status_code == 202, r.text
        d = r.json()
        assert d.get("job_id") == ctx["job_id"]
        assert d.get("id") == ctx["id"]
        assert d.get("idempotent") is True
        assert _wallet() == w_before

    def test_vps_read(self):
        ctx = pytest.vps_ctx
        time.sleep(2)
        r = requests.get(f"{API}/vps/{ctx['id']}", headers=HEADERS, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "provision_state" in d or "status" in d, f"missing state: {d}"
        r2 = requests.get(f"{API}/vps", headers=HEADERS, timeout=15)
        assert r2.status_code == 200
        items = r2.json().get("vps") or r2.json().get("items") or []
        assert any(it.get("id") == ctx["id"] for it in items)

    def test_vps_no_auth(self):
        r = requests.post(f"{API}/vps", json={"plan_id": "s-1vcpu-1gb"}, timeout=15)
        assert r.status_code in (401, 403)


# ---------- RDP ----------
class TestRdpAsync:
    def test_rdp_202(self):
        client_ref = f"rref-{_rand()}"
        body = {"plan_id": "standard-1m", "region": "EU", "os": "ws2022", "client_ref": client_ref}
        r = requests.post(f"{API}/rdp", json=body, headers=HEADERS, timeout=20)
        assert r.status_code == 202, r.text
        d = r.json()
        assert d.get("status") == "provisioning"
        for k in ("job_id", "id", "plan", "region", "price_usd", "poll_url"):
            assert k in d, f"missing {k}: {d}"
        pytest.rdp_ctx = {"body": body, "id": d["id"], "job_id": d["job_id"]}

    def test_rdp_idempotency(self):
        ctx = pytest.rdp_ctx
        w_before = _wallet()
        r = requests.post(f"{API}/rdp", json=ctx["body"], headers=HEADERS, timeout=20)
        assert r.status_code == 202, r.text
        d = r.json()
        assert d.get("job_id") == ctx["job_id"]
        assert d.get("id") == ctx["id"]
        assert d.get("idempotent") is True
        assert _wallet() == w_before

    def test_rdp_invalid_os(self):
        r = requests.post(f"{API}/rdp", json={"plan_id": "standard-1m", "region": "EU", "os": "ws2016"}, headers=HEADERS, timeout=15)
        assert r.status_code == 400, r.text
        body = r.json()
        assert body.get("error") == "invalid_os"
        msg = str(body)
        for v in ("ws2019", "ws2022", "ws2025"):
            assert v in msg, f"expected {v} in error message: {msg}"

    def test_rdp_invalid_plan(self):
        r = requests.post(f"{API}/rdp", json={"plan_id": "nope", "region": "EU", "os": "ws2022"}, headers=HEADERS, timeout=15)
        assert r.status_code == 400, r.text
        assert r.json().get("error") == "invalid_plan"

    def test_rdp_no_auth(self):
        r = requests.post(f"{API}/rdp", json={"plan_id": "standard-1m", "region": "EU", "os": "ws2022"}, timeout=15)
        assert r.status_code in (401, 403)
