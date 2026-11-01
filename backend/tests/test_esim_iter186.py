# Iter186: CloudIVR eSIM (Spenza) — SAFE regression: public plans, admin catalog/fleet, customer line, QR/usage,
# calls routing, SMS validation (+ at most ONE real text to the eSIM itself), Inbox canReply, simulated buy/cancel.
# DO NOT: call /admin/esim/webhook (re-registers real webhook), cancel es_69fcb8db0c34, send texts to other numbers.
import os, time, json, pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026', '5000000000000001')
ADMIN = ('moxxcompany@gmail.com', 'Katiekendra123@')
LINE = 'es_69fcb8db0c34'
ICCID = '8901240397145552684'
NUM = '+16462556424'
SEND_REAL_TEXT = os.environ.get('ESIM_SEND_REAL_TEXT') == '1'
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


# ---- public plans ----
def test_public_plans_no_spenza():
    r = requests.get(f"{API}/public/esim-plans")
    assert r.status_code == 200
    p = next(x for x in r.json()['plans'] if x['planId'] == 'SPENZA_001')
    assert p['name'] == 'US Starter eSIM' and p['price'] == 75 and p['carrier'] == 'US network'
    assert 'spenzaj' not in json.dumps(r.json()).lower()
    assert 'cost' not in p


# ---- admin ----
def test_admin_requires_admin(alice):
    assert requests.get(f"{API}/admin/esim").status_code == 401
    assert alice.get(f"{API}/admin/esim").status_code == 401


def test_admin_catalog_fleet(admin):
    d = admin.get(f"{API}/admin/esim").json()
    assert d['error'] is None and d['configured'] is True
    p = next(x for x in d['plans'] if x['planId'] == 'SPENZA_001')
    assert p['cost'] == 7 and p['data'] == '20 MB' and p['voiceMinutes'] == 20 and p['sms'] == 'Unlimited'
    assert p['enabled'] is True and p['price'] == 75
    sim = next(s for s in d['fleet']['sims'] if s['phoneNumber'] == NUM)
    assert sim['linkedTo'] == ALICE[2]
    assert len(d['fleet']['credit']) >= 1


def test_admin_set_plan_validation_keeps_price(admin):
    assert admin.put(f"{API}/admin/esim/plans/SPENZA_001", json={'enabled': True, 'price': 0}).status_code == 400
    r = admin.put(f"{API}/admin/esim/plans/SPENZA_001", json={'enabled': True, 'price': 75, 'label': 'US Starter eSIM'})
    assert r.status_code == 200
    assert db.esimPlans.find_one({'_id': 'SPENZA_001'})['price'] == 75


def test_admin_usage(admin):
    r = admin.get(f"{API}/admin/esim/sims/{ICCID}/usage")
    assert r.status_code == 200 and r.json()['usage'] is not None


# ---- customer ----
def test_customer_list(alice):
    d = alice.get(f"{API}/esim").json()
    line = next(x for x in d['items'] if x['id'] == LINE)
    assert line['phoneNumber'] == NUM and line['status'] == 'active' and line['linked'] is True
    assert d['textPrice'] == 0.05


def test_customer_api_spenza_leak(alice):
    # customer API should not expose provider name or wholesale cost
    raw = alice.get(f"{API}/esim").text
    p = alice.get(f"{API}/esim").json()['plans'][0]
    print('CUSTOMER PLAN', p)
    assert 'spenza' not in json.dumps(p).lower().replace('spenza_001', ''), 'provider name leaks in /esim plans'
    assert 'cost' not in p, 'wholesale cost leaks in /esim plans'


def test_customer_qr_usage(alice):
    q = alice.get(f"{API}/esim/{LINE}/qr")
    assert q.status_code == 200 and (q.json().get('qrCode') or q.json().get('image'))
    print('QR keys', list(q.json().keys()), str(q.json().get('image'))[:80])
    u = alice.get(f"{API}/esim/{LINE}/usage")
    assert u.status_code == 200 and u.json()['usage'] is not None
    print('USAGE', u.json())


