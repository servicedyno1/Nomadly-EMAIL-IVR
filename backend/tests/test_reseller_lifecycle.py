"""
Pytest for reseller API gap-closure (lifecycle, renewable, dry-run renew,
grace, terminated gating, webhook registration).

Tests hit the Node reseller API directly on port 5000 (same host).
API key is captured ONCE at module load from the printed seed output.

Scope: HTTP API surface only. Webhook emit paths are intentionally
disabled in sandbox (SKIP_WEBHOOK_SYNC=true) — we validate GET/PUT
/account/webhook registration + events list only.
"""
import os
import re
import subprocess
import time
import pytest
import requests

BASE_URL = "http://127.0.0.1:5000/reseller/v1"


def _seed_once():
    """Seed owner + fixtures once. Capture API key from stdout."""
    out = subprocess.run(
        ["node", "scripts/seed_reseller_test_owner.js"],
        cwd="/app", capture_output=True, text=True, timeout=60,
    )
    m = re.search(r"TEST_RESELLER_API_KEY=(\S+)", out.stdout)
    if not m:
        pytest.fail(f"Could not seed owner / parse key: {out.stdout}\n{out.stderr}")
    key = m.group(1)
    for script in (
        "scripts/seed_reseller_test_hosting.js",
        "scripts/seed_reseller_test_vps_rdp.js",
        "scripts/seed_reseller_lifecycle_fixtures.js",
    ):
        r = subprocess.run(["node", script], cwd="/app",
                           capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            pytest.fail(f"Seed {script} failed: {r.stderr}")
    return key


API_KEY = _seed_once()
HEADERS = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}


def _get(path, **kw):
    return requests.get(f"{BASE_URL}{path}", headers=HEADERS, timeout=15, **kw)


def _post(path, body=None):
    return requests.post(f"{BASE_URL}{path}", headers=HEADERS, json=body or {}, timeout=15)


def _put(path, body=None):
    return requests.put(f"{BASE_URL}{path}", headers=HEADERS, json=body or {}, timeout=15)


# ---------- Auth ---------- #
class TestAuth:
    def test_no_auth_returns_401(self):
        for path in ("/hosting", "/renewals", "/account/webhook"):
            r = requests.get(f"{BASE_URL}{path}", timeout=10)
            assert r.status_code == 401, f"{path} should 401 without auth, got {r.status_code}"


# ---------- Hosting detail (online) ---------- #
class TestHostingDetailOnline:
    def test_online_fields(self):
        r = _get("/hosting/apifix01")
        assert r.status_code == 200
        d = r.json()
        assert d["state"] == "online"
        assert d["renewable"] is True
        assert d["renew_blocked_reason"] is None
        assert d["terminated"] is False
        assert d["suspended"] is False
        assert d["grace"] is None
        assert "auto_renew_next_attempt_at" in d
        assert d["panel_url"]
        assert d["server_ip"]


# ---------- Hosting detail (grace) ---------- #
class TestHostingDetailGrace:
    def test_grace_block(self):
        r = _get("/hosting/apigrace01")
        assert r.status_code == 200
        d = r.json()
        assert d["state"] == "grace"
        assert isinstance(d["grace"], dict)
        g = d["grace"]
        assert g.get("in_grace") is True
        assert g.get("grace_hours") == 48
        assert "expired_at" in g and "delete_at" in g
        assert "days_remaining" in g and "hours_remaining" in g


# ---------- Hosting detail (terminated) ---------- #
class TestHostingDetailTerminated:
    def test_terminated_shape(self):
        r = _get("/hosting/apiterm01")
        assert r.status_code == 200, f"expected 200 not 410, got {r.status_code}"
        d = r.json()
        assert d["state"] == "terminated"
        assert d["terminated"] is True
        assert d["renewable"] is False
        assert d["renew_blocked_reason"] == "account_terminated"
        assert d["suspended"] is False  # legacy forced false
        assert d["deliverables"] is None
        assert d.get("credentials_url") is None
        assert d.get("panel_url") is None
        # KEEPS these:
        assert d.get("domain")
        assert d.get("plan")
        assert d.get("expires_at")
        assert d.get("terminated_at")


# ---------- Hosting list ---------- #
class TestHostingList:
    def test_list_shape_excludes_terminated(self):
        r = _get("/hosting")
        assert r.status_code == 200
        payload = r.json()
        # API returns {panel_url, server_ip, accounts: [...]}
        items = payload.get("accounts") if isinstance(payload, dict) else payload
        assert isinstance(items, list)
        ids = {it["id"] for it in items}
        assert "apiterm01" not in ids, "terminated must be excluded from list"
        for it in items:
            assert "state" in it
            assert "renewable" in it
            assert "renew_blocked_reason" in it
            assert "suspended" in it


# ---------- Hosting renew dry_run ---------- #
class TestHostingRenewDryRun:
    def test_dry_run_no_charge(self):
        before = _get("/hosting/apifix01").json()
        expiry_before = before["expires_at"]

        r = _post("/hosting/apifix01/renew", {"dry_run": True, "periods": 2})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["dry_run"] is True
        assert d["renewable"] is True
        assert "price_usd" in d
        # plan price (Golden) * 2 periods; verify multiplication
        assert d["price_usd"] == before["price_usd"] * 2
        assert "duration_days" in d
        assert "would_expire_at" in d
        assert "sufficient_balance" in d

        after = _get("/hosting/apifix01").json()
        assert after["expires_at"] == expiry_before, "dry_run must not change expiry"

    def test_dry_run_on_terminated_409(self):
        r = _post("/hosting/apiterm01/renew", {"dry_run": True, "periods": 1})
        assert r.status_code == 409, f"expected 409, got {r.status_code}: {r.text}"
        d = r.json()
        reason = d.get("renew_blocked_reason") or d.get("reason") or d.get("error")
        assert reason == "account_terminated", d

    def test_live_renew_on_terminated_409(self):
        r = _post("/hosting/apiterm01/renew", {"periods": 1})
        assert r.status_code == 409
        d = r.json()
        reason = d.get("renew_blocked_reason") or d.get("reason") or d.get("error")
        assert reason == "account_terminated"


