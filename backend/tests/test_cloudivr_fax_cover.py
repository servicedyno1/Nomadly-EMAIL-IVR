# CloudIVR web Fax cover page: POST /fax/stage with cover JSON (pages +1, bad_cover, empty cover) + dashboard data
import os
import json
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
FX = '/tmp/faxfx'


def login(creds):
    s = requests.Session()
    r = s.post(f'{API}/auth/login', json=creds)
    if r.status_code != 200:
        pytest.skip(f'login failed {r.status_code}')
    return s


@pytest.fixture(scope='module')
def alice():
    return login(ALICE)


@pytest.fixture(scope='module')
def biz(alice):
    r = alice.get(f'{API}/fax')
    assert r.status_code == 200
    nums = [n for n in r.json()['numbers'] if n['eligible']]
    if not nums:
        pytest.skip('no eligible numbers')
    # pick the number with the most free pages so the send test doesn't spend wallet money
    nums.sort(key=lambda n: -(n.get('usage') or {}).get('left', 0))
    return nums[0]['phoneNumber']


def stage(s, frm, cover=None, to=None, f='p1.pdf'):
    data = {'from': frm}
    if cover is not None:
        data['cover'] = cover if isinstance(cover, str) else json.dumps(cover)
    if to:
        data['to'] = to
    with open(f'{FX}/{f}', 'rb') as fh:
        return s.post(f'{API}/fax/stage', data=data, files={'file': (f, fh, 'application/pdf')})


class TestStageCover:
    def test_no_cover(self, alice, biz):
        r = stage(alice, biz)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['pages'] == 1 and d['cover'] is False

    def test_with_cover(self, alice, biz):
        r = stage(alice, biz, {'name': 'TEST_Alice', 'recipient': 'Bob Co', 'subject': 'Hi', 'note': 'Line1\nLine2'}, to='+14155550123')
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['pages'] == 2 and d['cover'] is True
        assert 'quote' in d

    def test_with_cover_3pages(self, alice, biz):
        r = stage(alice, biz, {'subject': 'only subject'}, f='p3.pdf')
        assert r.status_code == 200, r.text
        assert r.json()['pages'] == 4 and r.json()['cover'] is True

    def test_empty_cover(self, alice, biz):
        r = stage(alice, biz, {'name': '', 'recipient': ' ', 'subject': '-', 'note': ''})
        assert r.status_code == 200, r.text
        assert r.json()['pages'] == 1 and r.json()['cover'] is False

    def test_bad_json(self, alice, biz):
        r = stage(alice, biz, '{not json')
        assert r.status_code == 400
        assert r.json()['error'] == 'bad_cover'

    def test_primitive_cover_with_to(self, alice, biz):
        # JSON that parses to a non-object (number/string) plus `to` should not 500
        r = stage(alice, biz, '123', to='+14155550123')
        assert r.status_code in (200, 400), f'{r.status_code} {r.text[:200]}'

    def test_unicode_cover(self, alice, biz):
        r = stage(alice, biz, {'name': 'José 张伟 😀', 'note': 'x' * 5000})
        assert r.status_code == 200, r.text
        assert r.json()['pages'] == 2

    def test_cover_then_send(self, alice, biz):
        r = stage(alice, biz, {'name': 'TEST_send'}, to='+14155550123')
        assert r.status_code == 200
        sid = r.json()['stageId']
        s = alice.post(f'{API}/fax/send', json={'from': biz, 'stageId': sid, 'to': '+14155550123'})
        assert s.status_code == 200, s.text
        assert s.json()['fax']['pages'] == 2

    def test_bulk_quote_cover(self, alice, biz):
        r = stage(alice, biz, {'name': 'TEST_bulk'})
        sid = r.json()['stageId']
        q = alice.post(f'{API}/fax/bulk/quote', json={'from': biz, 'stageId': sid, 'recipients': '+14155550123\n+14155550124'})
        assert q.status_code == 200, q.text
        qq = q.json()['quote']
        print(qq)
        assert json.dumps(qq).find('4') >= 0


def test_bob_stage_404():
    s = login(BOB)
    r = stage(s, '+13346972125', {'name': 'x'})
    assert r.status_code == 404
