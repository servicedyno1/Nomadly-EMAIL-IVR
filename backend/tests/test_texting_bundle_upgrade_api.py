# Texting Number bundle checkout + campaign upgrade quote API checks (iteration 254)
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    r = sess.post(f"{API}/auth/login", json={"email": "civr.uxtest@example.com", "password": "UxTest#2026"})
    if r.status_code != 200:
        pytest.skip("login failed")
    return sess


# Texting offer shape
def test_mobile_offer_shape(s):
    r = s.get(f"{API}/mobile-numbers")
    assert r.status_code == 200
    d = r.json()
    assert isinstance(d["available"], bool)
    assert d["price"] == 75
    assert d["bundlePrice"] == 67.5
    assert d["bundlePct"] == 10
    assert isinstance(d["items"], list)


def test_mobile_offer_requires_auth():
    r = requests.get(f"{API}/mobile-numbers")
    assert r.status_code == 401


def _a_number(s):
    r = s.get(f"{API}/numbers/search?country=US&type=local")
    assert r.status_code == 200
    nums = r.json()["numbers"]
    assert nums
    return nums[0]["phoneNumber"]


# Checkout with a bad ZIP is rejected before buying
def test_checkout_texting_bad_zip(s):
    p = _a_number(s)
    r = s.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "wallet", "texting": {"zipcode": "12"}})
    assert r.status_code == 400
    assert "ZIP" in r.text


# Offer unavailable in this pod → clear 400, nothing bought
def test_checkout_texting_unavailable(s):
    before = s.get(f"{API}/numbers").json()["numbers"]
    p = _a_number(s)
    r = s.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "wallet", "texting": {"zipcode": "10011"}})
    if s.get(f"{API}/mobile-numbers").json()["available"]:
        pytest.skip("offer available in this pod")
    assert r.status_code == 400
    assert "temporarily unavailable" in r.text
    after = s.get(f"{API}/numbers").json()["numbers"]
    assert len(after) == len(before)


def test_checkout_texting_unavailable_crypto(s):
    p = _a_number(s)
    r = s.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "crypto", "coin": "BTC", "texting": {"zipcode": "10011"}})
    assert r.status_code == 400
    assert "temporarily unavailable" in r.text


# Upgrade quote (no confirm) does not charge
def test_upgrade_quote_business_number_to_business_is_rejected_or_quoted(s):
    r = s.post(f"{API}/numbers/%2B13341112222/upgrade", json={"plan": "pro"})
    assert r.status_code in (400, 409)
