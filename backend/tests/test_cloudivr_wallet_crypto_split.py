# CloudIVR web: "wallet + crypto for the rest" split checkout (new number, extra number, plan upgrade) and the
# short-payment rule (crypto arrives short -> order failed, nothing bought, everything stays in the wallet).
import os, pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"

def _env(k):
    for line in open('/app/backend/.env'):
        if line.startswith(k + '='):
            return line.split('=', 1)[1].strip().strip('"')
mdb = MongoClient(_env('MONGO_URL'))[_env('DB_NAME')]

UX = ("civr.uxtest@example.com", "UxTest#2026", "5000000000000077")
BOB = ("civr.bob@example.com", "BobTest#2026", None)

def login(em, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": em, "password": pw})
    if r.status_code != 200: pytest.skip(f"login failed {r.text}")
    return s

def bal(cid):
    w = mdb.walletOf.find_one({"_id": cid}) or {}
    return round((w.get("usdIn") or 0) - (w.get("usdOut") or 0), 2)

def set_bal(cid, amt):
    w = mdb.walletOf.find_one({"_id": cid}) or {}
    mdb.walletOf.update_one({"_id": cid}, {"$set": {"usdIn": (w.get("usdOut") or 0) + amt}})

def numbers_of(cid):
    d = mdb.phoneNumbersOf.find_one({"_id": cid}) or {}
    return [n["phoneNumber"] for n in (d.get("val") or {}).get("numbers", [])]

def release(cid, phone):
    mdb.phoneNumbersOf.update_one({"_id": cid}, {"$pull": {"val.numbers": {"phoneNumber": phone}}})

@pytest.fixture(scope="module")
def catalog(): return requests.get(f"{API}/public/catalog").json()

@pytest.fixture(scope="module")
def ux():
    s = login(UX[0], UX[1]); cid = UX[2]
    saved = mdb.walletOf.find_one({"_id": cid}); before = numbers_of(cid)
    yield s, cid
    mdb.walletOf.update_one({"_id": cid}, {"$set": {"usdIn": saved.get("usdIn", 0), "usdOut": saved.get("usdOut", 0)}})
    for p in numbers_of(cid):
        if p not in before: release(cid, p)

STARTER_EMAIL = "test_civr_split_starter@example.com"; STARTER_PW = "SplitTest#2026"

@pytest.fixture(scope="module")
def bob():
    # a TEST_ account (Bob isn't seeded on this pod); reused between runs
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": STARTER_EMAIL, "password": STARTER_PW})
    if r.status_code == 409: s = login(STARTER_EMAIL, STARTER_PW)
    elif r.status_code != 201: pytest.skip(f"register failed {r.text}")
    cid = str(int(mdb.webAccounts.find_one({"email": STARTER_EMAIL})["_id"]))
    saved = mdb.walletOf.find_one({"_id": cid}); before = numbers_of(cid)
    yield s, cid
    mdb.walletOf.update_one({"_id": cid}, {"$set": {"usdIn": saved.get("usdIn", 0), "usdOut": saved.get("usdOut", 0)}})
    for p in numbers_of(cid):
        if p not in before: release(cid, p)

def search(s):
    r = s.get(f"{API}/numbers/search", params={"country": "US", "type": "local"}, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()["numbers"][0]["phoneNumber"]

def price_of(catalog, plan): return next(p["price"] for p in catalog["plans"] if p["id"] == plan)

# --- new number: split
def test_checkout_split_full_payment(ux, catalog):
    s, cid = ux; set_bal(cid, 10)
    price = price_of(catalog, "starter"); p = search(s)
    r = s.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "crypto", "coin": "BTC", "useWallet": True})
    assert r.status_code == 201, r.text
    o = r.json()["order"]
    assert o["walletPart"] == 10 and o["price"] == round(price - 10, 2) and o["total"] == price, o
    g = s.get(f"{API}/numbers/orders/{o['id']}").json()["order"]; assert g["walletPart"] == 10
    d = s.post(f"{API}/numbers/orders/{o['id']}/simulate-payment", json={}).json()
    assert d["order"]["status"] == "active" and d["order"]["assignedNumber"] == p, d
    assert bal(cid) == 0, bal(cid)  # 10 + (price-10) - price
    assert p in numbers_of(cid)

