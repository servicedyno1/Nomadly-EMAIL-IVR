# Iter188: CloudIVR pay-with-crypto + eSIM $75 + eSIM auto-renew toggle/expiry + Texting paused renew.
# SAFE: simulated eSIM lines only (DRY_RUN); NEVER touch es_69fcb8db0c34; no real SMS; wallet restored after tests.
import os, time, uuid, pytest, requests
from datetime import datetime, timedelta
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026', '5000000000000001')
PROTECTED = 'es_69fcb8db0c34'
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
def wallet_guard():
    w = db.walletOf.find_one({'_id': ALICE[2]})
    yield
    db.walletOf.update_one({'_id': ALICE[2]}, {'$set': {'usdIn': w['usdIn'], 'usdOut': w['usdOut']}})


@pytest.fixture(scope='module')
def line(alice, wallet_guard):
    r = alice.post(f"{API}/esim", json={'planId': 'SPENZA_001', 'imei': '356938035643809'})
    assert r.status_code == 200, r.text
    lid = r.json()['item']['id']
    assert r.json()['item']['price'] == 75
    for _ in range(20):
        time.sleep(3)
        it = next(x for x in alice.get(f"{API}/esim").json()['items'] if x['id'] == lid)
        if it['status'] == 'active':
            break
    yield lid
    d = db.esimLines.find_one({'_id': lid})
    if d and d['status'] in ('active', 'suspended'):
        alice.post(f"{API}/esim/{lid}/cancel")


# ---- price $75 ----
def test_public_price_75():
    p = requests.get(f"{API}/public/esim-plans").json()['plans'][0]
    assert p['planId'] == 'SPENZA_001' and p['price'] == 75


def test_customer_plan_price_75(alice):
    d = alice.get(f"{API}/esim").json()
    assert d['plans'][0]['price'] == 75
    assert all('autoRenew' in x and isinstance(x['autoRenew'], bool) for x in d['items'])


# ---- crypto top-up (preview address) ----
def test_wallet_topup_preview(alice):
    w = alice.get(f"{API}/wallet").json()
    assert w['coins'], w
    r = alice.post(f"{API}/wallet/topup", json={'amountUsd': 75, 'coin': w['coins'][0]})
    assert r.status_code in (200, 201), r.text
    dep = r.json()
    print('DEP', dep)
    assert dep.get('dryRun') is True and dep.get('address')


# ---- auto-renew ----
def test_autorenew_default_and_toggle(alice, line):
    it = next(x for x in alice.get(f"{API}/esim").json()['items'] if x['id'] == line)
    assert it['status'] == 'active' and it['autoRenew'] is True
    r = alice.post(f"{API}/esim/{line}/auto-renew", json={'on': False})
    assert r.status_code == 200 and r.json()['item']['autoRenew'] is False
    it = next(x for x in alice.get(f"{API}/esim").json()['items'] if x['id'] == line)
    assert it['autoRenew'] is False
    r = alice.post(f"{API}/esim/{line}/auto-renew", json={'on': True})
    assert r.status_code == 200 and r.json()['item']['autoRenew'] is True
    assert db.esimLines.find_one({'_id': line})['autoRenew'] is True


def test_autorenew_unknown_id(alice):
    r = alice.post(f"{API}/esim/es_nope_{uuid.uuid4().hex[:6]}/auto-renew", json={'on': False})
    assert r.status_code == 400


def test_autorenew_off_expires_at_period_end_no_charge(alice, line):
    alice.post(f"{API}/esim/{line}/auto-renew", json={'on': False})
    b0 = bal()
    db.esimLines.update_one({'_id': line}, {'$set': {'nextBillAt': datetime.utcnow() - timedelta(minutes=1)}})
    st = None
    for _ in range(12):
        time.sleep(3)
        st = db.esimLines.find_one({'_id': line})['status']
        if st == 'cancelled':
            break
    assert st == 'cancelled'
    assert abs(bal() - b0) < 1e-6
    assert all(x['id'] != line for x in alice.get(f"{API}/esim").json()['items'])


