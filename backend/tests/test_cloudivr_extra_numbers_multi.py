# CloudIVR web: multi-select extra numbers on a plan (wallet + crypto) and new per-plan limits
import os
import requests
import pytest

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
PARENT = "+13341112222"
PARENT_ENC = "%2B13341112222"
EMAIL, PASSWORD = "civr.uxtest@example.com", "UxTest#2026"


@pytest.fixture(scope="module")
def s():
    ss = requests.Session()
    r = ss.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    return ss


def search(s):
    r = s.get(f"{API}/numbers/search", params={"country": "US", "type": "local"})
    assert r.status_code == 200, r.text
    nums = [n["phoneNumber"] for n in r.json()["numbers"] if not n.get("assigned")]
    assert len(nums) >= 3
    return nums


def extra_info(s):
    r = s.get(f"{API}/numbers/{PARENT_ENC}/extra")
    assert r.status_code == 200
    return r.json()


# Catalog limits
def test_catalog_limits(s):
    d = s.get(f"{API}/catalog").json()
    assert d["extraNumber"]["limits"] == {"starter": 5, "standard": 10, "pro": 25, "business": 50}


def test_public_catalog_limits():
    r = requests.get(f"{API}/public/catalog")
    assert r.status_code == 200
    print(r.json().get("extraNumber"))


# GET extra on Business number
def test_get_extra_business_limit(s):
    d = extra_info(s)
    assert d["allowed"] is True and d["limit"] == 50 and d["unlimited"] is False
    assert d["left"] == 50 - d["used"]


# Validation errors
def test_too_many(s):
    left = extra_info(s)["left"]
    fake = [f"+1555{str(i).zfill(7)}" for i in range(left + 1)]
    r = s.post(f"{API}/numbers/{PARENT_ENC}/extra", json={"phoneNumbers": fake})
    assert r.status_code == 400 and r.json()["error"] == "too_many"
    assert "Untick 1" in r.json()["message"]


def test_pick_none(s):
    r = s.post(f"{API}/numbers/{PARENT_ENC}/extra", json={"phoneNumbers": []})
    assert r.status_code == 400 and r.json()["error"] == "pick_number"


def test_search_again(s):
    nums = search(s)
    r = s.post(f"{API}/numbers/{PARENT_ENC}/extra", json={"phoneNumbers": [nums[0], "+15550000001"]})
    assert r.status_code == 400 and r.json()["error"] == "search_again"


def test_extra_on_subnumber_rejected(s):
    r = s.post(f"{API}/numbers/%2B13343334444/extra", json={"phoneNumbers": ["+15550000001"]})
    assert r.status_code == 400 and r.json()["error"] == "is_extra"


# Wallet multi purchase (3 at once)
def test_wallet_multi_purchase(s):
    before = extra_info(s)
    bal0 = s.get(f"{API}/wallet").json()["balance"]
    nums = search(s)[:3]
    r = s.post(f"{API}/numbers/{PARENT_ENC}/extra", json={"phoneNumbers": nums})
    assert r.status_code == 201, r.text
    d = r.json()
    assert set(d["added"]) == set(nums) and d["failed"] == []
    assert "3 extra numbers added" in d["message"]
    assert abs((bal0 - d["balance"]) - 75) < 0.01, (bal0, d["balance"])
    after = extra_info(s)
    assert after["used"] == before["used"] + 3
    listed = {n["phoneNumber"] for n in after["numbers"]}
    assert set(nums) <= listed


# Legacy single phoneNumber body
def test_wallet_single_legacy(s):
    before = extra_info(s)["used"]
    num = search(s)[0]
    r = s.post(f"{API}/numbers/{PARENT_ENC}/extra", json={"phoneNumber": num})
    assert r.status_code in (201, 202), r.text
    print("single body keys:", list(r.json().keys()))
    assert extra_info(s)["used"] == before + 1


# Crypto order for several extras + dry-run simulate payment
def test_crypto_multi_order(s):
    before = extra_info(s)["used"]
    nums = search(s)[:3]
    r = s.post(f"{API}/numbers/{PARENT_ENC}/extra-checkout", json={"phoneNumbers": nums, "coin": "BTC"})
    assert r.status_code == 201, r.text
    o = r.json()["order"]
    assert o["kind"] == "extra" and o["count"] == 3 and o["numbers"] == nums
    assert o["parentNumber"] == PARENT and abs(o["charge"] - 75) < 0.01
    g = s.get(f"{API}/numbers/orders/{o['id']}")
    assert g.status_code == 200 and g.json()["order"]["count"] == 3
    p = s.post(f"{API}/numbers/orders/{o['id']}/simulate-payment", json={})
    assert p.status_code == 200, p.text
    po = p.json()["order"]
    print("after pay:", po["status"], po["added"], po["failed"], po["message"])
    assert po["status"] == "active" and set(po["added"]) == set(nums)
    assert extra_info(s)["used"] == before + 3


def test_crypto_too_many(s):
    left = extra_info(s)["left"]
    fake = [f"+1555{str(i).zfill(7)}" for i in range(left + 1)]
    r = s.post(f"{API}/numbers/{PARENT_ENC}/extra-checkout", json={"phoneNumbers": fake, "coin": "BTC"})
    assert r.status_code == 400 and r.json()["error"] == "too_many"



# A number already bought is dropped from the search cache -> re-picking it needs a new search
def test_bought_number_leaves_search_cache(s):
    nums = search(s)[:2]
    r1 = s.post(f"{API}/numbers/{PARENT_ENC}/extra", json={"phoneNumber": nums[0]})
    assert r1.status_code in (201, 202), r1.text
    r = s.post(f"{API}/numbers/{PARENT_ENC}/extra", json={"phoneNumbers": nums})
    assert r.status_code == 400 and r.json()["error"] == "search_again"
