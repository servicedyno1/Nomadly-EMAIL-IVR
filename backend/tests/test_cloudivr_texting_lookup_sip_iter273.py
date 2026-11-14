# CloudIVR iter273: international texting, landline texting off, 10DLC no-US guard, number lookup, AI receptionist, extra SIP logins
import os
import json
import subprocess
import requests
from pymongo import MongoClient
from dotenv import dotenv_values

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE}/api/cloudivr-web"
ENV = dotenv_values('/app/backend/.env')
ALICE = ('civr.alice@example.com', 'AliceTest#2026')
BOB = ('civr.bob@example.com', 'BobTest#2026')
ALICE_ID, BOB_ID = '5000000000000900', '5000000000000901'
STARTER, BUSINESS = '+13346970101', '+13346970100'
S = {}
ADDED = []


def db():
    return MongoClient(ENV['MONGO_URL'])[ENV['DB_NAME']]


def login(creds):
    if creds[0] in S:
        return S[creds[0]]
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'email': creds[0], 'password': creds[1]})
    assert r.status_code == 200, r.text
    S[creds[0]] = s
    return s


def bal(cid):
    w = db().walletOf.find_one({'_id': cid}) or {}
    return round((w.get('usdIn', 0) or 0) - (w.get('usdOut', 0) or 0), 4)


def node(expr):
    out = subprocess.run(['node', '-e', f"console.log(JSON.stringify({expr})); process.exit(0)"], cwd='/app', capture_output=True, text=True, timeout=90)
    return json.loads(out.stdout.strip().splitlines()[-1])


def num_of(cid, phone):
    p = db().phoneNumbersOf.find_one({'_id': cid})
    return next(n for n in p['val']['numbers'] if n['phoneNumber'] == phone)


# International texting catalog
class TestTextingReady:
    def test_ready_list(self):
        r = login(ALICE).get(f"{API}/texting/ready")
        assert r.status_code == 200, r.text
        d = r.json()
        items = {i['country']: i for i in d['items']}
        assert sorted(items) == sorted(['BR', 'CA', 'CO', 'DK', 'LT', 'NL', 'PE', 'PL', 'PR', 'ES', 'GB'])
        assert all(i['typeName'] == 'Mobile' and i['caps']['sms'] for i in d['items'])
        for c in ['LT', 'PL', 'ES']:
            assert items[c]['caps']['voice'] is False
        assert items['GB']['caps']['voice'] is True
        assert items['GB']['textPrice'] == 0.18 and items['CA']['textPrice'] == 0.05 and items['PE']['textPrice'] == 1.45
        assert items['GB']['extraPrice'] == 25 and items['PE']['extraPrice'] == 74.94 and items['ES']['extraPrice'] == 117.09
        assert d['price'] == 50 and d['plan'] == 'starter'

    def test_ready_requires_login(self):
        assert requests.get(f"{API}/texting/ready").status_code in (401, 403)


# Landline texting must be unavailable
class TestHostedSms:
    def test_hosted_unavailable(self):
        s = login(BOB)
        g = s.get(f"{API}/hosted-sms").json()
        assert g['available'] is False
        r = s.post(f"{API}/hosted-sms", json={'phone': '+12125550123'})
        assert r.status_code >= 400
        assert 'isn’t available yet' in r.text, r.text


# 10DLC fee guard
class TestTenDlc:
    FORM = {'brand': {'entityType': 'PRIVATE_PROFIT', 'companyName': 'TEST_Bob LLC', 'ein': '12-3456789', 'website': 'https://example.com',
                      'email': 'bob@example.com', 'phone': '+12125550123', 'street': '1 Main St', 'city': 'Austin', 'state': 'TX', 'postalCode': '78701'},
            'campaign': {'useCase': 'CUSTOMER_CARE', 'description': 'Customer care replies to people who contact our support line about orders.',
                         'sample1': 'Hi, your order #123 has shipped. Reply STOP to opt out.', 'sample2': 'Thanks for contacting support, we will reply soon.',
                         'messageFlow': 'Customers tick an opt-in checkbox on our website contact form to receive texts.'}}

    def test_no_us_numbers_no_debit(self):
        s = login(BOB)
        before = bal(BOB_ID)
        r = s.put(f"{API}/tendlc", json=self.FORM)
        if r.status_code == 404:
            r = s.post(f"{API}/tendlc", json=self.FORM)
        assert r.status_code == 400, r.text
        assert r.json()['error'] == 'no_us_numbers'
        assert bal(BOB_ID) == before
        assert db().transactions.count_documents({'chatId': BOB_ID, 'type': 'tendlc-service'}) == 0


