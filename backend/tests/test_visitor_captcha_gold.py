"""Backend tests for Visitor Captcha (Gold-only) feature.

Covers:
  - Auth middleware sets cpPlan / cpIsGold / cpAddonDomains correctly
  - GET /api/panel/security/captcha/status (Gold + Premium)
  - POST /api/panel/security/captcha/toggle Gold-gating
  - POST /api/panel/security/js-challenge/toggle Gold-gating
  - GET /api/panel/security/status response shape includes plan/isGold/captchaGoldOnly
  - Plan-name regex: 'Premium' must NOT match Gold
  - /panel/login + /panel/session regression for both plans

Pre-req: seed via `set -a; source /app/backend/.env; set +a;
         node /app/tests/seed_captcha_accounts.js`
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ivr-features-lab.preview.emergentagent.com").rstrip("/")
PANEL = f"{BASE_URL}/api/panel"


# ─── Fixtures ───────────────────────────────────────────────
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, username, pin="123456"):
    r = session.post(f"{PANEL}/login", json={"username": username, "pin": pin}, timeout=20)
    assert r.status_code == 200, f"login failed for {username}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def gold_token(session):
    return _login(session, "goldtest")


@pytest.fixture(scope="session")
def prem_token(session):
    return _login(session, "premtest")


def _hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ─── Login / Session regression ─────────────────────────────
class TestLoginAndSession:
    def test_gold_login(self, session):
        r = session.post(f"{PANEL}/login", json={"username": "goldtest", "pin": "123456"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["username"] == "goldtest"
        assert data["domain"] == "goldtest.com"
        assert isinstance(data["token"], str) and len(data["token"]) > 20

    def test_prem_login(self, session):
        r = session.post(f"{PANEL}/login", json={"username": "premtest", "pin": "123456"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["domain"] == "premtest.com"

    def test_login_wrong_pin(self, session):
        r = session.post(f"{PANEL}/login", json={"username": "goldtest", "pin": "000000"}, timeout=15)
        assert r.status_code == 401

    def test_session_authenticated(self, session, gold_token):
        r = session.get(f"{PANEL}/session", headers=_hdr(gold_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["username"] == "goldtest"

    def test_session_unauth(self, session):
        r = session.get(f"{PANEL}/session", timeout=15)
        assert r.status_code == 401


# ─── /security/captcha/status (Gold-only feature flag) ───────
class TestCaptchaStatus:
    def test_gold_user_status_shape(self, session, gold_token):
        r = session.get(f"{PANEL}/security/captcha/status", headers=_hdr(gold_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["isGold"] is True
        assert data["captchaGoldOnly"] is True
        assert "Golden Anti-Red HostPanel" in data["plan"]
        assert isinstance(data["domains"], list)
        # All main + addon domains must be present
        names = sorted([d["domain"] for d in data["domains"]])
        assert names == sorted(["goldtest.com", "goldaddon.com"])
        # Each entry has required fields
        for entry in data["domains"]:
            assert set(["domain", "enabled", "hasCloudflare", "isMain"]).issubset(entry.keys())
        main = next(d for d in data["domains"] if d["isMain"])
        assert main["domain"] == "goldtest.com"
        # Cloudflare configured in seed → hasCloudflare true
        assert main["hasCloudflare"] is True

    def test_premium_user_status_shape(self, session, prem_token):
        # Endpoint itself is auth-only (not Gold-gated); should return isGold=False.
        r = session.get(f"{PANEL}/security/captcha/status", headers=_hdr(prem_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["isGold"] is False, "Premium plan must NOT match Gold regex"
        assert data["captchaGoldOnly"] is True
        assert "Premium" in data["plan"]
        names = [d["domain"] for d in data["domains"]]
        assert names == ["premtest.com"]


# ─── /security/captcha/toggle (Gold gate) ───────────────────
class TestCaptchaToggleGate:
    def test_premium_user_blocked(self, session, prem_token):
        r = session.post(
            f"{PANEL}/security/captcha/toggle",
            headers=_hdr(prem_token),
            json={"domain": "premtest.com", "enabled": True},
            timeout=20,
        )
        assert r.status_code == 403, r.text
        body = r.json()
        assert body.get("captchaGoldOnly") is True
        assert body.get("isGold") is False
        assert body.get("upgradeRequired") is True

    def test_gold_foreign_domain_rejected(self, session, gold_token):
        r = session.post(
            f"{PANEL}/security/captcha/toggle",
            headers=_hdr(gold_token),
            json={"domain": "premtest.com", "enabled": True},
            timeout=20,
        )
        assert r.status_code == 403, r.text
        assert "does not belong" in (r.json().get("error") or "").lower()

    def test_gold_invalid_body(self, session, gold_token):
        r = session.post(
            f"{PANEL}/security/captcha/toggle",
            headers=_hdr(gold_token),
            json={"domain": "goldtest.com"},  # missing enabled
            timeout=20,
        )
        assert r.status_code == 400
        assert "enabled" in (r.json().get("error") or "").lower()

    def test_gold_valid_domain_reaches_cloudflare_layer(self, session, gold_token):
        """Gold user + own domain bypasses gating. Real CF call will fail with
        the seeded fake zone id; we accept either success or a 5xx Cloudflare
        error (anything non-403 means gating + ownership passed)."""
        r = session.post(
            f"{PANEL}/security/captcha/toggle",
            headers=_hdr(gold_token),
            json={"domain": "goldtest.com", "enabled": True},
            timeout=30,
        )
        assert r.status_code != 403, f"unexpected gating block: {r.text}"
        # Acceptable outcomes: 200 success, 400 hasCloudflare:false, or 500 CF error
        assert r.status_code in (200, 400, 500), r.text

    def test_gold_addon_domain_passes_ownership(self, session, gold_token):
        r = session.post(
            f"{PANEL}/security/captcha/toggle",
            headers=_hdr(gold_token),
            json={"domain": "goldaddon.com", "enabled": False},
            timeout=30,
        )
        assert r.status_code != 403, r.text

    def test_unauth_blocked(self, session):
        r = session.post(
            f"{PANEL}/security/captcha/toggle",
            json={"domain": "goldtest.com", "enabled": True},
            timeout=10,
        )
        assert r.status_code == 401


# ─── /security/js-challenge/toggle Gold gating ──────────────
class TestJsChallengeGoldGate:
    def test_premium_blocked(self, session, prem_token):
        r = session.post(
            f"{PANEL}/security/js-challenge/toggle",
            headers=_hdr(prem_token),
            json={"enabled": True},
            timeout=20,
        )
        assert r.status_code == 403, r.text
        body = r.json()
        assert body.get("captchaGoldOnly") is True
        assert body.get("upgradeRequired") is True
        assert body.get("isGold") is False


# ─── /security/status response shape ────────────────────────
class TestSecurityStatusShape:
    def test_gold_status_includes_plan_fields(self, session, gold_token):
        r = session.get(f"{PANEL}/security/status", headers=_hdr(gold_token), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("captchaGoldOnly") is True
        assert data.get("isGold") is True
        assert "Golden" in (data.get("plan") or "")
        # Existing fields must remain
        assert "antiBot" in data
        assert "antiRed" in data
        assert "protectionLayers" in data

    def test_premium_status_isgold_false(self, session, prem_token):
        r = session.get(f"{PANEL}/security/status", headers=_hdr(prem_token), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("isGold") is False
        assert data.get("captchaGoldOnly") is True
        assert "Premium" in (data.get("plan") or "")
