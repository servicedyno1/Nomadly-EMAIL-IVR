# CloudIVR legal profile (individual/business), number-purchase gate, Google address proxy, resale records (iter265)
import os
import time
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
MONGO = MongoClient(os.environ.get('MONGO_URL', 'mongodb://localhost:27017'))[os.environ.get('DB_NAME', 'test')]

VALID_IND = {"type": "individual", "fullName": "TEST_ Jane Doe",
             "address": {"line1": "1 George St", "city": "Sydney", "region": "NSW", "postalCode": "2000", "countryCode": "AU"}}
VALID_BIZ = {"type": "business", "fullName": "TEST_ John Roe", "companyName": "TEST_ Acme Pty Ltd", "registrationNumber": "ABN123",
             "vatNumber": "GB123", "website": "https://acme.example.com",
             "address": {"line1": "10 Market St", "city": "Austin", "region": "TX", "postalCode": "78701", "countryCode": "US"}}


@pytest.fixture(scope="module")
def new_user():
    s = requests.Session()
    email = f"test_iter265_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "QaTest#2026x", "name": "TEST_ iter265"})
    assert r.status_code == 201, r.text
    acc = r.json()["account"]
    # give wallet so the dry-run purchase can go through (own TEST_ account only)
    MONGO.walletOf.update_one({"_id": acc["id"]}, {"$set": {"usdIn": 200, "usdOut": 0}}, upsert=True)
    yield s, acc, email


# --- Fresh account: profile empty and profileDue ---
def test_new_account_profile_empty(new_user):
    s, acc, _ = new_user
    assert acc["profileComplete"] is False and acc["profileType"] is None and acc["profileDue"] is True
    r = s.get(f"{API}/profile/legal")
    assert r.status_code == 200 and r.json() == {"profile": None, "complete": False}


# --- Gate: 428 profile_required on all checkout paths ---
@pytest.mark.parametrize("path", ["/numbers/buy", "/numbers/checkout", "/numbers/+13341112222/extra",
                                  "/numbers/+13341112222/extra-checkout", "/fax-numbers"])
def test_gate_428(new_user, path):
    s, _, _ = new_user
    r = s.post(f"{API}{path}", json={"phoneNumber": "+15555550100", "plan": "starter"})
    assert r.status_code == 428, f"{path} -> {r.status_code} {r.text[:200]}"
    assert r.json()["error"] == "profile_required"


# --- Validation errors ---
@pytest.mark.parametrize("payload,msg", [
    ({**VALID_IND, "type": None}, "individual or business"),
    ({**VALID_IND, "fullName": "J"}, "full legal name"),
    ({**VALID_BIZ, "companyName": ""}, "business name"),
    ({**VALID_BIZ, "website": "not a site"}, "website"),
    ({**VALID_IND, "address": {**VALID_IND["address"], "line1": ""}}, "street"),
    ({**VALID_IND, "address": {**VALID_IND["address"], "city": ""}}, "city"),
    ({**VALID_IND, "address": {**VALID_IND["address"], "countryCode": ""}}, "country"),
    ({**VALID_IND, "address": {**VALID_IND["address"], "postalCode": ""}}, "postal code"),
])
def test_validation(new_user, payload, msg):
    s, _, _ = new_user
    r = s.put(f"{API}/profile/legal", json=payload)
    assert r.status_code == 400, r.text
    assert r.json()["error"] == "invalid_profile" and msg in r.json()["message"], r.json()


# --- Auth required ---
@pytest.mark.parametrize("path", ["/profile/legal", "/address/suggest?q=george&country=AU&session=x",
                                  "/address/place?id=ChIJabcdefghijk&session=x"])
def test_unauth_401(path):
    r = requests.get(f"{API}{path}")
    assert r.status_code == 401, r.status_code