# Number lookup (Bird, real) — single call
class TestLookup:
    def test_price(self):
        r = login(BOB).get(f"{API}/lookup")
        assert r.status_code == 200 and r.json()['price'] == 0.015

    def test_invalid(self):
        r = login(BOB).post(f"{API}/lookup", json={'number': 'abc'})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_number'

    def test_lookup_charges(self):
        s = login(BOB)
        before = bal(BOB_ID)
        n0 = db().transactions.count_documents({'chatId': BOB_ID, 'type': 'number-lookup'})
        r = s.post(f"{API}/lookup", json={'number': '+14155552671'})
        assert r.status_code == 200, r.text
        d = r.json()
        print('LOOKUP', d)
        assert d['number'] == '+14155552671' and 'type' in d and 'carrier' in d and 'country' in d
        assert round(before - bal(BOB_ID), 4) == 0.015
        assert db().transactions.count_documents({'chatId': BOB_ID, 'type': 'number-lookup'}) == n0 + 1
        assert any(h['number'] == '+14155552671' for h in s.get(f"{API}/lookup").json()['history'])


# AI receptionist on every plan
class TestAi:
    def test_ai_agents_rate(self):
        r = login(ALICE).get(f"{API}/ai-agents")
        assert r.status_code == 200
        assert r.json()['receptionRate'] == 0.1 and r.json()['canUse'] is True

    def test_node_features(self):
        v = node("[require('./js/phone-config.js').canAccessFeature('starter','aiAgent'), require('./js/phone-config.js').canAccessFeature('pro','aiCampaigns'), require('./js/phone-config.js').canAccessFeature('business','aiCampaigns'), require('./js/ai-agent/calls.js').RECEPTION_RATE(), require('./js/spenza.js').MOBILE_TEXT_PRICE, require('./js/hosted-sms.js').AVAILABLE]")
        assert v == [True, False, True, 0.1, 0, False]


# Extra SIP logins
class TestExtraSip:
    def test_starter_get(self):
        r = login(ALICE).get(f"{API}/numbers/{STARTER}/sip/extra")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['allowed'] is True and d['free'] == 0 and d['price'] == 5 and d['max'] == 20

    def test_starter_needs_confirm(self):
        before = bal(ALICE_ID)
        r = login(ALICE).post(f"{API}/numbers/{STARTER}/sip/extra", json={'label': 'TEST_noconfirm'})
        assert r.status_code == 402 and r.json()['error'] == 'confirm_paid'
        assert bal(ALICE_ID) == before

    def test_starter_paid_add(self):
        s = login(ALICE)
        before = bal(ALICE_ID)
        r = s.post(f"{API}/numbers/{STARTER}/sip/extra", json={'label': 'TEST_paid', 'confirmPaid': True})
        assert r.status_code == 200, r.text
        d = r.json()
        ADDED.append((STARTER, d['id']))
        assert d['paid'] is True and d['price'] == 5
        assert round(before - bal(ALICE_ID), 2) == 5
        assert db().transactions.find_one({'_id': f"sip-extra-{ALICE_ID}-{d['id']}", 'type': 'extra-sip-login'})
        n = num_of(ALICE_ID, STARTER)
        paid = len([x for x in n['extraSip'] if x.get('paid')])
        sub = {k: v for k, v in n.items() if k in ('plan', 'planPrice', 'extraSip', 'isSubNumber')}
        rp = node(f"require('./js/plan-lifecycle.js').renewalPrice({json.dumps(sub)})")
        assert rp == 75 + 5 * paid, rp
        lg = s.get(f"{API}/numbers/{STARTER}/sip/extra").json()['logins']
        assert any(x['id'] == d['id'] and x['paid'] and x['active'] for x in lg)

    def test_business_five_free_then_paid(self):
        s = login(ALICE)
        g = s.get(f"{API}/numbers/{BUSINESS}/sip/extra").json()
        assert g['free'] == 5
        before = bal(ALICE_ID)
        for i in range(g['freeLeft']):
            r = s.post(f"{API}/numbers/{BUSINESS}/sip/extra", json={'label': f'TEST_free{i}'})
            assert r.status_code == 200, r.text
            assert not r.json().get('paid')
            ADDED.append((BUSINESS, r.json()['id']))
        assert bal(ALICE_ID) == before
        r = s.post(f"{API}/numbers/{BUSINESS}/sip/extra", json={'label': 'TEST_6th'})
        assert r.status_code == 402 and r.json()['error'] == 'confirm_paid'

    def test_zz_cleanup(self):
        s = login(ALICE)
        for phone, i in ADDED:
            assert s.delete(f"{API}/numbers/{phone}/sip/extra/{i}").status_code == 200


# Regression: plan ladder
class TestPlans:
    def test_plans(self):
        v = node("Object.fromEntries(Object.entries(require('./js/phone-config.js').plans).map(([k,p])=>[k,[p.name,p.price]]))")
        print(v)
        prices = sorted(p[1] for p in v.values())
        for x in [50, 75, 100, 120]:
            assert x in prices
