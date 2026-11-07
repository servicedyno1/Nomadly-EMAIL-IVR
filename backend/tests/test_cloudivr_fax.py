# CloudIVR web Fax (Business plan): overview, stage/quote, send (dry-run delivery), validation, fax line, PDF download, catalog
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
STATE = {}


def login(creds):
    s = requests.Session()
    r = s.post(f'{API}/auth/login', json=creds)
    if r.status_code != 200:
        pytest.skip(f'login failed {r.status_code} {r.text[:200]}')
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


def stage(s, frm, path, mime='application/pdf'):
    with open(path, 'rb') as fh:
        return s.post(f'{API}/fax/stage', data={'from': frm}, files={'file': (os.path.basename(path), fh, mime)})


class TestOverview:
    def test_unauth(self):
        assert requests.get(f'{API}/fax').status_code == 401

    def test_alice_overview(self, alice):
        r = alice.get(f'{API}/fax')
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['pricing'] == {'freePages': 50, 'pagePrice': 2}
        nums = {n['phoneNumber']: n for n in d['numbers']}
        assert BIZ in nums and BIZ2 in nums
        for n in d['numbers']:
            assert n['eligible'] == (n['plan'] == 'business'), n
            if n['eligible']:
                u = n['usage']
                assert u['free'] == 50 and u['pagePrice'] == 2 and u['left'] == 50 - u['used']
            else:
                assert n['usage'] is None
        assert any(not n['eligible'] for n in d['numbers']), 'expected a Pro number for Alice'
        STATE['pro'] = next(n['phoneNumber'] for n in d['numbers'] if not n['eligible'])
        STATE['left0'] = nums[BIZ]['usage']['left']
        assert isinstance(d['faxes'], list)

    def test_bob_overview(self, bob):
        r = bob.get(f'{API}/fax')
        assert r.status_code == 200
        # Bob is no longer number-less in preview (earlier runs bought dry-run numbers) → just check isolation
        mine = {n['phoneNumber'] for n in bob.get(f'{API}/numbers').json()['numbers']}
        got = {n['phoneNumber'] for n in r.json()['numbers']}
        assert got <= mine and BIZ not in got and BIZ2 not in got
        for n in r.json()['numbers']:
            assert n['eligible'] == (n['plan'] == 'business')


class TestStageValidation:
    def test_bad_type(self, alice):
        r = stage(alice, BIZ, f'{FX}/bad.txt', 'text/plain')
        assert r.status_code == 400 and r.json()['error'] == 'bad_type', r.text

    def test_pro_rejected(self, alice):
        if 'pro' not in STATE:
            pytest.skip('no pro number')
        r = stage(alice, STATE['pro'], f'{FX}/p1.pdf')
        assert r.status_code == 403 and r.json()['error'] == 'plan_upgrade_required', r.text

    def test_not_owned(self, bob):
        r = stage(bob, BIZ, f'{FX}/p1.pdf')
        assert r.status_code == 404, r.text

    def test_too_many_pages(self, alice):
        r = stage(alice, BIZ, f'{FX}/p51.pdf')
        assert r.status_code == 400 and r.json()['error'] == 'too_many_pages', r.text

    def test_no_file(self, alice):
        r = alice.post(f'{API}/fax/stage', data={'from': BIZ})
        assert r.status_code == 400 and r.json()['error'] == 'no_file', r.text

    def test_png_and_pdf_quote(self, alice):
        r = stage(alice, BIZ, f'{FX}/img.png', 'image/png')
        assert r.status_code == 200, r.text
        assert r.json()['pages'] == 1
        r = stage(alice, BIZ, f'{FX}/p3.pdf')
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['pages'] == 3 and d['quote']['pages'] == 3
        assert d['quote']['freePages'] + d['quote']['paidPages'] == 3
        assert d['quote']['cost'] == d['quote']['paidPages'] * 2
        assert isinstance(d['stageId'], str)


