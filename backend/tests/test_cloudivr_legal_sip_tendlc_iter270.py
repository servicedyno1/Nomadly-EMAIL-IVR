# CloudIVR iter270: legal acceptance ledger, extra SIP logins, 10DLC submit/approve/activate + texting gate, catalog caps, ready-to-text
import os
import time
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
STARTER = '+12024595976'
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


@pytest.fixture(scope='module')
def fresh():
    if 'fresh' not in S:
        s = requests.Session()
        email = f"test_l270{int(time.time()*1000)}@example.com"
        r = s.post(f"{API}/auth/register", json={'email': email, 'password': 'TestComp#2026', 'name': 'TEST_L270', 'acceptPolicy': True}, headers={'User-Agent': 'TEST_UA_270'})
        assert r.status_code == 201, r.text
        s.chat_id = str(r.json()['account']['id'])
        S['fresh'] = s
    return S['fresh']


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


# ---- Legal acceptance ledger ----
class TestLegal:
    def test_signup_records_ledger(self, fresh, admin):
        p = fresh.get(f"{API}/compliance").json()['policy']
        assert p['accepted'] is True and p['outstanding'] == [] and p['versions'] == {'terms': '2026-11-14', 'aup': '2026-11'}
        rows = admin.get(f"{API}/admin/compliance/{fresh.chat_id}/acceptances").json()['items']
        assert sorted(r['doc'] for r in rows) == ['aup', 'terms']
        assert all(r['method'] == 'signup' and r['userAgent'] == 'TEST_UA_270' and r['at'] for r in rows)
        assert {r['doc']: r['version'] for r in rows} == {'terms': '2026-11-14', 'aup': '2026-11'}
        S['signup_ip'] = rows[0]['ip']

    def test_outstanding_then_prompt_accept(self, fresh, admin):
        db().compliance.update_one({'_id': fresh.chat_id}, {'$unset': {'legal': ''}})
        p = fresh.get(f"{API}/compliance").json()['policy']
        assert p['accepted'] is False and sorted(p['outstanding']) == ['aup', 'terms']
        assert fresh.post(f"{API}/compliance/policy", json={'accept': 'yes'}).status_code == 400
        r = fresh.post(f"{API}/compliance/policy", json={'accept': True})
        assert r.status_code == 200 and r.json()['policy']['accepted'] is True
        rows = admin.get(f"{API}/admin/compliance/{fresh.chat_id}/acceptances").json()['items']
        assert len(rows) == 4 and [r['method'] for r in rows[:2]] == ['prompt', 'prompt']

    def test_acceptances_admin_only(self, fresh):
        assert fresh.get(f"{API}/admin/compliance/{fresh.chat_id}/acceptances").status_code in (401, 403)

    def test_ip_is_client_not_proxy(self):
        # audit IP should be the real client IP, not the local ingress/proxy
        assert S.get('signup_ip') not in ('127.0.0.1', '::1', '::ffff:127.0.0.1'), S.get('signup_ip')


# ---- Extra SIP logins ----
class TestExtraSip:
    def test_non_business_403(self, ux):
        g = ux.get(f"{API}/numbers/{STARTER}/sip/extra").json()
        assert g['allowed'] is False and g['max'] == 5
        r = ux.post(f"{API}/numbers/{STARTER}/sip/extra", json={'label': 'TEST_x'})
        assert r.status_code == 403 and r.json()['error'] == 'plan_required', r.text

    def test_business_add_limit_auth_delete(self, ux):
        base = ux.get(f"{API}/numbers/{BIZ}/sip/extra").json()
        assert base['allowed'] is True
        made = []
        try:
            for i in range(5 - len(base['logins'])):
                r = ux.post(f"{API}/numbers/{BIZ}/sip/extra", json={'label': f'TEST_dev{i}'})
                assert r.status_code == 200, r.text
                x = r.json()
                assert x['password'] and x['username'] and x['label'] == f'TEST_dev{i}'
                made.append(x)
            r = ux.post(f"{API}/numbers/{BIZ}/sip/extra", json={'label': 'TEST_6th'})
            assert r.status_code == 400 and r.json()['error'] == 'limit_reached', r.text
            g = ux.get(f"{API}/numbers/{BIZ}/sip/extra").json()
            assert len(g['logins']) == 5 and all('password' not in l for l in g['logins'])
            if made:
                a = requests.get(f"{BASE}/api/sip-auth/{made[0]['username']}", headers={'X-Sip-Key': ENV['SIP_SERVER_SECRET']})
                assert a.status_code == 200 and a.text == made[0]['password'], a.status_code
                assert requests.get(f"{BASE}/api/sip-auth/{made[0]['username']}", headers={'X-Sip-Key': 'bad'}).status_code == 403
        finally:
            for x in made:
                assert ux.delete(f"{API}/numbers/{BIZ}/sip/extra/{x['id']}").status_code == 200
        g = ux.get(f"{API}/numbers/{BIZ}/sip/extra").json()
        assert not any(l['id'] in [m['id'] for m in made] for l in g['logins'])
        if made:
            assert requests.get(f"{BASE}/api/sip-auth/{made[0]['username']}", headers={'X-Sip-Key': ENV['SIP_SERVER_SECRET']}).status_code == 404


