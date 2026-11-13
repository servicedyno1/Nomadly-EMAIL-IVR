import os
import random
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"


# Public fax offer (landing page, no auth)
def test_fax_offer():
    r = requests.get(f"{API}/public/fax-offer", timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["available"] is True
    assert d["price"] == 15
    assert {c["code"] for c in d["countries"]} == {"US", "CA"}


# Public fax search: area code w/ nearby flags
def test_search_us_305_nearby_flags():
    r = requests.get(f"{API}/public/fax-numbers/search", params={"country": "US", "areaCode": "305"}, timeout=60)
    assert r.status_code == 200
    d = r.json()
    assert isinstance(d["numbers"], list) and d["numbers"]
    assert all("nearby" in n and n["capabilities"] == {"voice": False, "sms": False, "fax": True} for n in d["numbers"])
    assert d["price"] == 15 and d["areaCode"] == "305"
    assert d["nearbyOnly"] == all(n["nearby"] for n in d["numbers"])


def test_search_ca():
    r = requests.get(f"{API}/public/fax-numbers/search", params={"country": "CA"}, timeout=60)
    assert r.status_code == 200
    nums = r.json()["numbers"]
    assert nums and all(n["phoneNumber"].startswith("+1") for n in nums)


def test_search_gb_rejected():
    r = requests.get(f"{API}/public/fax-numbers/search", params={"country": "GB"}, timeout=30)
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_country"


# Rate limit: >30/hour per IP -> 429 (uses a spoofed X-Forwarded-For so the real IP budget is kept)
def test_rate_limit_429():
    ip = f"10.{random.randint(1,254)}.{random.randint(1,254)}.{random.randint(1,254)}"
    codes = []
    for _ in range(32):
        r = requests.get(f"{API}/public/fax-numbers/search", params={"country": "GB"}, headers={"X-Forwarded-For": ip}, timeout=30)
        codes.append(r.status_code)
        if r.status_code == 429:
            break
    print("codes", codes)
    assert 429 in codes
    assert codes.index(429) == 30, f"429 at call {codes.index(429) + 1}"