class TestSend:
    def test_bad_to_and_own(self, alice):
        st = stage(alice, BIZ, f'{FX}/p1.pdf').json()['stageId']
        r = alice.post(f'{API}/fax/send', json={'from': BIZ, 'to': '123', 'stageId': st})
        assert r.status_code == 400 and r.json()['error'] == 'bad_number', r.text
        r = alice.post(f'{API}/fax/send', json={'from': BIZ, 'to': BIZ, 'stageId': st})
        assert r.status_code == 400 and r.json()['error'] == 'bad_number', r.text
        STATE['st'] = st  # still valid (bad number does not consume stage)

    def test_unknown_stage(self, alice):
        r = alice.post(f'{API}/fax/send', json={'from': BIZ, 'to': '+14155550123', 'stageId': 'nope'})
        assert r.status_code == 410 and r.json()['error'] == 'expired', r.text

    def test_send_and_deliver(self, alice):
        st = STATE.get('st') or stage(alice, BIZ, f'{FX}/p1.pdf').json()['stageId']
        r = alice.post(f'{API}/fax/send', json={'from': BIZ, 'to': '+14155550123', 'stageId': st})
        assert r.status_code == 200, r.text
        f = r.json()['fax']
        assert f['status'] == 'queued' and f['to'] == '+14155550123' and f['pages'] == 1 and f['direction'] == 'outbound'
        STATE['fax'] = f['id']
        # reuse rejected
        r2 = alice.post(f'{API}/fax/send', json={'from': BIZ, 'to': '+14155550123', 'stageId': st})
        assert r2.status_code == 410
        time.sleep(5)
        d = alice.get(f'{API}/fax').json()
        row = next(x for x in d['faxes'] if x['id'] == f['id'])
        assert row['status'] == 'delivered', row
        left = next(n for n in d['numbers'] if n['phoneNumber'] == BIZ)['usage']['left']
        if STATE.get('left0', 0) > 0:
            assert left == STATE['left0'] - 1

    def test_pdf_download(self, alice, bob):
        fid = STATE.get('fax')
        if not fid:
            pytest.skip('no fax')
        r = alice.get(f'{API}/fax/{fid}/pdf')
        assert r.status_code == 200
        assert r.headers['content-type'].startswith('application/pdf')
        assert r.content[:4] == b'%PDF'
        assert bob.get(f'{API}/fax/{fid}/pdf').status_code == 404
        assert alice.get(f'{API}/fax/does-not-exist/pdf').status_code == 404


class TestFaxLine:
    def test_toggle(self, alice):
        r = alice.patch(f'{API}/fax/line', json={'phone': BIZ2, 'enabled': True})
        assert r.status_code == 200 and r.json()['faxLine']['enabled'] is True, r.text
        n = next(x for x in alice.get(f'{API}/fax').json()['numbers'] if x['phoneNumber'] == BIZ2)
        assert n['faxLine'] is True
        r = alice.patch(f'{API}/fax/line', json={'phone': BIZ2, 'enabled': False})
        assert r.status_code == 200 and r.json()['faxLine']['enabled'] is False
        n = next(x for x in alice.get(f'{API}/fax').json()['numbers'] if x['phoneNumber'] == BIZ2)
        assert n['faxLine'] is False

    def test_pro_line_rejected(self, alice):
        if 'pro' not in STATE:
            pytest.skip('no pro')
        r = alice.patch(f'{API}/fax/line', json={'phone': STATE['pro'], 'enabled': True})
        assert r.status_code == 403

    def test_not_owned(self, bob):
        assert bob.patch(f'{API}/fax/line', json={'phone': BIZ, 'enabled': True}).status_code == 404


class TestCatalog:
    def test_business_fax_feature(self):
        r = requests.get(f'{API}/public/catalog')
        assert r.status_code == 200
        txt = r.text
        assert 'Fax' in txt or 'fax' in txt
        STATE['catalog'] = r.json()
