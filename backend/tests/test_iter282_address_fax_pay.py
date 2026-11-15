# Iter282: saved-profile ZIP reuse for Spenza mobile/eSIM, fax numbers via MultiTEL, 402 insufficient_balance, travel eSIM plans
import os
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"


def _env(k):
    for line in open('/app/backend/.env'):
        if line.startswith(k + '='):
            return line.split('=', 1)[1].strip().strip('"')


DB = MongoClient(_env('MONGO_URL'))[_env('DB_NAME')]
PROFILE = {"type": "individual", "fullName": "TEST Zip User", "address": {"line1": "1 Main St", "city": "New York", "region": "NY", "postalCode": "10001", "countryCode": "US"}}


def set_wallet(cid, amt):
    w = DB.walletOf.find_one({'_id': cid}) or {}
    DB.walletOf.update_one({'_id': cid}, {'$set': {'usdIn': (w.get('usdOut') or 0) + amt}}, upsert=True)


@pytest.fixture(scope="module")
def acct():
    s = requests.Session()
    email = f"test_iter282_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "QaTest#2026x", "name": "TEST_ iter282", "acceptPolicy": True}, timeout=30)
    if r.status_code not in (200, 201):
        pytest.skip(f"register failed {r.status_code} {r.text[:200]}")
    tok = (r.json() or {}).get("token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    a = DB.webAccounts.find_one({'email': email})
    cid = str(int(a['_id']))
    print("registered", email, cid)
    set_wallet(cid, 300)
    yield s, cid, email
    # cleanup only what this run created
    DB.esimLines.delete_many({'chatId': cid})


# --- Address reuse (profile -> Spenza ZIP) ---
class TestProfileZip:
    def test_profile_put_get(self, acct):
        s, _, _ = acct
        assert s.get(f"{API}/profile/legal").json()["profile"] is None
        r = s.put(f"{API}/profile/legal", json=PROFILE)
        assert r.status_code == 200, r.text[:200]
        g = s.get(f"{API}/profile/legal").json()
        assert g["complete"] is True and g["profile"]["address"]["postalCode"] == "10001"

    def test_mobile_offer(self, acct):
        s, _, _ = acct
        d = s.get(f"{API}/mobile-numbers").json()
        print("mobile offer", {k: d.get(k) for k in ("available", "price", "bundlePrice")})
        assert "available" in d

    def test_mobile_no_zip_uses_profile_then_updated_profile(self, acct):
        s, _, _ = acct
        r1 = s.post(f"{API}/mobile-numbers", json={})
        assert r1.status_code == 200, r1.text[:300]
        it1 = r1.json()["item"]
        assert it1["zipcode"] == "10001"
        p2 = dict(PROFILE, address=dict(PROFILE["address"], postalCode="94105", city="San Francisco", region="CA"))
        assert s.put(f"{API}/profile/legal", json=p2).status_code == 200
        r2 = s.post(f"{API}/mobile-numbers", json={})
        assert r2.status_code == 200, r2.text[:300]
        assert r2.json()["item"]["zipcode"] == "94105"
        items = {i["id"]: i for i in s.get(f"{API}/mobile-numbers").json()["items"]}
        assert items[it1["id"]]["zipcode"] == "10001", "earlier order must keep its old ZIP"

    def test_mobile_explicit_zip_wins(self, acct):
        s, _, _ = acct
        r = s.post(f"{API}/mobile-numbers", json={"zipcode": "30301"})
        assert r.status_code == 200, r.text[:300]
        assert r.json()["item"]["zipcode"] == "30301"

    def test_esim_no_zip_uses_profile(self, acct):
        s, _, email = acct
        plans = s.get(f"{API}/esim").json().get("plans") or []
        if not plans:
            pytest.skip("no eSIM plans")
        r = s.post(f"{API}/esim", json={"planId": plans[0]["planId"], "email": email})
        assert r.status_code == 200, r.text[:300]
        assert r.json()["item"]["zipcode"] == "94105"

    def test_non_us_profile_requires_zip(self, acct):
        s, _, _ = acct
        p = {"type": "individual", "fullName": "TEST Zip User", "address": {"line1": "1 High St", "city": "London", "postalCode": "SW1A 1AA", "countryCode": "GB"}}
        assert s.put(f"{API}/profile/legal", json=p).status_code == 200
        r = s.post(f"{API}/mobile-numbers", json={})
        assert r.status_code == 400
        assert "ZIP" in r.json()["message"]


# --- Fax numbers via MultiTEL ---
class TestFaxMultitel:
    def test_offer_available(self, acct):
        s, _, _ = acct
        d = s.get(f"{API}/fax-numbers").json()
        print("fax offer", {k: v for k, v in d.items() if k != 'numbers'})
        assert d.get("available") is True

    def test_search_us_212(self, acct):
        s, _, _ = acct
        r = s.get(f"{API}/fax-numbers/search", params={"country": "US", "areaCode": "212"})
        assert r.status_code == 200, r.text[:200]
        nums = r.json().get("numbers") or []
        print("fax search", nums[:3])
        assert len(nums) > 0 and nums[0]["phoneNumber"].startswith("+1")
        assert DB.multitelSearched.estimated_document_count() >= 0

    def test_buy_dry_run_provider_multitel(self, acct):
        s, cid, _ = acct
        nums = s.get(f"{API}/fax-numbers/search", params={"country": "US", "areaCode": "212"}).json().get("numbers") or []
        if not nums:
            pytest.skip("no numbers")
        r = s.post(f"{API}/fax-numbers", json={"phoneNumber": nums[0]["phoneNumber"], "autoRenew": False})
        assert r.status_code == 200, r.text[:300]
        doc = DB.faxNumbers.find_one({'_id': nums[0]["phoneNumber"]})
        assert doc and doc["provider"] == "multitel_fax" and doc.get("dryRun") is True
        DB.faxNumbers.delete_one({'_id': nums[0]["phoneNumber"], 'chatId': doc['chatId'], 'dryRun': True})


# --- Insufficient balance -> 402 (drives the ErrorNote "Add funds" link) ---
class TestInsufficient:
    def test_travel_esim_402(self, acct):
        s, cid, _ = acct
        zones = s.get(f"{API}/travel-esim/plans").json().get("zones") or []
        assert zones, "no travel eSIM zones"
        offer = None
        for z in zones:
            for o in (z.get("offers") or z.get("plans") or []):
                offer = o
                break
            if offer:
                break
        assert offer, f"zone shape: {list(zones[0].keys())}"
        set_wallet(cid, 0)
        r = s.post(f"{API}/travel-esim/orders", json={"offerId": offer.get("id") or offer.get("offerId")})
        assert r.status_code == 402, r.text[:200]
        assert r.json()["error"] == "insufficient_balance"

    def test_fax_buy_402(self, acct):
        s, cid, _ = acct
        set_wallet(cid, 0)
        nums = s.get(f"{API}/fax-numbers/search", params={"country": "US", "areaCode": "212"}).json().get("numbers") or []
        if not nums:
            pytest.skip("no numbers")
        r = s.post(f"{API}/fax-numbers", json={"phoneNumber": nums[0]["phoneNumber"]})
        assert r.status_code == 402, r.text[:200]
