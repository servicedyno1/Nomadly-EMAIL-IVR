# Landline to Texting (Hosted SMS) — web API regression (cookie auth, /api/cloudivr-web). Preview = DRY-RUN.
import os, time, json, random, pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
BOB = ('civr.bob@example.com', 'BobTest#2026', '5000000000000002')
ALICE = ('civr.alice@example.com', 'AliceTest#2026', '5000000000000001')
BOB_HS = open('/app/memory/_hsid').read().strip()
BILL = open('/app/memory/_bill.pdf', 'rb').read()
HOLDER = {"name": "TEST Holder", "business": "TEST Biz", "address": "1 Test St", "city": "Austin", "state": "TX", "zip": "73301", "carrier": "AT&T", "account": "999"}

db = MongoClient('mongodb://localhost:27017')['test']


def login(acc):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": acc[0], "password": acc[1]})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    return s


def bal(cid):
    w = db.walletOf.find_one({"_id": cid}) or {}
    return round(w.get('usdIn', 0) - w.get('usdOut', 0), 2)


def rnd_phone():
    return f"+1312555{random.randint(1000, 9999)}"


@pytest.fixture(scope='module', autouse=True)
def wallets():
    saved = {c: db.walletOf.find_one({"_id": c}) for c in (BOB[2], ALICE[2])}
    hs = db.hostedSms.find_one({"_id": BOB_HS})
    yield
    for c, w in saved.items():
        db.walletOf.update_one({"_id": c}, {"$set": {"usdIn": w.get('usdIn', 0), "usdOut": w.get('usdOut', 0)}})
    db.hostedSms.update_one({"_id": BOB_HS}, {"$set": {"status": hs['status'], "nextBillAt": hs['nextBillAt'], "retryAt": hs.get('retryAt')}})
    db.hostedSms.delete_many({"holder.name": "TEST Holder"})
    db.hostedSms.delete_many({"phoneNumber": {"$regex": "^\\+1312555"}, "_id": {"$ne": BOB_HS}})


@pytest.fixture(scope='module')
def bob():
    return login(BOB)


@pytest.fixture(scope='module')
def alice():
    return login(ALICE)


# --- listing + eligibility
def test_list_prices(bob):
    r = bob.get(f"{API}/hosted-sms")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d['prices'] == {"code": 300, "nocode": 500} and d['monthly'] == 50 and d['textPrice'] == 0.05 and d['maxText'] == 160
    assert any(i['id'] == BOB_HS and i['status'] == 'active' for i in d['items'])


def test_unauth():
    r = requests.get(f"{API}/hosted-sms")
    assert r.status_code == 401, r.status_code


def test_check(bob):
    assert bob.post(f"{API}/hosted-sms/check", json={"phone": rnd_phone()}).json()['eligible'] is True
    r = bob.post(f"{API}/hosted-sms/check", json={"phone": "+447700900123"}).json()
    assert r['eligible'] is False and 'US' in r['detail']
    r = bob.post(f"{API}/hosted-sms/check", json={"phone": "+13125550142"}).json()
    assert r['eligible'] is False and 'already' in r['detail']
    assert bob.post(f"{API}/hosted-sms/check", json={"phone": "abc"}).json()['eligible'] is False


