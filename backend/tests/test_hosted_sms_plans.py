# Landline to Texting — plan pricing (Starter $150/5, Pro $120/10, Business $100/unlimited), plan sync, refunds. DRY-RUN preview.
import os, time, json, random, threading, pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026', '5000000000000001')
BOB = ('civr.bob@example.com', 'BobTest#2026', '5000000000000002')
PLAN = '+13346972125'
BILL = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
HOLDER = {"name": "TEST Holder", "business": "TEST Biz", "address": "1 Test St", "city": "Austin", "state": "TX", "zip": "73301", "carrier": "AT&T", "account": "999"}
db = MongoClient('mongodb://localhost:27017')['test']


def login(acc):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": acc[0], "password": acc[1]})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return s


class _B(float):
    def __eq__(self, o):
        return abs(float(self) - float(o)) < 0.011
    __hash__ = float.__hash__
    def __sub__(self, o):
        return _B(float(self) - o)


def bal(cid):
    w = db.walletOf.find_one({"_id": cid}) or {}
    return _B(w.get('usdIn', 0) - w.get('usdOut', 0))


def rnd():
    return f"+1312555{random.randint(1000, 9999)}"


def set_plan(**kw):
    db.phoneNumbersOf.update_one({"_id": ALICE[2], "val.numbers.phoneNumber": PLAN}, {"$set": {f"val.numbers.$.{k}": v for k, v in kw.items()}})


def fill(n, plan):
    db.hostedSms.insert_many([{"_id": f"hs_TEST_{plan}_{i}", "chatId": ALICE[2], "phoneNumber": f"+1312556{i:04d}", "mode": "code", "planNumber": PLAN, "plan": plan, "status": "active", "live": True, "paid": 0, "_test": True} for i in range(n)])


def wait_for(pred, t=80):
    end = time.time() + t
    while time.time() < end:
        v = pred()
        if v:
            return v
        time.sleep(3)
    return None


@pytest.fixture(scope='module', autouse=True)
def restore():
    w = {c: db.walletOf.find_one({"_id": c}) for c in (ALICE[2], BOB[2])}
    bob_legacy = list(db.hostedSms.find({"chatId": BOB[2], "status": "active"}))
    yield
    set_plan(plan='business', status='active')
    db.hostedSms.delete_many({"_test": True})
    db.hostedSms.delete_many({"chatId": ALICE[2], "phoneNumber": {"$regex": "^\\+131255"}})
    for c, x in w.items():
        db.walletOf.update_one({"_id": c}, {"$set": {"usdIn": x['usdIn'], "usdOut": x['usdOut']}})


@pytest.fixture(scope='module')
def alice():
    return login(ALICE)


@pytest.fixture(scope='module')
def bob():
    return login(BOB)


# --- GET: plan prices / limits / plans
def test_get_plans(alice):
    d = alice.get(f"{API}/hosted-sms").json()
    assert d['planPrices'] == {"starter": 150, "pro": 120, "business": 100}
    assert d['planLimits'] == {"starter": 5, "pro": 10, "business": None}
    p = [x for x in d['plans'] if x['phoneNumber'] == PLAN][0]
    assert p['plan'] == 'business' and p['status'] == 'active' and p['price'] == 100 and p['limit'] is None and d['textPrice'] == 0.05


def test_no_plan_account(bob):
    d = bob.get(f"{API}/hosted-sms").json()
    assert d['plans'] == []
    r = bob.post(f"{API}/hosted-sms", json={"phone": rnd(), "mode": "code", "planNumber": PLAN})
    assert r.status_code == 400 and r.json()['error'] == 'needs_plan'


def test_pick_plan_errors(alice):
    b0 = bal(ALICE[2])
    r = alice.post(f"{API}/hosted-sms", json={"phone": rnd(), "mode": "code"})
    assert r.status_code == 400 and r.json()['error'] == 'pick_plan'
    r = alice.post(f"{API}/hosted-sms", json={"phone": rnd(), "mode": "code", "planNumber": "+15555550000"})
    assert r.status_code == 400 and r.json()['error'] == 'pick_plan'
    r = alice.post(f"{API}/hosted-sms", json={"phone": rnd(), "mode": "bogus", "planNumber": PLAN})
    assert r.status_code == 400
    assert bal(ALICE[2]) == b0


