# Iter185: Spenza eSIM integration — admin catalog/fleet, customer lines, buy (preview simulated), SMS, Inbox reply, webhook HMAC
import os, time, json, hmac, hashlib, pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026', '5000000000000001')
ADMIN = ('moxxcompany@gmail.com', 'Katiekendra123@')
LINE = 'es_69fcb8db0c34'
NUM = '+16462556424'
db = MongoClient('mongodb://localhost:27017')['test']


def bal():
    w = db.walletOf.find_one({'_id': ALICE[2]}) or {}
    return round((w.get('usdIn') or 0) - (w.get('usdOut') or 0), 4)


@pytest.fixture(scope='module')
def alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ALICE[0], "password": ALICE[1]})
    if r.status_code != 200:
        pytest.skip(f"alice login {r.status_code}")
    return s


@pytest.fixture(scope='module')
def admin():
    s = requests.Session()
    d = s.post(f"{API}/admin/login", json={'email': ADMIN[0], 'password': ADMIN[1]}).json()
    r = s.post(f"{API}/admin/verify", json={'challenge': d['challenge'], 'code': d['devCode']})
    if r.status_code != 200:
        pytest.skip('admin login failed')
    return s


# ---- admin ----
def test_admin_esim_requires_admin(alice):
    assert requests.get(f"{API}/admin/esim").status_code == 401
    assert alice.get(f"{API}/admin/esim").status_code == 401


def test_admin_esim_catalog_and_fleet(admin):
    r = admin.get(f"{API}/admin/esim")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d['error'] is None and d['configured'] is True
    p = next(x for x in d['plans'] if x['planId'] == 'SPENZA_001')
    print('PLAN', p)
    assert p['cost'] == 7 and p['data'] == '20 MB' and p['voiceMinutes'] == 20 and p['sms'] == 'Unlimited' and p['validityDays'] == 30
    assert p['isEsim'] is False
    f = d['fleet']
    print('CREDIT', f['credit'], 'SIMS', len(f['sims']))
    assert any(c['amount'] == 1 for c in f['credit'])
    sim = next(s for s in f['sims'] if s['phoneNumber'] == NUM)
    assert sim['status'] == 'ACTIVE' and sim['isEsim'] is True and sim['linkedTo'] == ALICE[2]
    assert '_id' not in json.dumps(d)


def test_admin_set_plan_validation(admin):
    r = admin.put(f"{API}/admin/esim/plans/SPENZA_001", json={'enabled': True, 'price': 0, 'label': 'US Starter eSIM'})
    assert r.status_code == 400
    r = admin.put(f"{API}/admin/esim/plans/SPENZA_001", json={'enabled': True, 'price': 'abc', 'label': 'US Starter eSIM'})
    assert r.status_code == 400
    r = admin.put(f"{API}/admin/esim/plans/SPENZA_001", json={'enabled': True, 'price': 14, 'label': 'US Starter eSIM'})
    assert r.status_code == 200 and r.json()['ok'] is True
    p = db.esimPlans.find_one({'_id': 'SPENZA_001'})
    assert p['price'] == 14 and p['enabled'] is True


def test_admin_usage(admin):
    r = admin.get(f"{API}/admin/esim/sims/8901240397145552684/usage")
    assert r.status_code == 200, r.text
    print('USAGE', r.json())
    assert r.json()['usage'] is not None


def test_admin_link_idempotent(admin):
    before = db.esimLines.find_one({'iccid': '8901240397145552684'})
    r = admin.post(f"{API}/admin/esim/sims/8901240397145552684/link", json={'email': ALICE[0]})
    assert r.status_code == 200
    assert db.esimLines.count_documents({'iccid': '8901240397145552684'}) == 1
    after = db.esimLines.find_one({'iccid': '8901240397145552684'})
    assert after['_id'] == LINE
    print('callsTo before/after relink', before.get('callsTo'), after.get('callsTo'))
    # restore previous routing choice if relink reset it
    if before.get('callsTo') != after.get('callsTo'):
        db.esimLines.update_one({'_id': LINE}, {'$set': {'callsTo': before.get('callsTo')}})
    r = admin.post(f"{API}/admin/esim/sims/8901240397145552684/link", json={'email': 'nobody_x@example.com'})
    assert r.status_code == 400


