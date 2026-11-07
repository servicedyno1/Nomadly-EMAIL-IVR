# CloudIVR web Bulk Fax (up to 500 numbers): quote, limits, send + dry-run delivery, cancel, 402, stage/regression fixes
import os
import subprocess
import time
import pytest
import requests

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = f'{BASE}/api/cloudivr-web'
ALICE = {'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'}
BOB = {'email': 'civr.bob@example.com', 'password': 'BobTest#2026'}
BIZ = '+13346972125'
BIZ2 = '+18037534921'
FX = '/tmp/faxfx'
S = {}


def nums(n, start=100, area='415'):
    return [f'+1{area}555{start + i:04d}' for i in range(n)]


def login(creds):
    s = requests.Session()
    r = s.post(f'{API}/auth/login', json=creds)
    if r.status_code != 200:
        pytest.skip(f'login failed {r.status_code}')
    return s


@pytest.fixture(scope='module', autouse=True)
def files():
    subprocess.run(['node', '/app/backend/tests/make_fax_files.js'], check=True, cwd='/app')


@pytest.fixture(scope='module')
def alice():
    return login(ALICE)


@pytest.fixture(scope='module')
def bob():
    return login(BOB)


def stage(s, frm, name='p1.pdf'):
    with open(f'{FX}/{name}', 'rb') as fh:
        r = s.post(f'{API}/fax/stage', data={'from': frm}, files={'file': (name, fh, 'application/pdf')})
    assert r.status_code == 200, r.text
    return r.json()


def batch_of(s, bid):
    return next((b for b in s.get(f'{API}/fax').json()['batches'] if b['id'] == bid), None)


class TestBulkQuote:
    def test_overview_bulkmax(self, alice):
        d = alice.get(f'{API}/fax').json()
        assert d['pricing']['bulkMax'] == 500
        assert isinstance(d['batches'], list)

    def test_quote_dedupe_invalid(self, alice):
        st = stage(alice, BIZ, 'p3.pdf')
        rec = '\n'.join(nums(10)) + '\n' + nums(1)[0] + '\nhello123x\n12345\n' + BIZ
        r = alice.post(f'{API}/fax/bulk/quote', json={'from': BIZ, 'stageId': st['stageId'], 'recipients': rec})
        assert r.status_code == 200, r.text
        d = r.json()
        q = d['quote']
        assert q['recipients'] == 10 and q['pagesEach'] == 3 and q['pages'] == 30
        assert q['freePages'] + q['paidPages'] == 30 and q['cost'] == q['paidPages'] * 2
        assert d['invalidCount'] >= 2  # '12345', own number (hello123x also)
        assert isinstance(d['invalid'], list)

    def test_csv_format(self, alice):
        st = stage(alice, BIZ)
        rec = 'name,number\n"Acme","+14155550100"\nFoo;+14155550101\n+14155550102 +14155550103'
        r = alice.post(f'{API}/fax/bulk/quote', json={'from': BIZ, 'stageId': st['stageId'], 'recipients': rec})
        assert r.status_code == 200, r.text
        assert r.json()['quote']['recipients'] == 4

    def test_too_many(self, alice):
        st = stage(alice, BIZ)
        rec = '\n'.join(nums(520, start=1000))
        r = alice.post(f'{API}/fax/bulk/quote', json={'from': BIZ, 'stageId': st['stageId'], 'recipients': rec})
        assert r.status_code == 400 and r.json()['error'] == 'too_many', r.text

    def test_no_recipients(self, alice):
        st = stage(alice, BIZ)
        r = alice.post(f'{API}/fax/bulk/quote', json={'from': BIZ, 'stageId': st['stageId'], 'recipients': 'abc\n12\n'})
        assert r.status_code == 400 and r.json()['error'] == 'no_recipients', r.text
        r = alice.post(f'{API}/fax/bulk', json={'from': BIZ, 'stageId': st['stageId'], 'recipients': ''})
        assert r.status_code == 400 and r.json()['error'] == 'no_recipients', r.text

    def test_not_owned(self, bob):
        r = bob.post(f'{API}/fax/bulk/quote', json={'from': BIZ, 'stageId': 'x', 'recipients': nums(1)[0]})
        assert r.status_code == 404

    def test_unauth(self):
        assert requests.post(f'{API}/fax/bulk/quote', json={}).status_code == 401
        assert requests.post(f'{API}/fax/bulk', json={}).status_code == 401


