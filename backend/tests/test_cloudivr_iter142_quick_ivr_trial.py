# CloudIVR web: free Quick IVR trial (GET/POST /calls/trial, dashboard ivrTrial), terms page/SEO
import os, time, uuid
from datetime import datetime, timedelta, timezone
import pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
PW = 'QaTest#2026x'
mdb = MongoClient('mongodb://localhost:27017')['test']
CREATED = []


def register():
    s = requests.Session()
    email = f"qa.trial{int(time.time()*1000)}{uuid.uuid4().hex[:4]}@example.com"
    r = s.post(f"{API}/auth/register", json={'email': email, 'password': PW, 'name': 'QA Trial'})
    assert r.status_code == 201, r.text
    acc = r.json()['account']
    CREATED.append(acc['id'])
    return s, acc['id'], email


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'email': email, 'password': pw})
    assert r.status_code == 200, r.text
    return s


GOOD = {'to': '+14155550123', 'transferTo': '+14155550188', 'text': 'Hello, this is a test call. Press 1 to talk to us.'}


@pytest.fixture(scope='module')
def fresh():
    return register()


@pytest.fixture(scope='module')
def fresh2():
    return register()


class TestTrialStatus:
    def test_get_trial_new_account(self, fresh):
        s, cid, _ = fresh
        r = s.get(f"{API}/calls/trial")
        assert r.status_code == 200
        d = r.json()
        assert d['available'] is True and d['used'] is False and d['inProgress'] is False
        assert d['retryAt'] is None and d['callerId'] == '+18889020132'

    def test_dashboard_ivrtrial_true(self, fresh):
        r = fresh[0].get(f"{API}/dashboard")
        assert r.status_code == 200 and r.json().get('ivrTrial') is True

    def test_alice_no_trial(self):
        s = login('civr.alice@example.com', 'AliceTest#2026')
        assert s.get(f"{API}/dashboard").json().get('ivrTrial') is False
        d = s.get(f"{API}/calls/trial").json()
        assert d['available'] is False
        r = s.post(f"{API}/calls/trial", json=GOOD)
        assert r.status_code == 403 and r.json()['error'] == 'trial_used'

    def test_unauth(self):
        assert requests.get(f"{API}/calls/trial").status_code == 401


class TestTrialValidation:
    @pytest.mark.parametrize('body,code', [
        ({**GOOD, 'text': ''}, 'invalid_message'),
        ({**GOOD, 'to': '12'}, 'invalid_number'),
        ({**GOOD, 'to': ''}, 'invalid_number'),
        ({**GOOD, 'mode': 'otp'}, 'trial_transfer_only'),
        ({**GOOD, 'menu': {'1': {'action': 'forward', 'to': '+14155550199'}}}, 'trial_transfer_only'),
        ({**GOOD, 'to': '+14155550123, +14155550124'}, 'too_many_numbers'),
        ({**GOOD, 'transferTo': 'abc'}, 'invalid_transfer'),
        ({**GOOD, 'to': '+18889020132'}, 'same_number'),
    ])
    def test_validation(self, fresh, body, code):
        r = fresh[0].post(f"{API}/calls/trial", json=body)
        assert r.status_code == 400, r.text
        assert r.json()['error'] == code
        # validation failures must not consume or hold the trial
        d = fresh[0].get(f"{API}/calls/trial").json()
        assert d['available'] is True and d['inProgress'] is False

    def test_audio_ignored_requires_text(self, fresh):
        r = fresh[0].post(f"{API}/calls/trial", json={**GOOD, 'text': '', 'audioId': 'x'})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_message'


class TestTrialInProgressAndState:
    def test_pending_in_progress(self, fresh2):
        s, cid, _ = fresh2
        mdb.webPrefs.update_one({'_id': cid}, {'$set': {'ivrTrialPendingAt': datetime.now(timezone.utc) - timedelta(minutes=1)}}, upsert=True)
        d = s.get(f"{API}/calls/trial").json()
        assert d['inProgress'] is True and d['available'] is True and d['retryAt']
        r = s.post(f"{API}/calls/trial", json=GOOD)
        assert r.status_code == 409 and r.json()['error'] == 'trial_in_progress'

    def test_pending_expired(self, fresh2):
        s, cid, _ = fresh2
        mdb.webPrefs.update_one({'_id': cid}, {'$set': {'ivrTrialPendingAt': datetime.now(timezone.utc) - timedelta(minutes=6)}})
        d = s.get(f"{API}/calls/trial").json()
        assert d['inProgress'] is False and d['available'] is True

    def test_state_used(self, fresh2):
        s, cid, _ = fresh2
        mdb.state.update_one({'_id': f'ivrTrialUsed_{cid}'}, {'$set': {'val': True}}, upsert=True)
        try:
            d = s.get(f"{API}/calls/trial").json()
            assert d['available'] is False and d['used'] is True
            assert s.get(f"{API}/dashboard").json()['ivrTrial'] is False
            r = s.post(f"{API}/calls/trial", json=GOOD)
            assert r.status_code == 403
        finally:
            mdb.state.delete_one({'_id': f'ivrTrialUsed_{cid}'})


class TestTrialPlace:
    def test_place_then_used(self, fresh):
        s, cid, _ = fresh
        r = s.post(f"{API}/calls/trial", json=GOOD)
        assert r.status_code == 202, r.text
        d = r.json()
        assert d['dryRun'] is True and d['count'] == 1 and 'Preview mode' in d['message']
        assert d['trial']['available'] is False and d['trial']['used'] is True
        assert s.get(f"{API}/calls/trial").json()['available'] is False
        assert s.get(f"{API}/dashboard").json()['ivrTrial'] is False
        r2 = s.post(f"{API}/calls/trial", json=GOOD)
        assert r2.status_code == 403 and r2.json()['error'] == 'trial_used'
        p = mdb.webPrefs.find_one({'_id': cid})
        assert p.get('ivrTrialUsed') is True and 'ivrTrialPendingAt' not in p

    def test_trial_not_in_recent(self, fresh):
        r = fresh[0].get(f"{API}/calls/recent")
        assert r.status_code == 200 and '+14155550123' not in r.json()['numbers']

    def test_trial_in_history_flagged(self, fresh):
        calls = fresh[0].get(f"{API}/calls/history").json()['calls']
        assert calls and calls[0]['trial'] is True and calls[0]['callerId'] == '+18889020132'

    def test_trial_redial_blocked(self, fresh):
        calls = fresh[0].get(f"{API}/calls/history").json()['calls']
        r = fresh[0].post(f"{API}/calls/history/{calls[0]['id']}/redial")
        assert r.status_code == 404


class TestTermsSeo:
    # seo.js only serves on the custom domain, so check the generators directly via node
    def test_terms_meta_and_sitemap(self):
        import subprocess
        js = "const s=require('/app/js/cloudivr-web/seo.js');console.log(JSON.stringify({h:/Terms of Service \u00b7 CloudIVR/.test(s.headTags('/terms')),m:s.sitemapXml().includes('/terms')}))"
        out = subprocess.run(['node', '-e', js], capture_output=True, text=True, cwd='/app').stdout.strip().splitlines()[-1]
        import json
        d = json.loads(out)
        assert d['h'] and d['m']

    def test_terms_spa_route(self):
        assert requests.get(f"{BASE_URL}/cloudivr/terms").status_code == 200
