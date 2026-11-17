# CloudIVR web: 402 insufficient_balance replies carry balance + need (pay-the-difference checkout)
import os, re, math, time
import pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
CHAT = '5000000000000900'
TEST_CID = '+14155559871'


def _env(k):
    for line in open('/app/backend/.env'):
        if line.startswith(k + '='):
            return line.split('=', 1)[1].strip().strip('"')


db = MongoClient(_env('MONGO_URL'))[_env('DB_NAME')]


@pytest.fixture(scope='module')
def s():
    orig = db.walletOf.find_one({'_id': CHAT})
    # near-empty wallet: balance 0.003
    db.walletOf.update_one({'_id': CHAT}, {'$set': {'usdIn': (orig.get('usdOut') or 0) + 0.003}})
    sess = requests.Session()
    r = sess.post(f"{API}/auth/login", json={'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'})
    assert r.status_code == 200, r.text
    yield sess
    db.walletOf.update_one({'_id': CHAT}, {'$set': {'usdIn': orig.get('usdIn'), 'usdOut': orig.get('usdOut')}})
    db.webCallerIds.delete_one({'_id': TEST_CID, 'chatId': CHAT})


def _cost(msg):
    m = re.search(r'\$(\d+(?:\.\d+)?)', msg.replace(',', ''))
    return float(m.group(1)) if m else None


def _check(r):
    assert r.status_code == 402, f"{r.status_code} {r.text}"
    d = r.json()
    assert d['error'] == 'insufficient_balance'
    assert isinstance(d['balance'], (int, float))
    assert d['need'] > 0
    cost = _cost(d['message'])
    if cost is not None:
        exp = math.ceil((cost - d['balance']) * 100) / 100
        assert abs(d['need'] - exp) <= 0.011, (d, exp)
    return d


# Lookup single
def test_lookup_402_shortfall(s):
    d = _check(s.post(f"{API}/lookup", json={'number': '+14155550123'}))
    print(d)


# Lookup bulk
def test_lookup_bulk_402_shortfall(s):
    d = _check(s.post(f"{API}/lookup/bulk", json={'numbers': ['+14155550123', '+14155550124']}))
    print(d)


# Email lookup
def test_email_lookup_402_shortfall(s):
    w = db.walletOf.find_one({'_id': CHAT})
    db.walletOf.update_one({'_id': CHAT}, {'$set': {'usdIn': (w.get('usdOut') or 0)}})  # exactly $0 (email check is $0.0015)
    d = _check(s.post(f"{API}/lookup/email", json={'email': 'someone@example.com'}))
    print(d)


# Number renew
def test_renew_402_shortfall(s):
    d = _check(s.post(f"{API}/numbers/%2B13346970100/renew", json={}))
    print(d)


# Travel eSIM order
def test_travel_esim_402_shortfall(s):
    p = s.get(f"{API}/travel-esim/plans", timeout=60)
    if p.status_code != 200 or not p.json().get('zones'):
        pytest.skip(f"no plans: {p.status_code}")
    offer = next((o for z in p.json()['zones'] for o in z.get('offers', [])), None)
    if not offer:
        pytest.skip('no offers')
    d = _check(s.post(f"{API}/travel-esim/orders", json={'offerId': offer['id']}))
    print(d)


# Caller-ID verify (seed a pending TEST caller id so the debit is reached)
def test_caller_id_verify_402_shortfall(s):
    db.webCallerIds.replace_one({'_id': TEST_CID}, {'_id': TEST_CID, 'chatId': CHAT, 'status': 'pending', 'method': 'sms', 'tries': 0, 'createdAt': int(time.time() * 1000)}, upsert=True)
    r = s.post(f"{API}/caller-ids/verify", json={'number': TEST_CID, 'code': '123456'})
    if r.status_code in (403, 404, 410) and r.json().get('error') in ('off', 'disabled', 'feature_off'):
        pytest.skip(r.text)
    d = _check(r)
    print(d)


# Non-shortfall errors untouched; GET wallet unaffected
def test_non_402_untouched(s):
    r = s.post(f"{API}/lookup", json={'number': 'abc'})
    assert r.status_code == 400
    assert 'need' not in r.json() and 'balance' not in r.json()


def test_unauth_402_not_reachable():
    r = requests.post(f"{API}/lookup", json={'number': '+14155550123'})
    assert r.status_code == 401