class TestBulkSend:
    def test_402_keeps_stage(self, alice):
        st = stage(alice, BIZ, 'p3.pdf')
        rec = '\n'.join(nums(500, start=2000))
        r = alice.post(f'{API}/fax/bulk', json={'from': BIZ, 'stageId': st['stageId'], 'recipients': rec})
        assert r.status_code == 402 and r.json()['error'] == 'insufficient_balance', r.text
        # stage survives → quote works
        r = alice.post(f'{API}/fax/bulk/quote', json={'from': BIZ, 'stageId': st['stageId'], 'recipients': nums(1)[0]})
        assert r.status_code == 200, r.text
        S['kept_stage'] = st['stageId']

    def test_stage_bound_to_from(self, alice):
        st = stage(alice, BIZ)
        r = alice.post(f'{API}/fax/send', json={'from': BIZ2, 'to': '+14155550123', 'stageId': st['stageId']})
        assert r.status_code == 410, r.text
        r = alice.post(f'{API}/fax/bulk/quote', json={'from': BIZ2, 'stageId': st['stageId'], 'recipients': nums(2)[0]})
        assert r.status_code == 410, r.text

    def test_send_and_finish(self, alice):
        st = stage(alice, BIZ)
        before = {f['id'] for f in alice.get(f'{API}/fax').json()['faxes']}
        rec = '\n'.join(nums(5, start=300))
        r = alice.post(f'{API}/fax/bulk', json={'from': BIZ, 'stageId': st['stageId'], 'recipients': rec})
        assert r.status_code == 200, r.text
        b = r.json()['batch']
        assert b['total'] == 5 and b['status'] == 'running' and b['pages'] == 1
        S['bid'] = b['id']
        # stage consumed
        r2 = alice.post(f'{API}/fax/bulk', json={'from': BIZ, 'stageId': st['stageId'], 'recipients': rec})
        assert r2.status_code == 410
        for _ in range(15):
            time.sleep(1.5)
            cur = batch_of(alice, b['id'])
            if cur and cur['status'] != 'running':
                break
        assert cur['status'] == 'done', cur
        assert cur['delivered'] == 5 and cur['sent'] == 5 and cur['failed'] == 0
        after = alice.get(f'{API}/fax').json()['faxes']
        new = [f for f in after if f['id'] not in before]
        assert not any(f['to'] in rec for f in new), 'bulk faxes leaked into single history'
        r = alice.post(f'{API}/fax/bulk/{b["id"]}/cancel')
        assert r.status_code == 409 and r.json()['error'] == 'not_running'

    def test_cancel(self, alice, bob):
        st = stage(alice, BIZ)
        rec = '\n'.join(nums(30, start=400))
        r = alice.post(f'{API}/fax/bulk', json={'from': BIZ, 'stageId': st['stageId'], 'recipients': rec})
        if r.status_code == 402:
            pytest.skip('wallet too low for 30-page batch')
        assert r.status_code == 200, r.text
        bid = r.json()['batch']['id']
        # pending pages counted against free allowance
        st2 = stage(alice, BIZ)
        left = next(n for n in alice.get(f'{API}/fax').json()['numbers'] if n['phoneNumber'] == BIZ)['usage']['left']
        if left <= 30:
            assert st2['quote']['freePages'] == 0, st2['quote']
        # Bob cannot stop it
        rb = bob.post(f'{API}/fax/bulk/{bid}/cancel')
        assert rb.status_code == 404, rb.text
        time.sleep(0.5)
        r = alice.post(f'{API}/fax/bulk/{bid}/cancel')
        assert r.status_code == 200 and r.json()['batch']['status'] == 'cancelled', r.text
        time.sleep(6)
        cur = batch_of(alice, bid)
        assert cur['status'] == 'cancelled'
        assert cur['sent'] < 30, cur
        assert cur['delivered'] == cur['sent'], cur
        S['cancelled'] = cur
