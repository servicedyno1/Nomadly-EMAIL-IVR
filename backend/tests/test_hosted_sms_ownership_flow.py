# Landline to Texting — new ownership flow: Pay -> Code (verified = review) | Skip -> LOA (typed signature) -> Bill / Contact support (admin_docs) -> admin submit. DRY-RUN.
import os, json, random, pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026', '5000000000000001')
BOB = ('civr.bob@example.com', 'BobTest#2026', '5000000000000002')
ADMIN = ('moxxcompany@gmail.com', 'Katiekendra123@')
PLAN = '+13346972125'
REAL_ID = 'hs_855real4001'  # real Telnyx order: never touch
PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082')
HOLDER = {"name": "TEST Holder", "business": "TEST Biz", "address": "1 Test St", "city": "Austin", "state": "TX", "zip": "73301", "carrier": "AT&T", "account": "999"}
db = MongoClient('mongodb://localhost:27017')['test']
CREATED = []


def login(acc):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": acc[0], "password": acc[1]})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return s


def bal(cid):
    w = db.walletOf.find_one({"_id": cid}) or {}
    return round(w.get('usdIn', 0) - w.get('usdOut', 0), 2)


@pytest.fixture(scope='module', autouse=True)
def restore():
    w = db.walletOf.find_one({"_id": ALICE[2]})
    db.walletOf.update_one({"_id": ALICE[2]}, {"$inc": {"usdIn": 1000}})
    yield
    for hid in CREATED:
        d = db.hostedSms.find_one({"_id": hid})
        assert d.get('realOrder') is not True
    db.hostedSms.delete_many({"_id": {"$in": CREATED}})
    db.transactions.delete_many({"metadata.hostedId": {"$in": CREATED}})
    db.walletOf.update_one({"_id": ALICE[2]}, {"$set": {"usdIn": w['usdIn'], "usdOut": w['usdOut']}})


@pytest.fixture(scope='module')
def alice():
    return login(ALICE)


@pytest.fixture(scope='module')
def admin():
    s = requests.Session()
    r = s.post(f"{API}/admin/login", json={"email": ADMIN[0], "password": ADMIN[1]})
    if r.status_code != 200 or 'devCode' not in r.json():
        pytest.skip(f"admin login failed {r.status_code} {r.text[:200]}")
    r = s.post(f"{API}/admin/verify", json={"challenge": r.json()['challenge'], "code": r.json()['devCode']})
    if r.status_code != 200:
        pytest.skip(f"admin verify failed {r.status_code}")
    return s


def new(alice):
    b0 = bal(ALICE[2])
    r = alice.post(f"{API}/hosted-sms", json={"phone": f"+1312555{random.randint(1000, 9999)}", "planNumber": PLAN})
    assert r.status_code == 200, r.text
    it = r.json()['item']
    CREATED.append(it['id'])
    assert it['status'] == 'verify' and it['paid'] == 100 and it['mode'] is None
    assert bal(ALICE[2]) == round(b0 - 100, 2)
    return it['id']


def to_documents(alice, hid):
    assert alice.post(f"{API}/hosted-sms/{hid}/code/skip").json()['item']['status'] == 'loa'
    r = alice.post(f"{API}/hosted-sms/{hid}/loa", json={"holder": HOLDER, "signature": "test holder", "consent": True})
    assert r.status_code == 200, r.text
    assert r.json()['item']['status'] == 'documents' and r.json()['item']['holder']['name'] == 'TEST Holder'


# --- start ignores legacy mode; real record visible
def test_start_ignores_mode_and_real_record_listed(alice):
    r = alice.post(f"{API}/hosted-sms", json={"phone": f"+1312555{random.randint(1000, 9999)}", "planNumber": PLAN, "mode": "nocode"})
    assert r.status_code == 200, r.text
    CREATED.append(r.json()['item']['id'])
    assert r.json()['item']['status'] == 'verify'
    items = alice.get(f"{API}/hosted-sms").json()['items']
    real = [x for x in items if x['id'] == REAL_ID]
    assert real and real[0]['status'] == 'verify' and real[0]['phoneNumber'] == '+18557574001'


# --- code path: send, wrong code, right code -> review (no LOA/bill)
def test_code_path(alice):
    hid = new(alice)
    for m in ('sms', 'call'):
        r = alice.post(f"{API}/hosted-sms/{hid}/code/send", json={"method": m})
        assert r.status_code == 200 and '123456' in r.json().get('preview', ''), r.text
    r = alice.post(f"{API}/hosted-sms/{hid}/code", json={"code": "000000"})
    assert r.status_code == 400 and 'didn’t work' in r.json()['message']
    r = alice.post(f"{API}/hosted-sms/{hid}/code", json={"code": ""})
    assert r.status_code == 400
    r = alice.post(f"{API}/hosted-sms/{hid}/code", json={"code": "123 456"})
    assert r.status_code == 200 and r.json()['item']['status'] == 'review' and r.json()['item']['mode'] == 'code'
    d = db.hostedSms.find_one({"_id": hid})
    assert d['status'] == 'review' and d.get('verifiedAt') and not d.get('holder')
    # cannot cancel in review
    assert alice.post(f"{API}/hosted-sms/{hid}/cancel").status_code == 400


