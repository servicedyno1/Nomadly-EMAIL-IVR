# CloudIVR: owner-chosen Accept / Decline outcomes on keys with manual confirm (collect/pin/webhook).
import os, json, copy, pytest, requests

BASE = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/') + '/api/cloudivr-web'
PHONE = '%2B13346970100'


@pytest.fixture(scope='module')
def s():
    ss = requests.Session()
    r = ss.post(f'{BASE}/auth/login', json={'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'})
    if r.status_code != 200:
        pytest.skip('login failed')
    return ss


@pytest.fixture(scope='module')
def orig(s):
    o = s.get(f'{BASE}/numbers/{PHONE}').json()['number']['features'].get('ivr')
    yield o
    if o:
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=o)
        assert r.status_code == 200, r.text


def menu(orig, **key1):
    m = copy.deepcopy(orig)
    m['options']['1'].update(key1)
    return m


class TestOutcomes:
    def test_forward_and_voicemail_stored(self, s, orig):
        m = menu(orig, confirm=True, onAccept={'action': 'forward', 'forwardTo': '+14155550144'}, onDecline={'action': 'voicemail', 'message': 'Sorry'})
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=m)
        assert r.status_code == 200, r.text
        o = r.json()['ivr']['options']['1']
        assert o['onAccept'] == {'action': 'forward', 'message': '', 'forwardTo': '+14155550144'}
        assert o['onDecline']['action'] == 'voicemail' and o['onDecline']['message'] == 'Sorry' and o['onDecline']['forwardTo'] == ''
        g = s.get(f'{BASE}/numbers/{PHONE}').json()['number']['features']['ivr']['options']['1']
        assert g['onAccept']['forwardTo'] == '+14155550144' and g['onDecline']['action'] == 'voicemail'

    @pytest.mark.parametrize('act', ['message', 'menu', 'end'])
    def test_other_actions(self, s, orig, act):
        m = menu(orig, confirm=True, onAccept={'action': act, 'message': 'Hi'}, onDecline={'action': act, 'message': 'Bye'})
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=m)
        assert r.status_code == 200, r.text
        o = r.json()['ivr']['options']['1']
        assert o['onAccept']['action'] == act and o['onDecline']['message'] == 'Bye'

    def test_default_drops_outcome(self, s, orig):
        m = menu(orig, confirm=True, onAccept={'action': 'default'}, onDecline={'action': 'bogus'})
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=m)
        assert r.status_code == 200, r.text
        o = r.json()['ivr']['options']['1']
        assert 'onAccept' not in o and 'onDecline' not in o

    def test_confirm_off_drops_outcomes(self, s, orig):
        m = menu(orig, confirm=False, onAccept={'action': 'forward', 'forwardTo': '+14155550144'})
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=m)
        assert r.status_code == 200, r.text
        assert 'onAccept' not in r.json()['ivr']['options']['1']

    @pytest.mark.parametrize('bad', ['123', '', 'abc'])
    def test_bad_forward_400(self, s, orig, bad):
        m = menu(orig, confirm=True, onAccept={'action': 'forward', 'forwardTo': bad})
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=m)
        assert r.status_code == 400, r.text
        msg = r.json().get('message', json.dumps(r.json()))
        assert 'key 1' in msg.lower(), msg
        print('400 msg:', msg)

    def test_pin_outcomes(self, s, orig):
        m = copy.deepcopy(orig)
        m['options']['2'].update(confirm=True, onDecline={'action': 'forward', 'forwardTo': '+14155550145', 'message': 'Connecting'})
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=m)
        assert r.status_code == 200, r.text
        assert r.json()['ivr']['options']['2']['onDecline']['forwardTo'] == '+14155550145'

    def test_webhook_outcomes(self, s, orig):
        m = copy.deepcopy(orig)
        m['options']['3'].update(confirm=True, onAccept={'action': 'menu', 'message': 'OK'})
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=m)
        assert r.status_code == 200, r.text
        assert r.json()['ivr']['options']['3']['onAccept'] == {'action': 'menu', 'message': 'OK', 'forwardTo': ''}

    def test_restore_matches(self, s, orig):
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=orig)
        assert r.status_code == 200
        g = s.get(f'{BASE}/numbers/{PHONE}').json()['number']['features']['ivr']
        assert g['options'] == orig['options']
