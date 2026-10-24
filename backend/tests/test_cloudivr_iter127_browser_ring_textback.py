# Iter127: browser ring (incoming), missed-call text back, decline with text, crypto extra number, forwarding backups
import os, time, pytest, requests

BASE = os.environ.get('REACT_APP_BACKEND_URL') or open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]
API = f"{BASE.rstrip('/')}/api/cloudivr-web"
NUM = '+14025031429'
ENC = '%2B14025031429'


def login(email, pw):
    s = requests.Session()
    r = s.post(f'{API}/auth/login', json={'email': email, 'password': pw})
    assert r.status_code == 200, r.text
    tok = r.json().get('token')
    if tok:
        s.headers['Authorization'] = f'Bearer {tok}'
    return s


def clear_rings(s):
    for c in s.get(f'{API}/incoming').json().get('calls', []):
        s.post(f'{API}/incoming/{c["id"]}/decline', json={})


def hangup_live(s):
    live = s.get(f'{API}/relay/info').json().get('live')
    if live:
        s.post(f'{API}/relay/calls/{live}/hangup', json={})


@pytest.fixture(scope='module')
def alice():
    s = login('civr.alice@example.com', 'AliceTest#2026')
    hangup_live(s); clear_rings(s)
    r = s.patch(f'{API}/numbers/{ENC}/browser-ring', json={'enabled': True, 'answerMode': 'ask', 'lang': 'en', 'voice': 'female', 'announce': True})
    assert r.status_code == 200, r.text
    yield s
    hangup_live(s); clear_rings(s)
    s.patch(f'{API}/numbers/{ENC}/browser-ring', json={'enabled': True, 'answerMode': 'ask'})


@pytest.fixture(scope='module')
def bob():
    return login('civr.bob@example.com', 'BobTest#2026')


def ring(s, frm='+14155550123'):
    r = s.post(f'{API}/incoming/simulate', json={'phone': NUM, 'from': frm})
    assert r.status_code == 201, r.text
    return r.json()['call']


# Browser-ring settings PATCH validation + persistence
class TestBrowserRingSettings:
    def test_invalid_values(self, alice):
        for body, err in [({'answerMode': 'x'}, 'invalid_mode'), ({'lang': 'de'}, 'invalid_lang'), ({'voice': 'robot'}, 'invalid_voice')]:
            r = alice.patch(f'{API}/numbers/{ENC}/browser-ring', json=body)
            assert r.status_code == 400 and r.json()['error'] == err

    def test_persist(self, alice):
        r = alice.patch(f'{API}/numbers/{ENC}/browser-ring', json={'enabled': True, 'answerMode': 'ask', 'lang': 'fr', 'voice': 'male', 'announce': False})
        assert r.status_code == 200
        br = alice.get(f'{API}/numbers/{ENC}').json()['number']['features']['browserRing']
        assert br == {'enabled': True, 'answerMode': 'ask', 'lang': 'fr', 'voice': 'male', 'announce': False}
        alice.patch(f'{API}/numbers/{ENC}/browser-ring', json={'lang': 'en', 'voice': 'female', 'announce': True})

    def test_not_enabled(self, alice):
        alice.patch(f'{API}/numbers/{ENC}/browser-ring', json={'enabled': False})
        r = alice.post(f'{API}/incoming/simulate', json={'phone': NUM})
        assert r.status_code == 400 and r.json()['error'] == 'not_enabled'
        alice.patch(f'{API}/numbers/{ENC}/browser-ring', json={'enabled': True})


