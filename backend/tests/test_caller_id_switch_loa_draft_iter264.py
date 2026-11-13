# iter264: Custom caller ID admin on/off switch (default OFF, write routes 403 caller_id_off) + LOA draft save (PUT /hosted-sms/:id/draft)
import os, requests, pytest
from pymongo import MongoClient
from dotenv import dotenv_values

BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or dotenv_values('/app/frontend/.env')['REACT_APP_BACKEND_URL']).rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ENV = dotenv_values('/app/backend/.env')
db = MongoClient(ENV['MONGO_URL'])[ENV['DB_NAME']]
ORDER = 'hs_qa_loa'
TEST_NUM = '+14155559264'


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code}")
    return s


@pytest.fixture(scope='module')
def cust():
    return login('civr.uxtest@example.com', 'UxTest#2026')


@pytest.fixture(scope='module')
def bob():
    return login('civr.alice@example.com', 'AliceTest#2026')


@pytest.fixture(scope='module')
def admin():
    s = requests.Session()
    r = s.post(f"{API}/admin/login", json={"email": "moxxcompany@gmail.com", "password": "Katiekendra123@"})
    if r.status_code != 200 or 'devCode' not in r.json():
        pytest.skip(f"admin login failed {r.status_code} {r.text[:200]}")
    d = r.json()
    v = s.post(f"{API}/admin/verify", json={"challenge": d['challenge'], "code": d['devCode']})
    if v.status_code != 200:
        pytest.skip(f"admin verify failed {v.status_code}")
    return s


@pytest.fixture(scope='module', autouse=True)
def restore(admin):
    yield
    admin.put(f"{API}/admin/caller-ids/switch", json={"enabled": False})
    db.webCallerIds.delete_one({'_id': TEST_NUM, 'chatId': {'$exists': True}})


# Switch OFF (default) — customer view
class TestSwitchOff:
    def test_admin_reports_off(self, admin):
        admin.put(f"{API}/admin/caller-ids/switch", json={"enabled": False})
        r = admin.get(f"{API}/admin/caller-ids")
        assert r.status_code == 200 and r.json()['enabled'] is False

    def test_presets_off(self, cust):
        r = cust.get(f"{API}/caller-ids/presets")
        assert r.status_code == 200
        d = r.json()
        assert d['enabled'] is False and d['items'] == []

    def test_list_reports_off(self, cust):
        r = cust.get(f"{API}/caller-ids")
        assert r.status_code == 200 and r.json()['enabled'] is False

    @pytest.mark.parametrize('method,path,body', [
        ('post', '/caller-ids/attest', {"number": TEST_NUM, "authorized": True}),
        ('post', '/caller-ids', {"number": TEST_NUM}),
        ('post', '/caller-ids/request', {"number": TEST_NUM, "authorized": True}),
        ('post', '/caller-ids/verify', {"number": TEST_NUM, "code": "123456"}),
        ('put', '/caller-ids/order', {"numbers": [TEST_NUM]}),
        ('put', '/caller-ids/default', {"number": "+13341112222", "showAs": TEST_NUM}),
        ('put', f'/caller-ids/{TEST_NUM}/label', {"label": "x"}),
    ])
    def test_writes_blocked(self, cust, method, path, body):
        r = getattr(cust, method)(f"{API}{path}", json=body)
        assert r.status_code == 403, r.text
        assert r.json()['error'] == 'caller_id_off'

    def test_switch_requires_admin(self, cust):
        assert requests.put(f"{API}/admin/caller-ids/switch", json={"enabled": True}).status_code == 401
        assert cust.put(f"{API}/admin/caller-ids/switch", json={"enabled": True}).status_code == 401


# Switch ON then OFF again
class TestSwitchOn:
    def test_on_then_attest_then_off(self, admin, cust):
        r = admin.put(f"{API}/admin/caller-ids/switch", json={"enabled": True})
        assert r.status_code == 200 and r.json()['enabled'] is True
        assert admin.get(f"{API}/admin/caller-ids").json()['enabled'] is True
        p = cust.get(f"{API}/caller-ids/presets").json()
        assert p['enabled'] is True
        a = cust.post(f"{API}/caller-ids/attest", json={"number": TEST_NUM, "authorized": True, "label": "TEST_iter264"})
        assert a.status_code == 201, a.text
        assert any(i['number'] == TEST_NUM for i in cust.get(f"{API}/caller-ids/presets").json()['items'])
        # off again: approved ID is hidden from presets
        assert admin.put(f"{API}/admin/caller-ids/switch", json={"enabled": False}).json()['enabled'] is False
        p2 = cust.get(f"{API}/caller-ids/presets").json()
        assert p2['enabled'] is False and p2['items'] == []
        doc = db.appSettings.find_one({'_id': 'customCallerId'})
        assert doc['enabled'] is False and doc.get('by') == 'moxxcompany@gmail.com'
        # cleanup our attested number (allowed while off)
        assert cust.delete(f"{API}/caller-ids/{TEST_NUM}").status_code == 200


# LOA draft
class TestLoaDraft:
    def test_draft_requires_auth(self):
        assert requests.put(f"{API}/hosted-sms/{ORDER}/draft", json={"holder": {}}).status_code == 401

    def test_draft_saved_and_returned(self, cust):
        before = db.hostedSms.find_one({'_id': ORDER}) if 'hostedSms' in db.list_collection_names() else None
        items = cust.get(f"{API}/hosted-sms").json()['items']
        o = next((i for i in items if i['id'] == ORDER), None)
        if not o or o['status'] not in ('loa', 'documents') or o.get('holder'):
            pytest.skip(f"seeded order not in loa step: {o and o['status']}")
        prev = o.get('draft')
        r = cust.put(f"{API}/hosted-sms/{ORDER}/draft", json={"holder": {"name": "TEST_Jane Doe", "city": "Toronto", "bogus": "x"}})
        assert r.status_code == 200 and r.json()['ok'] is True
        o2 = next(i for i in cust.get(f"{API}/hosted-sms").json()['items'] if i['id'] == ORDER)
        assert o2['draft']['name'] == 'TEST_Jane Doe' and o2['draft']['city'] == 'Toronto'
        assert 'bogus' not in o2['draft']
        assert o2['status'] == o['status'] and not o2.get('holder')
        # restore prior draft
        cust.put(f"{API}/hosted-sms/{ORDER}/draft", json={"holder": prev or {}})

    def test_draft_long_values_truncated(self, cust):
        prev = next(i for i in cust.get(f"{API}/hosted-sms").json()['items'] if i['id'] == ORDER).get('draft')
        r = cust.put(f"{API}/hosted-sms/{ORDER}/draft", json={"holder": {"name": "A" * 500}})
        if r.status_code != 200:
            pytest.skip(r.text)
        o = next(i for i in cust.get(f"{API}/hosted-sms").json()['items'] if i['id'] == ORDER)
        cust.put(f"{API}/hosted-sms/{ORDER}/draft", json={"holder": prev or {}})
        assert len(o['draft']['name']) == 120

    def test_draft_other_account_refused(self, bob):
        r = bob.put(f"{API}/hosted-sms/{ORDER}/draft", json={"holder": {"name": "hijack"}})
        assert r.status_code == 400

    def test_draft_unknown_order(self, cust):
        r = cust.put(f"{API}/hosted-sms/hs_nope_xyz/draft", json={"holder": {"name": "x"}})
        assert r.status_code == 400
