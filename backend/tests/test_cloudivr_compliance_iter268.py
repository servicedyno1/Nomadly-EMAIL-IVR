# CloudIVR compliance module: policy agreement, Stripe Identity, company papers + admin review, purchase policy gate, STOP opt-out
import os
import time
import pytest
import requests

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE}/api/cloudivr-web"
ADMIN = ('moxxcompany@gmail.com', 'Katiekendra123@')
UX = ('civr.uxtest@example.com', 'UxTest#2026')
ALICE = ('civr.alice@example.com', 'AliceTest#2026')
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082')
S = {}


def login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'email': creds[0], 'password': creds[1]})
    assert r.status_code == 200, r.text
    s.chat_id = r.json()['account']['id']
    return s


def register():
    s = requests.Session()
    email = f"test_comp{int(time.time()*1000)}@example.com"
    r = s.post(f"{API}/auth/register", json={'email': email, 'password': 'TestComp#2026', 'name': 'TEST_Comp', 'acceptPolicy': True})
    assert r.status_code == 201, r.text
    s.chat_id = r.json()['account']['id']
    s.email = email
    return s


@pytest.fixture(scope='module')
def fresh():
    if 'fresh' not in S:
        S['fresh'] = register()
    return S['fresh']


@pytest.fixture(scope='module')
def admin():
    s = requests.Session()
    d = s.post(f"{API}/admin/login", json={'email': ADMIN[0], 'password': ADMIN[1]}).json()
    r = s.post(f"{API}/admin/verify", json={'challenge': d['challenge'], 'code': d['devCode']})
    assert r.status_code == 200, r.text
    return s


# ---- GET compliance + policy ----
class TestPolicy:
    def test_unauth_401(self):
        assert requests.get(f"{API}/compliance").status_code == 401

    def test_get_shape_fresh(self, fresh):
        r = fresh.get(f"{API}/compliance")
        assert r.status_code == 200
        d = r.json()
        assert set(d) >= {'identity', 'company', 'policy'}
        assert d['identity']['status'] == 'none' and d['company']['status'] == 'none'
        assert d['policy']['accepted'] is True and d['policy']['version'] == '2026-11'  # accepted at register since iter269

    def test_purchase_blocked_policy_needed(self, fresh):
        pr = fresh.put(f"{API}/profile/legal", json={'type': 'business', 'fullName': 'TEST Owner', 'companyName': 'TEST_Co Ltd',
                       'address': {'line1': '1 Test St', 'city': 'Austin', 'region': 'TX', 'postalCode': '73301', 'countryCode': 'US'}})
        assert pr.status_code == 200, pr.text
        sr = fresh.get(f"{API}/numbers/search", params={'country': 'US', 'type': 'local'})
        assert sr.status_code == 200, sr.text
        nums = sr.json()['numbers']
        if not nums:
            pytest.skip('no US numbers returned')
        r = fresh.post(f"{API}/numbers/buy", json={'phoneNumber': nums[0]['phoneNumber'], 'plan': 'starter'})
        assert r.json().get('error') != 'policy_needed', r.text  # policy accepted at register since iter269

    def test_accept_false_400(self, fresh):
        r = fresh.post(f"{API}/compliance/policy", json={'accept': False})
        assert r.status_code == 400 and r.json()['error'] == 'not_accepted'

    def test_accept_true(self, fresh):
        r = fresh.post(f"{API}/compliance/policy", json={'accept': True})
        assert r.status_code == 200 and r.json()['policy']['accepted'] is True
        assert fresh.get(f"{API}/compliance").json()['policy']['accepted'] is True

    def test_purchase_after_policy_not_policy_needed(self, fresh):
        sr = fresh.get(f"{API}/numbers/search", params={'country': 'US', 'type': 'local'})
        nums = sr.json().get('numbers') or []
        if not nums:
            pytest.skip('no US numbers')
        r = fresh.post(f"{API}/numbers/buy", json={'phoneNumber': nums[0]['phoneNumber'], 'plan': 'starter'})
        assert r.json().get('error') != 'policy_needed', r.text  # expect insufficient_balance (empty wallet)


