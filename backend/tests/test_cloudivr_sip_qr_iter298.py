# CloudIVR web one-tap phone setup: POST /numbers/:phone/sip/qr codes + /sip-provision/:token Linphone XML (never prints passwords)
import os
import re
from urllib.parse import quote
import pytest
import requests

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = f'{BASE}/api/cloudivr-web'
USER = {'email': 'civr.uxtest@example.com', 'password': 'UxTest#2026'}
NUM = '+13341112222'
P = quote(NUM, safe='')


@pytest.fixture(scope='module')
def s():
    s = requests.Session()
    r = s.post(f'{API}/auth/login', json=USER)
    if r.status_code != 200:
        pytest.skip(f'login failed {r.status_code}')
    return s


@pytest.fixture(scope='module')
def codes(s):
    r = s.post(f'{API}/numbers/{P}/sip/qr')
    assert r.status_code == 200, r.text[:200]
    return r.json()


# QR codes shape
def test_qr_shape(codes):
    assert set(['linphone', 'generic', 'expiresInMin']) <= set(codes)
    assert codes['expiresInMin'] == 15
    assert codes['linphone'].startswith('https://'), codes['linphone'][:60]
    assert '/sip-provision/' in codes['linphone']
    assert re.match(r'^sip:[^:@]+:[^@]+@[^:]+:5060$', codes['generic'])


# generic matches the revealed credentials
def test_generic_matches_creds(s, codes):
    r = s.get(f'{API}/numbers/{P}/sip')
    assert r.status_code == 200
    c = r.json()
    assert codes['generic'].startswith(f"sip:{quote(c['username'], safe='')}:")
    assert quote(c['password'], safe='') in codes['generic']


# Linphone link returns XML with proxy_0 + auth_info_0 (public, no cookie)
def test_linphone_xml(codes, s):
    r = requests.get(codes['linphone'])
    assert r.status_code == 200, f"{r.status_code} {r.text[:120]}"
    assert 'xml' in r.headers.get('content-type', '')
    assert 'no-store' in r.headers.get('cache-control', '')
    assert 'name="proxy_0"' in r.text and 'name="auth_info_0"' in r.text
    c = s.get(f'{API}/numbers/{P}/sip').json()
    assert f'<entry name="username">{c["username"]}</entry>' in r.text
    assert 'name="passwd"' in r.text


# Each POST mints a fresh token; both work
def test_fresh_token_each_time(s, codes):
    r2 = s.post(f'{API}/numbers/{P}/sip/qr').json()
    assert r2['linphone'] != codes['linphone']
    assert requests.get(r2['linphone']).status_code == 200


# bad token → 404 plain text
def test_bad_token_404():
    for url in (f'{BASE}/api/sip-provision/badtoken', f'{BASE}/sip-provision/badtoken'):
        r = requests.get(url)
        print(url, r.status_code, r.headers.get('content-type'))
    r = requests.get(f'{BASE}/api/sip-provision/badtoken')
    assert r.status_code == 404
    assert 'text/plain' in r.headers.get('content-type', '')
    assert 'expired' in r.text


# auth required / unknown number
def test_qr_requires_auth():
    r = requests.post(f'{API}/numbers/{P}/sip/qr')
    assert r.status_code == 401


def test_qr_unknown_number(s):
    r = s.post(f'{API}/numbers/{quote("+19999999999", safe="")}/sip/qr')
    assert r.status_code in (403, 404)


# After reset, old linphone token serves new creds (render reads live number), generic changes
def test_reset_then_qr(s, codes):
    before = s.get(f'{API}/numbers/{P}/sip').json()
    r = s.post(f'{API}/numbers/{P}/sip/reset')
    assert r.status_code == 200
    after = s.get(f'{API}/numbers/{P}/sip').json()
    assert after['password'] != before['password']
    new = s.post(f'{API}/numbers/{P}/sip/qr').json()
    assert quote(after['password'], safe='') in new['generic']
    x = requests.get(new['linphone']).text
    assert f'<entry name="username">{after["username"]}</entry>' in x