# --- code-mode full flow
def test_code_flow(bob, alice):
    phone = rnd_phone()
    b0 = bal(BOB[2])
    r = bob.post(f"{API}/hosted-sms", json={"phone": phone, "mode": "code"})
    assert r.status_code == 200, r.text
    it = r.json()['item']
    assert it['status'] == 'verify' and it['paid'] == 300
    assert bal(BOB[2]) == round(b0 - 300, 2)
    hid = it['id']
    # duplicate
    r = bob.post(f"{API}/hosted-sms", json={"phone": phone, "mode": "nocode"})
    assert r.status_code == 400 and 'already' in r.json()['message']
    r = alice.post(f"{API}/hosted-sms", json={"phone": phone, "mode": "code"})
    assert r.status_code == 400
    # cross-account
    assert alice.post(f"{API}/hosted-sms/{hid}/code/send", json={"method": "sms"}).status_code in (400, 404)
    assert alice.get(f"{API}/hosted-sms/{hid}/messages").status_code in (400, 404)
    assert alice.post(f"{API}/hosted-sms/{hid}/loa-preview", json={"holder": HOLDER}).status_code in (400, 404)
    assert alice.post(f"{API}/hosted-sms/{hid}/cancel").status_code in (400, 404)
    # code
    for m in ('sms', 'call'):
        r = bob.post(f"{API}/hosted-sms/{hid}/code/send", json={"method": m})
        assert r.status_code == 200 and 'Preview: use code 123456' in r.json()['preview']
    r = bob.post(f"{API}/hosted-sms/{hid}/code", json={"code": "000000"})
    assert r.status_code == 400
    r = bob.post(f"{API}/hosted-sms/{hid}/code", json={"code": "123456"})
    assert r.status_code == 200 and r.json()['item']['status'] == 'documents'
    # LOA preview
    r = bob.post(f"{API}/hosted-sms/{hid}/loa-preview", json={"holder": HOLDER})
    assert r.status_code == 200 and r.headers['content-type'].startswith('application/pdf') and r.content[:5] == b'%PDF-'
    # docs validation
    url = f"{API}/hosted-sms/{hid}/documents"
    r = bob.post(url, files={"bill": ("b.pdf", BILL, "application/pdf")}, data={"holder": json.dumps(HOLDER), "consent": "false"})
    assert r.status_code == 400 and 'Tick' in r.json()['message']
    r = bob.post(url, files={"bill": ("b.txt", b"hello", "text/plain")}, data={"holder": json.dumps(HOLDER), "consent": "true"})
    assert r.status_code == 400 and 'PDF' in r.json()['message']
    r = bob.post(url, files={"bill": ("b.pdf", BILL, "application/pdf")}, data={"holder": json.dumps({**HOLDER, "city": ""}), "consent": "true"})
    assert r.status_code == 400 and 'city' in r.json()['message']
    r = bob.post(url, data={"holder": json.dumps(HOLDER), "consent": "true"})
    assert r.status_code == 400
    r = bob.post(url, files={"bill": ("b.pdf", BILL, "application/pdf")}, data={"holder": json.dumps(HOLDER), "consent": "true"})
    assert r.status_code == 200, r.text
    assert r.json()['item']['status'] == 'review'
    # can't cancel in review
    assert bob.post(f"{API}/hosted-sms/{hid}/cancel").status_code == 400
    db.hostedSms.update_one({"_id": hid}, {"$set": {"_flow": "code"}})
    pytest.hid_review = hid


def test_loa_unicode_name(bob):
    """Non-Latin names (WinAnsi) — LOA generation should not 500."""
    r = bob.post(f"{API}/hosted-sms/{BOB_HS}/loa-preview", json={"holder": {**HOLDER, "name": "José 王伟"}})
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"


# --- nocode + cancel refund
def test_nocode_cancel_refund(alice):
    phone = rnd_phone()
    b0 = bal(ALICE[2])
    db.walletOf.update_one({"_id": ALICE[2]}, {"$inc": {"usdIn": 600}})
    r = alice.post(f"{API}/hosted-sms", json={"phone": phone, "mode": "nocode"})
    assert r.status_code == 200, r.text
    it = r.json()['item']
    assert it['status'] == 'documents' and it['paid'] == 500
    assert bal(ALICE[2]) == round(b0 + 100, 2)
    r = alice.post(f"{API}/hosted-sms/{it['id']}/cancel")
    assert r.status_code == 200 and r.json()['item']['status'] == 'cancelled'
    assert bal(ALICE[2]) == round(b0 + 600, 2)
    assert db.transactions.find_one({"type": "hosted-sms-refund", "metadata.hostedId": it['id']})
    assert all(i['id'] != it['id'] for i in alice.get(f"{API}/hosted-sms").json()['items'])
    # second cancel → no double refund
    assert alice.post(f"{API}/hosted-sms/{it['id']}/cancel").status_code == 400
    assert bal(ALICE[2]) == round(b0 + 600, 2)
    w = alice.get(f"{API}/wallet").json()
    txt = ' | '.join(h.get('description', '') for h in w['history'])
    assert 'Refund · Landline to Texting' in txt and 'Landline to Texting setup' in txt
    db.walletOf.update_one({"_id": ALICE[2]}, {"$inc": {"usdIn": -600}})


def test_insufficient_and_bad_mode(alice):
    db.walletOf.update_one({"_id": ALICE[2]}, {"$inc": {"usdOut": 10000}})
    try:
        r = alice.post(f"{API}/hosted-sms", json={"phone": rnd_phone(), "mode": "code"})
        assert r.status_code == 402 and r.json()['error'] == 'insufficient_balance'
    finally:
        db.walletOf.update_one({"_id": ALICE[2]}, {"$inc": {"usdOut": -10000}})
    assert alice.post(f"{API}/hosted-sms", json={"phone": rnd_phone(), "mode": "x"}).status_code == 400


