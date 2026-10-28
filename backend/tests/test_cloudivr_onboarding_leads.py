# CloudIVR web: onboarding prefs, per-number setup, reviews, public reviews, CNAM and lead checks (iteration 172)
import os
import time
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026', '5000000000000001')
BOB = ('civr.bob@example.com', 'BobTest#2026', '5000000000000002')
ALICE_NUM = '+13346972125'


def _env(k):
    for line in open('/app/backend/.env'):
        if line.startswith(k + '='):
            return line.split('=', 1)[1].strip().strip('"')


db = MongoClient(_env('MONGO_URL'))[_env('DB_NAME')]


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'email': email, 'password': pw})
    assert r.status_code == 200, r.text
    return s


def balance(s):
    r = s.get(f"{API}/wallet")
    assert r.status_code == 200
    d = r.json()
    return float(d.get('balance', d.get('usd', 0)))


@pytest.fixture(scope='module')
def alice():
    return login(*ALICE[:2])


@pytest.fixture(scope='module')
def bob():
    return login(*BOB[:2])


@pytest.fixture(scope='module', autouse=True)
def snapshot_prefs():
    saved = {cid: db.webPrefs.find_one({'_id': cid}) for cid in (ALICE[2], BOB[2])}
    yield
    for cid, doc in saved.items():
        if doc:
            db.webPrefs.replace_one({'_id': cid}, doc, upsert=True)
    db.webReviews.delete_many({'_id': {'$in': [BOB[2]]}})
    db.phoneLogs.delete_many({'_test172': True})


# --- onboarding prefs
class TestOnboarding:
    def test_requires_auth(self):
        assert requests.get(f"{API}/prefs/onboarding").status_code == 401

    def test_put_filters_purposes(self, bob):
        r = bob.put(f"{API}/prefs/onboarding", json={'purposes': ['sales', 'hack', 'support', 'sales', 3]})
        assert r.status_code == 200
        assert r.json() == {'purposes': ['sales', 'support'], 'onboarded': True}
        g = bob.get(f"{API}/prefs/onboarding").json()
        assert g['purposes'] == ['sales', 'support'] and g['onboarded'] is True

    def test_put_non_array(self, bob):
        r = bob.put(f"{API}/prefs/onboarding", json={'purposes': 'sales'})
        assert r.status_code == 200 and r.json()['purposes'] == []

    def test_setup_own_number(self, alice):
        r = alice.put(f"{API}/prefs/setup/{ALICE_NUM}", json={'items': ['forwarding', 'ivr', 'bogus'], 'done': False})
        assert r.status_code == 200
        assert r.json()['setup']['items'] == ['forwarding', 'ivr']
        g = alice.get(f"{API}/prefs/onboarding").json()
        assert g['setups'][ALICE_NUM]['items'] == ['forwarding', 'ivr']

    def test_setup_foreign_number_404(self, bob):
        r = bob.put(f"{API}/prefs/setup/{ALICE_NUM}", json={'items': ['ivr']})
        assert r.status_code == 404 and r.json()['error'] == 'not_found'


# --- reviews
class TestReviews:
    def test_validation(self, bob):
        assert bob.post(f"{API}/reviews", json={'rating': 0, 'text': 'x'}).status_code == 400
        assert bob.post(f"{API}/reviews", json={'rating': 6, 'text': 'long enough text'}).status_code == 400
        r = bob.post(f"{API}/reviews", json={'rating': 5, 'text': 'short'})
        assert r.status_code == 400 and r.json()['error'] == 'too_short'

    def test_low_rating_no_text_ok_and_hidden_publicly(self, bob):
        r = bob.post(f"{API}/reviews", json={'rating': 3, 'text': '', 'name': 'Bob Builder'})
        assert r.status_code == 200
        pub = requests.get(f"{API}/public/reviews").json()['reviews']
        assert all(x['rating'] >= 4 for x in pub)

    def test_five_star_public_name_shortened(self, bob):
        r = bob.post(f"{API}/reviews", json={'rating': 5, 'text': 'TEST_172 great IVR service, works well', 'name': 'Bob Builder', 'role': 'Owner'})
        assert r.status_code == 200
        mine = bob.get(f"{API}/reviews/mine").json()
        assert mine['review']['rating'] == 5 and mine['eligible'] is False
        pub = requests.get(f"{API}/public/reviews").json()['reviews']
        hit = [x for x in pub if x['text'].startswith('TEST_172')]
        assert hit and hit[0]['name'] == 'Bob B.' and hit[0]['role'] == 'Owner'
        assert 'chatId' not in hit[0] and '_id' not in hit[0]

    def test_eligibility_alice(self, alice):
        db.webReviews.delete_one({'_id': ALICE[2]})
        db.webPrefs.update_one({'_id': ALICE[2]}, {'$unset': {'reviewDismissedAt': 1}})
        db.phoneLogs.insert_one({'phoneNumber': ALICE_NUM, 'duration': 30, '_test172': True})
        assert alice.get(f"{API}/reviews/mine").json()['eligible'] is True
        assert alice.post(f"{API}/reviews/dismiss").json() == {'ok': True}
        assert alice.get(f"{API}/reviews/mine").json()['eligible'] is False
        db.webPrefs.update_one({'_id': ALICE[2]}, {'$unset': {'reviewDismissedAt': 1}})

    def test_ineligible_without_answered_call_can_still_post(self, bob):
        # Bob has no number / answered call -> eligible False, yet POST /reviews accepted (no server-side gate)
        db.webReviews.delete_one({'_id': BOB[2]})
        assert bob.get(f"{API}/reviews/mine").json()['eligible'] is False
        r = bob.post(f"{API}/reviews", json={'rating': 5, 'text': 'TEST_172 ungated review text'})
        print('POST /reviews without eligibility ->', r.status_code)
        db.webReviews.delete_one({'_id': BOB[2]})


