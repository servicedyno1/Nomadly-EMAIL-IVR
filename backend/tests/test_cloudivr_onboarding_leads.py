# CloudIVR web: onboarding prefs, per-number setup, reviews (gated), CNAM billing, lead checks (cache/recheck/scope/list/delete-dead), wallet history (iteration 173)
import os
import time
import uuid
import datetime
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
RUN = int(time.time()) % 100000


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


def raw_balance(cid):
    w = db.walletOf.find_one({'_id': cid}) or {}
    return (w.get('usdIn', 0) or 0) - (w.get('usdOut', 0) or 0)


def wait_done(s, jid):
    for _ in range(30):
        g = s.get(f"{API}/leads/check/{jid}").json()
        if g['status'] != 'running':
            return g
        time.sleep(1)
    return g


def num(prefix, i):
    # unique US numbers per run; last digit controls dry-run result
    return f"+1{prefix}{RUN:05d}{i:01d}"[:12]


@pytest.fixture(scope='module')
def alice():
    return login(*ALICE[:2])


@pytest.fixture(scope='module')
def bob():
    return login(*BOB[:2])


@pytest.fixture(scope='module', autouse=True)
def snapshot():
    saved = {cid: db.webPrefs.find_one({'_id': cid}) for cid in (ALICE[2], BOB[2])}
    yield
    for cid, doc in saved.items():
        if doc:
            db.webPrefs.replace_one({'_id': cid}, doc, upsert=True)
    db.webReviews.delete_many({'_id': {'$in': [ALICE[2], BOB[2]]}})
    db.phoneLogs.delete_many({'_test173': True})
    db.webContacts.delete_many({'_test173': True})
    db.webContactLists.delete_many({'_test173': True})


# --- onboarding prefs
class TestOnboarding:
    def test_requires_auth(self):
        assert requests.get(f"{API}/prefs/onboarding").status_code == 401

    def test_put_filters_purposes(self, bob):
        r = bob.put(f"{API}/prefs/onboarding", json={'purposes': ['sales', 'hack', 'texting', 'sales', 3]})
        assert r.status_code == 200
        assert r.json() == {'purposes': ['sales', 'texting'], 'onboarded': True}
        g = bob.get(f"{API}/prefs/onboarding").json()
        assert g['purposes'] == ['sales', 'texting'] and g['onboarded'] is True

    def test_setup_foreign_number_404(self, bob):
        r = bob.put(f"{API}/prefs/setup/{ALICE_NUM}", json={'items': ['ivr']})
        assert r.status_code == 404


# --- reviews (gated on an answered call)
class TestReviews:
    def test_bob_not_eligible_403(self, bob):
        db.webReviews.delete_one({'_id': BOB[2]})
        assert bob.get(f"{API}/reviews/mine").json()['eligible'] is False
        r = bob.post(f"{API}/reviews", json={'rating': 5, 'text': 'TEST_173 ungated review text'})
        assert r.status_code == 403 and r.json()['error'] == 'not_eligible'
        assert db.webReviews.find_one({'_id': BOB[2]}) is None

    def test_alice_eligible_can_post(self, alice):
        db.webReviews.delete_one({'_id': ALICE[2]})
        db.phoneLogs.insert_one({'phoneNumber': ALICE_NUM, 'duration': 30, '_test173': True})
        r = alice.post(f"{API}/reviews", json={'rating': 5, 'text': 'TEST_173 great IVR service works', 'name': 'Alice Tester'})
        assert r.status_code == 200
        pub = requests.get(f"{API}/public/reviews").json()['reviews']
        assert any(x['text'].startswith('TEST_173') and x['name'] == 'Alice T.' for x in pub)
        db.webReviews.delete_one({'_id': ALICE[2]})


# --- CNAM billing
class TestCnam:
    def test_non_us_and_short_plus(self, alice):
        r = alice.post(f"{API}/cnam", json={'phone': '+447700900123'}).json()
        assert r['supported'] is False and r['charged'] == 0
        r = alice.post(f"{API}/cnam", json={'phone': '+1415555012'}).json()
        assert r['supported'] is False and r['charged'] == 0

    def test_charge_exact_once_and_history(self, alice):
        phone = f"+1415{RUN:05d}{RUN % 100:02d}"[:12]
        b0 = raw_balance(ALICE[2])
        r1 = alice.post(f"{API}/cnam", json={'phone': phone}).json()
        assert r1['supported'] is True and r1['charged'] == 0.015
        assert r1['name'] == ['Jane Doe', 'Sam Lee', None][int(phone[-1]) % 3]
        b1 = raw_balance(ALICE[2])
        assert abs((b0 - b1) - 0.015) < 1e-6, (b0, b1)
        r2 = alice.post(f"{API}/cnam", json={'phone': phone[2:]}).json()
        assert r2['charged'] == 0 and r2.get('cached') is True and r2['name'] == r1['name']
        assert abs(raw_balance(ALICE[2]) - b1) < 1e-6
        hist = alice.get(f"{API}/wallet").json()['history']
        row = [h for h in hist if h['description'] == f"Owner-name lookup · {phone}"]
        assert row and abs(row[0]['amount'] + 0.015) < 1e-9


