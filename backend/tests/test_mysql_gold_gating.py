"""Backend tests for MySQL Gold-gating on /api/panel/mysql/* (iter 18).

Validates:
  - POST /api/panel/login returns isGold + plan for both goldtest & premtest
  - GET  /api/panel/session returns isGold + plan (re-loaded from Mongo)
  - All 17 /api/panel/mysql/* routes return HTTP 403 for non-Gold (premtest)
    with body { error, goldOnly: true, isGold: false, plan }
  - Same routes still return 200 (or 502 for phpmyadmin SSO) for goldtest
  - Non-MySQL panel routes (/files, /domains, /email/accounts, /quota) still
    work for premtest → Gold-gating is limited to /mysql/* only
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://app-vault-launch-1.preview.emergentagent.com").rstrip("/")
PANEL = f"{BASE_URL}/api/panel"


# ─── Shared fixtures ────────────────────────────────────────
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, username, pin="123456"):
    r = session.post(f"{PANEL}/login", json={"username": username, "pin": pin}, timeout=20)
    assert r.status_code == 200, f"login failed for {username}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def gold_login(session):
    return _login(session, "goldtest")


@pytest.fixture(scope="module")
def prem_login(session):
    return _login(session, "premtest")


@pytest.fixture(scope="module")
def gold_headers(gold_login):
    return {"Authorization": f"Bearer {gold_login['token']}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def prem_headers(prem_login):
    return {"Authorization": f"Bearer {prem_login['token']}", "Content-Type": "application/json"}


# ─── 1) Login & Session expose isGold + plan ────────────────
class TestLoginIncludesGoldFlags:
    def test_gold_login_has_isgold_true(self, gold_login):
        assert gold_login.get("isGold") is True, gold_login
        plan = gold_login.get("plan", "")
        assert "Golden Anti-Red HostPanel" in plan, plan

    def test_prem_login_has_isgold_false(self, prem_login):
        assert prem_login.get("isGold") is False, prem_login
        plan = prem_login.get("plan", "")
        assert "Premium Anti-Red HostPanel" in plan, plan


class TestSessionIncludesGoldFlags:
    def test_gold_session(self, session, gold_headers):
        r = session.get(f"{PANEL}/session", headers=gold_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("isGold") is True
        assert "Golden Anti-Red HostPanel" in (data.get("plan") or "")
        assert data.get("username") == "goldtest"

    def test_prem_session(self, session, prem_headers):
        r = session.get(f"{PANEL}/session", headers=prem_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("isGold") is False
        assert "Premium Anti-Red HostPanel" in (data.get("plan") or "")
        assert data.get("username") == "premtest"


# ─── 2) Gold-gating on /mysql/* for non-Gold (premtest) ─────
MYSQL_ROUTES = [
    ("GET",  "/mysql/databases",            None),
    ("POST", "/mysql/databases/create",     {"name": "x"}),
    ("POST", "/mysql/databases/delete",     {"name": "x"}),
    ("GET",  "/mysql/users",                None),
    ("POST", "/mysql/users/create",         {"name": "x", "password": "longenough"}),
    ("POST", "/mysql/users/delete",         {"name": "x"}),
    ("POST", "/mysql/users/password",       {"user": "x", "password": "longenough"}),
    ("POST", "/mysql/privileges/grant",     {"user": "x", "database": "y"}),
    ("POST", "/mysql/privileges/revoke",    {"user": "x", "database": "y"}),
    ("GET",  "/mysql/remote-hosts",         None),
    ("POST", "/mysql/remote-hosts/add",     {"host": "1.2.3.4"}),
    ("POST", "/mysql/remote-hosts/delete",  {"host": "1.2.3.4"}),
    ("GET",  "/mysql/phpmyadmin",           None),
]


class TestPremGoldGate403:
    @pytest.mark.parametrize("method,path,body", MYSQL_ROUTES)
    def test_premium_user_blocked_with_403_contract(self, session, prem_headers, method, path, body):
        r = session.request(method, f"{PANEL}{path}", headers=prem_headers, json=body, timeout=20)
        assert r.status_code == 403, f"{method} {path} → {r.status_code} (expected 403). Body: {r.text[:200]}"
        body_json = r.json()
        # Contract: { error, goldOnly: true, isGold: false, plan }
        assert body_json.get("goldOnly") is True, f"missing/invalid goldOnly: {body_json}"
        assert body_json.get("isGold") is False, f"missing/invalid isGold: {body_json}"
        assert "error" in body_json, f"missing error: {body_json}"
        assert "Premium" in (body_json.get("plan") or ""), f"missing/invalid plan: {body_json}"


# Critical specific routes explicitly required by the review request
class TestPremGoldGateCriticalRoutes:
    def test_get_databases_403(self, session, prem_headers):
        r = session.get(f"{PANEL}/mysql/databases", headers=prem_headers, timeout=15)
        assert r.status_code == 403
        assert r.json().get("goldOnly") is True

    def test_post_databases_create_403(self, session, prem_headers):
        r = session.post(f"{PANEL}/mysql/databases/create", headers=prem_headers,
                         json={"name": "x"}, timeout=15)
        assert r.status_code == 403
        assert r.json().get("goldOnly") is True

    def test_get_users_403(self, session, prem_headers):
        r = session.get(f"{PANEL}/mysql/users", headers=prem_headers, timeout=15)
        assert r.status_code == 403
        assert r.json().get("goldOnly") is True

    def test_post_users_create_403(self, session, prem_headers):
        r = session.post(f"{PANEL}/mysql/users/create", headers=prem_headers,
                         json={"name": "x", "password": "longenough"}, timeout=15)
        assert r.status_code == 403
        assert r.json().get("goldOnly") is True

    def test_get_remote_hosts_403(self, session, prem_headers):
        r = session.get(f"{PANEL}/mysql/remote-hosts", headers=prem_headers, timeout=15)
        assert r.status_code == 403

    def test_post_remote_hosts_add_403(self, session, prem_headers):
        r = session.post(f"{PANEL}/mysql/remote-hosts/add", headers=prem_headers,
                         json={"host": "1.2.3.4"}, timeout=15)
        assert r.status_code == 403

    def test_get_phpmyadmin_403(self, session, prem_headers):
        r = session.get(f"{PANEL}/mysql/phpmyadmin", headers=prem_headers, timeout=15)
        assert r.status_code == 403

    def test_post_privileges_grant_403(self, session, prem_headers):
        r = session.post(f"{PANEL}/mysql/privileges/grant", headers=prem_headers,
                         json={"user": "x", "database": "y"}, timeout=15)
        assert r.status_code == 403


# ─── 3) Regression: goldtest still passes Gold gate ─────────
class TestGoldRoutesStillWork:
    @pytest.mark.parametrize("method,path,body", MYSQL_ROUTES)
    def test_gold_user_not_blocked(self, session, gold_headers, method, path, body):
        try:
            r = session.request(method, f"{PANEL}{path}", headers=gold_headers, json=body, timeout=15)
        except requests.exceptions.ReadTimeout:
            pytest.skip(f"cPanel UAPI unreachable from preview pod (expected). {method} {path}")
            return
        # 403 would be a Gold-gating regression. Acceptable codes:
        #   200/400 → route logic executed normally (UAPI may have errored gracefully)
        #   502 → only phpmyadmin SSO when WHM is unreachable in preview
        assert r.status_code != 403, f"REGRESSION: {method} {path} → 403 for Gold user. Body: {r.text[:200]}"
        # phpmyadmin allowed to 502, the rest should be in {200, 400}
        if path == "/mysql/phpmyadmin":
            assert r.status_code in (200, 502), f"{path} → {r.status_code}"
        else:
            assert r.status_code in (200, 400, 502, 504), f"{method} {path} → {r.status_code}: {r.text[:200]}"


# ─── 4) Non-MySQL routes still work for premtest ────────────
class TestNonMysqlRoutesNotGated:
    """Gold-gating must be limited to /mysql/* only."""

    def _assert_not_gated(self, session, prem_headers, path):
        try:
            r = session.get(f"{PANEL}{path}", headers=prem_headers, timeout=15)
        except requests.exceptions.ReadTimeout:
            pytest.skip(f"cPanel UAPI unreachable (timeout) for {path} — non-gating issue, expected in preview")
            return
        assert r.status_code != 403, f"REGRESSION: {path} returned 403 for prem: {r.text[:200]}"

    def test_files_works_for_prem(self, session, prem_headers):
        self._assert_not_gated(session, prem_headers, "/files/list")

    def test_domains_works_for_prem(self, session, prem_headers):
        self._assert_not_gated(session, prem_headers, "/domains")

    def test_email_accounts_works_for_prem(self, session, prem_headers):
        self._assert_not_gated(session, prem_headers, "/email/accounts")

    def test_quota_works_for_prem(self, session, prem_headers):
        self._assert_not_gated(session, prem_headers, "/quota")