# --- skip -> LOA validation
def test_loa_validation(alice):
    hid = new(alice)
    # help before LOA (verify) -> 400
    assert alice.post(f"{API}/hosted-sms/{hid}/help").status_code == 400
    # LOA in verify -> 400
    assert alice.post(f"{API}/hosted-sms/{hid}/loa", json={"holder": HOLDER, "signature": "TEST Holder", "consent": True}).status_code == 400
    assert alice.post(f"{API}/hosted-sms/{hid}/code/skip").json()['item']['status'] == 'loa'
    assert alice.post(f"{API}/hosted-sms/{hid}/code/skip").status_code == 400
    # help in loa -> 400
    assert alice.post(f"{API}/hosted-sms/{hid}/help").status_code == 400
    # documents in loa -> 400
    assert alice.post(f"{API}/hosted-sms/{hid}/documents", files={"files": ("b.pdf", PDF, "application/pdf")}).status_code == 400
    r = alice.post(f"{API}/hosted-sms/{hid}/loa", json={"holder": HOLDER, "signature": "Someone Else", "consent": True})
    assert r.status_code == 400 and 'exactly' in r.json()['message']
    r = alice.post(f"{API}/hosted-sms/{hid}/loa", json={"holder": HOLDER, "signature": "TEST Holder"})
    assert r.status_code == 400
    r = alice.post(f"{API}/hosted-sms/{hid}/loa", json={"holder": {**HOLDER, "city": ""}, "signature": "TEST Holder", "consent": True})
    assert r.status_code == 400 and 'city' in r.json()['message']
    r = alice.post(f"{API}/hosted-sms/{hid}/loa-preview", json={"holder": HOLDER, "signature": "TEST Holder"})
    assert r.status_code == 200 and r.content[:5] == b'%PDF-'
    r = alice.post(f"{API}/hosted-sms/{hid}/cancel")
    assert r.status_code == 200 and r.json()['item']['status'] == 'cancelled'


# --- bill upload (pdf + png merged) -> review
def test_bill_upload(alice):
    hid = new(alice)
    to_documents(alice, hid)
    r = alice.post(f"{API}/hosted-sms/{hid}/documents")
    assert r.status_code == 400
    r = alice.post(f"{API}/hosted-sms/{hid}/documents", files=[("files", ("x.txt", b"hello", "text/plain"))])
    assert r.status_code == 400
    r = alice.post(f"{API}/hosted-sms/{hid}/documents", files=[("files", ("b.pdf", PDF, "application/pdf")), ("files", ("b.png", PNG, "image/png"))])
    assert r.status_code == 200, r.text
    it = r.json()['item']
    assert it['status'] == 'review' and it['expectedBy']
    assert db.hostedSms.find_one({"_id": hid})['status'] == 'review'


# --- contact support -> admin_docs -> customer can still upload; cancel works in admin_docs
def test_help_then_cancel(alice):
    hid = new(alice)
    to_documents(alice, hid)
    b0 = bal(ALICE[2])
    r = alice.post(f"{API}/hosted-sms/{hid}/help")
    assert r.status_code == 200 and r.json()['item']['status'] == 'admin_docs' and r.json()['item']['noBill'] is True
    assert bal(ALICE[2]) == b0  # free
    assert alice.post(f"{API}/hosted-sms/{hid}/help").status_code == 200  # idempotent
    r = alice.post(f"{API}/hosted-sms/{hid}/cancel")
    assert r.status_code == 200 and r.json()['item']['status'] == 'cancelled'
    assert bal(ALICE[2]) == round(b0 + 100, 2)


def test_help_then_customer_upload(alice):
    hid = new(alice)
    to_documents(alice, hid)
    alice.post(f"{API}/hosted-sms/{hid}/help")
    r = alice.post(f"{API}/hosted-sms/{hid}/documents", files={"files": ("b.png", PNG, "image/png")})
    assert r.status_code == 200 and r.json()['item']['status'] == 'review', r.text


# --- cancel refunds in verify / loa / documents
def test_cancel_states(alice):
    for steps in (0, 1, 2):
        hid = new(alice)
        b0 = bal(ALICE[2])
        if steps >= 1:
            alice.post(f"{API}/hosted-sms/{hid}/code/skip")
        if steps >= 2:
            alice.post(f"{API}/hosted-sms/{hid}/loa", json={"holder": HOLDER, "signature": "TEST Holder", "consent": True})
        r = alice.post(f"{API}/hosted-sms/{hid}/cancel")
        assert r.status_code == 200 and r.json()['item']['status'] == 'cancelled', (steps, r.text)
        assert bal(ALICE[2]) == round(b0 + 100, 2)


# --- admin queue + submit
def test_admin_queue_and_submit(alice, admin):
    hid = new(alice)
    to_documents(alice, hid)
    alice.post(f"{API}/hosted-sms/{hid}/help")
    items = admin.get(f"{API}/admin/hosted?status=admin_docs").json()['items']
    me = [x for x in items if x['id'] == hid]
    assert me and me[0]['noBill'] is True and me[0]['email'] == ALICE[0] and me[0]['holder']['name'] == 'TEST Holder'
    assert any(x['id'] == 'hs_166f867fcda2' for x in items)
    r = admin.post(f"{API}/admin/hosted/{hid}/documents")
    assert r.status_code == 400
    r = admin.post(f"{API}/admin/hosted/{hid}/documents", files={"files": ("bill.pdf", PDF, "application/pdf")})
    assert r.status_code == 200 and r.json()['item']['status'] == 'review', r.text
    d = db.hostedSms.find_one({"_id": hid})
    assert d['status'] == 'review' and d['submittedBy'] == ADMIN[0]


def test_admin_submit_without_letter(alice, admin):
    hid = new(alice)
    r = admin.post(f"{API}/admin/hosted/{hid}/documents", files={"files": ("bill.pdf", PDF, "application/pdf")})
    assert r.status_code == 400
    alice.post(f"{API}/hosted-sms/{hid}/cancel")
