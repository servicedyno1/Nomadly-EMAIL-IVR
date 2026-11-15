"""Backend tests for CloudIVR unified buy / texting add-on / admin fax-sales (iter290)."""
import os
import pytest
import requests

def _load_env():
    try:
        with open('/app/frontend/.env') as f:
            for line in f:
                if line.startswith('REACT_APP_BACKEND_URL='):
                    return line.split('=', 1)[1].strip()
    except Exception:
        pass
    return os.environ.get('REACT_APP_BACKEND_URL', '')

BASE = _load_env().rstrip('/')
API = f"{BASE}/api/cloudivr-web"

USER_EMAIL = "civr.uxtest@example.com"
USER_PASS = "UxTest#2026"
ADMIN_EMAIL = "moxxcompany@gmail.com"
ADMIN_PASS = "Katiekendra123@"


@pytest.fixture(scope="module")
def user_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": USER_EMAIL, "password": USER_PASS})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    if r.status_code != 200:
        pytest.skip(f"Admin step1 failed: {r.status_code} {r.text[:200]}")
    data = r.json()
    code = data.get("devCode")
    challenge = data.get("challenge") or data.get("token")
    if not code:
        pytest.skip("No devCode in admin login response (preview may not be dry-run)")
    r2 = s.post(f"{API}/admin/login/verify", json={"challenge": challenge, "code": code})
    if r2.status_code != 200:
        # try alternate route name
        r2 = s.post(f"{API}/admin/verify", json={"challenge": challenge, "code": code})
    assert r2.status_code == 200, f"Admin verify failed: {r2.status_code} {r2.text[:200]}"
    return s


def test_user_login_ok(user_session):
    r = user_session.get(f"{API}/me")
    assert r.status_code == 200
    assert "email" in r.json() or "user" in r.json()


def test_numbers_list(user_session):
    r = user_session.get(f"{API}/numbers")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, (list, dict))


def test_texting_switch_off_and_on(user_session):
    num = "+12024595976"
    import urllib.parse as u
    p = u.quote(num, safe="")
    # OFF
    r = user_session.patch(f"{API}/numbers/{p}/switch", json={"feature": "texting", "enabled": False})
    assert r.status_code in (200, 204), f"OFF failed: {r.status_code} {r.text[:200]}"
    body = r.json() if r.content else {}
    texting = (body.get("number", {}).get("features", {}) or body.get("features", {})).get("texting", {})
    if texting:
        assert texting.get("enabled") in (False, None)
    # ON
    r2 = user_session.patch(f"{API}/numbers/{p}/switch", json={"feature": "texting", "enabled": True})
    assert r2.status_code in (200, 204), f"ON failed: {r2.status_code} {r2.text[:200]}"
    body2 = r2.json() if r2.content else {}
    texting2 = (body2.get("number", {}).get("features", {}) or body2.get("features", {})).get("texting", {})
    if texting2:
        assert texting2.get("enabled") is True


def test_admin_fax_sales(admin_session):
    r = admin_session.get(f"{API}/admin/fax-sales")
    assert r.status_code == 200, f"Fax sales API: {r.status_code} {r.text[:300]}"
    data = r.json()
    for key in ("since", "countries", "totals"):
        assert key in data, f"Missing key {key} in response: {list(data.keys())}"
    totals = data["totals"]
    for k in ("sold", "soldSince", "active", "released", "monthly"):
        assert k in totals, f"Missing totals key {k}"
