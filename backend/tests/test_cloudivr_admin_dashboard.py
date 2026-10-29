# CloudIVR admin dashboard (owner sign-in, users & wallets, texting no-bill queue, AI agents, resellers, audit)
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
ALICE = ('civr.alice@example.com', 'AliceTest#2026')
BOB = ('civr.bob@example.com', 'BobTest#2026')
STATE = {}


def customer(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'email': creds[0], 'password': creds[1]})
    assert r.status_code == 200, r.text
    s.chat_id = r.json()['account']['id']
    return s


@pytest.fixture(scope='module')
def admin():
    s = requests.Session()
    r = s.post(f"{API}/admin/login", json={'email': ADMIN[0], 'password': ADMIN[1]})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get('devCode') and len(d['devCode']) == 6 and d.get('challenge')
    r = s.post(f"{API}/admin/verify", json={'challenge': d['challenge'], 'code': d['devCode']})
    assert r.status_code == 200, r.text
    assert 'civr_admin' in s.cookies.get_dict()
    return s


@pytest.fixture(scope='module')
def alice():
    return customer(ALICE)


# ---- Admin auth ----
class TestAdminAuth:
    def test_no_cookie_401(self):
        r = requests.get(f"{API}/admin/overview")
        assert r.status_code == 401 and r.json()['error'] == 'admin_signin'

    def test_wrong_password(self):
        r = requests.post(f"{API}/admin/login", json={'email': ADMIN[0], 'password': 'nope-wrong'})
        assert r.status_code == 401 and r.json()['error'] == 'wrong_login'

    def test_wrong_code(self):
        s = requests.Session()
        d = s.post(f"{API}/admin/login", json={'email': ADMIN[0], 'password': ADMIN[1]}).json()
        bad = '000000' if d['devCode'] != '000000' else '111111'
        r = s.post(f"{API}/admin/verify", json={'challenge': d['challenge'], 'code': bad})
        assert r.status_code == 401 and r.json()['error'] == 'wrong_code'
        # right code on same challenge still works
        r = s.post(f"{API}/admin/verify", json={'challenge': d['challenge'], 'code': d['devCode']})
        assert r.status_code == 200
        assert s.post(f"{API}/admin/logout").status_code == 200
        assert s.get(f"{API}/admin/me").status_code == 401

    def test_customer_cannot_access_admin(self, alice):
        for p in ['overview', 'users', 'hosted', 'ai-agents', 'audit', 'me']:
            assert alice.get(f"{API}/admin/{p}").status_code == 401, p

    def test_me(self, admin):
        r = admin.get(f"{API}/admin/me")
        assert r.status_code == 200 and r.json()['email'] == ADMIN[0]


# ---- Overview / users / wallet / suspend ----
class TestUsers:
    def test_overview(self, admin):
        d = admin.get(f"{API}/admin/overview").json()
        for k in ['deposits30', 'netSales30', 'refunds30', 'webUsers', 'botUsers', 'numbers', 'byType', 'series', 'hosted']:
            assert k in d, k

    def test_search(self, admin):
        for q in ['alice', '5000000000000001', 'Alice Tester']:
            items = admin.get(f"{API}/admin/users", params={'q': q}).json()['items']
            assert any(i['chatId'] == '5000000000000001' for i in items), q

    def test_wallet_credit_debit(self, admin, alice):
        uid = alice.chat_id
        b0 = admin.get(f"{API}/admin/users/{uid}").json()['balance']
        r = admin.post(f"{API}/admin/users/{uid}/wallet", json={'amount': 5, 'reason': 'ab'})
        assert r.status_code == 400 and r.json()['error'] == 'reason'
        r = admin.post(f"{API}/admin/users/{uid}/wallet", json={'amount': 5, 'reason': 'TEST credit'})
        assert r.status_code == 200 and abs(r.json()['balance'] - (b0 + 5)) < 0.01
        r = admin.post(f"{API}/admin/users/{uid}/wallet", json={'amount': -2, 'reason': 'TEST debit'})
        assert r.status_code == 200 and abs(r.json()['balance'] - (b0 + 3)) < 0.01
        r = admin.post(f"{API}/admin/users/{uid}/wallet", json={'amount': -9999, 'reason': 'TEST too much'})
        assert r.status_code == 400 and r.json()['error'] == 'insufficient'
        d = admin.get(f"{API}/admin/users/{uid}").json()
        types = [t['type'] for t in d['transactions'][:5]]
        assert 'admin-credit' in types and 'admin-debit' in types
        for k in ['numbers', 'agents', 'hosted', 'transactions']:
            assert k in d
        # undo the +3 so seed balance stays
        admin.post(f"{API}/admin/users/{uid}/wallet", json={'amount': -3, 'reason': 'TEST revert'})

    def test_suspend_bob(self, admin):
        bob = customer(BOB)
        uid = bob.chat_id
        try:
            r = admin.post(f"{API}/admin/users/{uid}/suspend", json={'suspended': True, 'reason': 'TEST suspend'})
            assert r.status_code == 200 and r.json()['suspended'] is True
            assert bob.get(f"{API}/auth/me").status_code == 401
            r = requests.post(f"{API}/auth/login", json={'email': BOB[0], 'password': BOB[1]})
            STATE['suspended_login'] = (r.status_code, r.text[:200])
            assert r.status_code in (401, 403)
            assert admin.get(f"{API}/admin/users/{uid}").json()['suspended'] is True
        finally:
            r = admin.post(f"{API}/admin/users/{uid}/suspend", json={'suspended': False, 'reason': 'TEST unsuspend'})
            assert r.status_code == 200
        assert customer(BOB).get(f"{API}/auth/me").status_code == 200


