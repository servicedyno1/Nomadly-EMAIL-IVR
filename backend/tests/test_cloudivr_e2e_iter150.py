# CloudIVR web app E2E backend regression (iteration 150): catalog, auth, gating, isolation, number tabs, wallet, quick IVR, campaigns, audio, webhooks SSRF
import os, time, subprocess
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/') or open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0].rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE_NUM, BOB_NUM, CAROL_NUM = '+17377031678', '+19103709316', '+15512619698'
CREDS = {'alice': ('civr.alice@example.com', 'AliceTest#2026'), 'bob': ('civr.bob@example.com', 'BobTest#2026'), 'carol': ('civr.carol@example.com', 'CarolTest#2026')}
Q = lambda p: requests.utils.quote(p, safe='')


def login(who):
    s = requests.Session()
    e, p = CREDS[who]
    r = s.post(f"{API}/auth/login", json={'email': e, 'password': p})
    if r.status_code != 200:
        pytest.skip(f"login {who} failed {r.status_code} {r.text[:200]}")
    return s


@pytest.fixture(scope='module')
def alice():
    return login('alice')


@pytest.fixture(scope='module')
def bob():
    return login('bob')


@pytest.fixture(scope='module')
def carol():
    return login('carol')


# --- Public / sanity
class TestPublic:
    def test_catalog(self):
        d = requests.get(f"{API}/public/catalog").json()
        plans = {p['id']: p for p in d['plans']}
        assert plans['starter']['price'] == 50 and plans['pro']['price'] == 75 and plans['business']['price'] == 120
        assert len(d['countries']) == 17
        assert d['supportLink'] == 'https://t.me/CloudIVRhelp'

    def test_unauth_numbers_401(self):
        assert requests.get(f"{API}/numbers").status_code == 401

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={'email': 'civr.alice@example.com', 'password': 'nope-nope-1'})
        assert r.status_code in (400, 401) and r.json().get('message')

    def test_dashboard(self, alice):
        d = alice.get(f"{API}/dashboard").json()
        assert d['numbers']['total'] >= 1


# --- Plan gating
class TestGating:
    def test_sip_bob_403(self, bob):
        r = bob.get(f"{API}/numbers/{Q(BOB_NUM)}/sip")
        assert r.status_code == 403, r.text

    def test_sip_carol_200(self, carol):
        r = carol.get(f"{API}/numbers/{Q(CAROL_NUM)}/sip")
        assert r.status_code == 200, r.text
        assert 'sip.cloudivr.net' in r.text

    def test_voicemail_bob_403(self, bob):
        r = bob.patch(f"{API}/numbers/{Q(BOB_NUM)}/voicemail", json={'enabled': True})
        assert r.status_code == 403, r.text

    def test_ivr_bob_403(self, bob):
        r = bob.put(f"{API}/numbers/{Q(BOB_NUM)}/ivr", json={'enabled': True, 'greeting': 'hi', 'options': {'1': {'action': 'forward', 'forwardTo': '+14155550100'}}})
        assert r.status_code == 403, r.text

    def test_quick_ivr_bob_403(self, bob):
        r = bob.post(f"{API}/calls/quick", json={'callerId': BOB_NUM, 'to': '+14155550123', 'text': 'Hello there'})
        assert r.status_code == 403, r.text

    def test_text_triggers_carol_403(self, carol):
        r = carol.put(f"{API}/numbers/{Q(CAROL_NUM)}/text-triggers", json={'enabled': True, 'rules': [{'keyword': 'hi', 'reply': 'hello'}]})
        assert r.status_code == 403, r.text

    def test_quick_ivr_schedule_carol_403(self, carol):
        at = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(time.time() + 7200))
        r = carol.post(f"{API}/calls/quick", json={'callerId': CAROL_NUM, 'to': '+14155550123', 'text': 'Hello there', 'transferTo': '+14155550101', 'scheduleAt': at})
        assert r.status_code == 403, r.text


