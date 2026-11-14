# CloudIVR iter275: onboarding redesign — journey events, signup source/marketing opt-in, onboarding purposes, email prefs marketing
import os
import time
import requests
import pytest
from pymongo import MongoClient
from dotenv import dotenv_values

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE}/api/cloudivr-web"
ENV = dotenv_values('/app/backend/.env')
PW = 'QaTest#2026x'
ST = {}
CREATED_ACC = []  # account _ids created by this module
CREATED_EVT = []  # webEvents marker anon ids


def db():
    return MongoClient(ENV['MONGO_URL'])[ENV['DB_NAME']]


def register(opt_in, source=None, tag='a'):
    s = requests.Session()
    email = f"test_iter275_{tag}_{int(time.time()*1000)}@example.com"
    body = {'email': email, 'password': PW, 'name': 'TEST_ Iter275', 'acceptPolicy': True, 'marketingOptIn': opt_in}
    if source is not None:
        body['source'] = source
    r = s.post(f"{API}/auth/register", json=body)
    assert r.status_code == 201, r.text
    acc = db().webAccounts.find_one({'email': email})
    assert acc
    CREATED_ACC.append(acc['_id'])
    return s, acc


def purge(d, aid):
    sid = str(int(aid))
    d.webAccounts.delete_one({'_id': aid})
    for c in ('webPrefs', 'walletOf', 'state', 'nameOf', 'compliance'):
        d[c].delete_one({'_id': sid})
    d.webEvents.delete_many({'chatId': sid})
    d.legalAcceptances.delete_many({'chatId': sid})


@pytest.fixture(scope='module', autouse=True)
def cleanup():
    yield
    d = db()
    for aid in CREATED_ACC:
        purge(d, aid)
    for a in CREATED_EVT:
        d.webEvents.delete_many({'anon': a})


# Journey events
class TestEvents:
    def test_anon_event_ok(self):
        anon = f"t275anon{int(time.time())}"
        CREATED_EVT.append(anon)
        r = requests.post(f"{API}/events", json={'name': 'page_view', 'anon': anon, 'path': '/cloudivr/x', 'props': {'a': 1}})
        assert r.status_code == 200 and r.json()['ok'] is True
        doc = db().webEvents.find_one({'anon': anon})
        assert doc and doc['name'] == 'page_view' and doc['chatId'] is None and doc['props'] == {'a': 1}

    @pytest.mark.parametrize('name', ['signup_started', 'signup_done', 'purpose_picked', 'purpose_skipped', 'travel_esim_zone', 'travel_esim_paid'])
    def test_whitelisted(self, name):
        anon = f"t275w{name}{int(time.time())}"
        CREATED_EVT.append(anon)
        r = requests.post(f"{API}/events", json={'name': name, 'anon': anon})
        assert r.status_code == 200, r.text

    def test_unknown_rejected(self):
        r = requests.post(f"{API}/events", json={'name': 'hack_me'})
        assert r.status_code == 400 and r.json()['error'] == 'unknown_event'
        r2 = requests.post(f"{API}/events", json={})
        assert r2.status_code == 400

    def test_logged_in_has_chatid(self):
        s, acc = register(False, tag='ev')
        ST['ev'] = (s, acc)
        r = s.post(f"{API}/events", json={'name': 'purpose_picked', 'props': {'purposes': 'travel'}})
        assert r.status_code == 200
        doc = db().webEvents.find_one({'chatId': str(int(acc['_id'])), 'name': 'purpose_picked'})
        assert doc and doc['props']['purposes'] == 'travel'


# Register: source + marketing opt-in
class TestRegister:
    def test_source_whitelist_and_optin(self):
        src = {'utm_source': 'testsrc', 'utm_campaign': 'c1', 'evil': 'x', 'landing': '/cloudivr', 'at': 123}
        s, acc = register(True, src, tag='src')
        assert acc['marketingOptIn'] is True and acc.get('marketingOptInAt')
        assert acc['source'].get('utm_source') == 'testsrc' and acc['source'].get('utm_campaign') == 'c1'
        assert 'evil' not in acc['source'] and 'at' not in acc['source']
        assert isinstance(acc.get('signupDevice'), str)
        r = s.get(f"{API}/prefs/email")
        assert r.status_code == 200 and r.json()['prefs']['marketing'] is True
        ST['src'] = (s, acc)

    def test_default_optout(self):
        s, acc = register(False, tag='out')
        assert acc['marketingOptIn'] is False
        r = s.get(f"{API}/prefs/email")
        assert r.json()['prefs']['marketing'] is False
        ST['out'] = (s, acc)

    def test_optin_non_bool_is_false(self):
        s, acc = register('yes', tag='nb')
        assert acc['marketingOptIn'] is False


# Email prefs marketing toggle
class TestEmailPrefs:
    def test_flip_marketing(self):
        s, acc = ST.get('out') or register(False, tag='out2')
        r = s.put(f"{API}/prefs/email", json={'marketing': True})
        assert r.status_code == 200 and r.json()['prefs']['marketing'] is True
        a = db().webAccounts.find_one({'_id': acc['_id']})
        assert a['marketingOptIn'] is True
        r = s.put(f"{API}/prefs/email", json={'marketing': False})
        assert r.json()['prefs']['marketing'] is False
        assert db().webAccounts.find_one({'_id': acc['_id']})['marketingOptIn'] is False
        assert s.get(f"{API}/prefs/email").json()['prefs']['marketing'] is False

    def test_bad_value(self):
        s, _ = ST.get('out') or register(False, tag='out3')
        r = s.put(f"{API}/prefs/email", json={'marketing': 'yes'})
        assert r.status_code == 400

    def test_unauth(self):
        assert requests.put(f"{API}/prefs/email", json={'marketing': True}).status_code == 401


# Onboarding purposes
class TestOnboarding:
    def test_new_and_legacy_ids(self):
        s, _ = ST.get('out') or register(False, tag='onb')
        r = s.get(f"{API}/prefs/onboarding")
        assert r.status_code == 200 and r.json()['onboarded'] is False and r.json()['purposes'] == []
        r = s.put(f"{API}/prefs/onboarding", json={'purposes': ['travel', 'texting', 'line', 'ai', 'bulk', 'fax', 'other', 'sales', 'bogus', 'travel']})
        assert r.status_code == 200
        assert r.json()['purposes'] == ['travel', 'texting', 'line', 'ai', 'bulk', 'fax', 'other', 'sales']
        g = s.get(f"{API}/prefs/onboarding").json()
        assert g['onboarded'] is True and 'bogus' not in g['purposes'] and 'travel' in g['purposes']