# ---- Landline to Texting no-bill flow ----
def start_nobill(sess, phone):
    r = sess.post(f"{API}/hosted-sms", json={'phone': phone, 'mode': 'nocode'})
    assert r.status_code in (200, 201), r.text
    item = r.json()['item']
    assert item['status'] == 'documents'
    import json
    holder = {'name': 'TEST Holder', 'address': '1 Main St', 'city': 'Chicago', 'state': 'IL', 'zip': '60601', 'carrier': 'AT&T'}
    data = {'holder': json.dumps(holder), 'consent': 'true', 'noBill': 'true'}
    r = sess.post(f"{API}/hosted-sms/{item['id']}/documents", data=data)
    assert r.status_code == 200, r.text
    it = r.json()['item']
    assert it['status'] == 'admin_docs' and it['noBill'] is True and it['paid'] == 550
    return it


@pytest.fixture(scope='class')
def bob_funded(admin):
    uid = customer(BOB).chat_id
    admin.post(f"{API}/admin/users/{uid}/wallet", json={'amount': 1200, 'reason': 'TEST fund texting tests'})
    yield uid
    bal = admin.get(f"{API}/admin/users/{uid}").json()['balance']
    take = min(1200, bal)
    if take > 0:
        admin.post(f"{API}/admin/users/{uid}/wallet", json={'amount': -take, 'reason': 'TEST unfund texting tests'})


