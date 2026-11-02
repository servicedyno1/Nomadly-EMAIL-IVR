# Iteration 201: Spenza user linking for lines, phone-only → add email (line moves), email account → add phone (phone sign-in)
import os
import random
import time
import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

FE_ENV = dotenv_values('/app/frontend/.env')
BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or FE_ENV['REACT_APP_BACKEND_URL']).rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
BE_ENV = dotenv_values('/app/backend/.env')
DB = MongoClient(BE_ENV['MONGO_URL'])[BE_ENV['DB_NAME']]
ALICE = ('civr.alice@example.com', 'AliceTest#2026', 5000000000000001)
CREATED_LINES = []


def new_phone():
    return "+1555" + "".join(random.choice("0123456789") for _ in range(7))


@pytest.fixture(autouse=True)
def _ip_reset():
    DB.webLoginAttempts.delete_many({"_id": {"$regex": r"^(phone-send|email-link|login)"}})
    yield


def login_alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ALICE[0], "password": ALICE[1]})
    assert r.status_code == 200, r.text
    return s


def wait_active(line_id, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        d = DB.esimLines.find_one({"_id": line_id})
        if d and d.get("status") == "active" and (d.get("spenzaUser") or {}).get("linkedAt"):
            return d
        time.sleep(3)
    return DB.esimLines.find_one({"_id": line_id})


def phone_signup(name="TEST_iter201"):
    s = requests.Session()
    phone = new_phone()
    r = s.post(f"{API}/auth/phone/start", json={"phone": phone, "channel": "sms"})
    assert r.status_code == 200, r.text
    d = r.json()
    v = s.post(f"{API}/auth/phone/verify", json={"challenge": d["challenge"], "code": d["previewCode"], "name": name})
    assert v.status_code == 200, v.text
    return s, phone, v.json()["account"]


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    for lid in CREATED_LINES:
        DB.esimLines.update_one({"_id": lid}, {"$set": {"status": "cancelled"}})


# --- Spenza user linking on an email account (Alice) ---
def test_alice_mobile_line_gets_spenza_user():
    s = login_alice()
    r = s.post(f"{API}/mobile-numbers", json={"zipcode": "10011"})
    assert r.status_code in (200, 201), r.text
    lid = r.json()["item"]["id"]
    CREATED_LINES.append(lid)
    d = wait_active(lid)
    assert d["status"] == "active", d
    su = d.get("spenzaUser") or {}
    assert su.get("email") == ALICE[0] and su.get("private") is False and su.get("linkedAt"), su
    acc = DB.webAccounts.find_one({"_id": ALICE[2]})
    assert acc["spenzaUser"]["email"] == ALICE[0] and acc["spenzaUser"]["private"] is False


# --- phone-only account: private Spenza email, then add email → line moves ---
def test_phone_only_private_then_add_email():
    s, phone, acc = phone_signup()
    cid = acc["id"]
    DB.walletOf.update_one({"_id": str(cid)}, {"$set": {"usdIn": 200, "usdOut": 0}}, upsert=True)
    r = s.post(f"{API}/mobile-numbers", json={"zipcode": "10011"})
    assert r.status_code in (200, 201), r.text
    lid = r.json()["item"]["id"]
    CREATED_LINES.append(lid)
    d = wait_active(lid)
    su = d.get("spenzaUser") or {}
    assert su.get("private") is True and su["email"].startswith(f"u{cid}@users."), su
    email = f"test_iter201_{random.randint(10**6, 10**7)}@example.com"
    st = s.post(f"{API}/account/email/start", json={"email": email})
    assert st.status_code == 200, st.text
    j = st.json()
    assert j.get("previewCode")
    bad = s.post(f"{API}/account/email/verify", json={"challenge": j["challenge"], "code": "000000" if j["previewCode"] != "000000" else "111111"})
    assert bad.status_code == 401 and bad.json()["error"] == "wrong_code"
    v = s.post(f"{API}/account/email/verify", json={"challenge": j["challenge"], "code": j["previewCode"]})
    assert v.status_code == 200, v.text
    assert v.json()["account"]["email"] == email
    time.sleep(3)
    d = DB.esimLines.find_one({"_id": lid})
    assert d["spenzaUser"]["email"] == email and d["spenzaUser"]["private"] is False, d["spenzaUser"]
    a = DB.webAccounts.find_one({"_id": int(cid)})
    assert a["spenzaUser"]["email"] == email


def test_add_email_taken_returns_409():
    s, _, _ = phone_signup()
    r = s.post(f"{API}/account/email/start", json={"email": ALICE[0]})
    assert r.status_code == 409 and r.json()["error"] == "email_taken"


# --- email account → add phone, then phone sign-in reaches same account ---
def test_alice_add_phone_then_phone_signin():
    s = login_alice()
    phone = new_phone()
    st = s.post(f"{API}/account/phone/start", json={"phone": phone})
    assert st.status_code == 200, st.text
    j = st.json()
    # code from /account/phone/start can't be used on /auth/phone/verify
    x = requests.post(f"{API}/auth/phone/verify", json={"challenge": j["challenge"], "code": j["previewCode"]})
    assert x.status_code == 400 and x.json()["error"] == "code_expired", x.text
    v = s.post(f"{API}/account/phone/verify", json={"challenge": j["challenge"], "code": j["previewCode"]})
    assert v.status_code == 200, v.text
    assert v.json()["account"]["phone"] == phone
    p = requests.Session()
    a = p.post(f"{API}/auth/phone/start", json={"phone": phone}).json()
    lv = p.post(f"{API}/auth/phone/verify", json={"challenge": a["challenge"], "code": a["previewCode"]})
    assert lv.status_code == 200, lv.text
    assert str(lv.json()["account"]["id"]) == str(ALICE[2])
    assert lv.json()["account"]["email"] == ALICE[0]
    assert DB.webAccounts.count_documents({"phone": phone}) == 1
    login_alice()  # email/password still works


def test_phone_taken_by_other_account_409():
    _, other_phone, _ = phone_signup()
    s = login_alice()
    r = s.post(f"{API}/account/phone/start", json={"phone": other_phone})
    assert r.status_code == 409 and r.json()["error"] == "phone_taken"


def test_account_endpoints_require_auth():
    for path in ("/account/phone/start", "/account/phone/verify", "/account/email/start", "/account/email/verify"):
        r = requests.post(f"{API}{path}", json={})
        assert r.status_code == 401, (path, r.status_code)


def test_add_phone_invalid():
    s = login_alice()
    r = s.post(f"{API}/account/phone/start", json={"phone": "abc"})
    assert r.status_code == 400 and r.json()["error"] == "invalid_phone"