# --- business: $100 once, both modes, cancel refunds $100
@pytest.mark.parametrize('mode', ['code', 'nocode'])
def test_business_charge_and_refund(alice, mode):
    b0 = bal(ALICE[2])
    r = alice.post(f"{API}/hosted-sms", json={"phone": rnd(), "mode": mode, "planNumber": PLAN})
    assert r.status_code == 200, r.text
    it = r.json()['item']
    assert it['paid'] == 100 and it['planNumber'] == PLAN and it['plan'] == 'business' and it['monthly'] == 0
    assert it['status'] == ('verify' if mode == 'code' else 'documents')
    assert bal(ALICE[2]) == b0 - 100
    tx = list(db.transactions.find({"metadata.hostedId": it['id']}))
    assert [t['type'] for t in tx] == ['hosted-sms-setup'] and tx[0]['amount'] == 100
    listed = [x for x in alice.get(f"{API}/hosted-sms").json()['items'] if x['id'] == it['id']][0]
    assert listed['planNumber'] == PLAN and listed['monthly'] == 0
    r = alice.post(f"{API}/hosted-sms/{it['id']}/cancel")
    assert r.status_code == 200 and r.json()['item']['status'] == 'cancelled'
    assert bal(ALICE[2]) == b0
    assert db.transactions.find_one({"metadata.hostedId": it['id'], "type": "hosted-sms-refund"})['amount'] == 100
    # second cancel does not refund twice
    alice.post(f"{API}/hosted-sms/{it['id']}/cancel")
    assert bal(ALICE[2]) == b0


def test_double_click_single_debit(alice):
    b0 = bal(ALICE[2]); phone = rnd(); res = []
    def go():
        res.append(alice.post(f"{API}/hosted-sms", json={"phone": phone, "mode": "code", "planNumber": PLAN}))
    ts = [threading.Thread(target=go) for _ in range(3)]
    [t.start() for t in ts]; [t.join() for t in ts]
    ok = [r for r in res if r.status_code == 200]
    assert len(ok) == 1, [r.text for r in res]
    assert bal(ALICE[2]) == b0 - 100
    alice.post(f"{API}/hosted-sms/{ok[0].json()['item']['id']}/cancel")
    assert bal(ALICE[2]) == b0


def test_plan_inactive(alice):
    b0 = bal(ALICE[2])
    set_plan(status='expired')
    try:
        r = alice.post(f"{API}/hosted-sms", json={"phone": rnd(), "mode": "code", "planNumber": PLAN})
        assert r.status_code == 400 and r.json()['error'] == 'plan_inactive'
    finally:
        set_plan(status='active')
    assert bal(ALICE[2]) == b0


@pytest.mark.parametrize('plan,limit,price', [('starter', 5, 150), ('pro', 10, 120)])
def test_plan_limits(alice, plan, limit, price):
    set_plan(plan=plan)
    try:
        fill(limit - 1, plan)
        p = [x for x in alice.get(f"{API}/hosted-sms").json()['plans'] if x['phoneNumber'] == PLAN][0]
        assert p['used'] == limit - 1 and p['limit'] == limit and p['price'] == price
        b0 = bal(ALICE[2])
        r = alice.post(f"{API}/hosted-sms", json={"phone": rnd(), "mode": "nocode", "planNumber": PLAN})
        assert r.status_code == 200, r.text
        it = r.json()['item']
        assert it['paid'] == price and it['plan'] == plan and bal(ALICE[2]) == b0 - price
        r = alice.post(f"{API}/hosted-sms", json={"phone": rnd(), "mode": "code", "planNumber": PLAN})
        assert r.status_code == 400 and r.json()['error'] == 'plan_limit', r.text
        assert bal(ALICE[2]) == b0 - price
        alice.post(f"{API}/hosted-sms/{it['id']}/cancel")
        assert bal(ALICE[2]) == b0
    finally:
        db.hostedSms.delete_many({"_test": True})
        set_plan(plan='business')