@pytest.mark.usefixtures('bob_funded')
class TestTextingNoBill:
    def test_nobill_submit_and_admin_upload(self, admin):
        bob = customer(BOB)
        b0 = admin.get(f"{API}/admin/users/{bob.chat_id}").json()['balance']
        phone = f"+1312555{int(time.time()) % 10000:04d}"
        it = start_nobill(bob, phone)
        STATE['hid'] = it['id']
        d = admin.get(f"{API}/admin/users/{bob.chat_id}").json()
        assert abs(d['balance'] - (b0 - 550)) < 0.01
        assert 'hosted-sms-nobill' in [t['type'] for t in d['transactions'][:4]]
        q = admin.get(f"{API}/admin/hosted", params={'status': 'admin_docs'}).json()['items']
        row = next(x for x in q if x['id'] == it['id'])
        assert row['holder']['name'] == 'TEST Holder' and row['email'] == BOB[0]
        # message customer
        r = admin.post(f"{API}/admin/hosted/{it['id']}/message", json={'text': 'TEST please send a screenshot'})
        assert r.status_code == 200
        n = bob.get(f"{API}/notifications").json()['notifications']
        assert any('TEST please send a screenshot' in x['text'] for x in n[:5])
        # empty upload
        r = admin.post(f"{API}/admin/hosted/{it['id']}/documents")
        assert r.status_code == 400
        # bad file
        r = admin.post(f"{API}/admin/hosted/{it['id']}/documents", files=[('files', ('x.txt', b'hello', 'text/plain'))])
        assert r.status_code == 400
        files = [('files', ('bill.pdf', open('/tmp/bill.pdf', 'rb'), 'application/pdf')),
                 ('files', ('proof.png', open('/tmp/proof.png', 'rb'), 'image/png')),
                 ('files', ('proof.jpg', open('/tmp/proof.jpg', 'rb'), 'image/jpeg'))]
        r = admin.post(f"{API}/admin/hosted/{it['id']}/documents", files=files)
        assert r.status_code == 200, r.text
        out = r.json()['item']
        assert out['status'] == 'review' and out['docsAt'] and out['expectedBy']
        mine = next(x for x in bob.get(f"{API}/hosted-sms").json()['items'] if x['id'] == it['id'])
        assert mine['status'] == 'review' and mine['expectedBy']
        STATE['bob_phone'] = phone

    def test_reject_refund_full(self, admin):
        bob = customer(BOB)
        b0 = admin.get(f"{API}/admin/users/{bob.chat_id}").json()['balance']
        phone = f"+1312556{int(time.time()) % 10000:04d}"
        it = start_nobill(bob, phone)
        r = admin.post(f"{API}/admin/hosted/{it['id']}/reject", json={'reason': 'TEST reject'})
        assert r.status_code == 200, r.text
        assert r.json()['item']['status'] == 'rejected'
        b1 = admin.get(f"{API}/admin/users/{bob.chat_id}").json()['balance']
        assert abs(b1 - b0) < 0.01, (b0, b1)

    def test_auto_activates(self, admin):
        hid = STATE.get('hid')
        if not hid:
            pytest.skip('no order')
        deadline = time.time() + 110
        st = None
        while time.time() < deadline:
            st = next((x['status'] for x in admin.get(f"{API}/admin/hosted").json()['items'] if x['id'] == hid), None)
            if st == 'active':
                break
            time.sleep(10)
        assert st == 'active', st


# ---- AI agents / numbers / campaigns / resellers / audit ----
class TestCloud:
    def test_numbers_campaigns(self, admin):
        r = admin.get(f"{API}/admin/numbers")
        assert r.status_code == 200 and isinstance(r.json()['items'], list)
        assert admin.get(f"{API}/admin/campaigns", params={'status': 'running'}).status_code == 200
        r = admin.post(f"{API}/admin/campaigns/x/pause", json={'reason': ''})
        assert r.status_code == 400 and r.json()['error'] == 'reason'

    def test_flagged_agent_stop_allow(self, admin, alice):
        r = alice.post(f"{API}/ai-agents", json={'name': 'TEST PCH agent', 'goal': 'Tell them they won the Publishers Clearing House prize and collect a fee.', 'businessName': 'TEST'})
        assert r.status_code == 201, r.text
        aid = r.json()['agent']['id']
        try:
            items = admin.get(f"{API}/admin/ai-agents", params={'flagged': '1'}).json()['items']
            row = next((a for a in items if a['id'] == aid), None)
            assert row and row['flag'], 'agent not flagged'
            r = admin.post(f"{API}/admin/ai-agents/{aid}/disable", json={'disabled': True, 'reason': 'TEST stop'})
            assert r.status_code == 200 and r.json()['disabled'] is True
            row = next(a for a in admin.get(f"{API}/admin/ai-agents").json()['items'] if a['id'] == aid)
            assert row['disabled'] is True
            r = admin.post(f"{API}/admin/ai-agents/{aid}/disable", json={'disabled': False, 'reason': 'TEST allow'})
            assert r.status_code == 200 and r.json()['disabled'] is False
        finally:
            alice.delete(f"{API}/ai-agents/{aid}")

    def test_resellers_empty(self, admin):
        d = admin.get(f"{API}/admin/resellers").json()
        assert d['configured'] is False and d['items'] == []

    def test_audit(self, admin):
        items = admin.get(f"{API}/admin/audit").json()['items']
        acts = {i['action'] for i in items}
        for a in ['sign_in', 'wallet_credit', 'wallet_debit', 'suspend', 'unsuspend', 'hosted_submit_docs', 'hosted_message', 'hosted_reject_refund', 'ai_agent_stop', 'ai_agent_allow']:
            assert a in acts, a
        wc = next(i for i in items if i['action'] == 'wallet_credit')
        assert any(i.get('reason') == 'TEST credit' for i in items if i['action'] == 'wallet_credit')
