# CloudIVR web fax-only numbers (Telnyx fax account, US/CA): offer, search, buy (dry run), autoRenew, fax-only guard, wallet history
import os
import pytest
import requests

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = f'{BASE}/api/cloudivr-web'
CREDS = {'email': 'civr.uxtest@example.com', 'password': 'UxTest#2026'}
STATE = {}


@pytest.fixture(scope='module')
def s():
    sess = requests.Session()
    r = sess.post(f'{API}/auth/login', json=CREDS)
    if r.status_code != 200:
        pytest.skip(f'login failed {r.status_code} {r.text[:200]}')
    return sess


@pytest.fixture(scope='module', autouse=True)
def release_bought():
    # Release only the dry-run fax number this run bought (by id)
    yield
    pn = STATE.get('pn')
    if pn:
        import subprocess
        js = ("require('dotenv').config({path:'/app/backend/.env'});const {MongoClient}=require('mongodb');"
              "MongoClient.connect(process.env.MONGO_URL).then(async c=>{await c.db(process.env.DB_NAME).collection('faxNumbers')"
              f".updateOne({{_id:'{pn}',dryRun:true}},{{$set:{{status:'released',releaseReason:'test-cleanup'}}}});await c.close()}})")
        subprocess.run(['node', '-e', js], cwd='/app', env={**os.environ, 'NODE_PATH': '/app/node_modules'})


def bal(s):
    return s.get(f'{API}/wallet').json()['balance']


class TestFaxNumbers:
    def test_unauth(self):
        assert requests.get(f'{API}/fax-numbers').status_code == 401

    def test_offer(self, s):
        r = s.get(f'{API}/fax-numbers')
        assert r.status_code == 200
        d = r.json()
        assert d['available'] is True and d['price'] == 15
        assert [c['code'] for c in d['countries']] == ['US', 'CA']
        assert isinstance(d['numbers'], list)

    def test_search_invalid_country(self, s):
        r = s.get(f'{API}/fax-numbers/search', params={'country': 'GB'})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_country'

    def test_search_ca(self, s):
        r = s.get(f'{API}/fax-numbers/search', params={'country': 'CA'})
        assert r.status_code == 200, r.text
        nums = r.json()['numbers']
        print('CA', len(nums), nums[:2])
        assert len(nums) > 0 and all(n['phoneNumber'].startswith('+1') and n['capabilities'] == {'voice': False, 'sms': False, 'fax': True} for n in nums)

    def test_search_us_area(self, s):
        r = s.get(f'{API}/fax-numbers/search', params={'country': 'US', 'areaCode': '312'})
        assert r.status_code == 200, r.text
        nums = r.json()['numbers']
        print('US 312', len(nums), [n['phoneNumber'] for n in nums[:3]])
        assert len(nums) > 0
        STATE['nums'] = nums

    def test_buy_not_in_search(self, s):
        r = s.post(f'{API}/fax-numbers', json={'phoneNumber': '+15550001111'})
        assert r.status_code == 400 and r.json()['error'] == 'search_again'

    def test_buy(self, s):
        if 'nums' not in STATE:
            pytest.skip('no search')
        before = bal(s)
        pn = STATE['nums'][0]['phoneNumber']
        r = s.post(f'{API}/fax-numbers', json={'phoneNumber': pn, 'autoRenew': True})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['number']['phoneNumber'] == pn and d['number']['faxOnly'] is True and d['number']['status'] == 'active'
        assert round(before - d['balance'], 2) == 15
        STATE['pn'] = pn
        # second buy of same number → search cache cleared
        r2 = s.post(f'{API}/fax-numbers', json={'phoneNumber': pn})
        assert r2.status_code == 400 and r2.json()['error'] == 'search_again'

    def test_listed(self, s):
        pn = STATE.get('pn') or pytest.skip('no buy')
        nums = s.get(f'{API}/fax-numbers').json()['numbers']
        assert any(n['phoneNumber'] == pn for n in nums)
        fx = s.get(f'{API}/fax').json()['numbers']
        row = next(n for n in fx if n['phoneNumber'] == pn)
        assert row['faxOnly'] is True and row['eligible'] is True and row['faxLine'] is True

    def test_search_excludes_owned(self, s):
        pn = STATE.get('pn') or pytest.skip('no buy')
        nums = s.get(f'{API}/fax-numbers/search', params={'country': 'US', 'areaCode': '312'}).json()['numbers']
        assert pn not in [n['phoneNumber'] for n in nums]

    def test_autorenew(self, s):
        pn = STATE.get('pn') or pytest.skip('no buy')
        r = s.patch(f'{API}/fax-numbers/{pn}', json={'autoRenew': False})
        assert r.status_code == 200 and r.json()['number']['autoRenew'] is False
        assert next(n for n in s.get(f'{API}/fax-numbers').json()['numbers'] if n['phoneNumber'] == pn)['autoRenew'] is False
        assert s.patch(f'{API}/fax-numbers/+15550009999', json={'autoRenew': True}).status_code == 404

    def test_line_fax_only(self, s):
        pn = STATE.get('pn') or pytest.skip('no buy')
        r = s.patch(f'{API}/fax/line', json={'phone': pn, 'enabled': False})
        assert r.status_code == 409 and r.json()['error'] == 'fax_only'

    def test_wallet_history_shows_fax_debit(self, s):
        pn = STATE.get('pn') or pytest.skip('no buy')
        hist = s.get(f'{API}/wallet').json()['history']
        assert any(pn in (h.get('description') or '') for h in hist), 'fax number $15 debit not visible in wallet history'
