# Iteration 200: VoIP-only offer copy, no coupon on eSIM/mobile purchase, phone checkout signup, landing copy removal
import os
import random
import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

FE_ENV = dotenv_values('/app/frontend/.env')
BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or FE_ENV['REACT_APP_BACKEND_URL']).rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
BE_ENV = dotenv_values('/app/backend/.env')
DB = MongoClient(BE_ENV['MONGO_URL'])[BE_ENV['DB_NAME']]
NOTE = "VoIP numbers only, not the eSIM or USA mobile number."


def new_phone():
    return "+1555" + "".join(random.choice("0123456789") for _ in range(7))


def luhn_imei():
    base = [random.randint(0, 9) for _ in range(14)]
    s = 0
    for i, d in enumerate(base):
        if i % 2 == 1:
            d *= 2
            d = d - 9 if d > 9 else d
        s += d
    return "".join(map(str, base)) + str((10 - s % 10) % 10)


@pytest.fixture(autouse=True)
def _ip_reset():
    DB.webLoginAttempts.delete_many({"_id": {"$regex": r"^phone-send\|"}})
    yield


def phone_signup(name="TEST_iter200"):
    s = requests.Session()
    phone = new_phone()
    r = s.post(f"{API}/auth/phone/start", json={"phone": phone, "channel": "sms"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("previewCode"), d
    v = s.post(f"{API}/auth/phone/verify", json={"challenge": d["challenge"], "code": d["previewCode"], "name": name})
    assert v.status_code == 200, v.text
    return s, phone, v.json()


@pytest.fixture(scope="module")
def created():
    made = []
    yield made
    # teardown: remove every TEST_iter200 phone account and its wallet / lines / offers
    for a in DB.webAccounts.find({"name": {"$regex": "^TEST_iter200"}}, {"_id": 1}):
        cid = str(int(a["_id"])) if isinstance(a["_id"], float) else str(a["_id"])
        for c in ("walletOf",):
            DB[c].delete_many({"_id": cid})
        DB.webOffers.delete_many({"chatId": cid})
        DB.esimLines.delete_many({"chatId": cid})
        DB.transactions.delete_many({"chatId": cid})
        DB.webAccounts.delete_one({"_id": a["_id"]})


# ---- phone signup (used by landing checkout) ----
def test_phone_signup_creates_account(created):
    s, phone, body = phone_signup()
    me = s.get(f"{API}/auth/me")
    assert me.status_code == 200
    acc = me.json()["account"]
    assert acc.get("phone") == phone
    assert acc.get("name") == "TEST_iter200"
    created.append(acc.get("chatId") or acc.get("id") or acc.get("_id"))


def test_phone_wrong_code_rejected():
    s = requests.Session()
    d = s.post(f"{API}/auth/phone/start", json={"phone": new_phone()}).json()
    wrong = "000000" if d["previewCode"] != "000000" else "111111"
    r = s.post(f"{API}/auth/phone/verify", json={"challenge": d["challenge"], "code": wrong})
    assert r.status_code == 401


# ---- daily offer copy ----
def test_number_offer_present_copy():
    # new phone account has no numbers -> 'number' offer
    s, _, _ = phone_signup("TEST_iter200_offer")
    r = s.get(f"{API}/offers/current")
    assert r.status_code == 200
    o = r.json()["offer"]
    assert o["kind"] == "number", o
    assert o["title"].endswith("% off a new VoIP number")
    assert NOTE in o["text"]
    me = s.get(f"{API}/auth/me").json()["account"]
    chat = me.get("chatId") or me.get("id")
    DB.webOffers.delete_many({"chatId": str(chat)})
    DB.webAccounts.delete_many({"phone": me.get("phone")})


def test_renew_upgrade_present_copy():
    import subprocess, json
    js = ("const {present}=require('/app/js/cloudivr-web/offers.js');"
          "console.log(JSON.stringify([present({kind:'renew',discount:10,phones:['+1']}),"
          "present({kind:'upgrade',discount:10,phone:'+1',from:'starter',to:'pro'})]))")
    out = subprocess.run(["node", "-e", js], capture_output=True, text=True, cwd="/app", timeout=60)
    res = json.loads(out.stdout.strip().splitlines()[-1])
    for o in res:
        assert NOTE in o["text"], o


# ---- eSIM / mobile purchase ignores coupons ----
def _funded_phone_account(created, amount=500):
    s, phone, _ = phone_signup("TEST_iter200_buy")
    acc = s.get(f"{API}/auth/me").json()["account"]
    chat = str(acc.get("chatId") or acc.get("id"))
    created.append(chat)
    DB.walletOf.update_one({"_id": chat}, {"$set": {"usdIn": amount, "usdOut": 0}}, upsert=True)
    return s, chat


def _bal(chat):
    w = DB.walletOf.find_one({"_id": chat}) or {}
    return round((w.get("usdIn", 0) - w.get("usdOut", 0)), 4)


def test_esim_purchase_ignores_coupon(created):
    s, chat = _funded_phone_account(created)
    plans = s.get(f"{API}/esim").json().get("plans") or []
    if not plans:
        pytest.skip("no eSIM plans for sale in preview")
    p = plans[0]
    before = _bal(chat)
    r = s.post(f"{API}/esim", json={"planId": p["planId"], "imei": luhn_imei(), "email": "test_iter200@example.com", "coupon": "CIVRTEST50", "autoRenew": True})
    assert r.status_code == 200, r.text
    after = _bal(chat)
    assert round(before - after, 2) == round(float(p["price"]), 2), (before, after, p)


def test_mobile_purchase_ignores_coupon(created):
    s, chat = _funded_phone_account(created)
    offer = s.get(f"{API}/mobile-numbers").json()
    price = offer.get("price") or offer.get("monthly")
    before = _bal(chat)
    r = s.post(f"{API}/mobile-numbers", json={"zipcode": "10011", "coupon": "CIVRTEST50", "autoRenew": True})
    if r.status_code != 200 and "unavailable" in r.text:
        pytest.skip(r.text)
    assert r.status_code == 200, r.text
    after = _bal(chat)
    if price:
        assert round(before - after, 2) == round(float(price), 2), (before, after, offer)
    else:
        assert before - after > 0


# ---- landing copy ----
def test_landing_source_no_incoming_calls_line():
    import glob
    hits = []
    for f in glob.glob('/app/frontend/src/cloudivr/pages/landing/**/*.js', recursive=True):
        if "aren’t answered in CloudIVR yet" in open(f, encoding='utf-8').read():
            hits.append(f)
    assert not hits, hits
