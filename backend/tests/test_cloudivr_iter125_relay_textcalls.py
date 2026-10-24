# CloudIVR web iter125: Text calls (relay) API + FIX 1/2/5 (backups, email 2FA throttle)
import os, time, uuid
import pytest, requests
from concurrent.futures import ThreadPoolExecutor

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for l in open('/app/frontend/.env'):
        if l.startswith('REACT_APP_BACKEND_URL='):
            BASE = l.split('=', 1)[1].strip().rstrip('/')
API = BASE + '/api/cloudivr-web'
ALICE = ('civr.alice@example.com', 'AliceTest#2026')
BOB = ('civr.bob@example.com', 'BobTest#2026')
BIZ, PRO_N, BOB_N = '+19786001640', '+15674050075', '+17858810036'
PRO = '%2B15674050075'
QA_PW = 'QaTest#2026x'


def login(email, pw):
    s = requests.Session()
    r = s.post(f'{API}/auth/login', json={'email': email, 'password': pw})
    assert r.status_code == 200 and 'account' in r.json(), r.text
    return s


@pytest.fixture(scope='module')
def alice():
    s = login(*ALICE)
    # make sure no stale live call
    live = s.get(f'{API}/relay/info').json().get('live')
    if live:
        s.post(f'{API}/relay/calls/{live}/hangup', json={})
    return s


@pytest.fixture(scope='module')
def bob():
    return login(*BOB)


def mongo():
    from pymongo import MongoClient
    url = [l.split('=', 1)[1].strip().strip('"') for l in open('/app/backend/.env') if l.startswith('MONGO_URL=')][0]
    return MongoClient(url)['test']


@pytest.fixture
def temp_audio(alice):
    # temporary audio record so campaign validation reaches the backups check
    chat = alice.get(f'{API}/auth/me').json()['account']
    chat_id = str(chat.get('chatId') or chat.get('id'))
    aid = 'TEST_' + uuid.uuid4().hex[:8]
    db = mongo()
    db.ivrAudioFiles.insert_one({'id': aid, 'chatId': chat_id, 'name': 'TEST_audio', 'filename': aid + '.mp3', 'audioUrl': 'https://example.com/x.mp3', 'createdAt': time.time()})
    yield aid
    db.ivrAudioFiles.delete_one({'id': aid})


