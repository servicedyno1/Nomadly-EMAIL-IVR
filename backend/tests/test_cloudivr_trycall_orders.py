# CloudIVR web: free test call (OTP, limits, dry-run phases) + number checkout/crypto orders/substitution
import os, time, uuid, random
import pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
mdb = MongoClient(os.environ.get('MONGO_URL', 'mongodb://localhost:27017'))[os.environ.get('DB_NAME', 'test')]

def rnd(): return uuid.uuid4().hex[:10]
def email(): return f"qa.{rnd()}@example.com"
def fresh_to(): return f"+1415555{random.randint(1000, 9999)}"
def hdr(ip=None, dev=None):
    # XFF no longer isolates the network limit (server picks the real client hop); only the device header is per-scenario
    h = {"X-Civr-Device": dev or f"dev-{rnd()}"}
    if ip: h["X-Forwarded-For"] = ip
    return h

def clear_try():
    mdb.webTryCalls.delete_many({"email": {"$regex": r"^qa\."}})
    mdb.webTryCodes.delete_many({"email": {"$regex": r"^qa\."}})

def token_for(em, h):
    r = requests.post(f"{API}/public/try/send-code", json={"email": em}, headers=h)
    assert r.status_code == 200, r.text
    code = r.json()["previewCode"]
    v = requests.post(f"{API}/public/try/verify", json={"email": em, "code": code}, headers=h)
    assert v.status_code == 200, v.text
    return v.json()["token"]

