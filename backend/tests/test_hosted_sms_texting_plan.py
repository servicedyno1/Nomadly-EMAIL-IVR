# Landline to Texting redesign — Texting plan ($150 + $100/mo, 50 inbound), call-only code, LOA e-sign, bill upload / help handoff, admin submit. DRY-RUN.
import os, random, pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026', '5000000000000001')
BOB = ('civr.bob@example.com', 'BobTest#2026', '5000000000000002')
ADMIN = ('moxxcompany@gmail.com', 'Katiekendra123@')
PLAN = '+13346972125'
BOB_TP = '+13125558801'
PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f8d6e60000000049454e44ae426082')
HOLDER = {"name": "TEST Holder", "address": "1 Test St", "city": "Austin", "state": "TX", "zip": "73301", "carrier": "AT&T"}
db = MongoClient('mongodb://localhost:27017')['test']
PRE = {d['_id'] for d in db.hostedSms.find({}, {"_id": 1})}


def bal(cid):
    w = db.walletOf.find_one({"_id": cid}) or {}
    return round(w.get('usdIn', 0) - w.get('usdOut', 0), 2)


def rnd():
    return f"+1312555{random.randint(1000, 9999)}"


def login(acc):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": acc[0], "password": acc[1]})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    tok = r.json().get('token')
    if tok:
        s.headers['Authorization'] = f"Bearer {tok}"
    return s


@pytest.fixture(scope='module', autouse=True)
def restore():
    w = {c: db.walletOf.find_one({"_id": c}) for c in (ALICE[2], BOB[2])}
    db.walletOf.update_one({"_id": ALICE[2]}, {"$inc": {"usdIn": 1000}})
    db.walletOf.update_one({"_id": BOB[2]}, {"$inc": {"usdIn": 1000}})
    yield
    db.hostedSms.delete_many({"_id": {"$nin": list(PRE)}})
    for c, x in w.items():
        db.walletOf.update_one({"_id": c}, {"$set": {"usdIn": x['usdIn'], "usdOut": x['usdOut']}})


@pytest.fixture(scope='module')
def alice():
    return login(ALICE)


@pytest.fixture(scope='module')
def bob():
    return login(BOB)


def new_order(s, plan_number):
    r = s.post(f"{API}/hosted-sms", json={"phone": rnd(), "planNumber": plan_number})
    assert r.status_code == 200, r.text
    return r.json()['item']


# --- GET config
def test_get_config(bob, alice):
    d = bob.get(f"{API}/hosted-sms").json()
    assert d['texting'] == {"setup": 150, "monthly": 100, "inbound": 50, "extra": 150}
    assert d['planPrices'] == {"starter": 150, "pro": 120, "business": 100}
    assert 'noBillFee' not in d
    tp = [p for p in d['plans'] if p['plan'] == 'texting']
    assert any(p['phoneNumber'] == BOB_TP and p['status'] == 'active' and p['price'] == 150 for p in tp)
    a = alice.get(f"{API}/hosted-sms").json()
    assert any(p['phoneNumber'] == PLAN and p['plan'] == 'business' and p['price'] == 100 for p in a['plans'])


# --- new Texting plan (Bob, no CloudIVR plan) + inactive texting plan as parent
def test_new_texting_plan_and_inactive_parent(bob):
    b0 = bal(BOB[2])
    it = new_order(bob, 'new')
    assert it['paid'] == 150 and it['plan'] == 'texting' and it['planNumber'] is None
    assert it['status'] == 'verify' and it['monthly'] == 100 and it['inboundIncluded'] == 50
    assert bal(BOB[2]) == round(b0 - 150, 2)
    r = bob.post(f"{API}/hosted-sms", json={"phone": rnd(), "planNumber": it['phoneNumber']})
    assert r.status_code == 400 and r.json()['error'] == 'plan_inactive', r.text
    assert bal(BOB[2]) == round(b0 - 150, 2)
    r = bob.post(f"{API}/hosted-sms/{it['id']}/cancel")
    assert r.status_code == 200 and r.json()['item']['status'] == 'cancelled'
    assert bal(BOB[2]) == b0


def test_extra_on_active_texting_plan(bob):
    b0 = bal(BOB[2])
    it = new_order(bob, BOB_TP)
    assert it['paid'] == 150 and it['planNumber'] == BOB_TP and it['plan'] == 'texting' and it['monthly'] == 0
    p = [x for x in bob.get(f"{API}/hosted-sms").json()['plans'] if x['phoneNumber'] == BOB_TP][0]
    assert p['used'] >= 2
    bob.post(f"{API}/hosted-sms/{it['id']}/cancel")
    assert bal(BOB[2]) == b0


def test_business_price_and_402(alice):
    b0 = bal(ALICE[2])
    it = new_order(alice, PLAN)
    assert it['paid'] == 100 and it['plan'] == 'business'
    alice.post(f"{API}/hosted-sms/{it['id']}/cancel")
    assert bal(ALICE[2]) == b0
    w = db.walletOf.find_one({"_id": ALICE[2]})
    db.walletOf.update_one({"_id": ALICE[2]}, {"$set": {"usdOut": w['usdIn'] - 5}})
    try:
        r = alice.post(f"{API}/hosted-sms", json={"phone": rnd(), "planNumber": PLAN})
        assert r.status_code == 402 and r.json()['error'] == 'insufficient_balance', r.text
    finally:
        db.walletOf.update_one({"_id": ALICE[2]}, {"$set": {"usdOut": w['usdOut']}})


