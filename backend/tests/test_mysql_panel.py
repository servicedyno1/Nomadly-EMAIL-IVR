"""Backend tests for the MySQL panel UI: /api/panel/mysql/*.

cPanel UAPI is intentionally unreachable from this preview pod, so we ONLY
assert HTTP status codes + response shape. UAPI timeout-in-body errors are
expected, per agent_to_agent_context_note.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://vault-config-5.preview.emergentagent.com").rstrip("/")
PANEL = f"{BASE_URL}/api/panel"

# Seeded test account from /app/tests/seed_captcha_accounts.js
TEST_USER = "goldtest"
TEST_PIN = "123456"


@pytest.fixture(scope="module")
def auth_token():
    r = requests.post(f"{PANEL}/login", json={"username": TEST_USER, "pin": TEST_PIN}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"Login failed status={r.status_code} body={r.text[:200]}")
    data = r.json()
    assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 10
    return data["token"]


@pytest.fixture(scope="module")
def headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ── Login ─────────────────────────────────────────────
class TestLogin:
    def test_login_success(self):
        r = requests.post(f"{PANEL}/login", json={"username": TEST_USER, "pin": TEST_PIN}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "token" in d
        assert d.get("username") == TEST_USER

    def test_login_bad_pin(self):
        r = requests.post(f"{PANEL}/login", json={"username": TEST_USER, "pin": "000000"}, timeout=30)
        assert r.status_code in (401, 429)


# ── Auth gating: all routes require Authorization ─────
class TestAuthRequired:
    @pytest.mark.parametrize("method,path,body", [
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
    ])
    def test_unauthenticated_rejected(self, method, path, body):
        r = requests.request(method, f"{PANEL}{path}", json=body, timeout=15)
        assert r.status_code == 401, f"{method} {path} → {r.status_code} (expected 401)"


# ── Databases ─────────────────────────────────────────
class TestDatabases:
    def test_list(self, headers):
        r = requests.get(f"{PANEL}/mysql/databases", headers=headers, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        # Shape: { databases: <UAPI>, users: <UAPI> }
        assert "databases" in d and "users" in d, d
        assert isinstance(d["databases"], dict)
        assert isinstance(d["users"], dict)

    def test_create_missing_name(self, headers):
        r = requests.post(f"{PANEL}/mysql/databases/create", headers=headers, json={}, timeout=30)
        assert r.status_code == 400
        assert "error" in r.json()

    def test_create_accepts_name(self, headers):
        # UAPI will timeout — we just assert the request shape is accepted (HTTP 200 from our route).
        r = requests.post(f"{PANEL}/mysql/databases/create", headers=headers,
                          json={"name": "TEST_does_not_exist"}, timeout=60)
        assert r.status_code == 200

    def test_delete_missing_name(self, headers):
        r = requests.post(f"{PANEL}/mysql/databases/delete", headers=headers, json={}, timeout=30)
        assert r.status_code == 400

    def test_delete_accepts_name(self, headers):
        r = requests.post(f"{PANEL}/mysql/databases/delete", headers=headers,
                          json={"name": "TEST_does_not_exist"}, timeout=60)
        assert r.status_code == 200


# ── Users ─────────────────────────────────────────────
class TestUsers:
    def test_list(self, headers):
        r = requests.get(f"{PANEL}/mysql/users", headers=headers, timeout=60)
        assert r.status_code == 200

    def test_create_validation(self, headers):
        # missing name + password
        r = requests.post(f"{PANEL}/mysql/users/create", headers=headers, json={}, timeout=30)
        assert r.status_code == 400
        # short password
        r = requests.post(f"{PANEL}/mysql/users/create", headers=headers,
                          json={"name": "test", "password": "short"}, timeout=30)
        assert r.status_code == 400
        assert "8 characters" in r.json().get("error", "")

    def test_create_accepts_valid(self, headers):
        r = requests.post(f"{PANEL}/mysql/users/create", headers=headers,
                          json={"name": "TEST_user", "password": "longenoughpw"}, timeout=60)
        assert r.status_code == 200

    def test_delete_missing_name(self, headers):
        r = requests.post(f"{PANEL}/mysql/users/delete", headers=headers, json={}, timeout=30)
        assert r.status_code == 400

    def test_delete_accepts_name(self, headers):
        r = requests.post(f"{PANEL}/mysql/users/delete", headers=headers,
                          json={"name": "TEST_user"}, timeout=60)
        assert r.status_code == 200

    def test_password_validation(self, headers):
        r = requests.post(f"{PANEL}/mysql/users/password", headers=headers, json={}, timeout=30)
        assert r.status_code == 400
        r = requests.post(f"{PANEL}/mysql/users/password", headers=headers,
                          json={"user": "x", "password": "1234"}, timeout=30)
        assert r.status_code == 400

    def test_password_accepts_valid(self, headers):
        r = requests.post(f"{PANEL}/mysql/users/password", headers=headers,
                          json={"user": "TEST_user", "password": "longenoughpw"}, timeout=60)
        assert r.status_code == 200


# ── Privileges ────────────────────────────────────────
class TestPrivileges:
    def test_grant_missing(self, headers):
        r = requests.post(f"{PANEL}/mysql/privileges/grant", headers=headers, json={}, timeout=30)
        assert r.status_code == 400

    def test_grant_default_all(self, headers):
        # No privileges array → defaults to ALL PRIVILEGES per route source.
        r = requests.post(f"{PANEL}/mysql/privileges/grant", headers=headers,
                          json={"user": "TEST_user", "database": "TEST_db"}, timeout=60)
        assert r.status_code == 200

    def test_grant_with_privs(self, headers):
        r = requests.post(f"{PANEL}/mysql/privileges/grant", headers=headers,
                          json={"user": "TEST_user", "database": "TEST_db",
                                "privileges": ["SELECT", "INSERT"]}, timeout=60)
        assert r.status_code == 200

    def test_revoke_missing(self, headers):
        r = requests.post(f"{PANEL}/mysql/privileges/revoke", headers=headers, json={}, timeout=30)
        assert r.status_code == 400

    def test_revoke_accepts(self, headers):
        r = requests.post(f"{PANEL}/mysql/privileges/revoke", headers=headers,
                          json={"user": "TEST_user", "database": "TEST_db"}, timeout=60)
        assert r.status_code == 200


# ── Remote Hosts ──────────────────────────────────────
class TestRemoteHosts:
    def test_list(self, headers):
        r = requests.get(f"{PANEL}/mysql/remote-hosts", headers=headers, timeout=60)
        assert r.status_code == 200

    def test_add_empty(self, headers):
        r = requests.post(f"{PANEL}/mysql/remote-hosts/add", headers=headers, json={}, timeout=30)
        assert r.status_code == 400
        r = requests.post(f"{PANEL}/mysql/remote-hosts/add", headers=headers, json={"host": ""}, timeout=30)
        assert r.status_code == 400

    def test_add_oversized(self, headers):
        long_host = "a" * 200
        r = requests.post(f"{PANEL}/mysql/remote-hosts/add", headers=headers,
                          json={"host": long_host}, timeout=30)
        assert r.status_code == 400
        assert "1-60 characters" in r.json().get("error", "")

    def test_add_valid(self, headers):
        r = requests.post(f"{PANEL}/mysql/remote-hosts/add", headers=headers,
                          json={"host": "203.0.113.45"}, timeout=60)
        assert r.status_code == 200

    def test_delete_missing(self, headers):
        r = requests.post(f"{PANEL}/mysql/remote-hosts/delete", headers=headers, json={}, timeout=30)
        assert r.status_code == 400

    def test_delete_accepts(self, headers):
        r = requests.post(f"{PANEL}/mysql/remote-hosts/delete", headers=headers,
                          json={"host": "203.0.113.45"}, timeout=60)
        assert r.status_code == 200


# ── phpMyAdmin SSO ────────────────────────────────────
class TestPhpMyAdmin:
    def test_sso(self, headers):
        # In this preview env WHM is unreachable → 502 with {status:0, errors:[..]}.
        # In production → 200 with {url, expires}. Both shapes accepted.
        r = requests.get(f"{PANEL}/mysql/phpmyadmin", headers=headers, timeout=60)
        assert r.status_code in (200, 502), f"unexpected status {r.status_code}: {r.text[:200]}"
        d = r.json()
        if r.status_code == 200:
            assert "url" in d
        else:
            assert "errors" in d and isinstance(d["errors"], list)