# ---- Stripe Identity ----
class TestIdentity:
    def test_start_identity_returns_stripe_url(self, fresh):
        r = fresh.post(f"{API}/compliance/identity", headers={'Origin': BASE})
        assert r.status_code == 200, r.text
        assert r.json()['url'].startswith('https://verify.stripe.com/')
        assert fresh.get(f"{API}/compliance").json()['identity']['status'] == 'pending'

    def test_refresh(self, fresh):
        r = fresh.post(f"{API}/compliance/identity/refresh")
        assert r.status_code == 200, r.text
        assert r.json()['identity']['status'] in ('pending', 'none')

    def test_webhook_bad_signature(self):
        r = requests.post(f"{BASE}/api/stripe/webhook", data='{"type":"x"}', headers={'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=bad'})
        assert r.status_code == 400 and 'bad signature' in r.text


# ---- Company papers + admin review ----
class TestCompany:
    def test_wrong_type_rejected(self, fresh):
        r = fresh.post(f"{API}/compliance/company", data={'kind': 'registration'}, files={'files': ('x.txt', b'hello', 'text/plain')})
        assert r.status_code == 400 and r.json()['error'] in ('bad_type', 'bad_upload'), r.text

    def test_no_files(self, fresh):
        r = fresh.post(f"{API}/compliance/company", data={'kind': 'registration'})
        assert r.status_code == 400

    def test_upload_registration_then_submit_fails(self, fresh):
        r = fresh.post(f"{API}/compliance/company", data={'kind': 'registration'}, files={'files': ('TEST_reg.pdf', PDF, 'application/pdf')})
        assert r.status_code == 200, r.text
        c = r.json()['company']
        assert c['status'] == 'draft' and any(f['kind'] == 'registration' for f in c['files'])
        r = fresh.post(f"{API}/compliance/company/submit")
        assert r.status_code == 400 and r.json()['error'] == 'missing_files'

    def test_upload_address_and_submit(self, fresh):
        r = fresh.post(f"{API}/compliance/company", data={'kind': 'address'}, files={'files': ('TEST_addr.png', PNG, 'image/png')})
        assert r.status_code == 200, r.text
        r = fresh.post(f"{API}/compliance/company/submit")
        assert r.status_code == 200 and r.json()['company']['status'] == 'submitted'

    def test_non_admin_cannot_list(self, fresh):
        r = fresh.get(f"{API}/admin/compliance")
        assert r.status_code in (401, 403)

    def test_admin_lists_and_opens_file(self, admin, fresh):
        r = admin.get(f"{API}/admin/compliance", params={'status': 'submitted'})
        assert r.status_code == 200
        it = next((i for i in r.json()['items'] if str(i['chatId']) == str(fresh.chat_id)), None)
        assert it, 'fresh user not in submitted list'
        f = it['company']['files'][0]
        fr = admin.get(f"{API}/admin/compliance/{fresh.chat_id}/file/{f['id']}")
        assert fr.status_code == 200 and len(fr.content) > 10

    def test_admin_reject_needs_reason(self, admin, fresh):
        r = admin.post(f"{API}/admin/compliance/{fresh.chat_id}/company", json={'decision': 'reject', 'note': ''})
        assert r.status_code == 400 and r.json()['error'] == 'note_needed'

    def test_admin_approve(self, admin, fresh):
        r = admin.post(f"{API}/admin/compliance/{fresh.chat_id}/company", json={'decision': 'approve'})
        assert r.status_code == 200, r.text
        assert fresh.get(f"{API}/compliance").json()['company']['status'] == 'approved'
        r = admin.post(f"{API}/admin/compliance/{fresh.chat_id}/company", json={'decision': 'approve'})
        assert r.status_code == 409


# ---- STOP opt-out ----
class TestOptOut:
    def test_messages_send_opted_out(self):
        from pymongo import MongoClient
        from dotenv import dotenv_values
        env = dotenv_values('/app/backend/.env')
        s = login(UX)
        db = MongoClient(env['MONGO_URL'])[env['DB_NAME']]
        recip = '+15550001234'
        owner = int(s.chat_id) if str(s.chat_id).lstrip('-').isdigit() else s.chat_id
        _id = f"{owner}:{recip}"
        db.smsOptOuts.update_one({'_id': _id}, {'$set': {'owner': owner, 'recipient': recip, 'keyword': 'TEST_STOP'}}, upsert=True)
        try:
            r = s.post(f"{API}/messages/send", json={'number': '+13341112222', 'contact': recip, 'text': 'hi'})
            assert r.status_code == 403 and r.json()['error'] == 'opted_out', r.text
        finally:
            db.smsOptOuts.delete_one({'_id': _id})
