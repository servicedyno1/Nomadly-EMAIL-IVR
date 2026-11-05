# iter221: caller ID labels (PUT /caller-ids/:number/label), presets as {number,label}, last-used-first ordering, attest with label
import os, time, requests, pytest
from pymongo import MongoClient
from dotenv import dotenv_values

BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or dotenv_values('/app/frontend/.env')['REACT_APP_BACKEND_URL']).rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ENV = dotenv_values('/app/backend/.env')
db = MongoClient(ENV['MONGO_URL'])[ENV['DB_NAME']]
ALICE = '5000000000000001'
NEW = '+14155552211'
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
    snap = {d['_id']: d.get('lastUsedAt') for d in db.webCallerIds.find({'chatId': ALICE})}
    yield
    for n in created:
        db.webCallerIds.delete_one({'_id': n, 'chatId': ALICE})
    db.webCallerIds.update_one({'_id': '+16462556424', 'chatId': ALICE}, {'$set': {'label': 'Office'}})


# Presets shape
class TestPresets:
    def test_presets_objects(self, alice):
        r = alice.get(f"{API}/caller-ids/presets")
        assert r.status_code == 200
        items = r.json()['items']
        assert items and all(isinstance(i, dict) and set(i) >= {'number', 'label'} for i in items)
        office = [i for i in items if i['number'] == '+16462556424']
        assert office and office[0]['label'] == 'Office'

    def test_list_has_label(self, alice):
        items = alice.get(f"{API}/caller-ids").json()['items']
        assert all('label' in i for i in items)
        assert any(i['label'] == 'Office' for i in items)


# Attest with label + rename + clear + 404 + trim
class TestLabels:
    def test_attest_with_label(self, alice):
        r = alice.post(f"{API}/caller-ids/attest", json={"number": NEW, "authorized": True, "label": "  TEST_Front desk  "})
        assert r.status_code == 201, r.text
        created.append(NEW)
        p = alice.get(f"{API}/caller-ids/presets").json()['items']
        hit = [i for i in p if i['number'] == NEW]
        assert hit and hit[0]['label'] == 'TEST_Front desk'

    def test_rename_trim_24(self, alice):
        r = alice.put(f"{API}/caller-ids/{NEW.replace('+', '%2B')}/label", json={"label": "TEST_" + "x" * 40})
        assert r.status_code == 200, r.text
        assert r.json()['label'] == ("TEST_" + "x" * 40)[:24]
        items = alice.get(f"{API}/caller-ids").json()['items']
        assert [i for i in items if i['number'] == NEW][0]['label'] == ("TEST_" + "x" * 40)[:24]

    def test_clear_label(self, alice):
        r = alice.put(f"{API}/caller-ids/{NEW.replace('+', '%2B')}/label", json={"label": "   "})
        assert r.status_code == 200 and r.json()['label'] is None
        p = alice.get(f"{API}/caller-ids/presets").json()['items']
        assert [i for i in p if i['number'] == NEW][0]['label'] is None

    def test_label_404_not_mine(self, alice, bob):
        r = alice.put(f"{API}/caller-ids/%2B19995550000/label", json={"label": "TEST_x"})
        assert r.status_code == 404 and r.json()['error'] == 'not_found'
        r2 = bob.put(f"{API}/caller-ids/{NEW.replace('+', '%2B')}/label", json={"label": "TEST_hijack"})
        assert r2.status_code == 404
        assert db.webCallerIds.find_one({'_id': NEW})['chatId'] == ALICE

    def test_label_no_auth(self):
        r = requests.put(f"{API}/caller-ids/{NEW.replace('+', '%2B')}/label", json={"label": "x"})
        assert r.status_code == 401

    def test_rename_unencoded_plus(self, alice):
        r = alice.put(f"{API}/caller-ids/{NEW}/label", json={"label": "TEST_plain"})
        assert r.status_code == 200, r.text
        assert r.json()['label'] == 'TEST_plain'


# Last used first: a dry-run callback call with showAs moves that preset to the front
class TestOrder:
    def test_last_used_first(self, alice):
        items = alice.get(f"{API}/caller-ids/presets").json()['items']
        assert len(items) >= 2
        last = items[-1]['number']
        r = alice.post(f"{API}/calls/callback", json={"from": "+13346972125", "callerId": "+13346972125", "myPhone": "+14155553001", "to": "+14155553002", "showAs": last})
        print(r.status_code, r.text[:300])
        time.sleep(1)
        items2 = alice.get(f"{API}/caller-ids/presets").json()['items']
        assert items2[0]['number'] == last, (r.status_code, r.text[:200], items2)
