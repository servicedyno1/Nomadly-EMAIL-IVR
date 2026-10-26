# CloudIVR Starter browser phone / SIP gate / provider-name scrub API tests
import os
import re
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
STARTER = "%2B13313039088"
PRO = "%2B13313039077"
BUSINESS = "%2B13313039039"
PROVIDERS = re.compile(r"telnyx|twilio|openprovider|connectreseller", re.I)


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    r = sess.post(f"{API}/auth/login", json={"email": "civr.alice@example.com", "password": "AliceTest#2026"})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    return sess


# SIP credentials gate for Starter
def test_starter_sip_forbidden(s):
    r = s.get(f"{API}/numbers/{STARTER}/sip")
    assert r.status_code == 403, r.text
    assert "plan_upgrade_required" in r.text


def test_starter_sip_browser_ok(s):
    r = s.get(f"{API}/numbers/{STARTER}/sip?browser=1")
    assert r.status_code == 200, r.text
    d = r.json()
    d = d.get("sip", d)
    assert d.get("username") and d.get("password")
    assert d.get("browserOnly") is True
    bk = d.get("browserKey")
    assert bk and bk["name"] == "X-Civr-Browser" and bk.get("value") and bk.get("expiresAt")
    assert not PROVIDERS.search(r.text), "provider name leak in sip response"


def test_starter_sip_reset_forbidden(s):
    r = s.post(f"{API}/numbers/{STARTER}/sip/reset")
    assert r.status_code == 403, r.text


def test_pro_sip_ok(s):
    r = s.get(f"{API}/numbers/{PRO}/sip")
    assert r.status_code == 200, r.text
    assert "browserOnly" not in r.json() or r.json().get("browserOnly") is not True


# Access flags on numbers list
def test_numbers_access(s):
    r = s.get(f"{API}/numbers")
    assert r.status_code == 200
    data = r.json()
    nums = data.get("numbers", data) if isinstance(data, dict) else data
    assert len(nums) > 0
    for n in nums:
        acc = n.get("access") or {}
        assert acc.get("browserPhone") is True, n.get("phoneNumber")
        plan = (n.get("plan") or "").lower()
        if plan == "starter":
            assert acc.get("sipCredentials") is False
        else:
            assert acc.get("sipCredentials") is True, (n.get("phoneNumber"), plan)
    assert not PROVIDERS.search(r.text), PROVIDERS.findall(r.text)[:5]


# Public catalog webFeatures
def test_catalog_starter_features():
    r = requests.get(f"{API}/public/catalog")
    assert r.status_code == 200
    txt = r.text
    d = r.json()
    plans = d.get("plans", d)
    starter = None
    if isinstance(plans, dict):
        starter = plans.get("starter")
    else:
        starter = next((p for p in plans if (p.get("key") or p.get("id")) == "starter"), None)
    assert starter, str(d)[:300]
    wf = {f["key"]: f for f in starter.get("webFeatures", [])}
    assert wf["browserPhone"]["included"] is True
    assert wf["sip"]["included"] is False
    assert not PROVIDERS.search(txt), PROVIDERS.findall(txt)[:5]


def test_number_detail_no_leak(s):
    for p in (STARTER, PRO, BUSINESS):
        r = s.get(f"{API}/numbers/{p}")
        assert r.status_code == 200, r.text
        assert not PROVIDERS.search(r.text), (p, PROVIDERS.findall(r.text)[:5])
