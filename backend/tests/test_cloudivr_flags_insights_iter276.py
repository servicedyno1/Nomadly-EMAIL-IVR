# CloudIVR iter276: admin signup-insights endpoint, travel-esim zone codes + order fields (phoneNumber/install)
import os
import time
import requests
import pytest
from datetime import datetime, timezone
from pymongo import MongoClient
from dotenv import dotenv_values

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE}/api/cloudivr-web"
ENV = dotenv_values('/app/backend/.env')
ADMIN = ('moxxcompany@gmail.com', 'Katiekendra123@')
ALICE = ('civr.alice@example.com', 'AliceTest#2026')
PW = 'QaTest#2026x'
CREATED_ACC = []
CREATED_ESIM = []


def db():
    return MongoClient(ENV['MONGO_URL'])[ENV['DB_NAME']]


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
    for eid in CREATED_ESIM:
        d.travelEsims.delete_one({'_id': eid})


@pytest.fixture(scope='module')
def admin():
    s = requests.Session()
    r = s.post(f"{API}/admin/login", json={"email": ADMIN[0], "password": ADMIN[1]})
    if r.status_code != 200:
        pytest.skip(f"admin login {r.status_code} {r.text[:200]}")
    j = r.json()
    r = s.post(f"{API}/admin/verify", json={"challenge": j['challenge'], "code": j.get('devCode')})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope='module')
def alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ALICE[0], "password": ALICE[1]})
    if r.status_code != 200:
        pytest.skip(f"alice login {r.status_code}")
    return s


# Signup insights: auth
class TestInsightsAuth:
    def test_no_session(self):
        r = requests.get(f"{API}/admin/signup-insights?days=7")
        assert r.status_code in (401, 403)

    def test_normal_user_rejected(self, alice):
        r = alice.get(f"{API}/admin/signup-insights?days=7")
        assert r.status_code in (401, 403)


# Signup insights: shape + days param
class TestInsightsData:
    @pytest.mark.parametrize('days', [7, 30, 90])
    def test_shape(self, admin, days):
        r = admin.get(f"{API}/admin/signup-insights", params={'days': days})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['days'] == days
        for k in ('signups', 'optIn', 'paid', 'skipped', 'unanswered'):
            assert isinstance(d[k], int)
        for k in ('bySource', 'byCampaign', 'byDevice', 'purposes', 'visitorExits', 'userExits'):
            assert isinstance(d[k], list)
        assert len(d['funnel']) == 5 and d['funnel'][2][1] == d['signups']

    def test_bad_days_defaults_30(self, admin):
        r = admin.get(f"{API}/admin/signup-insights", params={'days': 999})
        assert r.status_code == 200 and r.json()['days'] == 30

    def test_new_signup_counted(self, admin):
        before = admin.get(f"{API}/admin/signup-insights?days=7").json()
        s = requests.Session()
        email = f"test_iter276_{int(time.time()*1000)}@example.com"
        r = s.post(f"{API}/auth/register", json={'email': email, 'password': PW, 'name': 'TEST_ Iter276', 'acceptPolicy': True,
                                                  'marketingOptIn': True, 'source': {'utm_source': 'insighttest_api', 'utm_campaign': 'iter276camp'}})
        assert r.status_code == 201, r.text
        acc = db().webAccounts.find_one({'email': email})
        CREATED_ACC.append(acc['_id'])
        r = s.put(f"{API}/prefs/onboarding", json={'purposes': ['travel']})
        assert r.status_code == 200, r.text
        after = admin.get(f"{API}/admin/signup-insights?days=7").json()
        assert after['signups'] == before['signups'] + 1
        assert after['optIn'] == before['optIn'] + 1
        src = {x['key']: x for x in after['bySource']}
        assert src.get('insighttest_api', {}).get('n') == 1
        camp = {x['key']: x['n'] for x in after['byCampaign']}
        assert camp.get('iter276camp') == 1
        p_before = {x['key']: x['n'] for x in before['purposes']}
        p_after = {x['key']: x['n'] for x in after['purposes']}
        assert p_after.get('travel', 0) == p_before.get('travel', 0) + 1


# Travel eSIM: zone codes and order fields
class TestTravelEsim:
    def test_zones_have_code(self, alice):
        r = alice.get(f"{API}/travel-esim/plans")
        assert r.status_code == 200, r.text
        zones = r.json()['zones']
        assert zones
        assert all('code' in z for z in zones)
        with_code = [z for z in zones if z['code']]
        assert len(with_code) > len(zones) * 0.5, f"{len(with_code)}/{len(zones)} zones have code"
        assert all(len(z['code']) == 2 for z in with_code)

    def test_order_exposes_phone_and_install(self, alice):
        d = db()
        acc = d.webAccounts.find_one({'email': ALICE[0]})
        chat = str(int(acc['_id']))
        sample = d.travelEsims.find_one({'chatId': {'$exists': True}})
        if sample is not None:
            assert isinstance(sample['chatId'], str)
        eid = f"TEST_esim_{int(time.time()*1000)}"
        CREATED_ESIM.append(eid)
        d.travelEsims.insert_one({'_id': eid, 'chatId': chat, 'offerId': 'x', 'name': 'TEST_ Netherlands 1GB', 'zone': 'Netherlands', 'code': 'NL', 'gb': 1, 'days': 7,
                                  'price': 5, 'cost': 3, 'idemKey': 'k', 'status': 'active', 'createdAt': datetime.now(timezone.utc),
                                  'phoneNumber': '+3197000000000', 'install': {'qr': None, 'activationCode': 'LPA:1$test.example$ABC'}})
        r = alice.get(f"{API}/travel-esim/orders")
        assert r.status_code == 200
        o = next(x for x in r.json()['orders'] if x['id'] == eid)
        assert o['phoneNumber'] == '+3197000000000' and o['code'] == 'NL'
        assert o['install']['activationCode'] == 'LPA:1$test.example$ABC'
        assert 'cost' not in o and 'idemKey' not in o and 'chatId' not in o
