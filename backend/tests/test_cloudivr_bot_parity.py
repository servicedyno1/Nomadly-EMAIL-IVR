# CloudIVR web — 21 bot-parity features (Quick IVR, trial, extras, downgrade, coupons, templates, support chat, isolation)
import os, datetime, pytest, requests

BASE = os.environ.get('REACT_APP_BACKEND_URL') or open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]
API = BASE.rstrip('/') + '/api/cloudivr-web'
ALICE = ('civr.alice@example.com', 'AliceTest#2026')
BOB = ('civr.bob@example.com', 'BobTest#2026')
A_NUM = '+15156445205'
B_NUM = '+19565971129'
STATE = {}


def login(cred):
    s = requests.Session()
    r = s.post(f'{API}/auth/login', json={'email': cred[0], 'password': cred[1]})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope='module')
def alice():
    return login(ALICE)


@pytest.fixture(scope='module')
def bob():
    return login(BOB)


def iso(minutes):
    return (datetime.datetime.utcnow() + datetime.timedelta(minutes=minutes)).isoformat() + 'Z'


# ── Quick IVR ──
class TestQuickIvr:
    def test_transfer(self, alice):
        r = alice.post(f'{API}/calls/quick', json={'callerId': A_NUM, 'targets': '+14155550100', 'text': 'Hello, press 1', 'transferTo': '+14155550199', 'activeKeys': ['1']})
        assert r.status_code == 202, r.text
        assert r.json()['dryRun'] is True
        STATE['callId'] = r.json()['callId']

    def test_otp(self, alice):
        r = alice.post(f'{API}/calls/quick', json={'callerId': A_NUM, 'targets': '+14155550100', 'text': 'Enter code', 'mode': 'otp', 'otp': {'length': 6, 'confirmMsg': 'Thanks', 'rejectMsg': 'Wrong'}})
        assert r.status_code == 202, r.text
        assert '6-digit' in r.json()['message']

    def test_menu(self, alice):
        menu = {'1': {'action': 'forward', 'forwardTo': '+14155550199'}, '2': {'action': 'message', 'message': 'Bye'},
                '3': {'action': 'submenu', 'greeting': 'x', 'options': {'1': {'action': 'message', 'message': 'y'}}}}
        r = alice.post(f'{API}/calls/quick', json={'callerId': A_NUM, 'targets': '+14155550100', 'text': 'Menu', 'menu': menu})
        assert r.status_code == 202, r.text
        assert 'route keys 1, 2, 3' in r.json()['message']

    def test_several_and_too_many(self, alice):
        nums = ','.join(f'+1415555{1000 + i}' for i in range(10))
        r = alice.post(f'{API}/calls/quick', json={'callerId': A_NUM, 'targets': nums, 'text': 'Hi', 'transferTo': '+14155550199'})
        assert r.status_code == 202 and r.json()['count'] == 10, r.text
        r = alice.post(f'{API}/calls/quick', json={'callerId': A_NUM, 'targets': nums + ',+14155552000', 'text': 'Hi', 'transferTo': '+14155550199'})
        assert r.status_code == 400 and r.json()['error'] == 'too_many_numbers'

    @pytest.mark.parametrize('body,code', [
        ({'targets': '12'}, 'invalid_number'),
        ({'text': 'Hello [Name], press 1'}, 'unfilled_placeholders'),
        ({'targets': '+8816123456'}, 'blocked_destination'),
    ])
    def test_errors(self, alice, body, code):
        base = {'callerId': A_NUM, 'targets': '+14155550100', 'text': 'Hi', 'transferTo': '+14155550199'}
        r = alice.post(f'{API}/calls/quick', json={**base, **body})
        assert r.status_code == 400 and r.json()['error'] == code, r.text

    def test_schedule_list_cancel(self, alice):
        base = {'callerId': A_NUM, 'targets': '+14155550100', 'text': 'Hi', 'transferTo': '+14155550199'}
        r = alice.post(f'{API}/calls/quick', json={**base, 'scheduleAt': iso(10)})
        assert r.status_code == 201 and r.json()['scheduled'] == 1, r.text
        lst = alice.get(f'{API}/calls/scheduled').json()['calls']
        sid = next(c['id'] for c in lst if c['status'] in ('preview', 'pending'))
        assert alice.delete(f'{API}/calls/scheduled/{sid}').status_code == 200
        assert alice.delete(f'{API}/calls/scheduled/{sid}').status_code == 404
        r = alice.post(f'{API}/calls/quick', json={**base, 'scheduleAt': iso(1)})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_schedule'

    def test_history_recent_redial(self, alice):
        h = alice.get(f'{API}/calls/history').json()['calls']
        assert any(c['id'] == STATE['callId'] for c in h)
        rec = alice.get(f'{API}/calls/recent').json()['numbers']
        assert 0 < len(rec) <= 10 and '+14155551009' in rec
        r = alice.post(f'{API}/calls/history/{STATE["callId"]}/redial')
        assert r.status_code == 202, r.text

    def test_presets(self, alice):
        r = alice.post(f'{API}/calls/presets', json={'name': 'TEST_preset', 'setup': {'callerId': A_NUM, 'text': 'Hi', 'transferTo': '+14155550199', 'activeKeys': ['1']}})
        assert r.status_code == 201, r.text
        pid = r.json()['preset']['id']
        STATE['presetId'] = pid
        assert any(p['id'] == pid for p in alice.get(f'{API}/calls/presets').json()['presets'])

    def test_menu_stats(self, alice):
        r = alice.get(f'{API}/calls/menu-stats')
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), dict)

    def test_templates_fill(self, alice):
        t = alice.get(f'{API}/outbound/templates').json()
        assert t['categories'] and t['templates'] and isinstance(t['smart'], dict)
        names = list(t['smart'].keys())[:3]
        v = alice.post(f'{API}/outbound/fill', json={'names': names}).json()['values']
        assert isinstance(v, dict)
        STATE['fill'] = (names, v)


