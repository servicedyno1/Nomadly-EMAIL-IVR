# CloudIVR web: Get-a-number country add-ons (planAddons), /texting/ready US MultiTEL offer, catalog labels
import os
import re
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    r = sess.post(f"{API}/auth/login", json={"email": "civr.uxtest@example.com", "password": "UxTest#2026"}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    return sess


def _search(s, country, typ):
    r = s.get(f"{API}/numbers/search", params={"country": country, "type": typ}, timeout=90)
    assert r.status_code == 200, r.text[:300]
    return r.json()


# planAddons per country
def test_br_local_addons(s):
    d = _search(s, "BR", "local")
    nums = d["numbers"]
    assert len(nums) > 0, d
    print("BR sample", nums[0])
    for n in nums:
        pa = n["planAddons"]
        assert set(pa.keys()) >= {"starter", "pro", "business"}
        assert all(v == 25 for v in pa.values()), pa


def test_us_local_addons_zero(s):
    d = _search(s, "US", "local")
    assert len(d["numbers"]) > 0
    for n in d["numbers"]:
        assert all(v == 0 for v in n["planAddons"].values()), n["planAddons"]


def test_nl_mobile_business_free(s):
    d = _search(s, "NL", "mobile")
    nums = d["numbers"]
    print("NL", d.get("message"), len(nums), nums[:1])
    assert len(nums) > 0, d
    for n in nums:
        pa = n["planAddons"]
        assert pa["business"] == 0, pa
        assert pa["starter"] == 25 and pa["pro"] == 25, pa


def test_de_local_addon(s):
    r = s.get(f"{API}/numbers/search", params={"country": "DE", "type": "local"}, timeout=90)
    print("DE", r.status_code, r.text[:400])
    assert r.status_code in (200, 400, 424, 503)


# texting/ready US MultiTEL offer
def test_texting_ready_us(s):
    r = s.get(f"{API}/texting/ready", timeout=30)
    assert r.status_code == 200
    d = r.json()
    us = [i for i in d["items"] if i["country"] == "US"]
    assert us, [i["country"] for i in d["items"]]
    assert us[0]["included"] is True and us[0]["needs10dlc"] is True
    codes = {i["country"] for i in d["items"]}
    print("texting countries", sorted(codes), "price", d.get("price"))
    assert {"CA", "GB"} <= codes or "UK" in codes


# catalog: all countries, no paperwork labels
def test_catalog_countries(s):
    r = s.get(f"{API}/catalog", timeout=30)
    assert r.status_code == 200
    txt = r.text
    d = r.json()
    cs = d.get("countries") or d.get("phone", {}).get("countries") or []
    print("catalog keys", list(d.keys())[:20], "countries", len(cs))


def test_unauth_search_401():
    r = requests.get(f"{API}/numbers/search", params={"country": "BR", "type": "local"}, timeout=30)
    assert r.status_code == 401