# --- full flow -> active -> plan sync pause/resume -> texts; legacy untouched
def test_full_flow_and_plan_sync(alice, bob):
    b0 = bal(ALICE[2])
    r = alice.post(f"{API}/hosted-sms", json={"phone": rnd(), "mode": "code", "planNumber": PLAN})
    assert r.status_code == 200, r.text
    hid = r.json()['item']['id']
    assert alice.post(f"{API}/hosted-sms/{hid}/code/send", json={"method": "sms"}).status_code == 200
    assert alice.post(f"{API}/hosted-sms/{hid}/code", json={"code": "123456"}).json()['item']['status'] == 'documents'
    r = alice.post(f"{API}/hosted-sms/{hid}/documents", files={"bill": ("b.pdf", BILL, "application/pdf")}, data={"holder": json.dumps(HOLDER), "consent": "true"})
    assert r.status_code == 200 and r.json()['item']['status'] == 'review', r.text
    db.hostedSms.update_one({"_id": hid}, {"$set": {"docsAt": time.time() * 0 or __import__('datetime').datetime.utcnow().replace(year=2020)}})
    d = wait_for(lambda: (x := db.hostedSms.find_one({"_id": hid, "status": "active"})) and x)
    assert d, 'review did not auto-activate'
    assert 'nextBillAt' not in d or d['nextBillAt'] is None
    assert bal(ALICE[2]) == b0 - 100
    # send a text while active
    r = alice.post(f"{API}/hosted-sms/{hid}/send", json={"to": "+14165550177", "text": "TEST plan text"})
    assert r.status_code == 200 and r.json()['charge'] > 0, r.text
    legacy = {x['_id']: x.get('nextBillAt') for x in db.hostedSms.find({"chatId": BOB[2], "status": "active", "live": True})}
    # plan expires -> paused
    set_plan(status='expired')
    try:
        d = wait_for(lambda: db.hostedSms.find_one({"_id": hid, "status": "paused"}), 45)
        assert d and 'isn’t active' in (d.get('note') or '')
        r = alice.post(f"{API}/hosted-sms/{hid}/send", json={"to": "+14165550177", "text": "TEST paused"})
        assert r.status_code == 400
        pytest.paused_msg = r.json()['message']
    finally:
        set_plan(status='active')
    d = wait_for(lambda: db.hostedSms.find_one({"_id": hid, "status": "active"}), 45)
    assert d and not d.get('note')
    for k, v in legacy.items():
        x = db.hostedSms.find_one({"_id": k})
        assert x['status'] == 'active' and x.get('nextBillAt') == v
    pytest.active_hid = hid


def test_paused_error_copy_mentions_plan():
    msg = getattr(pytest, 'paused_msg', '')
    assert msg and 'monthly fee' not in msg, f"plan-attached paused send error copy: {msg!r}"


def test_reject_refund_plan_price(alice):
    b0 = bal(ALICE[2])
    r = alice.post(f"{API}/hosted-sms", json={"phone": rnd(), "mode": "nocode", "planNumber": PLAN})
    hid = r.json()['item']['id']
    alice.post(f"{API}/hosted-sms/{hid}/documents", files={"bill": ("b.pdf", BILL, "application/pdf")}, data={"holder": json.dumps(HOLDER), "consent": "true"})
    import subprocess
    out = subprocess.run(['node', '-e', f"""
require('dotenv').config({{path:'/app/backend/.env'}});const {{MongoClient}}=require('mongodb');
(async()=>{{const c=await MongoClient.connect(process.env.MONGO_URL);const db=c.db(process.env.DB_NAME);
const HS=require('/app/js/hosted-sms.js').init({{db,log:()=>{{}},tell:async()=>null}});
const r=await HS.adminReject('{hid}','TEST reject');console.log(JSON.stringify(r));process.exit(0)}})()"""], capture_output=True, text=True, cwd='/app', timeout=60)
    assert '"rejected"' in out.stdout, out.stdout + out.stderr
    assert bal(ALICE[2]) == b0
    assert db.transactions.find_one({"metadata.hostedId": hid, "type": "hosted-sms-refund"})['amount'] == 100
