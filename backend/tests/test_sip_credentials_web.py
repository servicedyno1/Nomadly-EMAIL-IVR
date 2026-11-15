# CloudIVR web SIP credentials: GET self-heal (stable), plans include SIP, reset rotates and persists
import os
import re
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
PHONE = "+13341112222"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    r = sess.post(f"{API}/auth/login", json={"email": "civr.uxtest@example.com", "password": "UxTest#2026"})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    return sess


def _sip(s):
    r = s.get(f"{API}/numbers/{requests.utils.quote(PHONE, safe='')}/sip")
    assert r.status_code == 200, r.text
    return r.json()


def test_unauth_sip_401():
    r = requests.get(f"{API}/numbers/{requests.utils.quote(PHONE, safe='')}/sip")
    assert r.status_code in (401, 403)


def test_get_sip_shape_and_stable(s):
    a = _sip(s)
    print(a)
    assert re.fullmatch(r"cv[a-z0-9]{8}", a["username"]), a["username"]
    assert len(a["password"]) == 12
    assert a["domain"] == "sip.cloudivr.net"
    assert a["port"] == 5060
    assert a["transport"] == "UDP/TCP"
    assert "TLS" not in a["transport"]
    assert a["live"] is True
    b = _sip(s)
    assert (a["username"], a["password"]) == (b["username"], b["password"])


def test_plans_all_have_sip(s):
    r = s.get(f"{API}/catalog")
    print(r.status_code, r.text[:1500])
    assert r.status_code == 200
    txt = r.text
    data = r.json()
    plans = data.get("plans", data) if isinstance(data, dict) else data
    found = {}
    items = plans.items() if isinstance(plans, dict) else [(p.get("key") or p.get("id") or p.get("plan"), p) for p in plans]
    for k, p in items:
        acc = (p or {}).get("access") or {}
        found[k] = acc.get("sipCredentials")
    print(found)
    assert found, txt[:500]
    for k in ("starter", "standard", "pro", "business"):
        if k in found:
            assert found[k] is True, f"{k} sipCredentials={found[k]}"


def test_reset_rotates_and_persists(s):
    before = _sip(s)
    r = s.post(f"{API}/numbers/{requests.utils.quote(PHONE, safe='')}/sip/reset", json={})
    print(r.status_code, r.text)
    assert r.status_code == 200
    new = r.json()
    assert new["username"] != before["username"] or new["password"] != before["password"]
    after = _sip(s)
    print("after", after)
    assert (after["username"], after["password"]) == (new["username"], new["password"]), \
        f"GET after reset returned old/other pair: {after['username']} vs reset {new['username']}"
    assert re.fullmatch(r"cv[a-z0-9]{8}", new["username"]), new["username"]
    assert len(new["password"]) == 12
