# iter220: caller ID 10-cap counts ALL verified IDs; presets <= 10; /caller-ids/upgrade explicit number filter (replaced/sub/inactive -> 404)
import os, requests, pytest
from pymongo import MongoClient
from dotenv import dotenv_values

BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or dotenv_values('/app/frontend/.env')['REACT_APP_BACKEND_URL']).rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ENV = dotenv_values('/app/backend/.env')
db = MongoClient(ENV['MONGO_URL'])[ENV['DB_NAME']]
ALICE, BOB = '5000000000000001', '5000000000000002'
created = []


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code}")
    return s


@pytest.fixture(scope='module')
def alice():
    return login('civr.alice@example.com', 'AliceTest#2026')


@pytest.fixture(scope='module')
def bob():
    return login('civr.bob@example.com', 'BobTest#2026')


@pytest.fixture(scope='module', autouse=True)
def cleanup():
    yield
    for n in created:
        db.webCallerIds.delete_one({'_id': n, 'chatId': ALICE})


# Cap counts every verified caller ID (auto/code/attested)
class TestCap:
    def test_cap_counts_all_verified(self, alice):
        total = db.webCallerIds.count_documents({'chatId': ALICE, 'status': 'verified'})
        non_attested = db.webCallerIds.count_documents({'chatId': ALICE, 'status': 'verified', 'method': {'$ne': 'attested'}})
        assert non_attested >= 1, 'need at least one non-attested verified ID to prove the fix'
        for i in range(10 - total):
            n = f'+1415555{2010 + i}'
            r = alice.post(f"{API}/caller-ids/attest", json={"number": n, "authorized": True})
            assert r.status_code == 201, r.text
            created.append(n)
        assert db.webCallerIds.count_documents({'chatId': ALICE, 'status': 'verified'}) == 10
        r = alice.post(f"{API}/caller-ids/attest", json={"number": "+14155552099", "authorized": True})
        assert r.status_code == 400, r.text
        assert r.json()['error'] == 'too_many_presets'
        # attested count is < 10 => old logic would have allowed it
        assert db.webCallerIds.count_documents({'chatId': ALICE, 'status': 'verified', 'method': 'attested'}) < 10

    def test_presets_max_10(self, alice):
        # inject extra verified (code) docs directly to exceed 10, presets must still slice to 10
        for i in range(3):
            n = f'+1415555{2090 + i}'
            db.webCallerIds.replace_one({'_id': n}, {'_id': n, 'chatId': ALICE, 'status': 'verified', 'method': 'sms', 'createdAt': 1}, upsert=True)
            created.append(n)
        assert db.webCallerIds.count_documents({'chatId': ALICE, 'status': 'verified'}) > 10
        d = alice.get(f"{API}/caller-ids/presets").json()
        assert d['max'] == 10
        assert len(d['items']) == 10, d


# Upgrade explicit-number filter
class TestUpgradeFilter:
    def test_replaced_number_404(self, bob):
        r = bob.post(f"{API}/caller-ids/upgrade", json={"number": "+19522349029"})
        assert r.status_code == 404 and r.json()['error'] == 'not_found', r.text

    def test_sub_number_404(self, alice):
        r = alice.post(f"{API}/caller-ids/upgrade", json={"number": "+12138340888"})
        assert r.status_code == 404 and r.json()['error'] == 'not_found', r.text

    def test_inactive_number_404(self, bob):
        ph = '+14062358695'
        db.phoneNumbersOf.update_one({'_id': BOB, 'val.numbers.phoneNumber': ph}, {'$set': {'val.numbers.$.status': 'suspended'}})
        try:
            r = bob.post(f"{API}/caller-ids/upgrade", json={"number": ph})
            assert r.status_code == 404 and r.json()['error'] == 'not_found', r.text
        finally:
            db.phoneNumbersOf.update_one({'_id': BOB, 'val.numbers.phoneNumber': ph}, {'$set': {'val.numbers.$.status': 'active'}})

    def test_unknown_number_404(self, bob):
        r = bob.post(f"{API}/caller-ids/upgrade", json={"number": "+14155550000"})
        assert r.status_code == 404

    def test_valid_pro_quote(self, alice):
        r = alice.post(f"{API}/caller-ids/upgrade", json={"number": "+12138340902"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['number'] == '+12138340902' and d['plan'] == 'pro'
        assert d['quote']['charge'] == 45

    def test_valid_starter_quote(self, bob):
        r = bob.post(f"{API}/caller-ids/upgrade", json={"number": "+14062358695"})
        assert r.status_code == 200, r.text
        assert r.json()['quote']['charge'] == 70
