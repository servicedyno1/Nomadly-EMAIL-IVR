# Iter126 retest: text calls (relay) keypad order, single live call, delete guard, history delete
import os, time, pytest, requests

BASE = os.environ.get('REACT_APP_BACKEND_URL') or open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]
API = f"{BASE.rstrip('/')}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026')


@pytest.fixture(scope='module')
def alice():
    s = requests.Session()
    r = s.post(f'{API}/auth/login', json={'email': ALICE[0], 'password': ALICE[1]})
    assert r.status_code == 200, r.text
    tok = r.json().get('token')
    if tok:
        s.headers['Authorization'] = f'Bearer {tok}'
    live = s.get(f'{API}/relay/info').json().get('live')
    if live:
        s.post(f'{API}/relay/calls/{live}/hangup', json={})
    return s


@pytest.fixture(scope='module')
def call(alice):
    info = alice.get(f'{API}/relay/info').json()
    r = alice.post(f'{API}/relay/calls', json={'callerId': '+19786001640', 'to': '+12025550177', 'lang': 'en', 'voice': 'female'})
    assert r.status_code in (200, 201), r.text
    cid = r.json().get('id') or r.json().get('call', {}).get('id')
    for _ in range(40):
        if alice.get(f'{API}/relay/calls/{cid}').json()['call']['status'] == 'live':
            break
        time.sleep(0.5)
    yield cid
    alice.post(f'{API}/relay/calls/{cid}/hangup', json={})


class TestRelayRetest:
    # Keypad: sequential presses kept in order in GET lines
    def test_keys_order(self, alice, call):
        for k in ['1', '#', '2']:
            r = alice.post(f'{API}/relay/calls/{call}/keys', json={'digits': k})
            assert r.status_code == 200, r.text
        lines = alice.get(f'{API}/relay/calls/{call}').json()['call']['lines']
        assert [l['text'] for l in lines if l['who'] == 'key'][-3:] == ['1', '#', '2']

    # Only one live call per account
    def test_second_call_rejected(self, alice, call):
        r = alice.post(f'{API}/relay/calls', json={'callerId': '+19786001640', 'to': '+12025550178', 'lang': 'en'})
        assert r.status_code == 409

    # Cannot delete a live call
    def test_delete_live_blocked(self, alice, call):
        assert alice.delete(f'{API}/relay/calls/{call}').status_code == 409

    # Hang up → ended, then delete → 404 on GET
    def test_hangup_then_delete(self, alice, call):
        r = alice.post(f'{API}/relay/calls/{call}/hangup', json={})
        assert r.status_code == 200
        c = alice.get(f'{API}/relay/calls/{call}').json()['call']
        assert c['status'] == 'ended' and c['outcome'] == 'completed'
        assert alice.delete(f'{API}/relay/calls/{call}').status_code == 200
        assert alice.get(f'{API}/relay/calls/{call}').status_code == 404