# Incoming ring lifecycle
class TestIncoming:
    def test_get_shape(self, alice):
        d = alice.get(f'{API}/incoming').json()
        assert isinstance(d['calls'], list) and d['pollMs'] == 2000 and 'now' in d

    def test_simulate_and_list(self, alice):
        c = ring(alice)
        assert c['phone'] == NUM and c['from'] == '+14155550123' and c['simulated'] is True and c['canVoice'] is False and c['canText'] is True
        assert any(x['id'] == c['id'] for x in alice.get(f'{API}/incoming').json()['calls'])
        alice.post(f'{API}/incoming/{c["id"]}/decline', json={})

    def test_invalid_from(self, alice):
        r = alice.post(f'{API}/incoming/simulate', json={'phone': NUM, 'from': NUM})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_from'

    def test_429_after_three(self, alice):
        ids = [ring(alice, f'+1415555014{i}')['id'] for i in range(3)]
        r = alice.post(f'{API}/incoming/simulate', json={'phone': NUM})
        assert r.status_code == 429
        for i in ids:
            alice.post(f'{API}/incoming/{i}/decline', json={})

    def test_voice_remember(self, alice):
        c = ring(alice)
        r = alice.post(f'{API}/incoming/{c["id"]}/voice', json={'remember': True})
        assert r.status_code == 200 and r.json()['canVoice'] is False and 'Preview' in r.json()['message']
        assert alice.get(f'{API}/numbers/{ENC}').json()['number']['features']['browserRing']['answerMode'] == 'voice'
        alice.patch(f'{API}/numbers/{ENC}/browser-ring', json={'answerMode': 'ask'})
        alice.post(f'{API}/incoming/{c["id"]}/decline', json={})

    def test_bob_isolation(self, alice, bob):
        c = ring(alice)
        assert bob.get(f'{API}/incoming').json()['calls'] == []
        assert bob.post(f'{API}/incoming/{c["id"]}/text', json={}).status_code == 409
        assert bob.post(f'{API}/incoming/{c["id"]}/decline', json={}).status_code == 409
        assert any(x['id'] == c['id'] for x in alice.get(f'{API}/incoming').json()['calls'])
        alice.post(f'{API}/incoming/{c["id"]}/decline', json={})

    def test_answer_text_no_charge(self, alice):
        bal0 = alice.get(f'{API}/wallet').json().get('balance')
        c = ring(alice)
        r = alice.post(f'{API}/incoming/{c["id"]}/text', json={})
        assert r.status_code == 201, r.text
        call = r.json()['call']
        assert call['direction'] == 'inbound'
        # double take
        assert alice.post(f'{API}/incoming/{c["id"]}/text', json={}).status_code == 409
        # second ring while live -> already_live
        c2 = ring(alice, '+14155550124')
        r2 = alice.post(f'{API}/incoming/{c2["id"]}/text', json={})
        assert r2.status_code == 409 and r2.json()['error'] == 'already_live'
        alice.post(f'{API}/incoming/{c2["id"]}/decline', json={})
        time.sleep(4)
        alice.post(f'{API}/relay/calls/{call["id"]}/hangup', json={})
        bal1 = alice.get(f'{API}/wallet').json().get('balance')
        assert bal0 == bal1, f'{bal0} -> {bal1}'

    def test_decline_reply_too_long_before_decline(self, alice):
        c = ring(alice)
        r = alice.post(f'{API}/incoming/{c["id"]}/decline', json={'reply': 'x' * 161})
        assert r.status_code == 400 and r.json()['error'] == 'too_long'
        assert any(x['id'] == c['id'] for x in alice.get(f'{API}/incoming').json()['calls'])
        alice.post(f'{API}/incoming/{c["id"]}/decline', json={})

    def test_decline_with_reply(self, alice):
        frm = '+14155550199'
        c = ring(alice, frm)
        r = alice.post(f'{API}/incoming/{c["id"]}/decline', json={'reply': 'TEST_ busy, will call back'})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['declined'] is True and d['reply']['text'] == 'TEST_ busy, will call back' and d['reply']['status'] == 'preview' and d['replyError'] is None
        mc = alice.get(f'{API}/missed-calls').json()
        row = next(x for x in mc['calls'] if x['from'] == frm)
        assert row['reply'] and row['reply']['text'] == 'TEST_ busy, will call back' and row['canReply'] is False


