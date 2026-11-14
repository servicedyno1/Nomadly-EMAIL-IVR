# CloudIVR iter271: 2026-11 pricing — catalog plans/rates, pay-per-text outbound, attest retired, extra SIP caps, admin country add-ons, 10DLC $49 fee
import os
import time
import copy
import pytest
import requests
from pymongo import MongoClient
from dotenv import dotenv_values

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE}/api/cloudivr-web"
ADMIN = ('moxxcompany@gmail.com', 'Katiekendra123@')
UX = ('civr.uxtest@example.com', 'UxTest#2026')
BIZ = '+13341112222'
ENV = dotenv_values('/app/backend/.env')
S = {}


def db():
    return MongoClient(ENV['MONGO_URL'])[ENV['DB_NAME']]


def login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'email': creds[0], 'password': creds[1]})
    assert r.status_code == 200, r.text
    s.chat_id = str(r.json()['account']['id'])
    return s


def bal(s):
    w = s.get(f"{API}/wallet").json()
    return w.get('balance', w.get('usd'))


@pytest.fixture(scope='module')
def admin():
    s = requests.Session()
    d = s.post(f"{API}/admin/login", json={'email': ADMIN[0], 'password': ADMIN[1]}).json()
    r = s.post(f"{API}/admin/verify", json={'challenge': d['challenge'], 'code': d['devCode']})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope='module')
def ux():
    return login(UX)


@pytest.fixture(scope='module')
def fresh():
    if 'fresh' not in S:
        s = requests.Session()
        email = f"test_p271{int(time.time()*1000)}@example.com"
        r = s.post(f"{API}/auth/register", json={'email': email, 'password': 'TestComp#2026', 'name': 'TEST_P271', 'acceptPolicy': True})
        assert r.status_code == 201, r.text
        s.chat_id = str(r.json()['account']['id'])
        S['fresh'] = s
    return S['fresh']


# ---- Catalog ----
class TestCatalog:
    def test_plans_and_rates(self, ux):
        c = ux.get(f"{API}/catalog").json()
        p = {x['id']: x for x in c['plans']}
        assert p['starter']['name'] == 'Basic' and p['starter']['price'] == 50
        assert p['pro']['price'] == 75 and p['business']['price'] == 120
        assert all(x['sms'] == 0 for x in c['plans']), [(x['id'], x['sms']) for x in c['plans']]
        assert c['rates']['overagePerSms'] == 0.05
        assert c['texting']['setup'] == 99 and c['texting']['monthly'] == 29, c['texting']
        feats = ' '.join(f for x in c['plans'] for f in x['features'])
        print('features:', feats[:600])
        assert 'OTP' not in feats


# ---- Outbound pay-per-text ----
class TestTextCharge:
    def test_send_charges_005(self, ux):
        before = bal(ux)
        r = ux.post(f"{API}/messages/send", json={'number': BIZ, 'contact': '+14165550271', 'text': 'TEST pricing 271'})
        print('send:', r.status_code, r.text[:300])
        assert r.status_code == 200, r.text
        after = bal(ux)
        assert round(before - after, 2) == 0.05, (before, after)
        assert r.json().get('charge') == 0.05 or r.json().get('log', {}).get('charge') == 0.05

    def test_two_part_charges_010(self, ux):
        before = bal(ux)
        r = ux.post(f"{API}/messages/send", json={'number': BIZ, 'contact': '+14165550271', 'text': 'TEST ' + 'x' * 200})
        assert r.status_code == 200, r.text
        assert round(before - bal(ux), 2) == 0.10

    def test_fresh_account_402(self, fresh):
        d = db()
        num = {'phoneNumber': '+15125550272', 'provider': 'telnyx', 'country': 'US', 'type': 'local', 'status': 'active', 'plan': 'business',
               'capabilities': {'voice': True, 'sms': True, 'fax': False}, 'features': {'sms': True}, 'dryRun': True, 'channel': 'web', 'smsUsed': 0, 'TEST': True,
               'expiresAt': '2027-12-01T00:00:00.000Z'}
        d.phoneNumbersOf.insert_one({'_id': fresh.chat_id, 'val': {'numbers': [num]}})
        S['seeded'] = True
        assert bal(fresh) in (0, 0.0, None)
        r = fresh.post(f"{API}/messages/send", json={'number': num['phoneNumber'], 'contact': '+14165550111', 'text': 'TEST hi'})
        print('fresh send:', r.status_code, r.text[:300])
        assert r.status_code == 402 and r.json()['error'] == 'insufficient_balance', r.text


