# Iter128: forwarding/backups/IVR forward number normalisation + per-call text-back matching
import os, time, random, pytest, requests

BASE = os.environ.get('REACT_APP_BACKEND_URL') or open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]
API = f"{BASE.rstrip('/')}/api/cloudivr-web"
NUM = '+14025031429'
ENC = '%2B14025031429'


@pytest.fixture(scope='module')
def alice():
    s = requests.Session()
    r = s.post(f'{API}/auth/login', json={'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'})
    assert r.status_code == 200, r.text
    if r.json().get('token'):
        s.headers['Authorization'] = f"Bearer {r.json()['token']}"
    for c in s.get(f'{API}/incoming').json().get('calls', []):
        s.post(f'{API}/incoming/{c["id"]}/decline', json={})
    s.patch(f'{API}/numbers/{ENC}/browser-ring', json={'enabled': True, 'answerMode': 'ask'})
    return s


def ring_decline(s, frm, reply=None):
    r = s.post(f'{API}/incoming/simulate', json={'phone': NUM, 'from': frm})
    assert r.status_code == 201, r.text
    cid = r.json()['call']['id']
    r = s.post(f'{API}/incoming/{cid}/decline', json={'reply': reply} if reply else {})
    assert r.status_code == 200, r.text
    return r.json()


def rows_from(s, frm):
    return [x for x in s.get(f'{API}/missed-calls').json()['calls'] if x['from'] == frm]  # newest first


# FIX 1: number normalisation
class TestNorm:
    def test_forwarding_norm(self, alice):
        try:
            r = alice.patch(f'{API}/numbers/{ENC}/forwarding', json={'mode': 'no_answer', 'forwardTo': '4155550100', 'backups': '4155550102, 14155550103'})
            assert r.status_code == 200, r.text
            cf = r.json()['callForwarding']
            assert cf['forwardTo'] == '+14155550100' and cf['backups'] == ['+14155550102', '+14155550103']
            g = alice.get(f'{API}/numbers/{ENC}').json()['number']['features']['callForwarding']
            assert g['forwardTo'] == '+14155550100' and g['backups'] == ['+14155550102', '+14155550103']
            # formatted input
            r = alice.patch(f'{API}/numbers/{ENC}/forwarding', json={'mode': 'always', 'forwardTo': '(415) 555-0100', 'backups': '1 (415) 555-0104'})
            assert r.status_code == 200, r.text
            assert r.json()['callForwarding']['forwardTo'] == '+14155550100' and r.json()['callForwarding']['backups'] == ['+14155550104']
            # backup equal to forwardTo after normalisation is dropped/rejected
            r = alice.patch(f'{API}/numbers/{ENC}/forwarding', json={'mode': 'always', 'forwardTo': '4155550100', 'backups': '+14155550100'})
            print('dup backup ->', r.status_code, r.text[:200])
            # self forward via 10-digit
            r = alice.patch(f'{API}/numbers/{ENC}/forwarding', json={'mode': 'always', 'forwardTo': '4025031429'})
            assert r.status_code == 400 and r.json()['error'] == 'self_forward', r.text
        finally:
            r = alice.patch(f'{API}/numbers/{ENC}/forwarding', json={'mode': 'disabled'})
            assert r.status_code == 200 and r.json()['callForwarding']['enabled'] is False

    def test_ivr_forward_norm(self, alice):
        cur = alice.get(f'{API}/numbers/{ENC}').json()['number']['features'].get('ivr') or {'enabled': False, 'options': {}}
        try:
            r = alice.put(f'{API}/numbers/{ENC}/ivr', json={'enabled': True, 'greeting': 'TEST_ menu', 'options': {'1': {'action': 'forward', 'forwardTo': '4155550100', 'label': 'Sales'}, '2': {'action': 'forward', 'forwardTo': '14155550103', 'label': 'Support'}}})
            assert r.status_code == 200, r.text
            o = r.json()['ivr']['options']
            assert o['1']['forwardTo'] == '+14155550100' and o['2']['forwardTo'] == '+14155550103'
            o = alice.get(f'{API}/numbers/{ENC}').json()['number']['features']['ivr']['options']
            assert o['1']['forwardTo'] == '+14155550100'
            r = alice.put(f'{API}/numbers/{ENC}/ivr', json={'enabled': True, 'options': {'1': {'action': 'forward', 'forwardTo': '12345'}}})
            assert r.status_code == 400 and r.json()['error'] == 'invalid_ivr'
        finally:
            r = alice.put(f'{API}/numbers/{ENC}/ivr', json=cur)
            assert r.status_code == 200, r.text


# FIX 2: each text belongs to one missed call
class TestTextBackMatching:
    def test_per_call(self, alice):
        frm = '+1312555' + str(random.randint(1000, 9999))
        ring_decline(alice, frm)
        time.sleep(2)
        d = ring_decline(alice, frm, reply='TEST_ busy now')
        assert d['reply']['status'] == 'preview'
        rows = rows_from(alice, frm)
        assert len(rows) == 2, rows
        second, first = rows
        assert second['reply'] and second['reply']['text'] == 'TEST_ busy now' and second['canReply'] is False
        assert first['reply'] is None and first['canReply'] is True, first
        # reply on 1st now allowed
        r = alice.post(f'{API}/missed-calls/{first["id"]}/reply', json={'text': 'TEST_ sorry missed you'})
        assert r.status_code == 200, r.text
        # second reply to same call -> 409
        r = alice.post(f'{API}/missed-calls/{first["id"]}/reply', json={'text': 'again'})
        assert r.status_code == 409 and r.json()['error'] == 'already_replied'
        # reply on 2nd (decline-text matched) -> 409
        r = alice.post(f'{API}/missed-calls/{second["id"]}/reply', json={'text': 'again'})
        assert r.status_code == 409 and r.json()['error'] == 'already_replied', r.text
        time.sleep(2)
        ring_decline(alice, frm)
        rows = rows_from(alice, frm)
        assert len(rows) == 3
        new = rows[0]
        assert new['reply'] is None and new['canReply'] is True, new
        assert rows[1]['reply']['text'] == 'TEST_ busy now'
        assert rows[2]['reply']['text'] == 'TEST_ sorry missed you'
        # reply the newest
        r = alice.post(f'{API}/missed-calls/{new["id"]}/reply', json={'text': 'TEST_ third'})
        assert r.status_code == 200, r.text
        rows = rows_from(alice, frm)
        assert [x['reply']['text'] for x in rows] == ['TEST_ third', 'TEST_ busy now', 'TEST_ sorry missed you']

    def test_decline_text_after_textback_same_caller(self, alice):
        # call A declined, text back A, then call B declined with text -> B replied, A keeps its own text
        frm = '+1312556' + str(random.randint(1000, 9999))
        ring_decline(alice, frm)
        a = rows_from(alice, frm)[0]
        assert alice.post(f'{API}/missed-calls/{a["id"]}/reply', json={'text': 'TEST_ A'}).status_code == 200
        time.sleep(1)
        ring_decline(alice, frm, reply='TEST_ B')
        rows = rows_from(alice, frm)
        assert [x['reply']['text'] if x['reply'] else None for x in rows] == ['TEST_ B', 'TEST_ A'], rows