# --- Isolation
class TestIsolation:
    def test_bob_cannot_read_alice(self, bob):
        assert bob.get(f"{API}/numbers/{Q(ALICE_NUM)}").status_code == 404

    def test_bob_cannot_patch_alice(self, bob):
        r = bob.patch(f"{API}/numbers/{Q(ALICE_NUM)}/forwarding", json={'mode': 'always', 'forwardTo': '+14155550100'})
        assert r.status_code == 404

    def test_bob_campaign_alice_caller(self, bob):
        r = bob.post(f"{API}/campaigns", json={'callerId': ALICE_NUM, 'leads': '+14155550100', 'mode': 'transfer', 'transferNumber': '+14155550101'})
        assert r.status_code == 400 and r.json().get('error') == 'invalid_caller', r.text

    def test_audio_isolation(self, alice, carol):
        ids_c = {a.get('id') for a in (carol.get(f"{API}/audio").json().get('items') or [])}
        ids_a = {a.get('id') for a in (alice.get(f"{API}/audio").json().get('items') or [])}
        assert not (ids_c & ids_a)


# --- Number tabs (Alice Business)
class TestNumberTabs:
    def test_forwarding_ok_and_invalid(self, alice):
        r = alice.patch(f"{API}/numbers/{Q(ALICE_NUM)}/forwarding", json={'mode': 'always', 'forwardTo': '+14155550100'})
        assert r.status_code == 200 and r.json()['callForwarding']['forwardTo'] == '+14155550100'
        r2 = alice.patch(f"{API}/numbers/{Q(ALICE_NUM)}/forwarding", json={'mode': 'always', 'forwardTo': 'abc'})
        assert r2.status_code == 400

    def test_sip_alice(self, alice):
        r = alice.get(f"{API}/numbers/{Q(ALICE_NUM)}/sip")
        assert r.status_code == 200 and 'sip.cloudivr.net' in r.text

    def test_logs_and_hours(self, alice):
        assert alice.get(f"{API}/numbers/{Q(ALICE_NUM)}/logs").status_code == 200
        assert alice.get(f"{API}/numbers/{Q(ALICE_NUM)}/hours").status_code == 200

    def test_text_triggers_empty_keyword(self, alice):
        r = alice.put(f"{API}/numbers/{Q(ALICE_NUM)}/text-triggers", json={'enabled': True, 'rules': [{'keyword': '', 'reply': 'hello'}]})
        assert r.status_code == 400, r.text


# --- Wallet
class TestWallet:
    def test_topup_min(self, alice):
        r = alice.post(f"{API}/wallet/topup", json={'amountUsd': 5, 'coin': 'USDT-TRC20'})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_amount'

    def test_wallet_get(self, alice):
        d = alice.get(f"{API}/wallet").json()
        assert 'balance' in d and isinstance(d.get('coins'), list) and d['minTopup'] == 10


# --- Quick IVR / campaigns (dry-run)
class TestCalls:
    def test_quick_ivr_dry(self, alice):
        r = alice.post(f"{API}/calls/quick", json={'callerId': ALICE_NUM, 'to': '+14155550123', 'text': 'Hello, press 1 to talk.', 'menu': {'1': {'action': 'forward', 'forwardTo': '+14155550101'}}})
        assert r.status_code in (200, 202), r.text

    def test_quick_ivr_invalid_number(self, alice):
        r = alice.post(f"{API}/calls/quick", json={'callerId': ALICE_NUM, 'to': '4155550123x', 'text': 'Hello'})
        assert r.status_code == 400

    def test_campaign_estimate(self, alice):
        r = alice.post(f"{API}/campaigns/estimate", json={'callerId': ALICE_NUM, 'leads': '+14155550100\n+14155550101\n+14155550102\n+447700900123\nabc'})
        assert r.status_code == 200, r.text


# --- Webhooks SSRF
class TestWebhooks:
    def test_ssrf_rejected(self, alice):
        r = alice.put(f"{API}/webhooks", json={'url': 'http://127.0.0.1/x', 'enabled': True})
        assert r.status_code == 400, r.text
        r2 = alice.put(f"{API}/webhooks", json={'url': 'https://127.0.0.1/x', 'enabled': True})
        assert r2.status_code == 400, r2.text
