# SIP "calls from" caller-id API (iteration 277) + travel eSIM zone codes
import os, urllib.parse, pytest, requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL') or open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]
BASE_URL = BASE_URL.rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
MAIN = '+13341112222'
OTHER = '+13343334444'
enc = lambda p: urllib.parse.quote(p, safe='')


@pytest.fixture(scope='module')
def s():
    ses = requests.Session()
    r = ses.post(f"{API}/auth/login", json={'email': 'civr.uxtest@example.com', 'password': 'UxTest#2026'})
    if r.status_code != 200:
        pytest.skip(f'login failed {r.status_code} {r.text[:200]}')
    tok = r.json().get('token')
    if tok:
        ses.headers['Authorization'] = f'Bearer {tok}'
    yield ses
    # restore defaults
    ses.put(f"{API}/numbers/{enc(MAIN)}/sip/caller-id", json={'callerId': MAIN})


def test_get_caller_id(s):
    r = s.get(f"{API}/numbers/{enc(MAIN)}/sip/caller-id")
    assert r.status_code == 200, r.text
    d = r.json()
    print(d)
    assert 'main' in d and isinstance(d['options'], list)
    assert MAIN in d['options']


def test_put_main_other_and_restore(s):
    opts = s.get(f"{API}/numbers/{enc(MAIN)}/sip/caller-id").json()['options']
    other = OTHER if OTHER in opts else next((o for o in opts if o != MAIN), None)
    if not other:
        pytest.skip('no second active number')
    r = s.put(f"{API}/numbers/{enc(MAIN)}/sip/caller-id", json={'callerId': other})
    assert r.status_code == 200 and r.json()['callerId'] == other
    assert s.get(f"{API}/numbers/{enc(MAIN)}/sip/caller-id").json()['main'] == other
    r = s.put(f"{API}/numbers/{enc(MAIN)}/sip/caller-id", json={'callerId': MAIN})
    assert r.status_code == 200 and r.json()['callerId'] == MAIN
    assert s.get(f"{API}/numbers/{enc(MAIN)}/sip/caller-id").json()['main'] is None


def test_put_invalid_caller(s):
    r = s.put(f"{API}/numbers/{enc(MAIN)}/sip/caller-id", json={'callerId': '+15005550006'})
    assert r.status_code == 400
    assert r.json().get('error') == 'invalid_caller'


def test_extra_login_caller_id(s):
    ex = s.get(f"{API}/numbers/{enc(MAIN)}/sip/extra")
    assert ex.status_code == 200
    logins = ex.json()['logins']
    print('extra logins', [(l['id'], l.get('callerId')) for l in logins])
    for l in logins:
        assert 'callerId' in l
    if not logins:
        pytest.skip('no extra logins')
    lid, orig = logins[0]['id'], logins[0].get('callerId')
    opts = s.get(f"{API}/numbers/{enc(MAIN)}/sip/caller-id").json()['options']
    other = next((o for o in opts if o != MAIN), None)
    if not other:
        pytest.skip('no second number')
    r = s.put(f"{API}/numbers/{enc(MAIN)}/sip/caller-id", json={'callerId': other, 'loginId': lid})
    assert r.status_code == 200
    got = next(l for l in s.get(f"{API}/numbers/{enc(MAIN)}/sip/extra").json()['logins'] if l['id'] == lid)
    assert got['callerId'] == other
    # main untouched
    assert s.get(f"{API}/numbers/{enc(MAIN)}/sip/caller-id").json()['main'] is None
    s.put(f"{API}/numbers/{enc(MAIN)}/sip/caller-id", json={'callerId': orig or MAIN, 'loginId': lid})
    got = next(l for l in s.get(f"{API}/numbers/{enc(MAIN)}/sip/extra").json()['logins'] if l['id'] == lid)
    assert got['callerId'] == orig


def test_unauth_caller_id():
    r = requests.get(f"{API}/numbers/{enc(MAIN)}/sip/caller-id")
    assert r.status_code == 401


def test_travel_esim_zone_codes(s):
    r = s.get(f"{API}/travel-esim/plans")
    assert r.status_code == 200, r.text[:200]
    d = r.json()
    zones = d.get('zones') or []
    print('zones', [(z.get('name'), z.get('code')) for z in zones][:30])
    assert zones
    for z in zones:
        assert isinstance(z.get('code'), str) and len(z['code']) == 2, z


def test_extra_login_create_set_delete(s):
    # creates a free TEST_ extra login, sets its caller, then deletes it
    r = s.post(f"{API}/numbers/{enc(MAIN)}/sip/extra", json={'label': 'TEST_callfrom'})
    if r.status_code != 200:
        pytest.skip(f'cannot add free extra login: {r.status_code} {r.text[:150]}')
    lid = r.json()['id']
    try:
        r = s.put(f"{API}/numbers/{enc(MAIN)}/sip/caller-id", json={'callerId': OTHER, 'loginId': lid})
        assert r.status_code == 200 and r.json()['callerId'] == OTHER
        got = next(l for l in s.get(f"{API}/numbers/{enc(MAIN)}/sip/extra").json()['logins'] if l['id'] == lid)
        assert got['callerId'] == OTHER
        assert s.get(f"{API}/numbers/{enc(MAIN)}/sip/caller-id").json()['main'] is None
        r = s.put(f"{API}/numbers/{enc(MAIN)}/sip/caller-id", json={'callerId': MAIN, 'loginId': lid})
        got = next(l for l in s.get(f"{API}/numbers/{enc(MAIN)}/sip/extra").json()['logins'] if l['id'] == lid)
        assert got['callerId'] is None
    finally:
        assert s.delete(f"{API}/numbers/{enc(MAIN)}/sip/extra/{lid}").status_code == 200


def test_unknown_login_id(s):
    r = s.put(f"{API}/numbers/{enc(MAIN)}/sip/caller-id", json={'callerId': OTHER, 'loginId': 'nope1234'})
    print('unknown loginId ->', r.status_code, r.text[:120])
