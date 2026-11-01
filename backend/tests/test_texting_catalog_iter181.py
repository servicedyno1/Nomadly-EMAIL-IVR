# Texting plan as 4th plan: public catalog + /hosted-sms config for Bob (texting plan) and Alice (Business add-on)
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code}")
    return s


# Public catalog texting block
def test_public_catalog_texting():
    r = requests.get(f"{API}/public/catalog")
    assert r.status_code == 200
    t = r.json()["texting"]
    assert t["setup"] == 150 and t["monthly"] == 100 and t["inbound"] == 50 and t["extra"] == 150
    assert t["textPrice"] == 0.05
    assert t["addOn"] == {"starter": 150, "pro": 120, "business": 100}
    assert t["addOnLimits"]["starter"] == 5 and t["addOnLimits"]["pro"] == 10 and t["addOnLimits"]["business"] is None


# Bob has an active Texting plan anchor -> plan option 'texting' priced $150
def test_bob_hosted_sms_plans():
    s = login("civr.bob@example.com", "BobTest#2026")
    d = s.get(f"{API}/hosted-sms").json()
    assert d["texting"]["setup"] == 150
    tp = [p for p in d.get("plans", []) if p["plan"] == "texting"]
    assert tp, d.get("plans")
    assert tp[0]["phoneNumber"] == "+13125558801"
    assert tp[0]["price"] == 150 and tp[0]["status"] == "active"
    act = [x for x in d["items"] if x["phoneNumber"] == "+13125558801"][0]
    assert act["status"] == "active"
    assert act.get("inboundIncluded") == 50
    assert isinstance(act.get("inboundUsed"), int)


# Alice Business plan -> add-on $100
def test_alice_business_addon_price():
    s = login("civr.alice@example.com", "AliceTest#2026")
    d = s.get(f"{API}/hosted-sms").json()
    biz = [p for p in d.get("plans", []) if p["plan"] == "business"]
    assert biz, d.get("plans")
    assert biz[0]["price"] == 100


def test_hosted_sms_requires_auth():
    r = requests.get(f"{API}/hosted-sms")
    assert r.status_code == 401
