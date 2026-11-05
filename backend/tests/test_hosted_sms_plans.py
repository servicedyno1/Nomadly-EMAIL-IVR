# Landline to Texting — STANDALONE Texting plan ($200 once incl. first month, then $50/mo), incoming-only + free. DRY-RUN preview.
import os, time, random, json, subprocess, threading, pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026', '5000000000000001')
BOB = ('civr.bob@example.com', 'BobTest#2026', '5000000000000002')
PLAN = '+13346972125'           # Alice's Business plan number (must be ignored now)
BOB_TEXTING = '+13125558801'    # Bob's active Texting-plan number
BILL = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"
HOLDER = {"name": "TEST Holder", "business": "TEST Biz", "address": "1 Test St", "city": "Austin", "state": "TX", "zip": "73301", "carrier": "AT&T", "account": "999"}
db = MongoClient('mongodb://localhost:27017')['test']
KEEP = [d['_id'] for d in db.hostedSms.find({"phoneNumber": {"$regex": "^\\+131255"}}, {"_id": 1})]


def login(acc):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": acc[0], "password": acc[1]})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return s


def bal(cid):
    w = db.walletOf.find_one({"_id": cid}) or {}
    return round(w.get('usdIn', 0) - w.get('usdOut', 0), 2)


def rnd():
    return f"+1312555{random.randint(1000, 9999)}"


@pytest.fixture(scope='module', autouse=True)
def restore():
    w = {c: db.walletOf.find_one({"_id": c}) for c in (ALICE[2], BOB[2])}
    db.walletOf.update_one({"_id": ALICE[2]}, {"$inc": {"usdIn": 2000}})
    yield
    db.hostedSms.delete_many({"phoneNumber": {"$regex": "^\\+131255"}, "_id": {"$nin": KEEP}})
    db.phoneLogs.delete_many({"body": {"$regex": "^TEST_"}})
    for c, x in w.items():
        db.walletOf.update_one({"_id": c}, {"$set": {"usdIn": x['usdIn'], "usdOut": x['usdOut']}})


@pytest.fixture(scope='module')
def alice():
    return login(ALICE)


@pytest.fixture(scope='module')
def bob():
    return login(BOB)


# --- catalog / GET prices
def test_public_catalog_texting():
    r = requests.get(f"{API}/public/catalog")
    assert r.status_code == 200 and r.json()['texting'] == {"setup": 200, "monthly": 50}


def test_get_hosted_texting(alice):
    d = alice.get(f"{API}/hosted-sms").json()
    assert d['texting'] == {"setup": 200, "monthly": 50}


# --- start: planNumber ignored, always standalone Texting plan
@pytest.mark.parametrize('body_extra', [{}, {"planNumber": PLAN}, {"planNumber": "new"}])
def test_start_is_standalone(alice, body_extra):
    b0 = bal(ALICE[2])
    r = alice.post(f"{API}/hosted-sms", json={"phone": rnd(), **body_extra})
    assert r.status_code == 200, r.text
    it = r.json()['item']
    assert it['paid'] == 200 and it['plan'] == 'texting' and it['planNumber'] is None and it['status'] == 'verify' and it['monthly'] == 50
    assert bal(ALICE[2]) == round(b0 - 200, 2)
    tx = db.transactions.find_one({"metadata.hostedId": it['id'], "type": "hosted-sms-setup"})
    assert tx and tx['amount'] == 200
    listed = [x for x in alice.get(f"{API}/hosted-sms").json()['items'] if x['id'] == it['id']][0]
    assert listed['plan'] == 'texting' and listed['planNumber'] is None
    r = alice.post(f"{API}/hosted-sms/{it['id']}/cancel")
    assert r.status_code == 200 and r.json()['item']['status'] == 'cancelled'
    assert bal(ALICE[2]) == b0


def test_insufficient_balance_402(bob):
    b0 = bal(BOB[2])
    assert b0 < 200, f"Bob balance {b0} >= 200; test needs < $200"
    r = bob.post(f"{API}/hosted-sms", json={"phone": rnd()})
    assert r.status_code == 402 and r.json()['error'] == 'insufficient_balance' and '$200' in r.json()['message'], r.text
    assert bal(BOB[2]) == b0


def test_double_click_single_debit(alice):
    b0 = bal(ALICE[2]); phone = rnd(); res = []
    ts = [threading.Thread(target=lambda: res.append(alice.post(f"{API}/hosted-sms", json={"phone": phone}))) for _ in range(3)]
    [t.start() for t in ts]; [t.join() for t in ts]
    ok = [r for r in res if r.status_code == 200]
    assert len(ok) == 1, [r.text for r in res]
    assert bal(ALICE[2]) == round(b0 - 200, 2)
    alice.post(f"{API}/hosted-sms/{ok[0].json()['item']['id']}/cancel")
    assert bal(ALICE[2]) == b0


# --- post-payment flows
def test_code_flow_to_review(alice):
    hid = alice.post(f"{API}/hosted-sms", json={"phone": rnd()}).json()['item']['id']
    r = alice.post(f"{API}/hosted-sms/{hid}/code/send")
    assert r.status_code == 200 and r.json()['method'] == 'call'
    assert alice.post(f"{API}/hosted-sms/{hid}/code", json={"code": "000000"}).status_code == 400
    r = alice.post(f"{API}/hosted-sms/{hid}/code", json={"code": "123456"})
    assert r.status_code == 200 and r.json()['item']['status'] == 'review' and r.json()['item']['mode'] == 'code'