# --- Address proxy (real Google calls, keep modest) ---
def test_address_suggest_and_place(new_user):
    s, _, _ = new_user
    r = s.get(f"{API}/address/suggest", params={"q": "ab", "country": "AU", "session": "x"})
    assert r.status_code == 200 and r.json()["suggestions"] == []
    r = s.get(f"{API}/address/suggest", params={"q": "1 George St Sydney", "country": "AU", "session": "iter265"})
    assert r.status_code == 200, r.text
    sug = r.json()["suggestions"]
    assert 0 < len(sug) <= 5 and all({"id", "main", "secondary"} <= set(x) for x in sug)
    r = s.get(f"{API}/address/place", params={"id": sug[0]["id"], "session": "iter265"})
    assert r.status_code == 200, r.text
    a = r.json()["address"]
    for k in ["line1", "line2", "city", "region", "postalCode", "countryCode", "placeId", "formatted"]:
        assert k in a
    assert a["countryCode"] == "AU" and a["line1"] and a["city"]
    print("PLACE:", a)
    r = s.get(f"{API}/address/place", params={"id": "bad id!", "session": "x"})
    assert r.status_code == 400 and r.json()["error"] == "invalid_place"


# --- No-postcode countries + valid saves + later ---
def test_no_postcode_and_saves(new_user):
    s, _, _ = new_user
    for cc in ["AE", "HK", "IE"]:
        p = {**VALID_IND, "address": {"line1": "Some Street 1", "city": "Somecity", "countryCode": cc}}
        r = s.put(f"{API}/profile/legal", json=p)
        assert r.status_code == 200 and r.json()["complete"] is True, (cc, r.text)
    r = s.put(f"{API}/profile/legal", json=VALID_IND)
    assert r.status_code == 200 and r.json()["profile"]["type"] == "individual"
    r = s.put(f"{API}/profile/legal", json=VALID_BIZ)
    assert r.status_code == 200 and r.json()["complete"] is True
    prof = r.json()["profile"]
    assert prof["companyName"] == VALID_BIZ["companyName"] and prof["address"]["countryCode"] == "US"
    me = s.get(f"{API}/auth/me").json()["account"]
    assert me["profileComplete"] is True and me["profileType"] == "business" and me["profileDue"] is False
    g = s.get(f"{API}/profile/legal").json()
    assert g["complete"] is True and g["profile"]["website"] == VALID_BIZ["website"]


def test_later_clears_due():
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": f"test_iter265l_{uuid.uuid4().hex[:8]}@example.com", "password": "QaTest#2026x"})
    assert r.status_code == 201 and r.json()["account"]["profileDue"] is True
    r = s.post(f"{API}/profile/legal/later")
    assert r.status_code == 200 and r.json()["ok"] is True
    me = s.get(f"{API}/auth/me").json()["account"]
    assert me["profileDue"] is False and me["profileComplete"] is False


# --- Dry-run purchase after details -> resale record + admin view ---
def test_purchase_creates_resale_record(new_user):
    s, acc, _ = new_user
    r = s.get(f"{API}/numbers/search", params={"country": "US"})
    assert r.status_code == 200, r.text
    d = r.json()
    nums = d.get("numbers") or d.get("results") or []
    assert nums, d
    phone = nums[0]["phoneNumber"] if isinstance(nums[0], dict) else nums[0]
    r = s.post(f"{API}/numbers/buy", json={"phoneNumber": phone, "plan": "starter"})
    assert r.status_code in (200, 201), r.text
    time.sleep(1)
    rec = MONGO.numberResaleRecords.find_one({"chatId": acc["id"]}, sort=[("at", -1)])
    assert rec, "no resale record"
    assert rec["resold"] is True and rec["endUser"]["name"] == VALID_BIZ["companyName"]
    assert "10 Market St" in rec["endUser"]["address"] and rec["note"].startswith("Resold by CloudIVR")
    print("RESALE:", {k: rec[k] for k in ["phoneNumber", "provider", "note"]})
    pytest.bought = (acc["id"], phone)


def test_admin_user_detail_has_legal_and_resale(new_user):
    _, acc, _ = new_user
    a = requests.Session()
    r = a.post(f"{API}/admin/login", json={"email": "moxxcompany@gmail.com", "password": "Katiekendra123@"})
    if r.status_code != 200 or "devCode" not in r.json():
        pytest.skip(f"admin login unavailable {r.status_code}")
    r = a.post(f"{API}/admin/verify", json={"challenge": r.json()["challenge"], "code": r.json()["devCode"]})
    assert r.status_code == 200, r.text
    r = a.get(f"{API}/admin/users/{acc['id']}")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["legalProfile"]["companyName"] == VALID_BIZ["companyName"]
    assert len(d["resale"]) >= 1 and d["resale"][0]["note"]
