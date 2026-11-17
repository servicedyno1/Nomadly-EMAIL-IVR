# CloudIVR: Replay option on Accept/Decline (owner-typed message), confirm-preview, otp actions, replayMessage storage.
import os, json, copy, time, pytest, requests

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
    json.dump(o, open('/app/backend/tests/alice_ivr_backup_iter313.json', 'w'), indent=1)
    yield o
    if o:
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=o)
        assert r.status_code == 200, r.text


# Pop-up preview
class TestPreview:
    @pytest.mark.parametrize('kind', ['pin', 'collect'])
    def test_preview_replay_fields(self, s, kind):
        r = s.post(f'{BASE}/ivr-connections/confirm-preview', json={'kind': kind, 'digit': '2', 'label': 'TEST_lbl', 'onAccept': 'menu', 'onDecline': 'forward', 'declineTo': '+14155550145', 'replayMessage': 'TEST_replay msg', 'declineMessage': 'TEST_bye'})
        assert r.status_code == 200, r.text
        pid = r.json()['id']
        assert pid.startswith('pv_')
        # replay on preview
        r2 = s.post(f'{BASE}/calls/otp/{pid}', json={'action': 'replay', 'message': 'TEST typed'})
        assert r2.status_code == 200, r2.text
        assert r2.json()['state'] == 'replayed'

    def test_preview_view_has_fields(self, s):
        r = s.post(f'{BASE}/ivr-connections/confirm-preview', json={'kind': 'pin', 'replayMessage': 'TEST_rm', 'onAccept': 'voicemail', 'onDecline': 'forward', 'declineTo': '+14155550145'})
        pid = r.json()['id']
        # find view via any pending endpoint
        found = next((it for it in s.get(f'{BASE}/incoming').json()['otp'] if it.get('id') == pid), None)
        assert found, 'preview not in /incoming otp list'
        print('pending view:', found)
        if True:
            assert found['canReplay'] is True and found['replayMessage'] == 'TEST_rm'
            assert found['onAccept'] == 'voicemail' and found['declineTo'] == '+14155550145'
        s.post(f'{BASE}/calls/otp/{pid}', json={'action': 'hangup'})

    def test_webhook_no_replay(self, s):
        r = s.post(f'{BASE}/ivr-connections/confirm-preview', json={'kind': 'webhook', 'digit': '3'})
        assert r.status_code == 200
        v = next(it for it in s.get(f'{BASE}/incoming').json()['otp'] if it.get('id') == r.json()['id'])
        assert v['canReplay'] is False
        s.post(f"{BASE}/calls/otp/{r.json()['id']}", json={'action': 'decline'})

    def test_invalid_action(self, s):
        r = s.post(f'{BASE}/ivr-connections/confirm-preview', json={'kind': 'pin'})
        r2 = s.post(f"{BASE}/calls/otp/{r.json()['id']}", json={'action': 'bogus'})
        assert r2.status_code == 400
        assert 'Choose accept, decline, replay or hang up.' in r2.text
        s.post(f"{BASE}/calls/otp/{r.json()['id']}", json={'action': 'hangup'})

    def test_unauth(self):
        r = requests.post(f'{BASE}/ivr-connections/confirm-preview', json={'kind': 'pin'})
        assert r.status_code == 401


# replayMessage storage via PUT numbers/:phone/ivr
class TestStore:
    def test_replay_msg_pin_collect(self, s, orig):
        m = copy.deepcopy(orig)
        m['options']['1'].update(confirm=True, replayMessage='TEST_collect replay')
        m['options']['2'].update(confirm=True, replayMessage='TEST_pin replay')
        m['options']['3'].update(confirm=True, replayMessage='TEST_webhook replay')
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=m)
        assert r.status_code == 200, r.text
        g = s.get(f'{BASE}/numbers/{PHONE}').json()['number']['features']['ivr']['options']
        assert g['1']['replayMessage'] == 'TEST_collect replay'
        assert g['2']['replayMessage'] == 'TEST_pin replay'
        assert 'replayMessage' not in g['3']

    def test_replay_msg_dropped_when_confirm_off(self, s, orig):
        m = copy.deepcopy(orig)
        m['options']['1'].update(confirm=False, replayMessage='TEST_x')
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=m)
        assert r.status_code == 200, r.text
        assert 'replayMessage' not in r.json()['ivr']['options']['1']

    @pytest.mark.parametrize('which,label', [('onAccept', 'accept'), ('onDecline', 'decline')])
    def test_bad_forward_names_outcome(self, s, orig, which, label):
        m = copy.deepcopy(orig)
        m['options']['1'].update(confirm=True, **{which: {'action': 'forward', 'forwardTo': '123'}})
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=m)
        assert r.status_code == 400
        msg = r.json().get('message', r.text)
        print(msg)
        assert 'key 1' in msg.lower() and label in msg.lower()

    def test_restore(self, s, orig):
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=orig)
        assert r.status_code == 200
        g = s.get(f'{BASE}/numbers/{PHONE}').json()['number']['features']['ivr']
        assert g['options'] == orig['options']

