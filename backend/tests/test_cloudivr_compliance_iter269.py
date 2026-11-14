# CloudIVR compliance retest (iter269): server-side policy at register, requires_input→none, opt-out thread flag, admin review regression
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
GATE = ('test_gate1794672851@example.com', 'TestGate#2026')
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082')
S = {}


def db():
    env = dotenv_values('/app/backend/.env')
    return MongoClient(env['MONGO_URL'])[env['DB_NAME']]


def login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'email': creds[0], 'password': creds[1]})
    assert r.status_code == 200, r.text
    s.chat_id = r.json()['account']['id']
    return s


@pytest.fixture(scope='module')
def fresh():
    if 'fresh' not in S:
        s = requests.Session()
        email = f"test_comp{int(time.time()*1000)}@example.com"
        r = s.post(f"{API}/auth/register", json={'email': email, 'password': 'TestComp#2026', 'name': 'TEST_Comp', 'acceptPolicy': True})
        assert r.status_code == 201, r.text
        s.chat_id = r.json()['account']['id']
        s.email = email
        S['fresh'] = s
    return S['fresh']


@pytest.fixture(scope='module')
def admin():
    s = requests.Session()
    d = s.post(f"{API}/admin/login", json={'email': ADMIN[0], 'password': ADMIN[1]}).json()
    r = s.post(f"{API}/admin/verify", json={'challenge': d['challenge'], 'code': d['devCode']})
    assert r.status_code == 200, r.text
    return s


# ---- Register: policy acceptance server-side ----
class TestRegisterPolicy:
    def test_register_without_accept_400(self):
        r = requests.post(f"{API}/auth/register", json={'email': f"test_nopol{int(time.time()*1000)}@example.com", 'password': 'TestComp#2026'})
        assert r.status_code == 400 and r.json()['error'] == 'policy_needed', r.text

    def test_register_accept_false_400(self):
        r = requests.post(f"{API}/auth/register", json={'email': f"test_nopol{int(time.time()*1000)}@example.com", 'password': 'TestComp#2026', 'acceptPolicy': 'true'})
        assert r.status_code == 400 and r.json()['error'] == 'policy_needed', r.text

    def test_register_with_accept_policy_recorded(self, fresh):
        d = fresh.get(f"{API}/compliance").json()
        assert d['policy']['accepted'] is True and d['policy']['acceptedAt']
        assert d['identity']['status'] == 'none'


# ---- Stripe Identity status mapping ----
class TestIdentity:
    def test_start_then_immediate_refresh_is_none(self, fresh):
        r = fresh.post(f"{API}/compliance/identity", headers={'Origin': BASE})
        assert r.status_code == 200, r.text
        assert r.json()['url'].startswith('https://verify.stripe.com/')
        r = fresh.post(f"{API}/compliance/identity/refresh")
        assert r.status_code == 200, r.text
        ident = r.json()['identity']
        assert ident['status'] == 'none', ident
        assert ident['status'] != 'failed'

    def test_gate_user_verified(self):
        s = login(GATE)
        d = s.get(f"{API}/compliance").json()
        assert d['identity']['status'] == 'verified' and d['company']['status'] == 'approved' and d['policy']['accepted'] is True


# ---- Company papers + admin review regression ----
class TestCompany:
    def test_upload_and_submit(self, fresh):
        assert fresh.post(f"{API}/compliance/company", data={'kind': 'registration'}, files={'files': ('TEST_reg.pdf', PDF, 'application/pdf')}).status_code == 200
        assert fresh.post(f"{API}/compliance/company", data={'kind': 'address'}, files={'files': ('TEST_addr.png', PNG, 'image/png')}).status_code == 200
        r = fresh.post(f"{API}/compliance/company/submit")
        assert r.status_code == 200 and r.json()['company']['status'] == 'submitted'

    def test_admin_list_open_reject(self, admin, fresh):
        it = next((i for i in admin.get(f"{API}/admin/compliance").json()['items'] if str(i['chatId']) == str(fresh.chat_id)), None)
        assert it and it['email'] == fresh.email
        fr = admin.get(f"{API}/admin/compliance/{fresh.chat_id}/file/{it['company']['files'][0]['id']}")
        assert fr.status_code == 200 and len(fr.content) > 10
        assert admin.post(f"{API}/admin/compliance/{fresh.chat_id}/company", json={'decision': 'reject', 'note': ''}).status_code == 400
        r = admin.post(f"{API}/admin/compliance/{fresh.chat_id}/company", json={'decision': 'reject', 'note': 'TEST blurry'})
        assert r.status_code == 200, r.text
        c = fresh.get(f"{API}/compliance").json()['company']
        assert c['status'] == 'rejected' and c['note'] == 'TEST blurry'

    def test_resubmit_and_approve(self, admin, fresh):
        r = fresh.post(f"{API}/compliance/company/submit")
        assert r.status_code == 200 and r.json()['company']['status'] == 'submitted'
        assert admin.post(f"{API}/admin/compliance/{fresh.chat_id}/company", json={'decision': 'approve'}).status_code == 200
        assert fresh.get(f"{API}/compliance").json()['company']['status'] == 'approved'
        assert admin.post(f"{API}/admin/compliance/{fresh.chat_id}/company", json={'decision': 'approve'}).status_code == 409


# ---- STOP opt-out in thread + send ----
class TestOptOut:
    def test_thread_opted_out_and_send_blocked(self):
        s = login(UX)
        d = db()
        recip = '+15550001269'
        _id = f"{s.chat_id}:{recip}"
        d.smsOptOuts.update_one({'_id': _id}, {'$set': {'owner': str(s.chat_id), 'recipient': recip, 'keyword': 'TEST_STOP'}}, upsert=True)
        try:
            r = s.get(f"{API}/messages/thread", params={'number': '+13341112222', 'contact': recip})
            assert r.status_code == 200, r.text
            t = r.json()
            assert t['optedOut'] is True and t['canText'] is False
            r = s.post(f"{API}/messages/send", json={'number': '+13341112222', 'contact': recip, 'text': 'hi'})
            assert r.status_code == 403 and r.json()['error'] == 'opted_out', r.text
        finally:
            d.smsOptOuts.delete_one({'_id': _id})
        t = s.get(f"{API}/messages/thread", params={'number': '+13341112222', 'contact': recip}).json()
        assert t['optedOut'] is False