def test_calls_toggle(alice):
    orig = db.esimLines.find_one({'_id': LINE})['callsTo']
    r = alice.post(f"{API}/esim/{LINE}/calls", json={'to': 'device'})
    assert r.status_code == 200 and r.json()['item']['callsTo'] == 'device'
    r = alice.post(f"{API}/esim/{LINE}/calls", json={'to': 'browser'})
    assert r.status_code == 200 and r.json()['pending'] is True
    assert NUM in db.spenzaConfig.find_one({'_id': 'sip'})['numbers']
    alice.post(f"{API}/esim/{LINE}/calls", json={'to': orig})


def test_sms_validation_no_charge(alice):
    b0 = bal()
    r = alice.post(f"{API}/esim/{LINE}/sms", json={'to': '+447700900123', 'text': 'x'})
    assert r.status_code == 400 and 'Texts can go to US numbers' in r.json()['message']
    assert alice.post(f"{API}/esim/{LINE}/sms", json={'to': NUM, 'text': '   '}).status_code == 400
    assert alice.post(f"{API}/esim/nope/sms", json={'to': NUM, 'text': 'x'}).status_code == 400
    assert abs(bal() - b0) < 1e-6


@pytest.mark.skipif(not SEND_REAL_TEXT, reason='real text only when ESIM_SEND_REAL_TEXT=1')
def test_one_real_text_to_self(alice):
    b0 = bal()
    r = alice.post(f"{API}/esim/{LINE}/sms", json={'to': NUM, 'text': 'TEST_iter186 self text'})
    print('REAL SEND', r.status_code, r.text[:300])
    assert r.status_code == 200 and r.json()['log']['status'] == 'sent'
    assert abs(bal() - (b0 - 0.05)) < 1e-6


def test_messages_thread(alice):
    m = alice.get(f"{API}/esim/{LINE}/messages").json()['messages']
    dirs = {x['direction'] for x in m}
    print('MSGS', len(m), dirs)
    assert 'inbound' in dirs and 'outbound' in dirs


def test_inbox_can_reply(alice):
    r = alice.get(f"{API}/notifications")
    items = r.json().get('items') or r.json().get('notifications') or []
    es = [x for x in items if 'eSIM' in (x.get('text') or '')]
    print('ESIM NOTIFS', len(es), es[:1])
    assert es and any(x.get('canReply') for x in es)


# ---- buy (preview simulated) ----
def test_buy_invalid_imei(alice):
    r = alice.post(f"{API}/esim", json={'planId': 'SPENZA_001', 'imei': '490154203237519'})
    assert r.status_code == 400 and 'IMEI' in r.json()['message']


def test_buy_insufficient_402(alice):
    w = db.walletOf.find_one({'_id': ALICE[2]}) or {}
    db.walletOf.update_one({'_id': ALICE[2]}, {'$set': {'usdOut': w.get('usdIn', 0)}})
    try:
        r = alice.post(f"{API}/esim", json={'planId': 'SPENZA_001', 'imei': '490154203237518'})
        assert r.status_code == 402 and 'Top up' in r.json()['message']
    finally:
        db.walletOf.update_one({'_id': ALICE[2]}, {'$set': {'usdOut': w.get('usdOut', 0)}})


def test_buy_provision_and_cancel(alice):
    b0 = bal()
    r = alice.post(f"{API}/esim", json={'planId': 'SPENZA_001', 'imei': '490154203237518'})
    assert r.status_code == 200, r.text
    item = r.json()['item']
    assert item['status'] == 'provisioning' and abs(bal() - (b0 - 75)) < 1e-6
    lid = item['id']
    assert db.esimLines.find_one({'_id': lid})['simulated'] is True
    st, it = None, None
    for _ in range(16):
        time.sleep(3)
        it = next(x for x in alice.get(f"{API}/esim").json()['items'] if x['id'] == lid)
        st = it['status']
        if st == 'active':
            break
    assert st == 'active' and it['phoneNumber']
    q = alice.get(f"{API}/esim/{lid}/qr").json()
    print('SIM QR', q)
    assert q['qrCode'].startswith('LPA:1$')
    assert alice.post(f"{API}/esim/{lid}/cancel").status_code == 200
    assert all(x['id'] != lid for x in alice.get(f"{API}/esim").json()['items'])