def login(em, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": em, "password": pw})
    if r.status_code != 200: pytest.skip(f"login failed {r.text}")
    return s

def chat_id(em): return str(int(mdb.webAccounts.find_one({"email": em})["_id"]))

@pytest.fixture(scope="module")
def bob(): return login("civr.bob@example.com", "BobTest#2026")
@pytest.fixture(scope="module")
def alice(): return login("civr.alice@example.com", "AliceTest#2026")

@pytest.fixture(autouse=True)
def cleanup():
    clear_try()  # all scenarios share the real egress IP → reset the per-network counters per test
    yield
    clear_try()

# --- catalog
def test_catalog():
    d = requests.get(f"{API}/public/catalog").json()
    assert d["plans"] and d["countries"] and d["coins"] and d["minTopup"]
    assert all("verification" not in c for c in d["countries"])

# --- OTP
def test_send_code_invalid_and_rate():
    h = hdr()
    assert requests.post(f"{API}/public/try/send-code", json={"email": "nope"}, headers=h).json()["error"] == "invalid_email"
    em = email()
    for _ in range(3):
        r = requests.post(f"{API}/public/try/send-code", json={"email": em}, headers=hdr())
        assert r.status_code == 200 and r.json()["sent"] and len(r.json()["previewCode"]) == 6
    r = requests.post(f"{API}/public/try/send-code", json={"email": em}, headers=hdr())
    assert r.status_code == 429 and r.json()["error"] == "too_many_codes"

def test_verify_wrong_then_expired():
    h, em = hdr(), email()
    code = requests.post(f"{API}/public/try/send-code", json={"email": em}, headers=h).json()["previewCode"]
    bad = "000000" if code != "000000" else "111111"
    for _ in range(5):
        r = requests.post(f"{API}/public/try/verify", json={"email": em, "code": bad}, headers=h)
        assert r.status_code == 400 and r.json()["error"] == "wrong_code"
    r = requests.post(f"{API}/public/try/verify", json={"email": em, "code": code}, headers=h)
    assert r.status_code == 400 and r.json()["error"] == "code_expired"

# --- call-me + phases + limits
def test_call_me_phases_and_reuse():
    h, em, to = hdr(), email(), fresh_to()
    tok = token_for(em, h)
    r = requests.post(f"{API}/public/try/call-me", json={"token": tok, "to": to}, headers=h)
    assert r.status_code == 201, r.text
    d = r.json(); assert d["kind"] == "call_me" and d["dryRun"] is True
    s = requests.get(f"{API}/public/try/calls/{d['id']}").json(); assert s["phase"] == "ringing"
    time.sleep(12)
    s = requests.get(f"{API}/public/try/calls/{d['id']}").json(); assert s["phase"] == "connected" and s["digits"] == ["1"]
    time.sleep(13)
    s = requests.get(f"{API}/public/try/calls/{d['id']}").json(); assert s["phase"] == "ended"
    # same email again
    r = requests.post(f"{API}/public/try/call-me", json={"token": tok, "to": fresh_to()}, headers=hdr())
    assert r.status_code == 409 and r.json()["error"] == "already_used"
    r = requests.post(f"{API}/public/try/send-code", json={"email": em}, headers=hdr())
    assert r.status_code == 409 and r.json()["error"] == "already_used"
    # same destination, new email
    h2 = hdr(); tok2 = token_for(email(), h2)
    r = requests.post(f"{API}/public/try/call-me", json={"token": tok2, "to": to}, headers=h2)
    assert r.status_code == 409 and r.json()["error"] == "number_used"

def test_daily_limit_device_and_ip():
    dev = f"dev-{rnd()}"
    for _ in range(3):
        h = hdr(dev=dev); tok = token_for(email(), h)
        assert requests.post(f"{API}/public/try/call-me", json={"token": tok, "to": fresh_to()}, headers=h).status_code == 201
    h = hdr(dev=dev)
    r = requests.post(f"{API}/public/try/send-code", json={"email": email()}, headers=h)
    assert r.status_code == 429 and r.json()["error"] == "daily_limit"
    clear_try()
    # network limit: spoofed, different XFF first hops + fresh devices must still count against the real IP
    for i in range(3):
        h = hdr(ip=f"10.88.{i}.{random.randint(1,254)}"); tok = token_for(email(), h)
        assert requests.post(f"{API}/public/try/call-me", json={"token": tok, "to": fresh_to()}, headers=h).status_code == 201
    ips = {d["ip"] for d in mdb.webTryCalls.find({"email": {"$regex": r"^qa\."}})}
    assert len(ips) == 1 and not list(ips)[0].startswith("10."), ips
    r = requests.post(f"{API}/public/try/send-code", json={"email": email()}, headers=hdr(ip="8.8.4.4"))
    assert r.status_code == 429 and r.json()["error"] == "daily_limit"
    tok = None

def test_invalid_number_and_token():
    h = hdr(); tok = token_for(email(), h)
    for bad in ["4155550123", "+881612345678", "abc"]:
        r = requests.post(f"{API}/public/try/call-me", json={"token": tok, "to": bad}, headers=h)
        assert r.status_code == 400 and r.json()["error"] == "invalid_number", (bad, r.text)
    for bad in ["4155550123", "14155550123"]:
        r = requests.post(f"{API}/public/try/browser", json={"token": tok, "to": bad}, headers=h)
        assert r.status_code == 400 and r.json()["error"] == "invalid_number", (bad, r.text)
    assert mdb.webTryCalls.count_documents({"email": {"$regex": r"^qa\."}}) == 0
    to = f"00141555{random.randint(10000, 99999)}"
    r = requests.post(f"{API}/public/try/call-me", json={"token": tok, "to": to}, headers=h)
    assert r.status_code == 201 and r.json()["to"] == "+" + to[2:], r.text
    for t in [None, "garbage"]:
        r = requests.post(f"{API}/public/try/call-me", json={"token": t, "to": fresh_to()}, headers=h)
        assert r.status_code == 401 and r.json()["error"] == "verify_email"

def test_browser_idempotent():
    h, em, to = hdr(), email(), fresh_to(); tok = token_for(em, h)
    r = requests.post(f"{API}/public/try/browser", json={"token": tok, "to": to}, headers=h)
    assert r.status_code == 201 and r.json()["kind"] == "browser" and r.json()["dryRun"] is True
    r2 = requests.post(f"{API}/public/try/browser", json={"token": tok, "to": to}, headers=h)
    assert r2.status_code in (200, 201) and r2.json()["id"] == r.json()["id"]
    assert mdb.webTryCalls.count_documents({"email": em}) == 1

# --- checkout
def search(s, country="US", typ="local"):
    r = s.get(f"{API}/numbers/search", params={"country": country, "type": typ}, timeout=60)
    assert r.status_code == 200, r.text
    nums = r.json()["numbers"]; assert nums
    return nums

def release(cid, phone):
    mdb.phoneNumbersOf.update_one({"_id": cid}, {"$pull": {"val.numbers": {"phoneNumber": phone}}})

@pytest.mark.parametrize("auto", [True, False])
def test_wallet_checkout_autorenew(bob, auto):
    cid = chat_id("civr.bob@example.com")
    p = search(bob)[0]["phoneNumber"]
    r = bob.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "wallet", "autoRenew": auto})
    assert r.status_code == 201, r.text
    n = r.json()["number"]; assert n["autoRenew"] is auto
    release(cid, n["phoneNumber"]); mdb.walletOf.update_one({"_id": cid}, {"$inc": {"usdOut": -50}})