def test_admin_webhook_register_preview(admin):
    r = admin.post(f"{API}/admin/esim/webhook")
    assert r.status_code == 200, r.text
    assert r.json().get('preview') is True
    assert db.spenzaConfig.find_one({'_id': 'webhook'})['signingSecret'] == 'whsec_preview'


# ---- customer ----
def test_customer_esim_list(alice):
    r = alice.get(f"{API}/esim")
    assert r.status_code == 200
    d = r.json()
    p = next(x for x in d['plans'] if x['planId'] == 'SPENZA_001')
    assert p['price'] == 14 and p['label'] == 'US Starter eSIM'
    line = next(x for x in d['items'] if x['id'] == LINE)
    assert line['phoneNumber'] == NUM and line['status'] == 'active' and line['linked'] is True
    assert d['textPrice'] == 0.05


def test_customer_esim_requires_auth():
    assert requests.get(f"{API}/esim").status_code == 401


def test_customer_qr_and_usage(alice):
    r = alice.get(f"{API}/esim/{LINE}/qr")
    assert r.status_code == 200, r.text
    print('QR', r.json())
    assert r.json().get('qrCode') or r.json().get('image')
    u = alice.get(f"{API}/esim/{LINE}/usage").json()
    print('LINE USAGE', u)
    assert u['usage'] is not None


def test_calls_toggle(alice):
    orig = db.esimLines.find_one({'_id': LINE})['callsTo']
    r = alice.post(f"{API}/esim/{LINE}/calls", json={'to': 'device'})
    assert r.status_code == 200 and r.json()['item']['callsTo'] == 'device'
    assert db.spenzaConfig.find_one({'_id': 'sip'})['numbers'] == [] or NUM not in db.spenzaConfig.find_one({'_id': 'sip'})['numbers']
    r = alice.post(f"{API}/esim/{LINE}/calls", json={'to': 'browser'})
    assert r.status_code == 200 and r.json()['item']['callsTo'] == 'browser' and r.json()['pending'] is True
    assert NUM in db.spenzaConfig.find_one({'_id': 'sip'})['numbers']
    alice.post(f"{API}/esim/{LINE}/calls", json={'to': orig})


def test_messages_and_send_sms(alice):
    m = alice.get(f"{API}/esim/{LINE}/messages").json()['messages']
    assert any(x['body'] == 'Hello eSIM' and x['from'] == '+13125550111' for x in m)
    b0 = bal()
    r = alice.post(f"{API}/esim/{LINE}/sms", json={'to': '+13125550111', 'text': 'TEST_iter185 out'})
    assert r.status_code == 200, r.text
    assert r.json()['log']['status'] == 'preview'
    assert abs(bal() - (b0 - 0.05)) < 1e-6
    m = alice.get(f"{API}/esim/{LINE}/messages").json()['messages']
    assert m[0]['body'] == 'TEST_iter185 out' and m[0]['direction'] == 'outbound'
    assert alice.post(f"{API}/esim/{LINE}/sms", json={'to': '123', 'text': 'x'}).status_code == 400
    assert alice.post(f"{API}/esim/{LINE}/sms", json={'to': '+13125550111', 'text': '  '}).status_code == 400
    assert alice.post(f"{API}/esim/nope/sms", json={'to': '+13125550111', 'text': 'x'}).status_code == 400


# ---- webhook ----
def _sign(raw, secret='whsec_preview', ts=None):
    ts = str(int(time.time())) if ts is None else str(ts)
    sig = hmac.new(secret.encode(), f"{ts}.{raw}".encode(), hashlib.sha256).hexdigest()
    return {'x-spenza-signature': f't={ts},v1={sig}', 'x-spenza-timestamp': ts, 'Content-Type': 'application/json'}


def test_webhook_unsigned_401():
    r = requests.post(f"{API}/public/spenza/webhook", json={'from': '+1312', 'to': NUM, 'text': 'x'})
    assert r.status_code == 401
    raw = json.dumps({'from': '+13125550199', 'to': NUM, 'text': 'bad'})
    r = requests.post(f"{API}/public/spenza/webhook", data=raw, headers=_sign(raw, 'wrong'))
    assert r.status_code == 401
    r = requests.post(f"{API}/public/spenza/webhook", data=raw, headers=_sign(raw, ts=int(time.time()) - 1000))
    assert r.status_code == 401