# --- CNAM
class TestCnam:
    def test_non_us_unsupported(self, alice):
        r = alice.post(f"{API}/cnam", json={'phone': '+447700900123'})
        assert r.status_code == 200 and r.json()['supported'] is False and r.json()['charged'] == 0

    def test_charge_once(self, alice):
        phone = f"+1415555{int(time.time()) % 10000:04d}"
        b0 = balance(alice)
        r1 = alice.post(f"{API}/cnam", json={'phone': phone}).json()
        assert r1['supported'] is True and r1['charged'] == 0.015
        assert r1['name'] == ['Jane Doe', 'Sam Lee', None][int(phone[-1]) % 3]
        b1 = balance(alice)
        assert abs((b0 - b1) - 0.015) < 0.0011
        r2 = alice.post(f"{API}/cnam", json={'phone': phone[2:]}).json()  # 10-digit form -> same number
        assert r2['charged'] == 0 and r2['name'] == r1['name']
        assert abs(balance(alice) - b1) < 0.0001


# --- lead checks
class TestLeads:
    def test_quote(self, alice):
        r = alice.post(f"{API}/leads/quote", json={'numbers': '+14155550101, 4155550102\n+14155550101'})
        assert r.status_code == 200
        assert r.json() == {'count': 2, 'rate': 0.015, 'price': 0.03, 'max': 2000}

    def test_empty(self, alice):
        assert alice.post(f"{API}/leads/check", json={'numbers': []}).status_code == 400

    def test_check_flow_and_ownership(self, alice, bob):
        nums = ['+14155550110', '+14155550111', '+14155550113', '+14155550112', '+447700900123']
        b0 = balance(alice)
        r = alice.post(f"{API}/leads/check", json={'numbers': nums})
        assert r.status_code == 200
        j = r.json()
        assert j['total'] == 5 and j['charge'] == 0.07
        for _ in range(20):
            g = alice.get(f"{API}/leads/check/{j['id']}").json()
            if g['status'] == 'done':
                break
            time.sleep(1)
        assert g['status'] == 'done' and len(g['results']) == 5
        by = {x['phone']: x for x in g['results']}
        assert by['+14155550110']['status'] == 'invalid'
        assert by['+14155550111']['status'] == 'active' and by['+14155550111']['line'] == 'mobile'
        assert by['+14155550113']['line'] == 'landline'
        assert abs((b0 - balance(alice)) - g['charge']) < 0.011
        assert bob.get(f"{API}/leads/check/{j['id']}").status_code == 404

    def test_402_and_too_many_fresh_account(self):
        s = requests.Session()
        email = f"test172.{int(time.time())}@example.com"
        r = s.post(f"{API}/auth/register", json={'email': email, 'password': 'QaTest#2026x', 'name': 'TEST Fresh'})
        if r.status_code != 201:
            pytest.skip(f"register failed {r.status_code}")
        r = s.post(f"{API}/leads/check", json={'numbers': ['+14155550111']})
        assert r.status_code == 402 and r.json()['error'] == 'insufficient_balance'
        r = s.post(f"{API}/cnam", json={'phone': '+14155550111'})
        assert r.status_code == 402
        r = s.post(f"{API}/leads/check", json={'numbers': [f"+1415555{i:04d}" for i in range(2001)]})
        assert r.status_code == 400 and r.json()['error'] == 'too_many'
        g = s.get(f"{API}/prefs/onboarding").json()
        assert g['onboarded'] is False and g['purposes'] == []
