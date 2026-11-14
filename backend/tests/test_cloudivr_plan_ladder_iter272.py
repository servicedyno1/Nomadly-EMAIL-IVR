# CloudIVR iter272: 5-plan ladder (Basic/Starter/Pro/Business/Enterprise) — public catalog, upgrade quotes, price lock, bot config (node)
import os
import time
import subprocess
import pytest
import requests
from pymongo import MongoClient
from dotenv import dotenv_values

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE}/api/cloudivr-web"
ENV = dotenv_values('/app/backend/.env')
ALICE = ('civr.alice@example.com', 'AliceTest#2026')
UX = ('civr.uxtest@example.com', 'UxTest#2026')
S = {}
BASIC_NUM = '+15125550381'
LOCK_NUM = '+15125550382'


def db():
    return MongoClient(ENV['MONGO_URL'])[ENV['DB_NAME']]


def login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'email': creds[0], 'password': creds[1]})
    assert r.status_code == 200, r.text
    s.chat_id = str(r.json()['account']['id'])
    return s


def num(phone, plan, **kw):
    n = {'phoneNumber': phone, 'provider': 'telnyx', 'country': 'US', 'type': 'local', 'status': 'active', 'plan': plan,
         'capabilities': {'voice': True, 'sms': True, 'fax': False}, 'features': {'sms': True}, 'dryRun': True, 'channel': 'web',
         'TEST': True, 'expiresAt': '2027-12-01T00:00:00.000Z', 'purchaseDate': '2026-11-10T00:00:00.000Z'}
    n.update(kw)
    return n


@pytest.fixture(scope='module')
def fresh():
    if 'fresh' not in S:
        s = requests.Session()
        email = f"test_p272{int(time.time()*1000)}@example.com"
        r = s.post(f"{API}/auth/register", json={'email': email, 'password': 'TestComp#2026', 'name': 'TEST_P272', 'acceptPolicy': True})
        assert r.status_code == 201, r.text
        s.chat_id = str(r.json()['account']['id'])
        d = db()
        d.phoneNumbersOf.insert_one({'_id': s.chat_id, 'val': {'numbers': [
            num(BASIC_NUM, 'starter', planPrice=50),
            num(LOCK_NUM, 'pro', planPrice=75, priceLock={'plan': 'pro', 'price': 75, 'key': 'pro75-2026-06'}),
        ]}})
        d.walletOf.update_one({'_id': s.chat_id}, {'$set': {'usdIn': 500, 'usdOut': 0}}, upsert=True)
        S['fresh'] = s
        S['email'] = email
    return S['fresh']


# ---- Public catalog ----
class TestPublicCatalog:
    def test_plans_order_and_prices(self):
        c = requests.get(f"{API}/public/catalog").json()
        got = [(p['id'], p['name'], p['price'], p['minutes']) for p in c['plans']]
        assert got == [('starter', 'Basic', 50, 100), ('standard', 'Starter', 75, 250), ('pro', 'Pro', 100, 400), ('business', 'Business', 120, 600)], got
        rec = [p['id'] for p in c['plans'] if p.get('recommended')]
        assert rec == ['pro'], rec
        assert c['enterprise']['price'] == 399, c.get('enterprise')
        assert c['extraNumber']['limits']['standard'] == 8, c['extraNumber']

    def test_standard_web_features(self):
        c = requests.get(f"{API}/public/catalog").json()
        std = next(p for p in c['plans'] if p['id'] == 'standard')
        inc = {f['key'] for f in std['webFeatures'] if f['included']}
        assert inc == {'inbox', 'forwarding', 'browserPhone', 'hours', 'notes', 'private', 'voicemail', 'sip', 'recording'}, inc


# ---- Upgrade quotes ----
class TestUpgrade:
    def test_basic_quote_to_standard_and_pro(self, fresh):
        for plan, price in (('standard', 75), ('pro', 100)):
            r = fresh.post(f"{API}/numbers/{BASIC_NUM}/upgrade", json={'plan': plan})
            print(plan, r.status_code, r.text[:300])
            assert r.status_code == 200, r.text
            q = r.json()['quote']
            assert q['newPrice'] == price, q
            assert q['charge'] > 0 and q['charge'] <= price, q

    def test_locked_pro_to_business(self, fresh):
        r = fresh.post(f"{API}/numbers/{LOCK_NUM}/upgrade", json={'plan': 'business'})
        print(r.status_code, r.text[:300])
        assert r.status_code == 200, r.text
        q = r.json()['quote']
        assert q['newPrice'] == 120, q
        assert q['charge'] >= 0, q

    def test_lower_plan_rejected(self, fresh):
        r = fresh.post(f"{API}/numbers/{LOCK_NUM}/upgrade", json={'plan': 'standard'})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_plan', r.text

    def test_confirm_basic_to_standard_persists(self, fresh):
        r = fresh.post(f"{API}/numbers/{BASIC_NUM}/upgrade", json={'plan': 'standard', 'confirm': True})
        print(r.status_code, r.text[:300])
        assert r.status_code == 200 and r.json()['plan'] == 'standard', r.text
        doc = db().phoneNumbersOf.find_one({'_id': fresh.chat_id})
        n = next(x for x in doc['val']['numbers'] if x['phoneNumber'] == BASIC_NUM)
        assert n['plan'] == 'standard' and n['planPrice'] == 75, (n['plan'], n.get('planPrice'))

    def test_cleanup(self, fresh):
        d = db()
        d.phoneNumbersOf.delete_one({'_id': fresh.chat_id})
        d.walletOf.delete_one({'_id': fresh.chat_id})


# ---- Price lock migration in DB ----
class TestPriceLockDB:
    def test_mark_and_locks(self):
        d = db()
        m = d.migrationMarks.find_one({'_id': 'priceLock:pro75-2026-06'})
        assert m is not None
        pros = [n for doc in d.phoneNumbersOf.find({'val.numbers.plan': 'pro'}) for n in doc['val'].get('numbers', [])
                if n.get('plan') == 'pro' and not n.get('isSubNumber') and n.get('status') != 'released' and not n.get('TEST')]
        assert pros, 'no pro numbers'
        assert all((n.get('priceLock') or {}).get('price') == 75 for n in pros), [(n['phoneNumber'], n.get('priceLock')) for n in pros]
        # idempotent: lock timestamps all equal the mark (not re-applied after restarts)
        ats = {n['priceLock']['at'] for n in pros}
        assert len(ats) == 1, ats


# ---- Bot config (node) ----
def test_bot_config_node():
    out = subprocess.run(['node', '/app/backend/tests/plan_ladder_iter272.js'], capture_output=True, text=True, timeout=90).stdout
    fails = [l for l in out.splitlines() if l.startswith('FAIL')]
    assert not fails and 'ALL PASS' in out, fails


# ---- Regression: Business user (Alice missing in preview DB -> uxtest fallback) ----
def test_alice_numbers_wallet():
    r = requests.post(f"{API}/auth/login", json={'email': ALICE[0], 'password': ALICE[1]})
    print('alice login:', r.status_code)
    s = login(ALICE) if r.status_code == 200 else login(UX)
    n = s.get(f"{API}/numbers")
    assert n.status_code == 200
    w = s.get(f"{API}/wallet")
    assert w.status_code == 200
    c = s.get(f"{API}/catalog")
    assert c.status_code == 200 and [p['id'] for p in c.json()['plans']] == ['starter', 'standard', 'pro', 'business']
    print('alice numbers:', str(n.json())[:300], 'wallet:', w.json())
