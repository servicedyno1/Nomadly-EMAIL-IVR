# iter224 retest: per-VoIP-number default is remembered only when a call/campaign is accepted; lastUsedAt only from real uses
import os, time, requests, pytest
from dotenv import dotenv_values

BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or dotenv_values('/app/frontend/.env')['REACT_APP_BACKEND_URL']).rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
FROM = "+13346972125"   # Alice Business number
FROM2 = "+18037534921"  # Alice Business number
TARGET = "+14155553002"
XFER = "+14155553009"


@pytest.fixture(scope='module')
def alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "civr.alice@example.com", "password": "AliceTest#2026"})
    if r.status_code != 200:
        pytest.skip('alice login failed')
    return s


def verified(s):
    return [i for i in s.get(f"{API}/caller-ids").json()['items'] if i['status'] == 'verified']


def last(s, frm):
    time.sleep(0.6)
    return s.get(f"{API}/caller-ids/presets", params={"from": frm}).json()['last']


def quick(s, frm, show_as, **kw):
    body = {"callerId": frm, "targets": [TARGET], "to": TARGET, "showAs": show_as, "text": "TEST_ hello", "mode": "transfer", "transferTo": XFER}
    body.update(kw)
    return s.post(f"{API}/calls/quick", json=body)


@pytest.fixture(scope='module')
def nums(alice):
    n = [i['number'] for i in verified(alice)]
    assert len(n) >= 3
    return n


@pytest.fixture(scope='module', autouse=True)
def restore(alice):
    before = {f: alice.get(f"{API}/caller-ids/presets", params={"from": f}).json()['last'] for f in (FROM, FROM2)}
    snap = {i['number']: i['lastUsedAt'] for i in verified(alice)}
    yield
    for f, v in before.items():
        quick(alice, f, v or "")


# Quick Call: accepted (202) remembers, failed 400 does not
class TestQuickCall:
    def test_accepted_quick_call_remembers(self, alice, nums):
        r = quick(alice, FROM, nums[1])
        assert r.status_code == 202, r.text[:300]
        assert last(alice, FROM) == nums[1]

    def test_bad_transfer_does_not_change(self, alice, nums):
        r = quick(alice, FROM, nums[2], transferTo="123")
        assert r.status_code == 400 and r.json()['error'] == 'invalid_transfer'
        assert last(alice, FROM) == nums[1]

    def test_bad_target_does_not_change(self, alice, nums):
        r = quick(alice, FROM, nums[2], targets=["abc"], to="abc")
        assert r.status_code == 400, r.text[:200]
        assert last(alice, FROM) == nums[1]

    def test_saving_preset_does_not_change(self, alice, nums):
        r = alice.post(f"{API}/calls/presets", json={"name": "TEST_p224", "setup": {"callerId": FROM, "showAs": nums[2], "text": "TEST_ x", "transferTo": XFER}, "callerId": FROM, "showAs": nums[2], "text": "TEST_ x", "transferTo": XFER})
        print('preset', r.status_code, r.text[:200])
        if r.status_code == 201:
            alice.delete(f"{API}/calls/presets/{r.json()['preset']['id']}")
        assert last(alice, FROM) == nums[1]

    def test_other_from_independent(self, alice, nums):
        assert quick(alice, FROM2, nums[0]).status_code == 202
        assert last(alice, FROM2) == nums[0]
        assert last(alice, FROM) == nums[1]

    def test_own_number_clears(self, alice):
        assert quick(alice, FROM2, "").status_code == 202
        assert last(alice, FROM2) is None

    def test_dry_run_call_does_not_set_last_used(self, alice, nums):
        before = {i['number']: (i['lastUsedAt'], i['uses30']) for i in verified(alice)}
        quick(alice, FROM, nums[2])
        time.sleep(0.6)
        after = {i['number']: (i['lastUsedAt'], i['uses30']) for i in verified(alice)}
        assert before == after  # dry-run does not logUse → lastUsedAt and uses30 unchanged


# Call me first: remembers at 202, not on 400
class TestCallback:
    def test_callback_accepted_remembers(self, alice, nums):
        r = alice.post(f"{API}/calls/callback", json={"from": FROM, "callerId": FROM, "myPhone": "+14155553001", "to": TARGET, "showAs": nums[0]})
        assert r.status_code == 202, r.text[:300]
        assert last(alice, FROM) == nums[0]

    def test_callback_invalid_does_not_change(self, alice, nums):
        r = alice.post(f"{API}/calls/callback", json={"from": FROM, "callerId": FROM, "myPhone": "+14155553001", "to": "12", "showAs": nums[2]})
        assert r.status_code == 400, r.text[:300]
        assert last(alice, FROM) == nums[0]


# Campaign validateOnly must not remember
class TestCampaign:
    def test_validate_only_does_not_change(self, alice, nums):
        r = alice.post(f"{API}/campaigns", json={"name": "TEST_c224", "callerId": FROM, "showAs": nums[2], "leads": TARGET, "mode": "report_only", "validateOnly": True, "audioPending": True})
        assert r.status_code == 200 and r.json().get('ok') is True, r.text[:300]
        assert last(alice, FROM) == nums[0]

    def test_created_campaign_remembers(self, alice, nums):
        items = alice.get(f"{API}/audio").json().get('audios') or []
        if not items:
            pytest.skip('no audio')
        r = alice.post(f"{API}/campaigns", json={"name": "TEST_c224", "callerId": FROM, "showAs": nums[2], "leads": TARGET, "mode": "report_only", "audioId": items[0]['id']})
        assert r.status_code == 201, r.text[:300]
        cid = r.json()['campaign']['id']
        alice.post(f"{API}/campaigns/{cid}/cancel")
        assert last(alice, FROM) == nums[2]


class TestAuth:
    def test_presets_requires_auth(self):
        assert requests.get(f"{API}/caller-ids/presets", params={"from": FROM}).status_code == 401
