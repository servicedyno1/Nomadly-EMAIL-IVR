# iter219: Caller ID presets (GET /caller-ids/presets, 10 cap on attest) + price-gap Business upgrade quote (POST /caller-ids/upgrade)
import os, time, requests, pytest
from pymongo import MongoClient
from dotenv import dotenv_values

BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or dotenv_values('/app/frontend/.env')['REACT_APP_BACKEND_URL']).rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ENV = dotenv_values('/app/backend/.env')
db = MongoClient(ENV['MONGO_URL'])[ENV['DB_NAME']]
ALICE, BOB = '5000000000000001', '5000000000000002'
BOB_PRO = '+18509558201'
created = []  # webCallerIds _ids created by this module


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
        db.webCallerIds.delete_one({'_id': n})
        db.callerIdDefaults.delete_many({'showAs': n})


def bal(chat):
    w = db.walletOf.find_one({'_id': chat}) or {}
    return round((w.get('usdIn', 0) or 0) - (w.get('usdOut', 0) or 0), 4)


# Presets API
class TestPresets:
    def test_requires_auth(self):
        assert requests.get(f"{API}/caller-ids/presets").status_code == 401

    def test_shape(self, alice):
        r = alice.get(f"{API}/caller-ids/presets")
        assert r.status_code == 200
        d = r.json()
        assert d['max'] == 10 and isinstance(d['items'], list)

    def test_attest_appears_in_presets(self, alice):
        n = '+14155551901'
        r = alice.post(f"{API}/caller-ids/attest", json={"number": n, "authorized": True})
        assert r.status_code == 201, r.text
        created.append(n)
        assert n in alice.get(f"{API}/caller-ids/presets").json()['items']

    def test_emergency_refused(self, alice):
        r = alice.post(f"{API}/caller-ids/attest", json={"number": "911", "authorized": True})
        assert r.status_code == 400 and r.json()['error'] == 'emergency_number'

    def test_cap_10(self, alice):
        existing = db.webCallerIds.count_documents({'chatId': ALICE, 'status': 'verified', 'method': 'attested'})
        for i in range(10 - existing):
            n = f'+1415555{1910 + i}'
            r = alice.post(f"{API}/caller-ids/attest", json={"number": n, "authorized": True})
            assert r.status_code == 201, r.text
            created.append(n)
        r = alice.post(f"{API}/caller-ids/attest", json={"number": "+14155551999", "authorized": True})
        assert r.status_code == 400
        assert r.json()['error'] == 'too_many_presets'
        assert 'You can save up to 10 caller IDs' in r.json()['message']
        # re-attesting a saved one still OK
        assert alice.post(f"{API}/caller-ids/attest", json={"number": created[0], "authorized": True}).status_code == 201
        items = alice.get(f"{API}/caller-ids/presets").json()['items']
        assert sum(1 for x in items if x in created) == 10

    def test_quick_call_with_preset_showas(self, alice):
        r = alice.post(f"{API}/calls/quick", json={"from": "+13346972125", "to": "+14155550142", "showAs": created[0], "text": "Hello test"})
        print('quick', r.status_code, r.text[:300])
        assert r.status_code != 500

    def test_cleanup_cap(self, alice):
        # remove via API to free slots
        for n in list(created):
            r = alice.delete(f"{API}/caller-ids/{n}")
            assert r.status_code == 200
        assert not any(x in created for x in alice.get(f"{API}/caller-ids/presets").json()['items'])


# Bob (no Business) — attested hidden + upgrade quote
class TestBobUpgradeQuote:
    def test_bob_attest_forbidden(self, bob):
        if any(n.get('plan') == 'business' and n.get('status') == 'active' for n in (db.phoneNumbersOf.find_one({'_id': BOB}) or {}).get('val', {}).get('numbers', [])):
            pytest.skip('Bob already Business')
        r = bob.post(f"{API}/caller-ids/attest", json={"number": "+14155551988", "authorized": True})
        assert r.status_code == 403 and r.json()['error'] == 'plan_required'

    def test_attested_hidden_without_business(self, bob):
        if any(n.get('plan') == 'business' and n.get('status') == 'active' for n in (db.phoneNumbersOf.find_one({'_id': BOB}) or {}).get('val', {}).get('numbers', [])):
            pytest.skip('Bob already Business')
        n = '+14155551977'
        db.webCallerIds.replace_one({'_id': n}, {'_id': n, 'chatId': BOB, 'status': 'verified', 'method': 'attested', 'createdAt': int(time.time() * 1000)}, upsert=True)
        created.append(n)
        assert n not in bob.get(f"{API}/caller-ids/presets").json()['items']
        db.webCallerIds.delete_one({'_id': n})

    def test_upgrade_quote_diff(self, bob):
        if any(n.get('phoneNumber') == BOB_PRO and n.get('plan') != 'pro' for n in (db.phoneNumbersOf.find_one({'_id': BOB}) or {}).get('val', {}).get('numbers', [])):
            pytest.skip('Bob Pro number already upgraded (iter219 UI test upgraded it)')
        before = bal(BOB)
        r = bob.post(f"{API}/caller-ids/upgrade", json={})
        print(r.text)
        assert r.status_code == 200
        d = r.json()
        assert d['number'] == BOB_PRO and d['plan'] == 'pro'
        assert d['quote']['charge'] == 45
        assert bal(BOB) == before  # no debit without confirm

    def test_upgrade_quote_for_starter(self, bob):
        r = bob.post(f"{API}/caller-ids/upgrade", json={"number": "+14062358695"})
        assert r.status_code == 200 and r.json()['quote']['charge'] == 70

    def test_regression_normal_upgrade_quote(self, bob):
        # Starter -> Pro normal (25% credit rule) pricing unchanged: 75 - 12.5 within 14 days, else 75
        r = bob.post(f"{API}/numbers/{requests.utils.quote('+14062358695')}/upgrade", json={"plan": "business"})
        print(r.text)
        assert r.status_code == 200
        assert r.json()['quote']['charge'] in (107.5, 120)