def test_skip_loa_docs_to_review(alice):
    hid = alice.post(f"{API}/hosted-sms", json={"phone": rnd()}).json()['item']['id']
    assert alice.post(f"{API}/hosted-sms/{hid}/code/skip").json()['item']['status'] == 'loa'
    r = alice.post(f"{API}/hosted-sms/{hid}/loa", json={"holder": HOLDER, "signature": "Wrong Name", "consent": True})
    assert r.status_code == 400
    r = alice.post(f"{API}/hosted-sms/{hid}/loa", json={"holder": HOLDER, "signature": HOLDER['name'], "consent": True})
    assert r.status_code == 200 and r.json()['item']['status'] == 'documents'
    r = alice.post(f"{API}/hosted-sms/{hid}/documents", files={"files": ("b.pdf", BILL, "application/pdf")})
    assert r.status_code == 200 and r.json()['item']['status'] == 'review', r.text


def test_skip_help_admin_docs_free(alice):
    hid = alice.post(f"{API}/hosted-sms", json={"phone": rnd()}).json()['item']['id']
    alice.post(f"{API}/hosted-sms/{hid}/code/skip")
    alice.post(f"{API}/hosted-sms/{hid}/loa", json={"holder": HOLDER, "signature": HOLDER['name'], "consent": True})
    b0 = bal(ALICE[2])
    r = alice.post(f"{API}/hosted-sms/{hid}/help")
    assert r.status_code == 200 and r.json()['item']['status'] == 'admin_docs' and r.json()['item']['noBill'] is True
    assert bal(ALICE[2]) == b0


# --- receive-only
def test_send_receive_only(bob):
    hid = db.hostedSms.find_one({"phoneNumber": BOB_TEXTING, "plan": "texting", "status": "active"})['_id']
    r = bob.post(f"{API}/hosted-sms/{hid}/send", json={"to": "+14165550177", "text": "TEST_x"})
    assert r.status_code == 400 and 'receives texts only' in r.json()['message']
    pytest.receive_only_code = r.json()['error']


def test_send_receive_only_error_code():
    assert getattr(pytest, 'receive_only_code', None) == 'receive_only', f"error code returned: {getattr(pytest, 'receive_only_code', None)}"


def test_inbound_free():
    b0 = bal(BOB[2])
    body = f"TEST_inbound_{random.randint(1000, 9999)}"
    js = f"""require('dotenv').config({{path:'/app/backend/.env'}});const {{MongoClient}}=require('mongodb');
(async()=>{{const c=await MongoClient.connect(process.env.MONGO_URL);const db=c.db(process.env.DB_NAME);
const HS=require('/app/js/hosted-sms.js').init({{db,log:()=>{{}},tell:async()=>null}});
const r=await HS.onInbound({{from:'+14165550199',to:'{BOB_TEXTING}',body:'{body}'}});console.log(JSON.stringify(r));process.exit(0)}})()"""
    out = subprocess.run(['node', '-e', js], capture_output=True, text=True, cwd='/app', timeout=60)
    assert 'true' in out.stdout, out.stdout + out.stderr
    log = db.phoneLogs.find_one({"body": body})
    assert log and log['charge'] == 0 and log['direction'] == 'inbound'
    assert bal(BOB[2]) == b0
    assert not db.transactions.find_one({"type": "hosted-sms-inbound", "metadata.from": "+14165550199", "metadata.phoneNumber": BOB_TEXTING, "createdAt": {"$gte": log['timestamp'].replace(microsecond=0)}})


# --- iter182: legacy add-on number (Alice +13125557703, planNumber set) is also receive-only
def test_send_receive_only_legacy_addon(alice):
    d = db.hostedSms.find_one({"phoneNumber": "+13125557703"})
    if not d:
        pytest.skip("legacy record missing")
    w0 = bal(ALICE[2])
    r = alice.post(f"{API}/hosted-sms/{d['_id']}/send", json={"to": "+14165550177", "text": "TEST_legacy"})
    assert r.status_code == 400 and r.json()['error'] == 'receive_only'
    assert 'receives texts only' in r.json()['message']
    assert not db.phoneLogs.find_one({"body": "TEST_legacy"})
    assert bal(ALICE[2]) == w0


# --- iter182: Inbox items from hosted numbers never offer Reply
def test_notifications_hosted_cannot_reply(alice):
    from datetime import datetime
    col = db.webNotifications
    ids = col.insert_many([
        {"chatId": ALICE[2], "text": "TEST_hosted_legacy", "kind": "sms", "mediaUrl": None, "meta": {"from": "+14165550111", "to": "+13125557703", "hosted": "hs_166f867fcda2"}, "read": True, "createdAt": datetime.utcnow()},
        {"chatId": ALICE[2], "text": "TEST_hosted_ro", "kind": "sms", "mediaUrl": None, "meta": {"from": "+14165550112", "to": "+13125557703", "hosted": "hs_166f867fcda2", "receiveOnly": True}, "read": True, "createdAt": datetime.utcnow()},
    ]).inserted_ids
    try:
        r = alice.get(f"{API}/notifications")
        assert r.status_code == 200
        mine = [n for n in r.json()['notifications'] if n['text'].startswith('TEST_hosted')]
        assert len(mine) == 2
        assert all(n['canReply'] is False for n in mine), mine
    finally:
        col.delete_many({"_id": {"$in": ids}})
