# CloudIVR web app - uncovered flows (iter150b): logout, profile/lang, change-password, 2FA status, audio TTS CRUD, campaigns, quick call, inbox, AI agents, wallet deposit
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/') or open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0].rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE_NUM, BOB_NUM, CAROL_NUM = '+17377031678', '+19103709316', '+15512619698'
CREDS = {'alice': ('civr.alice@example.com', 'AliceTest#2026'), 'bob': ('civr.bob@example.com', 'BobTest#2026'), 'carol': ('civr.carol@example.com', 'CarolTest#2026')}


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


# --- Auth / settings
class TestAuthSettings:
    def test_logout_invalidates_session(self):
        s = login('alice')
        assert s.get(f"{API}/auth/me").status_code == 200
        assert s.post(f"{API}/auth/logout").status_code in (200, 204)
        assert s.get(f"{API}/auth/me").status_code == 401

    def test_profile_name_roundtrip(self, alice):
        me = alice.get(f"{API}/auth/me").json()
        acc = me.get('account', me)
        orig = acc.get('name') or ''
        r = alice.patch(f"{API}/auth/profile", json={'name': 'TEST_Alice'})
        assert r.status_code == 200 and r.json()['account']['name'] == 'TEST_Alice'
        me2 = alice.get(f"{API}/auth/me").json()
        assert me2.get('account', me2)['name'] == 'TEST_Alice'
        alice.patch(f"{API}/auth/profile", json={'name': orig})

    def test_lang_pref(self, alice):
        for lang in ('fr', 'es', 'en'):
            r = alice.put(f"{API}/prefs/lang", json={'lang': lang})
            assert r.status_code == 200, r.text

    def test_change_password_wrong_current(self, alice):
        r = alice.post(f"{API}/auth/change-password", json={'currentPassword': 'wrong-pass-1', 'newPassword': 'Whatever#2026'})
        assert r.status_code == 400 and r.json()['error'] == 'wrong_password'

    def test_2fa_status(self, alice):
        r = alice.get(f"{API}/auth/2fa")
        assert r.status_code == 200, r.text


# --- Audio library
class TestAudio:
    def test_tts_rename_delete(self, alice):
        r = alice.post(f"{API}/audio/tts", json={'text': 'Hello this is a test clip from QA', 'voice': 'rachel', 'name': 'TEST_clip'})
        assert r.status_code == 201, r.text
        aid = r.json()['audio']['id']
        assert alice.patch(f"{API}/audio/{aid}", json={'name': 'TEST_clip_renamed'}).json()['name'] == 'TEST_clip_renamed'
        lst = alice.get(f"{API}/audio").json()
        items = lst['audios']
        assert any(a['id'] == aid and a['name'] == 'TEST_clip_renamed' for a in items)
        assert alice.delete(f"{API}/audio/{aid}").status_code == 200
        items = alice.get(f"{API}/audio").json()
        assert not any(a['id'] == aid for a in items['audios'])

    def test_tts_short_text(self, alice):
        assert alice.post(f"{API}/audio/tts", json={'text': 'hi', 'voice': 'rachel'}).status_code == 400


# --- Campaigns
class TestCampaigns:
    def test_create_start_detail(self, alice):
        r = alice.post(f"{API}/audio/tts", json={'text': 'Campaign message for QA test', 'voice': 'rachel', 'name': 'TEST_camp'})
        assert r.status_code == 201, r.text
        aid = r.json()['audio']['id']
        r = alice.post(f"{API}/campaigns", json={'callerId': ALICE_NUM, 'audioId': aid, 'mode': 'report_only', 'leads': '+14155550100\n+14155550101,Bob'})
        assert r.status_code == 201, r.text
        c = r.json()['campaign']
        assert c.get('dryRun') is True
        s = alice.post(f"{API}/campaigns/{c['id']}/start")
        assert s.status_code in (200, 202), s.text
        d = alice.get(f"{API}/campaigns/{c['id']}").json()['campaign']
        assert d['id'] == c['id']
        print('campaign status', d.get('status'), d.get('stats') or d.get('results'))

    def test_bob_gated(self, bob):
        r = bob.post(f"{API}/campaigns", json={'callerId': BOB_NUM, 'audioId': 'x', 'mode': 'report_only', 'leads': '+14155550100'})
        assert r.status_code == 403, r.text

    def test_isolation(self, alice, bob):
        cs = alice.get(f"{API}/campaigns").json()['campaigns']
        if cs:
            assert bob.get(f"{API}/campaigns/{cs[0]['id']}").status_code == 404


# --- Quick call
class TestQuickCall:
    def test_quick_dry(self, alice):
        r = alice.post(f"{API}/calls/quick", json={'callerId': ALICE_NUM, 'to': '+14155550100', 'text': 'Hello from QA quick call test', 'transferTo': '+14155550199'})
        assert r.status_code in (200, 201, 202), r.text
        h = alice.get(f"{API}/calls/history").json()
        assert len(h.get('calls', h.get('history', []))) >= 1

    def test_quick_bad_number(self, alice):
        r = alice.post(f"{API}/calls/quick", json={'callerId': ALICE_NUM, 'to': '+12', 'text': 'Hello'})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_number'


# --- Inbox
class TestInbox:
    @pytest.mark.parametrize('path', ['notifications', 'missed-calls', 'incoming'])
    def test_lists(self, alice, path):
        r = alice.get(f"{API}/{path}")
        assert r.status_code == 200, r.text


# --- AI agents
class TestAiAgents:
    def test_crud(self, alice):
        r = alice.post(f"{API}/ai-agents", json={'name': 'TEST_agent', 'goal': 'Answer questions about our opening hours politely.'})
        assert r.status_code == 201, r.text
        a = r.json()['agent']
        u = alice.put(f"{API}/ai-agents/{a['id']}", json={**a, 'name': 'TEST_agent2'})
        assert u.status_code == 200 and u.json()['agent']['name'] == 'TEST_agent2', u.text
        assert alice.get(f"{API}/ai-agents/{a['id']}").json()['agent']['name'] == 'TEST_agent2'
        assert alice.delete(f"{API}/ai-agents/{a['id']}").status_code == 200
        assert alice.get(f"{API}/ai-agents/{a['id']}").status_code == 404

    def test_canuse_flags(self, alice, carol):
        assert alice.get(f"{API}/ai-agents").json()['canUse'] is True
        assert carol.get(f"{API}/ai-agents").json()['canUse'] is False


# --- Wallet
class TestWallet:
    def test_deposit_dry(self, alice):
        w = alice.get(f"{API}/wallet").json()
        coin = w['coins'][0]
        r = alice.post(f"{API}/wallet/topup", json={'amountUsd': max(w['minTopup'], 25), 'coin': coin})
        assert r.status_code == 201 and r.json()['dryRun'] is True, r.text
        ref = r.json()['ref']
        w2 = alice.get(f"{API}/wallet").json()
        assert any(d['ref'] == ref and d['status'] == 'waiting' for d in w2['deposits'])

    def test_deposit_invalid(self, alice):
        assert alice.post(f"{API}/wallet/topup", json={'amountUsd': 1, 'coin': 'BTC'}).status_code == 400
        assert alice.post(f"{API}/wallet/topup", json={'amountUsd': 50, 'coin': 'NOPE'}).status_code == 400
