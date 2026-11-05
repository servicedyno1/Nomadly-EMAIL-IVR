# iter217: Custom caller ID web API (attest/defaults/default) + public try-call showAs + /phone/test/caller-id
import os, time, uuid, requests, pytest
from pymongo import MongoClient
from dotenv import dotenv_values

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL') or dotenv_values('/app/frontend/.env')['REACT_APP_BACKEND_URL']
BASE_URL = BASE_URL.rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ENV = dotenv_values('/app/backend/.env')
db = MongoClient(ENV['MONGO_URL'])[ENV['DB_NAME']]
ALICE_OWN = '+13346972125'
N_ATTEST = '+14155550927'
created_cids, created_creds = [], []


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code} {r.text[:200]}")
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
    for n in created_cids:
        db.webCallerIds.delete_one({'_id': n})
    db.callerIdDefaults.delete_one({'_id': ALICE_OWN, 'showAs': N_ATTEST})
    db.callerIdUses.delete_many({'showAs': N_ATTEST})
    for u in created_creds:
        db.testCredentials.delete_one({'sipUsername': u})
        db.callerIdUses.delete_many({'chatId': 'T217_sipchat'})


# Attest
class TestAttest:
    def test_requires_auth(self):
        r = requests.post(f"{API}/caller-ids/attest", json={"number": N_ATTEST, "authorized": True})
        assert r.status_code == 401

    def test_requires_authorized_true(self, alice):
        r = alice.post(f"{API}/caller-ids/attest", json={"number": N_ATTEST})
        assert r.status_code == 400 and r.json()['error'] == 'not_authorized'

    def test_emergency_blocked(self, alice):
        r = alice.post(f"{API}/caller-ids/attest", json={"number": "911", "authorized": True})
        assert r.status_code == 400 and r.json()['error'] == 'emergency_number'

    def test_invalid(self, alice):
        r = alice.post(f"{API}/caller-ids/attest", json={"number": "123", "authorized": True})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_number'

    def test_non_business_plan_required(self, bob):
        r = bob.post(f"{API}/caller-ids/attest", json={"number": N_ATTEST, "authorized": True})
        assert r.status_code == 403 and r.json()['error'] == 'plan_required'

    def test_business_ok_and_listed(self, alice):
        created_cids.append(N_ATTEST)
        r = alice.post(f"{API}/caller-ids/attest", json={"number": N_ATTEST, "authorized": True})
        assert r.status_code == 201, r.text
        assert r.json() == {"number": N_ATTEST, "status": "verified", "method": "attested"}
        items = alice.get(f"{API}/caller-ids").json()['items']
        assert any(i['number'] == N_ATTEST and i['status'] == 'verified' and i['method'] == 'attested' for i in items)


# SIP defaults
class TestDefaults:
    def test_set_default_own_number(self, alice):
        r = alice.put(f"{API}/caller-ids/default", json={"number": ALICE_OWN, "showAs": N_ATTEST})
        assert r.status_code == 200, r.text
        assert r.json()['showAs'] == N_ATTEST
        items = alice.get(f"{API}/caller-ids/defaults").json()['items']
        assert {"number": ALICE_OWN, "showAs": N_ATTEST} in items

    def test_default_not_own_number(self, alice):
        r = alice.put(f"{API}/caller-ids/default", json={"number": "+14155550100", "showAs": N_ATTEST})
        assert r.status_code == 404

    def test_default_unverified_showas(self, alice):
        r = alice.put(f"{API}/caller-ids/default", json={"number": ALICE_OWN, "showAs": "+14155550001"})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_show_as'

    def test_bob_cannot_set_alice_number(self, bob):
        r = bob.put(f"{API}/caller-ids/default", json={"number": ALICE_OWN, "showAs": N_ATTEST})
        assert r.status_code == 404

    def test_clear_default(self, alice):
        r = alice.put(f"{API}/caller-ids/default", json={"number": ALICE_OWN, "showAs": None})
        assert r.status_code == 200 and r.json()['showAs'] is None
        items = alice.get(f"{API}/caller-ids/defaults").json()['items']
        assert not any(i['number'] == ALICE_OWN for i in items)


def try_token():
    email = f"test_iter217_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/public/try/send-code", json={"email": email})
    if r.status_code != 200 or 'previewCode' not in r.json():
        pytest.skip(f"send-code: {r.status_code} {r.text[:200]}")
    v = requests.post(f"{API}/public/try/verify", json={"email": email, "code": r.json()['previewCode']})
    assert v.status_code == 200, v.text
    return v.json()['token'], email


# Public try-call showAs
class TestTryShowAs:
    @pytest.fixture(scope='class')
    def tok(self):
        return try_token()

    def _h(self, t):
        return {"Authorization": f"Bearer {t}"}

    @pytest.mark.parametrize('kind', ['call-me', 'browser'])
    @pytest.mark.parametrize('bad', ['911', '112', '12ab'])
    def test_bad_showas(self, tok, kind, bad):
        r = requests.post(f"{API}/public/try/{kind}", json={"to": "+14155550133", "showAs": bad, "token": tok[0]})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_show_as', r.text

    def test_browser_valid_showas_dry(self, tok):
        r = requests.post(f"{API}/public/try/browser", json={"to": "+14155550133", "showAs": "+14155550199", "token": tok[0]})
        assert r.status_code in (200, 201), r.text
        assert r.json()['dryRun'] is True
        db.webTryCalls.delete_one({'_id': r.json()['id']})


# /phone/test/caller-id
class TestPhoneTestCallerId:
    def test_unknown_login_404(self):
        r = requests.post(f"{BASE_URL}/api/phone/test/caller-id", json={"sipUsername": "nope_" + uuid.uuid4().hex, "showAs": "+14155550199"})
        assert r.status_code == 404

    def test_emergency_400(self):
        r = requests.post(f"{BASE_URL}/api/phone/test/caller-id", json={"sipUsername": "x", "showAs": "911"})
        assert r.status_code == 400

    def test_set_and_clear(self):
        u = 'T217sip' + uuid.uuid4().hex[:6]
        created_creds.append(u)
        db.testCredentials.insert_one({'chatId': 'T217_sipchat', 'sipUsername': u, 'expired': False, 'callsMade': 0, 'createdAt': time.time()})
        r = requests.post(f"{BASE_URL}/api/phone/test/caller-id", json={"sipUsername": u, "showAs": "4155550199"})
        assert r.status_code == 200 and r.json()['showAs'] == '+4155550199' or r.json()['showAs'] == '+14155550199', r.text
        r = requests.post(f"{BASE_URL}/api/phone/test/caller-id", json={"sipUsername": u, "showAs": "+14155550199"})
        assert r.json()['showAs'] == '+14155550199'
        assert db.testCredentials.find_one({'sipUsername': u})['showAs'] == '+14155550199'
        r = requests.post(f"{BASE_URL}/api/phone/test/caller-id", json={"sipUsername": u, "showAs": ""})
        assert r.status_code == 200 and r.json()['showAs'] is None
