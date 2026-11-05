# iter211 — Number typo check (dialIssue) across CloudIVR web dialing endpoints (dry-run preview, nothing dialed)
import os
import time
import urllib.parse
import pytest
import requests

BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]).rstrip('/')
API = f'{BASE_URL}/api/cloudivr-web'
MISSING = '+1707220640'
EXTRA = '+170722064100'
BAD_AREA = '+11234567890'
NO_ONE = '+7072206410'
GOOD = '+17072206410'


@pytest.fixture(scope='module')
def alice():
    s = requests.Session()
    r = s.post(f'{API}/auth/login', json={'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f'login failed {r.status_code}')
    return s


@pytest.fixture(scope='module')
def num(alice):
    nums = alice.get(f'{API}/numbers', timeout=20).json()['numbers']
    act = [n for n in nums if n.get('status') == 'active']
    if not act:
        pytest.skip('Alice has no active number')
    return act[0]['phoneNumber']


@pytest.fixture(scope='module')
def audio_id(alice):
    a = alice.get(f'{API}/audio', timeout=20).json().get('audios') or []
    if not a:
        pytest.skip('no audio')
    return a[0]['id']


def enc(n):
    return urllib.parse.quote(n, safe='')


# ── Quick IVR ──
class TestQuickIvrTypos:
    @pytest.mark.parametrize('bad,frag', [(MISSING, 'is missing a digit'), (EXTRA, 'has an extra digit'), (BAD_AREA, 'not a valid USA/Canada number'), (NO_ONE, 'Did you mean +17072206410?')])
    def test_target_typo(self, alice, num, bad, frag):
        r = alice.post(f'{API}/calls/quick', json={'callerId': num, 'targets': bad, 'text': 'Hi press 1', 'transferTo': '+14155550199'}, timeout=20)
        assert r.status_code == 400, r.text
        assert r.json()['error'] == 'invalid_number' and frag in r.json()['message'], r.text

    def test_typo_among_several_targets(self, alice, num):
        r = alice.post(f'{API}/calls/quick', json={'callerId': num, 'targets': f'{GOOD},{MISSING}', 'text': 'Hi', 'transferTo': '+14155550199'}, timeout=20)
        assert r.status_code == 400 and 'missing a digit' in r.json()['message'], r.text

    def test_transfer_typo(self, alice, num):
        r = alice.post(f'{API}/calls/quick', json={'callerId': num, 'targets': GOOD, 'text': 'Hi', 'transferTo': NO_ONE}, timeout=20)
        assert r.status_code == 400 and r.json()['error'] == 'invalid_transfer' and 'missing the 1' in r.json()['message'], r.text

    def test_otp_transfer_typo(self, alice, num):
        r = alice.post(f'{API}/calls/quick', json={'callerId': num, 'targets': GOOD, 'text': 'Code', 'mode': 'otp', 'otp': {'length': 6}, 'transferTo': EXTRA}, timeout=20)
        assert r.status_code == 400 and r.json()['error'] == 'invalid_transfer', r.text

    def test_menu_forward_typo(self, alice, num):
        r = alice.post(f'{API}/calls/quick', json={'callerId': num, 'targets': GOOD, 'text': 'Menu', 'menu': {'1': {'action': 'forward', 'forwardTo': MISSING}}}, timeout=20)
        assert r.status_code == 400 and r.json()['error'] == 'invalid_menu' and 'missing a digit' in r.json()['message'], r.text

    def test_backup_typo(self, alice, num):
        r = alice.post(f'{API}/calls/quick', json={'callerId': num, 'targets': GOOD, 'text': 'Hi', 'transferTo': '+14155550199', 'transferBackups': [MISSING]}, timeout=20)
        assert r.status_code == 400 and r.json()['error'] == 'invalid_backup', r.text

    @pytest.mark.parametrize('good', ['+17072206410', '+18002805175', '+447911123456', '+77072206410'])
    def test_valid_targets_still_work(self, alice, num, good):
        r = alice.post(f'{API}/calls/quick', json={'callerId': num, 'targets': good, 'text': 'Hi press 1', 'transferTo': '+18002805175' if good != '+18002805175' else '+17072206410'}, timeout=20)
        assert r.status_code == 202, r.text
        assert r.json().get('dryRun') is True


# ── Campaigns (pasted leads) ──
class TestCampaignTypos:
    def test_estimate_lists_typos(self, alice):
        r = alice.post(f'{API}/campaigns/estimate', json={'leads': f'{GOOD}\n{NO_ONE}\n{MISSING}\n+18002805175'}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['count'] == 2 and len(d['errors']) == 2, d
        assert any(NO_ONE in e for e in d['errors']) and any(MISSING in e for e in d['errors'])

    def test_create_rejects_invalid_leads(self, alice, num, audio_id):
        r = alice.post(f'{API}/campaigns', json={'callerId': num, 'audioId': audio_id, 'mode': 'report_only', 'leads': f'{GOOD}\n{NO_ONE}', 'validateOnly': True}, timeout=20)
        assert r.status_code == 400 and r.json()['error'] == 'invalid_leads', r.text
        assert '1 number needs fixing' in r.json()['message']

    def test_create_rejects_invalid_leads_no_validate_only(self, alice, num, audio_id):
        r = alice.post(f'{API}/campaigns', json={'callerId': num, 'audioId': audio_id, 'mode': 'report_only', 'name': 'TEST_typo', 'leads': f'{GOOD}\n{MISSING}\n{EXTRA}'}, timeout=20)
        assert r.status_code == 400 and r.json()['error'] == 'invalid_leads' and '2 numbers need' in r.json()['message'], r.text

    def test_only_typos_no_leads(self, alice, num, audio_id):
        r = alice.post(f'{API}/campaigns', json={'callerId': num, 'audioId': audio_id, 'mode': 'report_only', 'leads': NO_ONE, 'validateOnly': True}, timeout=20)
        assert r.status_code == 400 and r.json()['error'] == 'no_leads' and NO_ONE in r.json()['message'], r.text

    def test_transfer_number_typo(self, alice, num, audio_id):
        r = alice.post(f'{API}/campaigns', json={'callerId': num, 'audioId': audio_id, 'mode': 'transfer', 'transferNumber': MISSING, 'leads': GOOD, 'validateOnly': True}, timeout=20)
        assert r.status_code == 400 and r.json()['error'] == 'invalid_transfer', r.text

    def test_valid_leads_validate_ok(self, alice, num, audio_id):
        r = alice.post(f'{API}/campaigns', json={'callerId': num, 'audioId': audio_id, 'mode': 'report_only', 'leads': f'{GOOD}\n+18002805175\n+447911123456', 'validateOnly': True}, timeout=20)
        assert r.status_code == 200 and r.json().get('ok') is True, r.text

    def test_ai_campaign_rejects_typos(self, alice, num):
        ag = alice.get(f'{API}/ai-agents', timeout=20)
        agents = (ag.json().get('agents') if ag.status_code == 200 else None) or []
        if not agents:
            pytest.skip(f'no AI agent for Alice ({ag.status_code})')
        r = alice.post(f'{API}/campaigns', json={'mode': 'ai', 'callerId': num, 'agentId': agents[0]['id'], 'leads': f'{GOOD}\n{NO_ONE}'}, timeout=20)
        assert r.status_code == 400 and r.json()['error'] == 'invalid_leads', r.text


# ── Other dialing screens ──
class TestOtherScreens:
    def test_callback_my_phone_typo(self, alice, num):
        r = alice.post(f'{API}/calls/callback', json={'callerId': num, 'myPhone': MISSING, 'to': GOOD}, timeout=20)
        assert r.status_code == 400 and r.json()['error'] == 'invalid_my_phone', r.text

    def test_callback_to_typo(self, alice, num):
        r = alice.post(f'{API}/calls/callback', json={'callerId': num, 'myPhone': '+18002805175', 'to': NO_ONE}, timeout=20)
        assert r.status_code == 400 and r.json()['error'] == 'invalid_number' and 'missing the 1' in r.json()['message'], r.text

    def test_relay_typo(self, alice, num):
        r = alice.post(f'{API}/relay/calls', json={'callerId': num, 'to': EXTRA}, timeout=20)
        assert r.status_code == 400 and r.json()['error'] == 'invalid_number' and 'extra digit' in r.json()['message'], r.text

    def test_ring_group_typo(self, alice, num):
        r = alice.put(f'{API}/numbers/{enc(num)}/ring-group', json={'enabled': True, 'members': [GOOD, MISSING]}, timeout=20)
        assert r.status_code == 400 and 'missing a digit' in r.text, r.text

    def test_ring_group_fallback_typo(self, alice, num):
        r = alice.put(f'{API}/numbers/{enc(num)}/ring-group', json={'enabled': True, 'members': [GOOD, '+18002805175'], 'fallback': 'forward', 'fallbackTo': NO_ONE}, timeout=20)
        assert r.status_code == 400 and 'missing the 1' in r.text, r.text

    def test_forwarding_typo(self, alice, num):
        r = alice.patch(f'{API}/numbers/{enc(num)}/forwarding', json={'mode': 'always', 'forwardTo': MISSING}, timeout=20)
        assert r.status_code == 400 and r.json()['error'] == 'invalid_number', r.text

    def test_ivr_forward_key_typo(self, alice, num):
        r = alice.put(f'{API}/numbers/{enc(num)}/ivr', json={'enabled': True, 'greeting': 'Hi', 'options': {'1': {'action': 'forward', 'forwardTo': EXTRA}}}, timeout=20)
        assert r.status_code == 400 and 'extra digit' in r.text, r.text

    def test_contact_add_typo(self, alice):
        r = alice.post(f'{API}/contacts', json={'phone': NO_ONE, 'name': 'TEST_typo'}, timeout=20)
        assert r.status_code == 400 and r.json()['error'] == 'invalid_contact', r.text

    def test_trycall_typo(self):
        r = requests.post(f'{API}/public/try/call-me', json={'to': MISSING}, timeout=20)
        # unverified email → 401 first; destination check is after auth. Just ensure no 5xx.
        assert r.status_code in (400, 401), r.text


# ── Saved contact list import drops mistyped numbers (check only, nothing saved) ──
class TestContactsImport:
    def test_import_check_counts_typos_invalid(self, alice):
        text = f'Name,Phone\nTEST_a,{GOOD}\nTEST_b,{NO_ONE}\nTEST_c,{MISSING}\nTEST_d,+18002805175'
        r = alice.post(f'{API}/contacts/import/parse', data={'text': text, 'fileName': 'TEST_typo.csv'}, timeout=20)
        assert r.status_code == 201, r.text
        p = r.json()
        roles = [c['role'] for c in p['columns']]
        assert 'phone' in roles, p
        r = alice.post(f'{API}/contacts/import/check', json={'importId': p['importId'], 'roles': roles, 'hasHeader': p['hasHeader']}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['valid'] == 2 and d['invalid'] == 2, d