def test_webhook_signed_inbound_and_dedupe():
    text = f"TEST_iter185 in {int(time.time())}"
    raw = json.dumps({'from': '+13125550199', 'to': NUM, 'text': text})
    n0 = db.notifications.count_documents({}) if 'notifications' in db.list_collection_names() else None
    r = requests.post(f"{API}/public/spenza/webhook", data=raw, headers=_sign(raw))
    assert r.status_code == 200 and r.json()['ok'] is True
    assert db.phoneLogs.count_documents({'esim': LINE, 'body': text, 'direction': 'inbound'}) == 1
    r = requests.post(f"{API}/public/spenza/webhook", data=raw, headers=_sign(raw))
    assert r.status_code == 200
    assert db.phoneLogs.count_documents({'esim': LINE, 'body': text, 'direction': 'inbound'}) == 1


def test_inbox_reply_via_esim(alice):
    text = f"TEST_iter185 reply-src {int(time.time())}"
    raw = json.dumps({'data': {'fromNumber': '3125550177', 'toNumber': '6462556424', 'message': text}})
    assert requests.post(f"{API}/public/spenza/webhook", data=raw, headers=_sign(raw)).status_code == 200
    time.sleep(1)
    r = alice.get(f"{API}/notifications")
    assert r.status_code == 200
    items = r.json().get('items') or r.json().get('notifications') or []
    n = next((x for x in items if text in (x.get('text') or '')), None)
    assert n, f"notification not found: {str(r.json())[:400]}"
    b0 = bal()
    r = alice.post(f"{API}/notifications/{n['id']}/reply", json={'text': 'TEST_iter185 reply'})
    assert r.status_code == 200, r.text
    assert r.json()['charge'] == 0.05
    assert abs(bal() - (b0 - 0.05)) < 1e-6
    lg = db.phoneLogs.find_one({'esim': LINE, 'body': 'TEST_iter185 reply'})
    assert lg and lg['to'] == '+13125550177'


# ---- buy (preview simulated) ----
def test_buy_invalid_imei(alice):
    r = alice.post(f"{API}/esim", json={'planId': 'SPENZA_001', 'imei': '490154203237519'})
    assert r.status_code == 400 and 'IMEI' in r.json()['message']
    r = alice.post(f"{API}/esim", json={'planId': 'NOPE', 'imei': '490154203237518'})
    assert r.status_code == 400


def test_buy_insufficient_402(alice):
    w = db.walletOf.find_one({'_id': ALICE[2]}) or {}
    db.walletOf.update_one({'_id': ALICE[2]}, {'$set': {'usdOut': w.get('usdIn', 0)}}, upsert=True)
    try:
        r = alice.post(f"{API}/esim", json={'planId': 'SPENZA_001', 'imei': '490154203237518'})
        assert r.status_code == 402 and r.json()['error'] == 'insufficient_balance'
    finally:
        db.walletOf.update_one({'_id': ALICE[2]}, {'$set': {'usdOut': w.get('usdOut', 0)}})


def test_buy_provision_and_cancel(alice):
    if bal() < 14:
        db.walletOf.update_one({'_id': ALICE[2]}, {'$inc': {'usdIn': 20}}, upsert=True)
    b0 = bal()
    r = alice.post(f"{API}/esim", json={'planId': 'SPENZA_001', 'imei': '490154203237518'})
    assert r.status_code == 200, r.text
    item = r.json()['item']
    assert item['status'] == 'provisioning'
    assert abs(bal() - (b0 - 14)) < 1e-6
    lid = item['id']
    st = None
    for _ in range(14):
        time.sleep(3)
        it = next(x for x in alice.get(f"{API}/esim").json()['items'] if x['id'] == lid)
        st = it['status']
        if st == 'active':
            break
    assert st == 'active'
    assert it['phoneNumber'] and it['phoneNumber'].startswith('+1555')
    q = alice.get(f"{API}/esim/{lid}/qr").json()
    assert q['qrCode'].startswith('LPA:1$')
    r = alice.post(f"{API}/esim/{lid}/cancel")
    assert r.status_code == 200
    assert all(x['id'] != lid for x in alice.get(f"{API}/esim").json()['items'])
    assert alice.post(f"{API}/esim/{lid}/cancel").status_code == 400