# ---- Caller ID attest retired ----
class TestAttest:
    def test_attest_blocked(self, ux):
        r = ux.post(f"{API}/caller-ids/attest", json={'number': '+15125550199', 'label': 'TEST'})
        print('attest:', r.status_code, r.text)
        assert r.status_code in (400, 403) and r.json()['error'] in ('verification_required', 'caller_id_off')


# ---- Extra SIP caps ----
class TestExtraSip:
    def test_caps(self, ux):
        nums = ux.get(f"{API}/numbers").json()
        items = nums.get('numbers', nums.get('items', nums)) if isinstance(nums, dict) else nums
        by = {}
        for n in items:
            by.setdefault(n.get('plan'), n['phoneNumber'])
        print('plans:', by)
        g = ux.get(f"{API}/numbers/{BIZ}/sip/extra").json()
        assert g['allowed'] is True and g['max'] == 5
        if 'starter' in by:
            p = by['starter']
            g = ux.get(f"{API}/numbers/{p}/sip/extra").json()
            assert g['allowed'] is False
            r = ux.post(f"{API}/numbers/{p}/sip/extra", json={'label': 'TEST_x'})
            assert r.status_code == 403 and r.json()['error'] == 'plan_required'

    def test_pro_max_2(self, fresh):
        d = db()
        d.phoneNumbersOf.update_one({'_id': fresh.chat_id}, {'$set': {'val.numbers.0.plan': 'pro'}})
        p = '+15125550272'
        g = fresh.get(f"{API}/numbers/{p}/sip/extra")
        assert g.status_code == 200, g.text
        assert g.json()['allowed'] is True and g.json()['max'] == 2
        made = []
        try:
            for i in range(2):
                r = fresh.post(f"{API}/numbers/{p}/sip/extra", json={'label': f'TEST_p{i}'})
                assert r.status_code == 200, r.text
                made.append(r.json()['id'])
            r = fresh.post(f"{API}/numbers/{p}/sip/extra", json={'label': 'TEST_p3'})
            assert r.status_code == 400 and r.json()['error'] == 'limit_reached', r.text
        finally:
            for i in made:
                fresh.delete(f"{API}/numbers/{p}/sip/extra/{i}")
        d.phoneNumbersOf.update_one({'_id': fresh.chat_id}, {'$set': {'val.numbers.0.plan': 'starter'}})
        r = fresh.post(f"{API}/numbers/{p}/sip/extra", json={'label': 'TEST_s'})
        assert r.status_code == 403 and r.json()['error'] == 'plan_required'
        d.phoneNumbersOf.update_one({'_id': fresh.chat_id}, {'$set': {'val.numbers.0.plan': 'business'}})


# ---- Admin country add-ons ----
class TestAddons:
    def test_list_and_auth(self, admin, ux):
        assert ux.get(f"{API}/admin/number-addons").status_code in (401, 403)
        r = admin.get(f"{API}/admin/number-addons")
        assert r.status_code == 200, r.text
        items = r.json()['items']
        assert items and all({'country', 'type', 'provider', 'cost', 'addon'} <= set(i) for i in items)
        print('sample:', items[:3], 'count', len(items))
        S['orig'] = next((i['addon'] for i in items if i['country'] == 'CO' and i['type'] == 'local'), 0)

    def test_put_persist_and_validation(self, admin):
        assert admin.put(f"{API}/admin/number-addons", json={'country': 'XYZ', 'type': 'local', 'amount': 5}).status_code == 400
        assert admin.put(f"{API}/admin/number-addons", json={'country': 'CO', 'type': 'bogus', 'amount': 5}).status_code == 400
        try:
            r = admin.put(f"{API}/admin/number-addons", json={'country': 'CO', 'type': 'local', 'amount': 10})
            assert r.status_code == 200 and r.json()['addon'] == 10
            items = admin.get(f"{API}/admin/number-addons").json()['items']
            co = [i for i in items if i['country'] == 'CO' and i['type'] == 'local']
            print('CO local:', co)
            if co:
                assert co[0]['addon'] == 10
            doc = db().appSettings.find_one({'_id': 'numberAddons'})
            assert doc['map']['CO:local'] == 10
            assert admin.put(f"{API}/admin/number-addons", json={'country': 'CO', 'type': 'local', 'amount': 9999}).json()['addon'] == 500
        finally:
            admin.put(f"{API}/admin/number-addons", json={'country': 'CO', 'type': 'local', 'amount': S.get('orig') or 0})