# Missed-calls text back API
class TestMissedCalls:
    def test_shape(self, alice):
        d = alice.get(f'{API}/missed-calls').json()
        assert d['maxLength'] == 160 and 'overageRate' in d and isinstance(d['calls'], list)

    def test_reply_flow(self, alice, bob):
        frm = '+1415555' + str(int(time.time()) % 10000).zfill(4)
        c = ring(alice, frm)
        alice.post(f'{API}/incoming/{c["id"]}/decline', json={})
        row = next(x for x in alice.get(f'{API}/missed-calls').json()['calls'] if x['from'] == frm and x['canReply'])
        rid = row['id']
        assert alice.post(f'{API}/missed-calls/{rid}/reply', json={'text': '   '}).json()['error'] == 'empty'
        r = alice.post(f'{API}/missed-calls/{rid}/reply', json={'text': 'y' * 161})
        assert r.status_code == 400 and r.json()['error'] == 'too_long'
        assert alice.post(f'{API}/missed-calls/notanid/reply', json={'text': 'hi'}).status_code == 404
        assert alice.post(f'{API}/missed-calls/507f1f77bcf86cd799439011/reply', json={'text': 'hi'}).status_code == 404
        assert bob.post(f'{API}/missed-calls/{rid}/reply', json={'text': 'hi'}).status_code == 404
        r = alice.post(f'{API}/missed-calls/{rid}/reply', json={'text': 'TEST_ sorry I missed you'})
        assert r.status_code == 200, r.text
        assert r.json()['reply']['status'] == 'preview' and r.json()['reply']['text'] == 'TEST_ sorry I missed you'
        r2 = alice.post(f'{API}/missed-calls/{rid}/reply', json={'text': 'again'})
        assert r2.status_code == 409 and r2.json()['error'] == 'already_replied'
        row = next(x for x in alice.get(f'{API}/missed-calls').json()['calls'] if x['id'] == rid)
        assert row['canReply'] is False and row['reply']['text'] == 'TEST_ sorry I missed you'

    def test_bob_empty(self, bob):
        assert bob.get(f'{API}/missed-calls').json()['calls'] == []


# Forwarding backups (web)
class TestForwardingBackups:
    def test_backups(self, alice):
        cur = alice.get(f'{API}/numbers/{ENC}').json()['number']['features'].get('callForwarding')
        try:
            r = alice.patch(f'{API}/numbers/{ENC}/forwarding', json={'mode': 'no_answer', 'forwardTo': '+14155550100', 'backups': '+14155550101, +14155550102'})
            assert r.status_code == 200, r.text
            assert r.json()['callForwarding']['backups'] == ['+14155550101', '+14155550102']
            assert alice.get(f'{API}/numbers/{ENC}').json()['number']['features']['callForwarding']['backups'] == ['+14155550101', '+14155550102']
            r = alice.patch(f'{API}/numbers/{ENC}/forwarding', json={'mode': 'no_answer', 'forwardTo': '+14155550100', 'backups': '+14155550101,+14155550102,+14155550103,+14155550104,+14155550105'})
            assert r.status_code == 400 and r.json()['error'] == 'invalid_backup'
            # KNOWN BUG: 10-digit US backup should become +1XXXXXXXXXX (bot does), web gives +41...
            r = alice.patch(f'{API}/numbers/{ENC}/forwarding', json={'mode': 'no_answer', 'forwardTo': '+14155550100', 'backups': '4155550102'})
            assert r.json()['callForwarding']['backups'] == ['+14155550102'], r.text
        finally:
          if cur:
            alice.patch(f'{API}/numbers/{ENC}/forwarding', json=cur)
          else:
            alice.patch(f'{API}/numbers/{ENC}/forwarding', json={'mode': 'disabled'})


# Crypto extra number checkout
class TestExtraCrypto:
    def test_extra_checkout(self, alice):
        s = alice.get(f'{API}/numbers/search', params={'country': 'US', 'type': 'local'})
        assert s.status_code == 200, s.text
        res = s.json().get('results') or s.json().get('numbers') or []
        assert res, s.text[:300]
        pn = res[0]['phoneNumber']
        r = alice.post(f'{API}/numbers/{ENC}/extra-checkout', json={'phoneNumber': pn, 'coin': 'BAD'})
        assert r.status_code == 400
        r = alice.post(f'{API}/numbers/{ENC}/extra-checkout', json={'phoneNumber': pn, 'coin': 'USDT (TRC20)', 'autoRenew': True})
        if r.status_code == 400 and r.json().get('error') == 'invalid_coin':
            pytest.fail(r.text)
        assert r.status_code == 201, r.text
        o = r.json()['order']
        assert o.get('address') == 'PREVIEW-MODE-DO-NOT-SEND-FUNDS' or 'PREVIEW' in str(o)
        p = alice.post(f'{API}/numbers/orders/{o["id"]}/simulate-payment', json={})
        assert p.status_code == 200, p.text
        o2 = p.json()['order']
        assert o2['status'] in ('active', 'completed'), o2
        nums = alice.get(f'{API}/numbers').json()['numbers']
        ex = next(x for x in nums if x['phoneNumber'] == pn)
        assert ex.get('isSubNumber') is True and ex.get('parentNumber') == NUM