def test_crypto_order_flow_and_isolation(bob, alice):
    cid = chat_id("civr.bob@example.com"); coin = requests.get(f"{API}/public/catalog").json()["coins"][0]
    p = search(bob)[0]["phoneNumber"]
    assert bob.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "crypto", "coin": "FAKE"}).json()["error"] == "invalid_coin"
    r = bob.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "crypto", "coin": coin})
    assert r.status_code == 201, r.text
    o = r.json()["order"]; assert o["status"] == "awaiting_payment" and o["address"] and o["autoRenew"] is True
    assert o["id"] in [x["id"] for x in bob.get(f"{API}/numbers/orders?open=1").json()["orders"]]
    assert alice.get(f"{API}/numbers/orders/{o['id']}").status_code == 404
    assert alice.post(f"{API}/numbers/orders/{o['id']}/simulate-payment", json={}).status_code == 400
    r = bob.post(f"{API}/numbers/orders/{o['id']}/simulate-payment", json={})
    d = r.json()["order"]; assert d["status"] == "active" and d["assignedNumber"] == p and d["substitutedFrom"] is None
    assert bob.post(f"{API}/numbers/orders/{o['id']}/cancel").status_code == 400
    release(cid, p)

def test_crypto_cancel(bob):
    p = search(bob)[0]["phoneNumber"]
    o = bob.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "crypto", "coin": "BTC"}).json()["order"]
    r = bob.post(f"{API}/numbers/orders/{o['id']}/cancel"); assert r.status_code == 200 and r.json()["order"]["status"] == "cancelled"
    assert bob.post(f"{API}/numbers/orders/{o['id']}/simulate-payment", json={}).status_code == 400

def test_underpaid_then_finish(bob):
    cid = chat_id("civr.bob@example.com")
    w = mdb.walletOf.find_one({"_id": cid}); bal = (w.get("usdIn", 0) - w.get("usdOut", 0))
    mdb.walletOf.update_one({"_id": cid}, {"$inc": {"usdOut": bal}})  # wallet → 0
    try:
        p = search(bob)[0]["phoneNumber"]
        o = bob.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "crypto", "coin": "BTC"}).json()["order"]
        d = bob.post(f"{API}/numbers/orders/{o['id']}/simulate-payment", json={"amountUsd": 20}).json()["order"]
        assert d["status"] == "underpaid" and d["paidUsd"] == 20, d
        r = bob.post(f"{API}/numbers/orders/{o['id']}/finish"); assert r.status_code == 402
        mdb.walletOf.update_one({"_id": cid}, {"$inc": {"usdIn": 40}})
        r = bob.post(f"{API}/numbers/orders/{o['id']}/finish"); assert r.status_code == 200, r.text
        assert r.json()["order"]["status"] == "active" and r.json()["order"]["assignedNumber"] == p
        release(cid, p)
    finally:
        w = mdb.walletOf.find_one({"_id": cid}); cur = w.get("usdIn", 0) - w.get("usdOut", 0)
        mdb.walletOf.update_one({"_id": cid}, {"$inc": {"usdIn": bal - cur}})