# ── Trial (Bob) ──
class TestTrial:
    def test_alice_not_available(self, alice):
        assert alice.get(f'{API}/calls/trial').json()['available'] is False

    def test_bob_trial_once(self, bob):
        assert bob.get(f'{API}/calls/trial').json()['available'] is True
        r = bob.post(f'{API}/calls/trial', json={'to': '+14155550100', 'transferTo': '+14155550199', 'text': 'Hi press 1'})
        assert r.status_code == 202 and r.json()['dryRun'], r.text
        r = bob.post(f'{API}/calls/trial', json={'to': '+14155550100', 'transferTo': '+14155550199', 'text': 'Hi press 1'})
        assert r.status_code == 403 and r.json()['error'] == 'trial_used'
        assert bob.get(f'{API}/calls/trial').json()['available'] is False


# ── Numbers extras: extra numbers, downgrade, test calls, fax ──
class TestNumbersExtras:
    def _pick(self, s):
        r = s.get(f'{API}/numbers/search', params={'country': 'US', 'type': 'local'})
        assert r.status_code == 200, r.text
        return r.json()['numbers'][0]['phoneNumber']

    def test_extra_info_and_buy(self, alice):
        info = alice.get(f'{API}/numbers/{A_NUM}/extra').json()
        assert info['allowed'] is True and 'limit' in info and 'price' in info
        p = self._pick(alice)
        r = alice.post(f'{API}/numbers/{A_NUM}/extra', json={'phoneNumber': p})
        assert r.status_code == 201, r.text
        n = r.json()['number']
        assert n.get('isSubNumber') is True and n.get('parentNumber') == A_NUM, n
        STATE['sub'] = n['phoneNumber']
        r = alice.post(f'{API}/numbers/{STATE["sub"]}/extra', json={'phoneNumber': p})
        assert r.status_code == 400 and r.json()['error'] == 'is_extra'

    def test_downgrade_flow(self, alice):
        p = self._pick(alice)
        r = alice.post(f'{API}/numbers/buy', json={'phoneNumber': p, 'plan': 'business'})
        assert r.status_code == 201, r.text
        main = r.json()['number']['phoneNumber']
        STATE['throwaway'] = main
        p2 = self._pick(alice)
        r = alice.post(f'{API}/numbers/{main}/extra', json={'phoneNumber': p2})
        assert r.status_code == 201, r.text
        sub = r.json()['number']['phoneNumber']
        r = alice.post(f'{API}/numbers/{main}/downgrade', json={'plan': 'pro'})
        assert r.status_code == 200 and 'preview' in r.json(), r.text
        STATE['lost'] = r.json()['preview']['lost']
        assert alice.get(f'{API}/numbers/{main}').json()['number']['plan'] == 'business'
        r = alice.post(f'{API}/numbers/{main}/downgrade', json={'plan': 'business', 'confirm': True})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_plan'
        r = alice.post(f'{API}/numbers/{main}/downgrade', json={'plan': 'pro', 'confirm': True})
        assert r.status_code == 200 and r.json()['plan'] == 'pro', r.text
        assert alice.get(f'{API}/numbers/{main}').json()['number']['plan'] == 'pro'
        assert alice.get(f'{API}/numbers/{sub}').json()['number']['plan'] == 'pro'
        r = alice.post(f'{API}/numbers/{main}/downgrade', json={'plan': 'business', 'confirm': True})
        assert r.status_code == 400

    def test_test_calls(self, alice, bob):
        assert alice.post(f'{API}/numbers/{A_NUM}/test-call').status_code == 202
        assert alice.post(f'{API}/numbers/{A_NUM}/test-sip').status_code == 202
        assert bob.post(f'{API}/numbers/{B_NUM}/test-sip').status_code == 403

    def test_fax(self, alice, bob):
        # Alice's main number IS fax-capable → 200; no_fax checked on any non-fax number we own
        r = alice.patch(f'{API}/numbers/{A_NUM}/fax', json={'toInbox': True})
        assert r.status_code == 200 and r.json()['fax']['toInbox'] is True, r.text
        for s in (alice, bob):
            for n in s.get(f'{API}/numbers').json()['numbers']:
                if not (n.get('capabilities') or {}).get('fax'):
                    r = s.patch(f'{API}/numbers/{n["phoneNumber"]}/fax', json={'toInbox': True})
                    assert r.status_code == 400 and r.json()['error'] == 'no_fax', r.text
                    return
        pytest.skip('no non-fax number available')