# --- lead checks
class TestLeads:
    def test_check_3_exact_cache_recheck(self, alice):
        nums = [f"+1650{RUN:05d}{d}1"[:10] + f"{d}1" for d in (1, 2, 3)]
        nums = [f"+1650{RUN:05d}{d}{d}" for d in (1, 2, 3)]  # 12 chars: +1 650 RUN(5) dd
        q = alice.post(f"{API}/leads/quote", json={'numbers': nums}).json()
        assert q['count'] == 3 and q['fresh'] == 3 and q['cached'] == 0 and q['price'] == 0.045
        b0 = raw_balance(ALICE[2])
        r = alice.post(f"{API}/leads/check", json={'numbers': nums})
        assert r.status_code == 200 and r.json()['charge'] == 0.045
        g = wait_done(alice, r.json()['id'])
        assert g['status'] == 'done' and len(g['results']) == 3
        assert abs((b0 - raw_balance(ALICE[2])) - 0.045) < 1e-6
        hist = alice.get(f"{API}/wallet").json()['history']
        assert any(h['description'] == 'Lead check · 3 numbers' and abs(h['amount'] + 0.045) < 1e-9 for h in hist)
        # quote again → all cached, free
        q2 = alice.post(f"{API}/leads/quote", json={'numbers': nums + [f"+1650{RUN:05d}44"]}).json()
        assert q2['count'] == 4 and q2['cached'] == 3 and q2['fresh'] == 1 and q2['price'] == 0.015
        b1 = raw_balance(ALICE[2])
        r2 = alice.post(f"{API}/leads/check", json={'numbers': nums}).json()
        assert r2['status'] == 'done' and r2['charge'] == 0 and r2['cached'] == 3
        assert abs(raw_balance(ALICE[2]) - b1) < 1e-6
        g2 = alice.get(f"{API}/leads/check/{r2['id']}").json()
        assert g2['status'] == 'done' and len(g2['results']) == 3 and all(x.get('cached') for x in g2['results'])
        # recheck → charges all
        r3 = alice.post(f"{API}/leads/check", json={'numbers': nums, 'recheck': True}).json()
        assert r3['charge'] == 0.045 and r3['status'] == 'running'
        wait_done(alice, r3['id'])
        assert abs((b1 - raw_balance(ALICE[2])) - 0.045) < 1e-6

    def test_scope_contacts_all_and_list_and_delete_dead(self, alice):
        cid = ALICE[2]
        lid = f"test173-{uuid.uuid4()}"
        now = datetime.datetime.utcnow()
        db.webContactLists.insert_one({'_id': lid, 'chatId': cid, 'name': f'TEST_173 list {RUN}', 'createdAt': now, 'updatedAt': now, '_test173': True})
        docs = []
        for i in range(60):
            docs.append({'_id': f"test173-{uuid.uuid4()}", 'chatId': cid, 'phone': f"+1702{RUN:05d}{i:02d}", 'name': f'TEST_173 c{i}',
                         'listIds': [lid] if i < 5 else [], 'fields': [], 'createdAt': now, 'updatedAt': now, '_test173': True})
        db.webContacts.insert_many(docs)
        total = db.webContacts.count_documents({'chatId': cid})
        q = alice.post(f"{API}/leads/quote", json={'scope': 'contacts'}).json()
        assert q['count'] == total and q['count'] >= 60
        ql = alice.post(f"{API}/leads/quote", json={'listId': lid}).json()
        assert ql['count'] == 5
        r = alice.post(f"{API}/leads/check", json={'scope': 'contacts'}).json()
        g = wait_done(alice, r['id'])
        assert g['status'] == 'done' and len(g['results']) == total
        dead = [x for x in g['results'] if x['status'] == 'invalid']
        assert len(dead) >= 6  # last two digits %10 == 0 → 00,10,20,30,40,50
        d = alice.post(f"{API}/leads/check/{r['id']}/delete-dead", json={}).json()
        assert d['deleted'] == len(dead)
        assert db.webContacts.count_documents({'chatId': cid, 'phone': {'$in': [x['phone'] for x in dead]}}) == 0
        assert db.webContacts.count_documents({'chatId': cid}) == total - len(dead)

    def test_402_fresh_account(self):
        s = requests.Session()
        email = f"test173.{int(time.time())}@example.com"
        r = s.post(f"{API}/auth/register", json={'email': email, 'password': 'QaTest#2026x', 'name': 'TEST Fresh'})
        if r.status_code != 201:
            pytest.skip(f"register failed {r.status_code}")
        assert s.post(f"{API}/leads/check", json={'numbers': ['+14155550111']}).status_code == 402
        assert s.post(f"{API}/cnam", json={'phone': '+14155550111'}).status_code == 402
        r = s.post(f"{API}/leads/check", json={'numbers': [f"+1415555{i:04d}" for i in range(2001)]})
        assert r.status_code == 400 and r.json()['error'] == 'too_many'