def test_substitution(bob):
    cid = chat_id("civr.bob@example.com")
    p = search(bob)[0]["phoneNumber"]
    o = bob.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "crypto", "coin": "BTC"}).json()["order"]
    mdb.phoneNumbersOf.insert_one({"_id": "TEST_other_" + rnd(), "val": {"numbers": [{"phoneNumber": p, "status": "active"}]}})
    try:
        d = bob.post(f"{API}/numbers/orders/{o['id']}/simulate-payment", json={}).json()["order"]
        print(d)
        assert d["status"] == "active" and d["assignedNumber"] and d["assignedNumber"] != p and d["substitutedFrom"] == p
        assert p in d["message"] and d["assignedNumber"] in d["message"]
        release(cid, d["assignedNumber"])
    finally:
        mdb.phoneNumbersOf.delete_many({"_id": {"$regex": "^TEST_other_"}})

# --- orders list route (was shadowed by /numbers/:phone)
def test_orders_list_routes(bob):
    for q in ["", "?open=1"]:
        r = bob.get(f"{API}/numbers/orders{q}")
        assert r.status_code == 200 and isinstance(r.json()["orders"], list), r.text

# --- no double-buy: bought number hidden from search, re-buy → 409
def test_no_double_buy(bob, alice):
    bid, aid = chat_id("civr.bob@example.com"), chat_id("civr.alice@example.com")
    a_nums = search(alice)
    p = search(bob)[0]["phoneNumber"]
    r = bob.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "wallet"})
    assert r.status_code == 201, r.text
    try:
        assert p not in [n["phoneNumber"] for n in search(bob)]
        assert p not in [n["phoneNumber"] for n in search(alice)]
        # self: re-inject into Bob's search cache → already_yours
        coll = "webSearchCache"
        hit = {"phoneNumber": p, "region": "", "capabilities": {"voice": True, "sms": False, "fax": False}, "surcharge": 0, "cost": {"monthly": 1, "upfront": 1}}
        mdb[coll].update_one({"_id": bid}, {"$push": {"results": hit}})
        r = bob.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "wallet"})
        assert r.status_code == 409 and r.json()["error"] == "already_yours", r.text
        mdb[coll].update_one({"_id": aid}, {"$push": {"results": hit}})
        r = alice.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "wallet"})
        assert r.status_code == 409 and r.json()["error"] == "number_taken", r.text
    finally:
        release(bid, p); mdb.walletOf.update_one({"_id": bid}, {"$inc": {"usdOut": -50}})

def test_substitution_cheaper(bob):
    cid = chat_id("civr.bob@example.com")
    p = search(bob)[0]["phoneNumber"]
    o = bob.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "crypto", "coin": "BTC"}).json()["order"]
    # make the picked number dearer (+$7 surcharge) so the substitute is cheaper
    mdb.webNumberOrders.update_one({"_id": o["id"]}, {"$set": {"hit.surcharge": 7}, "$inc": {"price": 7}})
    mdb.phoneNumbersOf.insert_one({"_id": "TEST_other_" + rnd(), "val": {"numbers": [{"phoneNumber": p, "status": "active"}]}})
    try:
        d = bob.post(f"{API}/numbers/orders/{o['id']}/simulate-payment", json={}).json()["order"]
        print(d)
        assert d["status"] == "active" and d["assignedNumber"] != p and d["substitutedFrom"] == p
        assert "difference stays in your wallet" in d["message"], d["message"]
        release(cid, d["assignedNumber"])
    finally:
        mdb.phoneNumbersOf.delete_many({"_id": {"$regex": "^TEST_other_"}})