GOOD = {'brand': {'entityType': 'PRIVATE_PROFIT', 'companyName': 'TEST_Acme LLC', 'ein': '12-3456789', 'website': 'https://example.com', 'email': 'ops@example.com', 'phone': '+14155550100',
                  'street': '1 Main St', 'city': 'Austin', 'state': 'tx', 'postalCode': '73301'},
        'campaign': {'useCase': 'CUSTOMER_CARE', 'description': 'We answer customer questions and send appointment reminders.', 'sample1': 'Hi Sam, your appointment is at 3pm. Reply STOP to opt out.',
                     'sample2': 'Thanks for your order, it ships today. Reply STOP to opt out.', 'messageFlow': 'Customers tick an unticked Text me box on our booking form at example.com.'}}


def set_wallet(chat_id, usd):
    # give the TEST account wallet funds directly (TEST-created account only)
    db().walletOf.update_one({'_id': str(chat_id)}, {'$set': {'usdIn': usd, 'usdOut': 0}}, upsert=True)


# ---- 10DLC $49 fee ----
class TestTenDlcFee:
    def test_fee_exposed(self, fresh):
        assert fresh.get(f"{API}/tendlc").json()['fee'] == 49

    def test_402_when_short(self, fresh):
        d = db()
        print('wallet doc', d.walletOf.find_one({'_id': int(fresh.chat_id)}) or d.walletOf.find_one({'_id': fresh.chat_id}))
        r = fresh.put(f"{API}/tendlc", json=GOOD)
        assert r.status_code == 402 and r.json()['error'] == 'insufficient_balance', r.text
        assert d.tenDlc.find_one({'_id': fresh.chat_id}) is None

    def test_charge_once_reject_refund_recharge(self, fresh, admin):
        d = db()
        set_wallet(fresh.chat_id, 100)
        b0 = bal(fresh)
        print('balance after funding', b0)
        r = fresh.put(f"{API}/tendlc", json=GOOD)
        assert r.status_code == 200, r.text
        assert round(b0 - bal(fresh), 2) == 49
        tx = list(d.transactions.find({'chatId': fresh.chat_id, 'type': 'tendlc-service'}))
        assert len(tx) == 1 and tx[0]['amount'] == 49
        assert fresh.put(f"{API}/tendlc", json=GOOD).status_code == 409
        assert round(b0 - bal(fresh), 2) == 49
        r = admin.post(f"{API}/admin/tendlc/{fresh.chat_id}/decision", json={'decision': 'reject', 'note': 'TEST fix EIN'})
        assert r.status_code == 200
        assert round(bal(fresh), 2) == round(b0, 2)
        r = fresh.put(f"{API}/tendlc", json=GOOD)
        assert r.status_code == 200, r.text
        assert round(b0 - bal(fresh), 2) == 49
        assert d.transactions.count_documents({'chatId': fresh.chat_id, 'type': 'tendlc-service'}) == 2

    def test_cleanup(self, fresh):
        d = db()
        if S.get('seeded'):
            d.phoneNumbersOf.delete_one({'_id': fresh.chat_id, 'val.numbers.TEST': True})
        d.tenDlc.delete_one({'_id': fresh.chat_id})
