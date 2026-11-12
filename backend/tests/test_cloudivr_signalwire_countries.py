# CloudIVR web: SignalWire US/CA-only country catalog + live number search (no purchase)
import os
import re
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "civr.uxtest@example.com", "password": "UxTest#2026"}, timeout=30)
    if r.status_code != 200:
        r = s.post(f"{API}/auth/login", json={"email": "civr.alice@example.com", "password": "AliceTest#2026"}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    return s


# Public catalog lists only US + CA
def test_public_catalog_us_ca_only():
    r = requests.get(f"{API}/public/catalog", timeout=30)
    assert r.status_code == 200
    codes = [c["code"] for c in r.json()["countries"]]
    assert sorted(codes) == ["CA", "US"], codes


# Authenticated catalog also US + CA
def test_auth_catalog_us_ca_only(client):
    r = client.get(f"{API}/catalog", timeout=30)
    assert r.status_code == 200
    assert sorted(c["code"] for c in r.json()["countries"]) == ["CA", "US"]


# Unsupported country rejected
def test_search_gb_rejected(client):
    r = client.get(f"{API}/numbers/search", params={"country": "GB", "type": "local"}, timeout=60)
    assert r.status_code == 400


# Canada local, no area code -> Canadian numbers
def test_search_ca_local(client):
    r = client.get(f"{API}/numbers/search", params={"country": "CA", "type": "local"}, timeout=90)
    assert r.status_code == 200, r.text[:300]
    nums = r.json()["numbers"]
    print("CA local:", [n["phoneNumber"] for n in nums], [n["region"] for n in nums])
    assert len(nums) > 0
    for n in nums:
        assert n["phoneNumber"].startswith("+1")
        assert n["capabilities"].get("fax") is False


# Canada toll-free
def test_search_ca_tollfree(client):
    r = client.get(f"{API}/numbers/search", params={"country": "CA", "type": "toll_free"}, timeout=90)
    assert r.status_code == 200, r.text[:300]
    nums = r.json()["numbers"]
    print("CA TF:", [n["phoneNumber"] for n in nums])
    assert len(nums) > 0
    for n in nums:
        assert re.match(r"^\+18(00|33|44|55|66|77|88)", n["phoneNumber"]), n["phoneNumber"]


# US local 212 -> fallback in NY
def test_search_us_212_fallback(client):
    r = client.get(f"{API}/numbers/search", params={"country": "US", "type": "local", "areaCode": "212"}, timeout=90)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    print("US 212:", d.get("fallback"), [n["phoneNumber"] for n in d["numbers"]], [n["region"] for n in d["numbers"]])
    assert len(d["numbers"]) > 0
    if not any(n["phoneNumber"].startswith("+1212") for n in d["numbers"]):
        assert d["fallback"] and d["fallback"]["areaCode"] == "212"
    for n in d["numbers"]:
        assert n["capabilities"].get("fax") is False


# US toll-free
def test_search_us_tollfree(client):
    r = client.get(f"{API}/numbers/search", params={"country": "US", "type": "toll_free"}, timeout=90)
    assert r.status_code == 200, r.text[:300]
    assert len(r.json()["numbers"]) > 0