GOOD = {'brand': {'entityType': 'PRIVATE_PROFIT', 'companyName': 'TEST_Acme LLC', 'ein': '12-3456789', 'website': 'https://example.com', 'email': 'ops@example.com', 'phone': '+14155550100',
                  'street': '1 Main St', 'city': 'Austin', 'state': 'tx', 'postalCode': '73301'},
        'campaign': {'useCase': 'CUSTOMER_CARE', 'description': 'We answer customer questions and send appointment reminders.', 'sample1': 'Hi Sam, your appointment is at 3pm. Reply STOP to opt out.',
                     'sample2': 'Thanks for your order, it ships today. Reply STOP to opt out.', 'messageFlow': 'Customers tick an unticked Text me box on our booking form at example.com.'}}
MT = '+15125550270'


# ---- 10DLC submit → admin approve (dry-run) → activate; texting gate ----
class TestTenDlc:
    def test_validation(self, fresh):
        import copy
        for path, val in [(('brand', 'ein'), '123'), (('brand', 'state'), 'T'), (('campaign', 'sample2'), 'short'), (('campaign', 'description'), 'too short'), (('campaign', 'messageFlow'), 'short'), (('brand', 'street'), '')]:
            b = copy.deepcopy(GOOD); b[path[0]][path[1]] = val
            r = fresh.put(f"{API}/tendlc", json=b)
            assert r.status_code == 400 and r.json()['error'] == 'invalid', (path, r.text)

    def test_seed_number_and_gate_blocks(self, fresh):
        d = db()
        assert d.phoneNumbersOf.find_one({'_id': fresh.chat_id}) is None
        d.phoneNumbersOf.insert_one({'_id': fresh.chat_id, 'val': {'numbers': [{'phoneNumber': MT, 'provider': 'multitel', 'country': 'US', 'type': 'local', 'status': 'active', 'plan': 'starter',
                                     'capabilities': {'voice': True, 'sms': True, 'fax': False}, 'features': {'sms': True}, 'dryRun': True, 'channel': 'web', 'smsUsed': 0, 'smsLimit': 100, 'TEST': True}]}})
        S['seeded'] = True
        g = fresh.get(f"{API}/tendlc").json()
        assert g['status'] == 'none' and [n['phoneNumber'] for n in g['usNumbers']] == [MT]
        r = fresh.post(f"{API}/messages/send", json={'number': MT, 'contact': '+15125550111', 'text': 'TEST hello'})
        assert r.status_code == 403 and r.json()['error'] == 'tendlc_needed', r.text

    def test_submit_locks(self, fresh):
        # 2026-11 pricing: 10DLC submit debits a $49 service fee — fund the TEST account first
        db().walletOf.update_one({'_id': fresh.chat_id}, {'$set': {'usdIn': 100, 'usdOut': 0}}, upsert=True)
        r = fresh.put(f"{API}/tendlc", json=GOOD)
        assert r.status_code == 200 and r.json()['status'] == 'submitted', r.text
        assert r.json()['brand']['state'] == 'TX'
        r = fresh.put(f"{API}/tendlc", json=GOOD)
        assert r.status_code == 409 and r.json()['error'] == 'locked'

    def test_admin_list_reject_needs_note_approve_activate(self, admin, fresh):
        items = admin.get(f"{API}/admin/tendlc", params={'status': 'submitted'}).json()['items']
        assert any(str(i['chatId']) == fresh.chat_id for i in items)
        assert admin.post(f"{API}/admin/tendlc/{fresh.chat_id}/decision", json={'decision': 'reject'}).status_code == 400
        r = admin.post(f"{API}/admin/tendlc/{fresh.chat_id}/decision", json={'decision': 'approve'})
        assert r.status_code == 200 and r.json()['status'] == 'filed', r.text
        assert fresh.get(f"{API}/tendlc").json()['status'] == 'filed'
        r = fresh.post(f"{API}/messages/send", json={'number': MT, 'contact': '+15125550111', 'text': 'TEST hello'})
        assert r.status_code == 403 and r.json()['error'] == 'tendlc_needed'
        r = admin.post(f"{API}/admin/tendlc/{fresh.chat_id}/decision", json={'decision': 'activate'})
        assert r.status_code == 200 and r.json()['status'] == 'active'
        assert fresh.get(f"{API}/tendlc").json()['status'] == 'active'

    def test_gate_lifts_after_active(self, fresh):
        r = fresh.post(f"{API}/messages/send", json={'number': MT, 'contact': '+15125550111', 'text': 'TEST hello'})
        assert not (r.status_code == 403 and r.json().get('error') == 'tendlc_needed'), r.text
        print('after-active send:', r.status_code, r.text[:200])

    def test_cleanup(self, fresh):
        d = db()
        if S.get('seeded'):
            d.phoneNumbersOf.delete_one({'_id': fresh.chat_id, 'val.numbers.TEST': True})
        d.tenDlc.delete_one({'_id': fresh.chat_id})


# ---- Catalog caps + ready-to-text ----
class TestCatalog:
    def test_caps(self, ux):
        r = ux.get(f"{API}/catalog")
        assert r.status_code == 200, r.text
        cs = {c['code']: c for c in r.json()['countries']}
        for c in cs.values():
            for t, o in c['offers'].items():
                assert set(['voice', 'sms', 'fax', 'smsNeedsApproval']) <= set(o['caps']), (c['code'], t)
        assert cs['US']['offers']['local']['caps']['smsNeedsApproval'] is True

    def test_ready(self, ux):
        r = ux.get(f"{API}/texting/ready").json()
        assert r['plan'] == 'starter'
        keys = {(i['country'], i['type']) for i in r['items']}
        print(sorted(keys))
        assert ('CA', 'local') in keys
        assert not any(c == 'US' for c, _ in keys)
        assert all(i['caps']['sms'] and not i['caps']['smsNeedsApproval'] for i in r['items'])