def test_autorenew_on_bills_75(alice, wallet_guard):
    # second simulated line, auto-renew on, period end → $75 debited, stays active
    r = alice.post(f"{API}/esim", json={'planId': 'SPENZA_001', 'imei': '356938035643809'})
    assert r.status_code == 200, r.text
    lid = r.json()['item']['id']
    try:
        for _ in range(20):
            time.sleep(3)
            if db.esimLines.find_one({'_id': lid})['status'] == 'active':
                break
        b0 = bal()
        db.esimLines.update_one({'_id': lid}, {'$set': {'nextBillAt': datetime.utcnow() - timedelta(minutes=1)}})
        for _ in range(12):
            time.sleep(3)
            d = db.esimLines.find_one({'_id': lid})
            if d['nextBillAt'] > datetime.utcnow():
                break
        assert d['status'] == 'active' and abs(bal() - (b0 - 75)) < 1e-6
    finally:
        alice.post(f"{API}/esim/{lid}/cancel")


def test_protected_line_untouched(alice):
    d = db.esimLines.find_one({'_id': PROTECTED})
    assert d and d['status'] == 'active'


# ---- Texting renew ----
def test_hosted_renew_unknown(alice):
    r = alice.post(f"{API}/hosted-sms/hs_nope123/renew")
    assert r.status_code == 400 and r.json()['message'] == 'Nothing to renew.'


def test_hosted_renew_non_paused(alice):
    r = alice.post(f"{API}/hosted-sms/hs_166f867fcda2/renew")
    assert r.status_code == 400 and r.json()['message'] == 'Nothing to renew.'


def test_hosted_renew_paused_standalone(alice, wallet_guard):
    hid = f"hs_TEST_{uuid.uuid4().hex[:8]}"
    past = datetime.utcnow() - timedelta(days=1)
    db.hostedSms.insert_one({'_id': hid, 'chatId': ALICE[2], 'phoneNumber': '+13125550199', 'planNumber': None, 'plan': 'texting',
                             'status': 'paused', 'live': True, 'nextBillAt': past, 'retryAt': datetime.utcnow() + timedelta(days=1),
                             'createdAt': past, 'updatedAt': past})
    try:
        items = alice.get(f"{API}/hosted-sms").json()['items']
        it = next(x for x in items if x['id'] == hid)
        print('HS item', it)
        b0 = bal()
        r = alice.post(f"{API}/hosted-sms/{hid}/renew")
        assert r.status_code == 200, r.text
        assert r.json()['item']['status'] == 'active'
        assert bal() < b0
    finally:
        db.hostedSms.delete_one({'_id': hid})


def test_suspended_with_autorenew_off_not_charged(alice, wallet_guard):
    # Auto-renew off on a paused line: the hourly biller must not take $75 once the wallet has money.
    r = alice.post(f"{API}/esim", json={'planId': 'SPENZA_001', 'imei': '356938035643809'})
    lid = r.json()['item']['id']
    try:
        for _ in range(20):
            time.sleep(3)
            if db.esimLines.find_one({'_id': lid})['status'] == 'active':
                break
        db.esimLines.update_one({'_id': lid}, {'$set': {'status': 'suspended', 'autoRenew': False, 'nextBillAt': datetime.utcnow() - timedelta(minutes=1)}})
        b0 = bal()
        time.sleep(35)
        d = db.esimLines.find_one({'_id': lid})
        print('SUSPENDED+OFF after tick', d['status'], bal() - b0)
        assert abs(bal() - b0) < 1e-6, f"charged {b0 - bal()} although auto-renew off; status={d['status']}"
    finally:
        if db.esimLines.find_one({'_id': lid})['status'] in ('active', 'suspended'):
            alice.post(f"{API}/esim/{lid}/cancel")