# --- sending on active
def test_send_text(bob):
    b0 = bal(BOB[2])
    r = bob.post(f"{API}/hosted-sms/{BOB_HS}/send", json={"to": "+15125550199", "text": "TEST hello"})
    assert r.status_code == 200, r.text
    assert r.json()['charge'] == 0.05 and r.json()['message']['status'] == 'preview'
    assert bal(BOB[2]) == round(b0 - 0.05, 2)
    m = bob.get(f"{API}/hosted-sms/{BOB_HS}/messages").json()['messages']
    assert m[0]['body'] == 'TEST hello' and m[0]['direction'] == 'outbound'
    assert bob.post(f"{API}/hosted-sms/{BOB_HS}/send", json={"to": "+15125550199", "text": "x" * 161}).status_code == 400
    assert bob.post(f"{API}/hosted-sms/{BOB_HS}/send", json={"to": "12", "text": "hi"}).status_code == 400
    assert bob.post(f"{API}/hosted-sms/{BOB_HS}/send", json={"to": "+15125550199", "text": "  "}).status_code == 400
    assert bal(BOB[2]) == round(b0 - 0.05, 2)


# --- monthly billing + pause/resume (tick every 30s)
def wait_for(pred, t=75):
    end = time.time() + t
    while time.time() < end:
        if pred():
            return True
        time.sleep(3)
    return False


def test_billing_renew_pause_resume(bob):
    from datetime import datetime, timedelta
    b0 = bal(BOB[2])
    past = datetime.utcnow() - timedelta(minutes=1)
    db.hostedSms.update_one({"_id": BOB_HS}, {"$set": {"nextBillAt": past, "status": "active"}})
    assert wait_for(lambda: db.hostedSms.find_one({"_id": BOB_HS})['nextBillAt'] > datetime.utcnow() + timedelta(days=29)), "not renewed"
    assert bal(BOB[2]) == round(b0 - 50, 2)
    assert db.transactions.find_one({"type": "hosted-sms-renewal", "metadata.hostedId": BOB_HS})
    # pause: wallet < 50
    db.walletOf.update_one({"_id": BOB[2]}, {"$inc": {"usdOut": 10000}})
    db.hostedSms.update_one({"_id": BOB_HS}, {"$set": {"nextBillAt": past}})
    try:
        assert wait_for(lambda: db.hostedSms.find_one({"_id": BOB_HS})['status'] == 'paused'), "not paused"
        r = bob.post(f"{API}/hosted-sms/{BOB_HS}/send", json={"to": "+15125550199", "text": "hi"})
        assert r.status_code == 400 and 'monthly fee' in r.json()['message']
    finally:
        db.walletOf.update_one({"_id": BOB[2]}, {"$inc": {"usdOut": -10000}})
    db.hostedSms.update_one({"_id": BOB_HS}, {"$set": {"retryAt": past}})
    assert wait_for(lambda: db.hostedSms.find_one({"_id": BOB_HS})['status'] == 'active'), "not resumed"
    assert bal(BOB[2]) == round(b0 - 100, 2)


def test_review_auto_activates(bob):
    hid = getattr(pytest, 'hid_review', None)
    if not hid:
        pytest.skip('no review item')
    assert wait_for(lambda: db.hostedSms.find_one({"_id": hid})['status'] == 'active', 100), db.hostedSms.find_one({"_id": hid})['status']


# --- regression: regular (non-hosted) Inbox SMS reply, dashboard, wallet
def test_regular_inbox_reply_and_dashboard(alice):
    from datetime import datetime
    r = db.webNotifications.insert_one({"chatId": ALICE[2], "kind": "sms", "text": "TEST regular inbound", "meta": {"from": "+15125550166", "to": "+13346972125"}, "read": False, "createdAt": datetime.utcnow()})
    try:
        rr = alice.post(f"{API}/notifications/{r.inserted_id}/reply", json={"text": "TEST regular reply"})
        assert rr.status_code == 200, rr.text
        assert rr.json()['reply']['text'] == 'TEST regular reply'
    finally:
        db.webNotifications.delete_one({"_id": r.inserted_id})
    d = alice.get(f"{API}/dashboard")
    assert d.status_code == 200 and 'balance' in d.json()
    assert alice.get(f"{API}/wallet").status_code == 200