def wait_status(s, cid, status, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        c = s.get(f'{API}/relay/calls/{cid}').json()['call']
        if c['status'] == status:
            return c
        time.sleep(0.5)
    return c


# --- Relay info / auth ---
class TestRelayInfo:
    def test_info(self, alice):
        d = alice.get(f'{API}/relay/info').json()
        assert d['relayRate'] == 0.03 and d['usRate'] == 0.15 and d['intlRate'] == 0.5
        assert d['maxText'] == 1000 and 'live' in d

    def test_requires_login(self):
        for m, p in [('get', '/relay/info'), ('get', '/relay/calls'), ('post', '/relay/calls')]:
            r = getattr(requests, m)(f'{API}{p}', json={})
            assert r.status_code == 401, (p, r.status_code)


# --- Relay start validation ---
class TestRelayValidation:
    def test_invalid_caller(self, alice):
        r = alice.post(f'{API}/relay/calls', json={'callerId': '+14155550199', 'to': '+14155550100'})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_caller'

    def test_other_users_number(self, alice):
        r = alice.post(f'{API}/relay/calls', json={'callerId': BOB_N, 'to': '+14155550100'})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_caller'

    def test_starter_plan_403(self, bob):
        r = bob.post(f'{API}/relay/calls', json={'callerId': BOB_N, 'to': '+14155550100'})
        assert r.status_code == 403 and r.json()['error'] == 'plan_upgrade_required', r.text

    def test_bad_to(self, alice):
        for to in ['abc', '123', '']:
            r = alice.post(f'{API}/relay/calls', json={'callerId': PRO_N, 'to': to})
            assert r.status_code == 400 and r.json()['error'] == 'invalid_number', (to, r.text)

    def test_same_number(self, alice):
        r = alice.post(f'{API}/relay/calls', json={'callerId': PRO_N, 'to': PRO_N})
        assert r.status_code == 400 and r.json()['error'] == 'same_number'


# --- Relay full live flow (dry-run pretend person) ---
class TestRelayFlow:
    def test_full_call(self, alice, bob):
        r = alice.post(f'{API}/relay/calls', json={'callerId': BIZ, 'to': '+1 (415) 555-0100', 'lang': 'es', 'voice': 'male', 'name': 'TEST_Relay', 'announce': True})
        assert r.status_code == 201, r.text
        c = r.json()['call']
        cid = c['id']
        try:
            assert c['status'] == 'ringing' and c['to'] == '+14155550100' and c['lang'] == 'es' and c['voice'] == 'male'
            assert c['rate'] == 0.18 and c['dryRun'] is True
            assert alice.get(f'{API}/relay/info').json()['live'] == cid
            # 409 second live
            r2 = alice.post(f'{API}/relay/calls', json={'callerId': PRO_N, 'to': '+14155550100'})
            assert r2.status_code == 409 and r2.json()['error'] == 'already_live'
            # say before answer → 409
            r3 = alice.post(f'{API}/relay/calls/{cid}/say', json={'text': 'hola'})
            assert r3.status_code == 409 and r3.json()['error'] == 'not_connected'
            # isolation
            assert bob.get(f'{API}/relay/calls/{cid}').status_code == 404
            assert bob.post(f'{API}/relay/calls/{cid}/hangup', json={}).status_code == 404
            # delete while live → 409
            assert alice.delete(f'{API}/relay/calls/{cid}').status_code == 409
            c = wait_status(alice, cid, 'live', 8)
            assert c['status'] == 'live' and c['answeredAt']
            assert any(l['who'] == 'note' and l['text'] == 'intro' for l in c['lines'])
            time.sleep(6)
            c = alice.get(f'{API}/relay/calls/{cid}').json()['call']
            them = [l for l in c['lines'] if l['who'] == 'them']
            assert them and 'Hola' in them[0]['text'], c['lines']
            # empty say
            r = alice.post(f'{API}/relay/calls/{cid}/say', json={'text': '   '})
            assert r.status_code == 400 and r.json()['error'] == 'empty'
            r = alice.post(f'{API}/relay/calls/{cid}/say', json={'text': 'TEST hola, necesito una cita'})
            assert r.status_code == 200 and r.json()['line']['who'] == 'me'
            r = alice.post(f'{API}/relay/calls/{cid}/keys', json={'digits': '1#x'})
            assert r.status_code == 200
            assert alice.post(f'{API}/relay/calls/{cid}/keys', json={'digits': 'xx'}).status_code == 400
            time.sleep(6)
            c = alice.get(f'{API}/relay/calls/{cid}').json()['call']
            assert any(l['who'] == 'key' and l['text'] == '1#' for l in c['lines'])
            assert len([l for l in c['lines'] if l['who'] == 'them']) >= 2
        finally:
            r = alice.post(f'{API}/relay/calls/{cid}/hangup', json={})
        assert r.status_code == 200
        c = r.json()['call']
        assert c['status'] == 'ended' and c['outcome'] == 'completed' and c['charge'] == 0 and c['duration'] > 0
        assert alice.get(f'{API}/relay/info').json()['live'] is None
        # say after hangup
        assert alice.post(f'{API}/relay/calls/{cid}/say', json={'text': 'x'}).status_code == 404
        # history
        h = alice.get(f'{API}/relay/calls').json()['calls']
        row = [x for x in h if x['id'] == cid]
        assert row and row[0]['outcome'] == 'completed' and row[0]['last'] is not None
        full = alice.get(f'{API}/relay/calls/{cid}').json()['call']
        assert len(full['lines']) >= 5
        # delete
        assert bob.delete(f'{API}/relay/calls/{cid}').status_code == 404
        assert alice.delete(f'{API}/relay/calls/{cid}').status_code == 200
        assert alice.get(f'{API}/relay/calls/{cid}').status_code == 404

    def test_cancel_before_answer(self, alice):
        r = alice.post(f'{API}/relay/calls', json={'callerId': PRO_N, 'to': '+442071234567', 'announce': False})
        assert r.status_code == 201, r.text
        c = r.json()['call']
        assert c['rate'] == 0.53 and c['lang'] == 'en' and c['voice'] == 'female'
        r = alice.post(f'{API}/relay/calls/{c["id"]}/hangup', json={})
        assert r.json()['call']['outcome'] == 'cancelled'
        alice.delete(f'{API}/relay/calls/{c["id"]}')

    def test_parallel_start_only_one_live(self, alice):
        def go(_):
            return alice.post(f'{API}/relay/calls', json={'callerId': PRO_N, 'to': '+14155550100', 'announce': False})
        with ThreadPoolExecutor(3) as ex:
            rs = list(ex.map(go, range(3)))
        codes = sorted(r.status_code for r in rs)
        ids = [r.json()['call']['id'] for r in rs if r.status_code == 201]
        for i in ids:
            alice.post(f'{API}/relay/calls/{i}/hangup', json={})
            alice.delete(f'{API}/relay/calls/{i}')
        assert codes.count(201) == 1, f'race: {codes}'


# --- FIX 2 backups on campaigns + quick calls ---
class TestBackupJunk:
    @pytest.mark.parametrize('bk', ['bad', 'zz9', '12ab', ['+14155550101', 'x']])
    def test_forwarding_junk(self, alice, bk):
        r = alice.patch(f'{API}/numbers/{PRO}/forwarding', json={'mode': 'busy', 'forwardTo': '+14155550100', 'backups': bk})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_backup'

    def test_forwarding_ok_and_disabled(self, alice):
        r = alice.patch(f'{API}/numbers/{PRO}/forwarding', json={'mode': 'busy', 'forwardTo': '+14155550100', 'backups': '+14155550101 +14155550102'})
        assert r.status_code == 200 and r.json()['callForwarding']['backups'] == ['+14155550101', '+14155550102']
        r = alice.patch(f'{API}/numbers/{PRO}/forwarding', json={'mode': 'disabled', 'backups': '12ab'})
        assert r.status_code == 200 and r.json()['callForwarding']['enabled'] is False

    @pytest.mark.parametrize('bk', ['bad', 'zz9', '12ab', ['+14155550101', 'x']])
    def test_quick_call_junk(self, alice, bk):
        r = alice.post(f'{API}/calls/quick', json={'callerId': BIZ, 'to': '+14155550100', 'text': 'TEST hello', 'transferTo': '+14155550109', 'transferBackups': bk})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_backup', r.text

    @pytest.mark.parametrize('bk', ['bad', '12ab', ['+14155550101', 'x']])
    def test_campaign_junk(self, alice, temp_audio, bk):
        r = alice.post(f'{API}/campaigns', json={'callerId': BIZ, 'audioId': temp_audio, 'leads': '+14155550111', 'mode': 'transfer', 'transferNumber': '+14155550109', 'transferBackups': bk})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_backup', r.text


# --- FIX 5 email 2FA throttle + disable-code ---
class TestDisableCode:
    def test_disable_code_not_email(self, alice):
        r = alice.post(f'{API}/auth/2fa/disable-code', json={})
        assert r.status_code == 400 and r.json()['error'] == 'not_email'

    def test_disable_code_unauth(self):
        assert requests.post(f'{API}/auth/2fa/disable-code', json={}).status_code == 401
