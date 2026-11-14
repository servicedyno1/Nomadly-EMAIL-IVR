# CloudIVR eSIM / mobile-number orders: 428 profile_required gate + spenza resale records (iter266)
import os
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
MONGO = MongoClient(os.environ.get('MONGO_URL', 'mongodb://localhost:27017'))[os.environ.get('DB_NAME', 'test')]

VALID_US = {"type": "individual", "fullName": "TEST_ Jane Doe",
            "address": {"line1": "10 Market St", "city": "Austin", "region": "TX", "postalCode": "78701", "countryCode": "US"}}


@pytest.fixture(scope="module")
def user():
    s = requests.Session()
    email = f"test_iter266_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "QaTest#2026x", "name": "TEST_ iter266"})
    assert r.status_code == 201, r.text
    acc = r.json()["account"]
    MONGO.walletOf.update_one({"_id": acc["id"]}, {"$set": {"usdIn": 300, "usdOut": 0}}, upsert=True)
    yield s, acc


def test_public_catalog():
    p = requests.get(f"{API}/public/esim-plans").json()
    m = requests.get(f"{API}/public/mobile-offer").json()
    print("PLANS:", p, "MOBILE:", m)
    assert "plans" in p


# --- Gate: 428 on eSIM + mobile for user without details ---
@pytest.mark.parametrize("path", ["/esim", "/mobile-numbers"])
def test_gate_428(user, path):
    s, _ = user
    r = s.post(f"{API}{path}", json={"planId": "x", "zipcode": "78701", "email": "a@example.com"})
    assert r.status_code == 428, r.text
    j = r.json()
    assert j["error"] == "profile_required" and "personal or business details" in j["message"]


def test_unauth_401():
    for p in ["/esim", "/mobile-numbers"]:
        assert requests.post(f"{API}{p}", json={}).status_code == 401


# --- After details: orders go through (dry-run) and record resale ---
def test_buy_after_profile(user):
    s, acc = user
    r = s.put(f"{API}/profile/legal", json=VALID_US)
    assert r.status_code == 200 and r.json()["complete"] is True
    cid = str(acc["id"])
    # mobile
    r = s.post(f"{API}/mobile-numbers", json={"zipcode": "78701", "autoRenew": False})
    print("MOBILE:", r.status_code, r.text[:400])
    if r.status_code == 200:
        rec = MONGO.numberResaleRecords.find_one({"chatId": cid, "provider": "spenza-mobile"})
        assert rec and rec["endUser"] and rec["resold"] is True, rec
        print("MOBILE REC:", rec)
    else:
        assert r.status_code != 428
    # esim
    plans = s.get(f"{API}/esim").json().get("plans") or []
    print("ESIM PLANS:", plans[:2])
    if not plans:
        pytest.skip("no esim plans in preview")
    r = s.post(f"{API}/esim", json={"planId": plans[0]["planId"], "zipcode": "78701", "email": "qa@example.com", "autoRenew": False})
    print("ESIM:", r.status_code, r.text[:400])
    assert r.status_code == 200, r.text
    rec = MONGO.numberResaleRecords.find_one({"chatId": cid, "provider": "spenza-esim"})
    assert rec and rec["endUser"], rec
    print("ESIM REC:", rec)
