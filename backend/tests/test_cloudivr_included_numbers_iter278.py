# CloudIVR web: plan "included number" rules (US/CA/GB all plans; NL/FR/ES Business; instant no-ID only),
# texting hidden from plans, International Texting coming soon. Uses injected search cache (no live searches).
import copy
import os
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026')
db = MongoClient('mongodb://localhost:27017')['test']
START = datetime.now(timezone.utc)
FAKE = {'NL:mobile': '+3197099990001', 'NL:local': '+31209999001', 'DE:local': '+493099990001', 'DE:mobile': '+4915299990001',
        'US:local': '+13349990001', 'GB:mobile': '+447999990001', 'FR:local': '+33199990001'}


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'email': email, 'password': pw})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope='module')
def alice():
    acc = db.webAccounts.find_one({'email': ALICE[0]})
    cid = str(int(acc['_id']))
    snap = {c: copy.deepcopy(db[c].find_one({'_id': cid})) for c in ('phoneNumbersOf', 'walletOf', 'webSearchCache')}
    lp = copy.deepcopy(acc.get('legalProfile'))
    if not (lp or {}).get('completedAt'):
        db.webAccounts.update_one({'_id': acc['_id']}, {'$set': {'legalProfile': {'type': 'personal', 'firstName': 'Alice', 'lastName': 'Test', 'address': '1 Main St', 'city': 'Austin', 'zip': '73301', 'country': 'US', 'completedAt': datetime.now(timezone.utc)}}})
    s = login(*ALICE)
    yield s, cid
    for c, doc in snap.items():
        if doc is None:
            db[c].delete_one({'_id': cid})
        else:
            db[c].replace_one({'_id': cid}, doc, upsert=True)
    if lp is None:
        db.webAccounts.update_one({'_id': acc['_id']}, {'$unset': {'legalProfile': ''}})
    else:
        db.webAccounts.update_one({'_id': acc['_id']}, {'$set': {'legalProfile': lp}})
    fakes = list(FAKE.values())
    db.webNumberOrders.delete_many({'chatId': cid, 'phoneNumber': {'$in': fakes}})
    db.webDeposits.delete_many({'chatId': cid, 'forNumber': {'$in': fakes}})
    db.webNumberLocks.delete_many({'_id': {'$in': fakes}})
    for coll in db.list_collection_names():
        if coll in ('phoneNumbersOf', 'walletOf', 'webSearchCache', 'webAccounts'):
            continue
        try:
            db[coll].delete_many({'phoneNumber': {'$in': fakes}, 'at': {'$gte': START.replace(tzinfo=None)}})
        except Exception:
            pass
    db.phoneTransactions.delete_many({'chatId': cid, 'phoneNumber': {'$in': fakes}})


def seed(cid, cc, t):
    num = FAKE[f"{cc}:{t}"]
    db.webSearchCache.replace_one({'_id': cid}, {'_id': cid, 'country': cc, 'type': t, 'areaCode': None, 'at': datetime.now(timezone.utc),
                                                  'results': [{'phoneNumber': num, 'region': cc, 'capabilities': {'voice': True, 'sms': False, 'fax': False}, 'surcharge': 0, 'provider': 'multitel', 'cost': {'monthly': 1, 'upfront': 0}}]}, upsert=True)
    return num


@pytest.fixture(scope='module')
def coin():
    c = requests.get(f"{API}/public/catalog").json().get("coins")
    return (c or ['USDT-TRC20'])[0]


# ── Catalog ──
class TestCatalog:
    def test_country_included_tiers(self, alice):
        s, _ = alice
        d = s.get(f"{API}/catalog").json()
        cs = {c['code']: c for c in d['countries']}
        for cc in ('US', 'CA', 'GB'):
            assert cs[cc]['included'] == 'all', cc
        for cc in ('NL', 'FR', 'ES'):
            assert cs[cc]['included'] == 'business', cc
        for cc in ('DE', 'IT', 'AU'):
            if cc in cs:
                assert cs[cc]['included'] is None, cc
        assert cs['NL']['offers']['mobile']['included'] is True
        assert cs['NL']['offers']['local']['included'] is False
        assert d['planTexting'] is False

    def test_plan_webfeatures_no_texting(self, alice):
        s, _ = alice
        d = s.get(f"{API}/catalog").json()
        for p in d['plans']:
            keys = [f['key'] for f in p['webFeatures']]
            assert not set(keys) & {'inbox', 'smsEmail', 'textTriggers'}, (p['id'], keys)
            assert not any('SMS' in f for f in p['features']), p['features']

    def test_texting_ready_unavailable(self, alice):
        s, _ = alice
        r = s.get(f"{API}/texting/ready")
        assert r.status_code == 200
        assert r.json()['available'] is False


# ── Server enforcement ──
class TestIncludedEnforcement:
    @pytest.mark.parametrize('plan,cc,t', [('pro', 'NL', 'mobile'), ('business', 'NL', 'local'), ('business', 'DE', 'local'), ('starter', 'DE', 'mobile'), ('standard', 'FR', 'local')])
    def test_checkout_blocked(self, alice, plan, cc, t):
        s, cid = alice
        num = seed(cid, cc, t)
        r = s.post(f"{API}/numbers/checkout", json={'phoneNumber': num, 'plan': plan, 'method': 'wallet'})
        assert r.status_code == 400, r.text
        assert r.json()['error'] == 'extra_number_only'

    def test_buy_route_blocked(self, alice):
        s, cid = alice
        num = seed(cid, 'NL', 'mobile')
        r = s.post(f"{API}/numbers/buy", json={'phoneNumber': num, 'plan': 'pro'})
        assert r.status_code == 400, r.text
        assert r.json()['error'] == 'extra_number_only'

    @pytest.mark.parametrize('plan,cc,t', [('business', 'NL', 'mobile'), ('starter', 'US', 'local'), ('standard', 'GB', 'mobile'), ('business', 'FR', 'local')])
    def test_checkout_allowed_crypto(self, alice, coin, plan, cc, t):
        s, cid = alice
        num = seed(cid, cc, t)
        r = s.post(f"{API}/numbers/checkout", json={'phoneNumber': num, 'plan': plan, 'method': 'crypto', 'coin': coin})
        assert r.status_code == 201, r.text
        oid = r.json()['order']['id'] if 'id' in r.json()['order'] else r.json()['order'].get('_id')
        if oid:
            s.post(f"{API}/numbers/orders/{oid}/cancel")

    def test_number_request_blocked(self, alice):
        s, _ = alice
        r = s.post(f"{API}/numbers/request", json={'country': 'DE', 'plan': 'business'})
        assert r.status_code == 400, r.text
        assert r.json()['error'] in ('extra_number_only', 'invalid_country'), r.text
        print('request DE ->', r.json())

    def test_extra_checkout_allows_other_country(self, alice, coin):
        s, cid = alice
        main = '+13346970100'
        num = seed(cid, 'DE', 'local')
        r = s.post(f"{API}/numbers/{main}/extra-checkout", json={'phoneNumber': num, 'method': 'crypto', 'coin': coin})
        assert r.json().get('error') != 'extra_number_only', r.text
        print('extra-checkout DE ->', r.status_code, r.text[:200])
        if r.status_code == 201:
            o = r.json().get('order', {})
            if o.get('id'):
                s.post(f"{API}/numbers/orders/{o['id']}/cancel")

    def test_unauth_checkout_401(self):
        r = requests.post(f"{API}/numbers/checkout", json={'phoneNumber': '+1', 'plan': 'pro'})
        assert r.status_code == 401
