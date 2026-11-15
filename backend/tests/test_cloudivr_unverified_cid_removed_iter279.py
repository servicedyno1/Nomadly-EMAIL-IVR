# CloudIVR iter279: unverified caller IDs removed (attest, resolve, presets, try call, phone test), landing catalog, regression smoke.
import os
import subprocess
import time
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026')
ALICE_OWN = '+13346970100'
db = MongoClient('mongodb://localhost:27017')['test']
ATT = '+14155559901'   # TEST attested doc
VER = '+14155559902'   # TEST code-verified doc


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'email': email, 'password': pw})
    assert r.status_code == 200, r.text
    return s


def try_token(email):
    js = ("const c=require('crypto'),jwt=require('/app/node_modules/jsonwebtoken');require('/app/node_modules/dotenv').config({path:'/app/backend/.env'});"
          "const {secret}=require('/app/js/cloudivr-web/auth');const s=c.createHash('sha256').update('try:'+secret()).digest('hex');"
          f"process.stdout.write(jwt.sign({{email:'{email}',k:'try'}},s,{{expiresIn:'5m'}}))")
    return subprocess.check_output(['node', '-e', js], cwd='/app', stderr=subprocess.DEVNULL).decode().strip().splitlines()[-1]


@pytest.fixture(scope='module')
def alice():
    s = login(*ALICE)
    cid = str(int(db.webAccounts.find_one({'email': ALICE[0]})['_id']))
    now = datetime.now(timezone.utc)
    db.webCallerIds.replace_one({'_id': ATT}, {'_id': ATT, 'chatId': cid, 'status': 'verified', 'method': 'attested', 'attested': True, 'createdAt': int(time.time() * 1000), 'verifiedAt': now}, upsert=True)
    db.webCallerIds.replace_one({'_id': VER}, {'_id': VER, 'chatId': cid, 'status': 'verified', 'method': 'call', 'createdAt': int(time.time() * 1000), 'verifiedAt': now}, upsert=True)
    prev = db.callerIdDefaults.find_one({'_id': ALICE_OWN})
    sw = db.appSettings.find_one({'_id': 'customCallerId'})
    if not (sw or {}).get('enabled'):
        db.appSettings.update_one({'_id': 'customCallerId'}, {'$set': {'enabled': True, 'by': 'TEST_iter279'}}, upsert=True)
        time.sleep(32)  # loadSwitch polls every 30 s
    yield s, cid
    if sw is None:
        db.appSettings.delete_one({'_id': 'customCallerId'})
    else:
        db.appSettings.replace_one({'_id': 'customCallerId'}, sw)
    db.webCallerIds.delete_many({'_id': {'$in': [ATT, VER]}})
    if prev:
        db.callerIdDefaults.replace_one({'_id': ALICE_OWN}, prev, upsert=True)
    else:
        db.callerIdDefaults.delete_one({'_id': ALICE_OWN})


# Attest endpoint always refuses
class TestAttest:
    def test_attest_authorized_true(self, alice):
        r = alice[0].post(f"{API}/caller-ids/attest", json={'number': '+14155559903', 'authorized': True})
        assert r.status_code == 400 and r.json()['error'] == 'verification_required', r.text
        assert db.webCallerIds.find_one({'_id': '+14155559903'}) is None

    def test_attest_without_authorized(self, alice):
        r = alice[0].post(f"{API}/caller-ids/attest", json={'number': '+14155559903'})
        assert r.status_code == 400
        assert r.json()['error'] == 'verification_required', f"got {r.json()['error']}"


# resolve() ignores attested docs; accepts code-verified
class TestResolve:
    def test_default_with_attested_rejected(self, alice):
        r = alice[0].put(f"{API}/caller-ids/default", json={'number': ALICE_OWN, 'showAs': ATT})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_show_as', r.text

    def test_default_with_code_verified_ok(self, alice):
        r = alice[0].put(f"{API}/caller-ids/default", json={'number': ALICE_OWN, 'showAs': VER})
        assert r.status_code == 200 and r.json()['showAs'] == VER, r.text
        alice[0].put(f"{API}/caller-ids/default", json={'number': ALICE_OWN, 'showAs': None})

    def test_presets_exclude_attested(self, alice):
        r = alice[0].get(f"{API}/caller-ids/presets")
        assert r.status_code == 200
        nums = [i['number'] for i in r.json()['items']]
        assert VER in nums
        assert ATT not in nums, f"attested (unverified) caller ID still offered as a preset: {nums}"


# Free try calls refuse showAs
class TestTryCalls:
    def test_call_me_show_as(self):
        tok = try_token(f"test_iter279_{int(time.time())}@example.com")
        r = requests.post(f"{API}/public/try/call-me", json={'token': tok, 'to': '+14155550177', 'showAs': '+14155550100'})
        if r.status_code == 429:
            pytest.skip('daily_limit hit before showAs check')
        assert r.status_code == 400 and r.json()['error'] == 'invalid_show_as', r.text

    def test_browser_show_as(self):
        tok = try_token(f"test_iter279b_{int(time.time())}@example.com")
        r = requests.post(f"{API}/public/try/browser", json={'token': tok, 'to': '+14155550178', 'showAs': '+14155550100'})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_show_as', r.text

    def test_phone_test_caller_id(self):
        r = requests.post(f"{BASE_URL}/api/phone/test/caller-id", json={'sipUsername': 'test_none', 'showAs': '+14155550100'})
        assert r.status_code == 400 and 'Custom caller IDs' in r.json()['error'], r.text


# Regression smoke
class TestRegression:
    def test_health(self):
        assert requests.get(f"{BASE_URL}/api/health").status_code == 200

    def test_alice_me_and_numbers(self, alice):
        r = alice[0].get(f"{API}/auth/me")
        assert r.status_code == 200 and r.json().get('email', r.json().get('account', {}).get('email')) == ALICE[0]
        n = alice[0].get(f"{API}/numbers")
        assert n.status_code == 200

    def test_unauth_numbers(self):
        assert requests.get(f"{API}/numbers").status_code == 401