# ---------- VPS / RDP detail + renew ---------- #
class TestVpsRdp:
    def test_vps_detail_has_renewable(self):
        r = _get("/vps/vps-test-1")
        assert r.status_code == 200
        d = r.json()
        assert "renewable" in d and "renew_blocked_reason" in d
        assert d["renewable"] is True

    def test_rdp_detail_has_renewable(self):
        r = _get("/rdp/rdp-test-1")
        assert r.status_code == 200
        d = r.json()
        assert "renewable" in d and "renew_blocked_reason" in d

    def test_rdp_grace_block(self):
        r = _get("/rdp/rdp-grace-1")
        assert r.status_code == 200
        d = r.json()
        # grace block present
        assert d.get("state") == "grace" or isinstance(d.get("grace"), dict)

    def test_vps_renew_dry_run(self):
        r = _post("/vps/vps-test-1/renew", {"dry_run": True})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["dry_run"] is True
        assert "price_usd" in d
        assert d.get("renewable") is True

    def test_rdp_renew_dry_run(self):
        r = _post("/rdp/rdp-test-1/renew", {"dry_run": True})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["dry_run"] is True
        assert "price_usd" in d
        assert d.get("renewable") is True

    def test_vps_cancelled_409(self):
        r = _post("/vps/vps-term-1/renew", {"dry_run": True})
        assert r.status_code == 409, r.text
        d = r.json()
        reason = d.get("renew_blocked_reason") or d.get("reason") or d.get("error")
        assert reason == "already_destroyed", d


# ---------- Renewals ---------- #
class TestRenewals:
    def test_default_excludes_terminated(self):
        r = _get("/renewals")
        assert r.status_code == 200
        d = r.json()
        summary = d.get("summary", {})
        assert summary.get("terminated", 0) == 0
        items = d.get("renewals", [])
        assert isinstance(items, list)
        for it in items:
            assert "renewable" in it, f"item missing renewable: {it}"
            assert "renew_blocked_reason" in it
            assert it.get("status") != "terminated"

    def test_hosting_grace_block_in_renewals(self):
        r = _get("/renewals")
        d = r.json()
        items = d.get("renewals", [])
        grace_item = next(
            (x for x in items if x.get("product") == "hosting" and x.get("id") == "apigrace01"),
            None,
        )
        assert grace_item is not None, f"apigrace01 should appear in renewals: {items}"
        assert grace_item.get("state") == "grace"
        assert "delete_at" in grace_item
        assert "days_until_deletion" in grace_item

    def test_include_terminated_true(self):
        r = _get("/renewals", params={"include_terminated": "true"})
        assert r.status_code == 200
        d = r.json()
        items = d.get("renewals", [])
        terminated = [x for x in items if x.get("status") == "terminated"]
        assert len(terminated) >= 1, f"expected terminated items, got {d}"
        for t in terminated:
            assert t.get("renewable") is False
            assert "terminated_at" in t


# ---------- Webhook registration ---------- #
EXPECTED_EVENTS = {
    "hosting.grace_start",
    "hosting.suspended",
    "hosting.deleted",
    "hosting.auto_renew_failed",
    "vps.grace_start",
    "vps.deleted",
    "rdp.grace_start",
    "rdp.deleted",
}


class TestWebhook:
    def test_get_initial(self):
        r = _get("/account/webhook")
        assert r.status_code == 200
        d = r.json()
        events = set(d.get("events", []))
        assert EXPECTED_EVENTS.issubset(events), f"missing events: {EXPECTED_EVENTS - events}"
        # secret may be null until set, OR may already be set from prior PUT.
        assert "webhook_secret" in d

    def test_put_mints_secret(self):
        r = _put("/account/webhook", {"webhook_url": "https://example.com/hook"})
        assert r.status_code == 200, r.text
        d = r.json()
        secret = d.get("webhook_secret")
        assert secret and secret.startswith("whsec_"), d
        events = set(d.get("events", []))
        assert EXPECTED_EVENTS.issubset(events)

        # GET afterwards – secret persists
        r2 = _get("/account/webhook")
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2.get("webhook_secret") == secret

    def test_invalid_url_400(self):
        r = _put("/account/webhook", {"webhook_url": "not-a-url"})
        assert r.status_code == 400
        d = r.json()
        err = d.get("error") or d.get("code") or ""
        assert "invalid_webhook_url" in str(err) or "invalid" in str(err).lower()

    def test_clear_url_keeps_secret(self):
        # ensure a secret exists first
        _put("/account/webhook", {"webhook_url": "https://example.com/hook2"})
        prior = _get("/account/webhook").json().get("webhook_secret")
        assert prior
        r = _put("/account/webhook", {"webhook_url": None})
        assert r.status_code == 200, r.text
        after = _get("/account/webhook").json()
        # url cleared, secret kept
        assert after.get("webhook_url") in (None, "", False)
        assert after.get("webhook_secret") == prior