# ── Inbound IVR templates, voice prefs ──
class TestTemplatesVoice:
    def test_ivr_templates(self, alice):
        t = alice.get(f'{API}/ivr/templates').json()
        assert len(t['builtin']) == 5
        r = alice.post(f'{API}/ivr/templates', json={'name': 'TEST_Sales line', 'ivr': {'greeting': 'Hi', 'options': {'1': {'action': 'forward', 'forwardTo': '+14155550199'}}}})
        assert r.status_code == 201, r.text
        STATE['tplId'] = r.json()['template']['id']

    def test_voice(self, alice, bob):
        assert alice.get(f'{API}/prefs/voice').status_code == 200
        r = alice.put(f'{API}/prefs/voice', json={'voice': 'rachel', 'speed': 1})
        assert r.status_code == 200 and r.json()['voice'] == 'rachel'
        assert alice.get(f'{API}/prefs/voice').json()['voice'] == 'rachel'
        assert bob.put(f'{API}/prefs/voice', json={'voice': 'rachel', 'speed': 1}).status_code == 403


# ── Isolation: Bob cannot reach Alice's stuff ──
class TestIsolation:
    def test_isolation(self, bob):
        assert bob.get(f'{API}/numbers/{A_NUM}/extra').status_code == 404
        assert bob.post(f'{API}/numbers/{A_NUM}/downgrade', json={'plan': 'pro'}).status_code == 404
        assert bob.delete(f'{API}/calls/presets/{STATE.get("presetId", "x")}').status_code == 404
        assert bob.delete(f'{API}/ivr/templates/{STATE.get("tplId", "x")}').status_code == 404
        assert bob.post(f'{API}/calls/history/{STATE.get("callId", "x")}/redial').status_code == 404
        if STATE.get('campaignId'):
            assert bob.get(f'{API}/campaigns/{STATE["campaignId"]}/report.csv').status_code == 404


