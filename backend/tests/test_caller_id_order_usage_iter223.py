# iter223: caller ID hand order, per-VoIP-number default (presets?from → last), usage insights, inline rename API
import os, time, requests, pytest
from dotenv import dotenv_values

BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or dotenv_values('/app/frontend/.env')['REACT_APP_BACKEND_URL']).rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
FROM = "+13346972125"   # Alice Business number
FROM2 = "+18037534921"  # Alice Business number


@pytest.fixture(scope='module')
def alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "civr.alice@example.com", "password": "AliceTest#2026"})
    if r.status_code != 200:
        pytest.skip('alice login failed')
    return s


def verified(s):
    return [i for i in s.get(f"{API}/caller-ids").json()['items'] if i['status'] == 'verified']


@pytest.fixture(scope='module', autouse=True)
def restore(alice):
    orig = verified(alice)
    yield
    alice.put(f"{API}/caller-ids/order", json={"numbers": [i['number'] for i in orig]})
    for i in orig:
        alice.put(f"{API}/caller-ids/{requests.utils.quote(i['number'])}/label", json={"label": i['label'] or ''})


def quick(s, frm, show_as):
    return s.post(f"{API}/calls/quick", json={"callerId": frm, "to": "+14155553002", "showAs": show_as, "templateId": "custom", "message": "TEST_ hello"})


# Usage insight fields
class TestUsageFields:
    def test_items_have_uses30_and_last_used(self, alice):
        items = verified(alice)
        assert len(items) >= 2
        for i in items:
            assert isinstance(i['uses30'], int)
            assert 'lastUsedAt' in i


# Hand order API
class TestOrder:
    def test_reorder_persists_and_presets_follow(self, alice):
        nums = [i['number'] for i in verified(alice)]
        new = list(reversed(nums))
        r = alice.put(f"{API}/caller-ids/order", json={"numbers": new})
        assert r.status_code == 200, r.text
        assert [i['number'] for i in r.json()['items']] == new
        assert [i['number'] for i in verified(alice)] == new
        pre = [i['number'] for i in alice.get(f"{API}/caller-ids/presets").json()['items']]
        assert pre == new

    def test_order_rejects_foreign_number(self, alice):
        nums = [i['number'] for i in verified(alice)]
        r = alice.put(f"{API}/caller-ids/order", json={"numbers": nums + ["+14155559999"]})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_order'

    def test_order_rejects_empty(self, alice):
        r = alice.put(f"{API}/caller-ids/order", json={"numbers": []})
        assert r.status_code == 400

    def test_order_requires_auth(self):
        r = requests.put(f"{API}/caller-ids/order", json={"numbers": ["+15555769817"]})
        assert r.status_code == 401

    def test_use_does_not_override_hand_order(self, alice):
        order = [i['number'] for i in verified(alice)]
        r = alice.post(f"{API}/calls/callback", json={"from": FROM, "callerId": FROM, "myPhone": "+14155553001", "to": "+14155553002", "showAs": order[-1]})
        assert r.status_code in (200, 202), r.text[:300]
        time.sleep(1)
        assert [i['number'] for i in verified(alice)] == order


# Default per VoIP number
class TestLastPerFrom:
    def test_quick_call_remembers_last(self, alice):
        nums = [i['number'] for i in verified(alice)]
        r = quick(alice, FROM, nums[1])
        print('quick', r.status_code, r.text[:200])
        time.sleep(0.5)
        d = alice.get(f"{API}/caller-ids/presets", params={"from": FROM}).json()
        assert d['last'] == nums[1]

    def test_other_from_independent(self, alice):
        nums = [i['number'] for i in verified(alice)]
        quick(alice, FROM2, nums[0])
        time.sleep(0.5)
        assert alice.get(f"{API}/caller-ids/presets", params={"from": FROM2}).json()['last'] == nums[0]
        assert alice.get(f"{API}/caller-ids/presets", params={"from": FROM}).json()['last'] == nums[1]

    def test_own_number_clears(self, alice):
        quick(alice, FROM, "")
        time.sleep(0.5)
        assert alice.get(f"{API}/caller-ids/presets", params={"from": FROM}).json()['last'] is None
        quick(alice, FROM2, "")
        time.sleep(0.5)
        assert alice.get(f"{API}/caller-ids/presets", params={"from": FROM2}).json()['last'] is None

    def test_presets_without_from_has_null_last(self, alice):
        assert alice.get(f"{API}/caller-ids/presets").json()['last'] is None


# Rename API (inline rename backend)
class TestRename:
    def test_rename_and_clear(self, alice):
        n = verified(alice)[0]['number']
        q = requests.utils.quote(n)
        r = alice.put(f"{API}/caller-ids/{q}/label", json={"label": "TEST_Sales"})
        assert r.status_code == 200 and r.json()['label'] == 'TEST_Sales'
        assert next(i for i in verified(alice) if i['number'] == n)['label'] == 'TEST_Sales'
        r = alice.put(f"{API}/caller-ids/{q}/label", json={"label": ""})
        assert r.json()['label'] is None
        assert next(i for i in verified(alice) if i['number'] == n)['label'] is None