def test_checkout_split_short_payment_fails(ux, catalog):
    s, cid = ux; set_bal(cid, 10)
    p = search(s)
    o = s.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "crypto", "coin": "BTC", "useWallet": True}).json()["order"]
    d = s.post(f"{API}/numbers/orders/{o['id']}/simulate-payment", json={"amountUsd": 5}).json()["order"]
    assert d["status"] == "failed" and "everything is in your wallet" in d["message"], d
    assert bal(cid) == 15 and p not in numbers_of(cid)
    assert s.post(f"{API}/numbers/orders/{o['id']}/finish").status_code == 400  # no more 'underpaid → Finish'

def test_checkout_without_usewallet_full_price(ux, catalog):
    s, cid = ux; set_bal(cid, 10)
    p = search(s)
    o = s.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "crypto", "coin": "BTC"}).json()["order"]
    assert o["walletPart"] == 0 and o["price"] == price_of(catalog, "starter"), o
    s.post(f"{API}/numbers/orders/{o['id']}/cancel")

def test_checkout_split_min_topup(ux, catalog):
    # wallet $45 on a $50 plan → crypto at least the $10 minimum, extra stays in wallet
    s, cid = ux; set_bal(cid, 45)
    p = search(s)
    o = s.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "crypto", "coin": "BTC", "useWallet": True}).json()["order"]
    assert o["walletPart"] == 45 and o["price"] == 10, o
    d = s.post(f"{API}/numbers/orders/{o['id']}/simulate-payment", json={}).json()["order"]
    assert d["status"] == "active"
    assert bal(cid) == 5

# --- extra number: split
def test_extra_checkout_split(ux, catalog):
    s, cid = ux; set_bal(cid, 10)
    p = search(s)
    r = s.post(f"{API}/numbers/{requests.utils.quote('+13341112222')}/extra-checkout", json={"phoneNumber": p, "coin": "BTC", "useWallet": True})
    assert r.status_code == 201, r.text
    o = r.json()["order"]; charge = o["total"]
    assert o["walletPart"] == 10 and o["price"] == round(max(charge - 10, 10), 2), o
    d = s.post(f"{API}/numbers/orders/{o['id']}/simulate-payment", json={}).json()["order"]
    assert d["status"] == "active", d
    assert bal(cid) == round(10 + o["price"] - charge, 2)

def test_extra_checkout_split_short(ux, catalog):
    s, cid = ux; set_bal(cid, 10)
    p = search(s)
    o = s.post(f"{API}/numbers/{requests.utils.quote('+13341112222')}/extra-checkout", json={"phoneNumber": p, "coin": "BTC", "useWallet": True}).json()
    if "order" not in o: pytest.skip(f"extra not possible: {o}")
    o = o["order"]
    d = s.post(f"{API}/numbers/orders/{o['id']}/simulate-payment", json={"amountUsd": 5}).json()["order"]
    assert d["status"] == "failed" and "everything is in your wallet" in d["message"], d
    assert bal(cid) == 15 and p not in numbers_of(cid)

# --- plan upgrade: split (Bob buys a starter number first)
def test_upgrade_checkout_split(bob, catalog):
    s, cid = bob; set_bal(cid, 100)
    p = search(s)
    r = s.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "wallet"})
    assert r.status_code == 201, r.text
    set_bal(cid, 10)
    q = s.post(f"{API}/numbers/{requests.utils.quote(p)}/upgrade", json={"plan": "pro"}).json()["quote"]
    r = s.post(f"{API}/numbers/{requests.utils.quote(p)}/upgrade-checkout", json={"plan": "pro", "coin": "BTC", "useWallet": True})
    assert r.status_code == 201, r.text
    o = r.json()["order"]
    assert o["walletPart"] == 10 and o["price"] == round(max(q["charge"] - 10, 10), 2), (o, q)
    # short first (separate order)
    d = s.post(f"{API}/numbers/orders/{o['id']}/simulate-payment", json={"amountUsd": 1}).json()["order"]
    assert d["status"] == "failed" and "everything is in your wallet" in d["message"], d
    assert bal(cid) == 11
    set_bal(cid, 10)
    o = s.post(f"{API}/numbers/{requests.utils.quote(p)}/upgrade-checkout", json={"plan": "pro", "coin": "BTC", "useWallet": True}).json()["order"]
    d = s.post(f"{API}/numbers/orders/{o['id']}/simulate-payment", json={}).json()["order"]
    assert d["status"] == "active", d
    n = next(x for x in s.get(f"{API}/numbers").json()["numbers"] if x["phoneNumber"] == p)
    assert n["plan"] == "pro"
    assert bal(cid) == round(10 + o["price"] - q["charge"], 2)