# ── Campaign CSV ──
class TestCampaignCsv:
    def test_report_csv(self, alice, bob):
        camps = alice.get(f'{API}/campaigns').json().get('campaigns', [])
        if not camps:
            aud = alice.get(f'{API}/audio').json()
            items = aud.get('audio') or aud.get('items') or aud.get('files') or []
            if not items:
                pytest.skip('no campaign and no audio')
            r = alice.post(f'{API}/campaigns', json={'callerId': A_NUM, 'audioId': items[0]['id'], 'leads': '+14155550100,TEST', 'mode': 'report_only'})
            assert r.status_code == 201, r.text
            camps = [r.json()['campaign']]
        cid = camps[0]['id']
        STATE['campaignId'] = cid
        r = alice.get(f'{API}/campaigns/{cid}/report.csv')
        assert r.status_code == 200, r.text[:200]
        assert 'csv' in r.headers.get('content-type', '') or 'attachment' in r.headers.get('content-disposition', '')
        assert bob.get(f'{API}/campaigns/{cid}/report.csv').status_code == 404


# ── Coupons (Bob) ──
class TestCoupons:
    def test_check_and_buy(self, bob):
        today = bob.get(f'{API}/coupons/today').json()
        STATE['today'] = today
        assert bob.post(f'{API}/coupons/check', json={'code': 'NOPE_XYZ', 'amount': 50}).status_code == 400
        r = bob.post(f'{API}/coupons/check', json={'code': 'NMD10EQA5U5', 'amount': 50})
        assert r.status_code == 200, r.text
        assert r.json()['discount'] == 10 and r.json()['newPrice'] == 45
        bal0 = bob.get(f'{API}/wallet').json()
        p = TestNumbersExtras()._pick(bob)
        r = bob.post(f'{API}/numbers/buy', json={'phoneNumber': p, 'plan': 'starter', 'coupon': 'NMD10EQA5U5'})
        assert r.status_code == 201, r.text
        STATE['bobNew'] = r.json()['number']['phoneNumber']
        STATE['bobBal'] = (bal0, r.json()['balance'])
        notes = bob.get(f'{API}/notifications').json()['notifications']
        n = next((x for x in notes if x['kind'] == 'coupon' and 'NMD10EQA5U5 applied' in x['text']), None)
        assert n and n['meta'].get('used') is True and 'You saved $' in n['text'], notes[:3]
        r = bob.post(f'{API}/coupons/check', json={'code': 'NMD10EQA5U5', 'amount': 50})
        assert r.status_code == 400 and 'already' in r.json()['message'].lower()


# ── AI support chat (real OpenAI — few calls) ──
class TestSupportChat:
    def test_chat(self, alice):
        g = alice.get(f'{API}/support/chat').json()
        assert g['enabled'] is True and g['supportLink'].startswith('https://t.me/'), g
        r = alice.post(f'{API}/support/chat', json={'message': 'How do I add an extra number?', 'lang': 'en'}, timeout=60).json()
        STATE['ai1'] = r
        assert r['reply'] and r['escalate'] is False, r
        r = alice.post(f'{API}/support/chat', json={'message': 'I want a refund', 'lang': 'en'}, timeout=60).json()
        assert r['escalate'] is True and r['supportLink'], r
        r = alice.post(f'{API}/support/chat', json={'message': 'Comment acheter un numéro ?', 'lang': 'fr'}, timeout=60).json()
        STATE['ai_fr'] = r['reply']
        assert r['reply'] and any(w in r['reply'].lower() for w in [' le ', ' la ', ' un ', 'numéro']), r
        assert alice.delete(f'{API}/support/chat').status_code == 200
        assert alice.get(f'{API}/support/chat').json()['messages'] == []


# ── Cleanup ──
class TestZCleanup:
    def test_cleanup(self, alice):
        if STATE.get('presetId'):
            assert alice.delete(f'{API}/calls/presets/{STATE["presetId"]}').status_code == 200
        if STATE.get('tplId'):
            assert alice.delete(f'{API}/ivr/templates/{STATE["tplId"]}').status_code == 200
        print('STATE', {k: v for k, v in STATE.items()})