# --- code path
def test_code_send_call_and_verify(bob):
    it = new_order(bob, 'new')
    r = bob.post(f"{API}/hosted-sms/{it['id']}/code/send", json={"method": "sms"})
    assert r.status_code == 200 and r.json()['method'] == 'call' and '123456' in r.json().get('preview', '')
    r = bob.post(f"{API}/hosted-sms/{it['id']}/code", json={"code": "000000"})
    assert r.status_code == 400
    r = bob.post(f"{API}/hosted-sms/{it['id']}/code", json={"code": "123456"})
    assert r.status_code == 200 and r.json()['item']['status'] == 'review' and r.json()['item']['mode'] == 'code'
    assert db.hostedSms.find_one({"_id": it['id']})['status'] == 'review'
    r = bob.post(f"{API}/hosted-sms/{it['id']}/cancel")
    assert r.status_code == 400  # in review -> not cancellable
    db.hostedSms.delete_one({"_id": it['id']})


# --- no-code path: skip -> LOA -> help -> upload; refunds at each stage
def test_skip_loa_help_documents(bob):
    b0 = bal(BOB[2])
    it = new_order(bob, 'new'); hid = it['id']
    assert bob.post(f"{API}/hosted-sms/{hid}/help").status_code == 400  # before skip
    r = bob.post(f"{API}/hosted-sms/{hid}/code/skip")
    assert r.status_code == 200 and r.json()['item']['status'] == 'loa' and r.json()['item']['mode'] == 'nocode'
    assert bob.post(f"{API}/hosted-sms/{hid}/help").status_code == 400  # before LOA signed
    r = bob.post(f"{API}/hosted-sms/{hid}/loa", json={"holder": HOLDER, "signature": "Someone Else", "consent": True})
    assert r.status_code == 400
    r = bob.post(f"{API}/hosted-sms/{hid}/loa", json={"holder": HOLDER, "signature": HOLDER['name']})
    assert r.status_code == 400
    r = bob.post(f"{API}/hosted-sms/{hid}/loa", json={"holder": HOLDER, "signature": "test holder", "consent": True})
    assert r.status_code == 200 and r.json()['item']['status'] == 'documents' and r.json()['item']['holder']['name'] == 'TEST Holder'
    b1 = bal(BOB[2])
    r = bob.post(f"{API}/hosted-sms/{hid}/help")
    assert r.status_code == 200 and r.json()['item']['status'] == 'admin_docs' and r.json()['item']['noBill'] is True
    assert bal(BOB[2]) == b1 == round(b0 - 150, 2)
    r = bob.post(f"{API}/hosted-sms/{hid}/documents", files=[("files", ("b.pdf", PDF, "application/pdf")), ("files", ("p.png", PNG, "image/png"))])
    assert r.status_code == 200 and r.json()['item']['status'] == 'review', r.text
    db.hostedSms.delete_one({"_id": hid})


def test_documents_bad_file(bob):
    it = new_order(bob, 'new'); hid = it['id']
    bob.post(f"{API}/hosted-sms/{hid}/code/skip")
    bob.post(f"{API}/hosted-sms/{hid}/loa", json={"holder": HOLDER, "signature": HOLDER['name'], "consent": True})
    r = bob.post(f"{API}/hosted-sms/{hid}/documents", files={"files": ("x.txt", b"hello", "text/plain")})
    assert r.status_code == 400
    b0 = bal(BOB[2])
    r = bob.post(f"{API}/hosted-sms/{hid}/cancel")
    assert r.status_code == 200 and bal(BOB[2]) == round(b0 + 150, 2)


@pytest.mark.parametrize('stage', ['loa', 'admin_docs'])
def test_cancel_refund_stages(alice, stage):
    b0 = bal(ALICE[2])
    it = new_order(alice, PLAN); hid = it['id']
    alice.post(f"{API}/hosted-sms/{hid}/code/skip")
    if stage == 'admin_docs':
        alice.post(f"{API}/hosted-sms/{hid}/loa", json={"holder": HOLDER, "signature": HOLDER['name'], "consent": True})
        assert alice.post(f"{API}/hosted-sms/{hid}/help").json()['item']['status'] == 'admin_docs'
    r = alice.post(f"{API}/hosted-sms/{hid}/cancel")
    assert r.status_code == 200 and r.json()['item']['status'] == 'cancelled'
    assert bal(ALICE[2]) == b0


# --- admin upload for admin_docs order
def test_admin_upload(alice):
    it = new_order(alice, PLAN); hid = it['id']
    alice.post(f"{API}/hosted-sms/{hid}/code/skip")
    alice.post(f"{API}/hosted-sms/{hid}/loa", json={"holder": HOLDER, "signature": HOLDER['name'], "consent": True})
    alice.post(f"{API}/hosted-sms/{hid}/help")
    s = requests.Session()
    r = s.post(f"{API}/admin/login", json={"email": ADMIN[0], "password": ADMIN[1]})
    if r.status_code != 200:
        pytest.skip(f"admin login {r.status_code} {r.text[:200]}")
    j = r.json()
    r = s.post(f"{API}/admin/verify", json={"challenge": j['challenge'], "code": j.get('devCode')})
    assert r.status_code == 200, r.text
    r = s.get(f"{API}/admin/hosted", params={"status": "admin_docs"})
    assert r.status_code == 200, r.text
    assert any(x['id'] == hid for x in r.json()['items'])
    r = s.post(f"{API}/admin/hosted/{hid}/documents", files={"files": ("b.pdf", PDF, "application/pdf")})
    assert r.status_code == 200 and r.json()['item']['status'] == 'review', r.text
    db.hostedSms.delete_one({"_id": hid})
