# CloudIVR iter325: Emily texting-country suggest (/texting/suggest) + plan-suggest "kind" (calls|texting|fax).
import os
import pytest
import requests

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE}/api/cloudivr-web"
UX = ('civr.uxtest@example.com', 'UxTest#2026')


@pytest.fixture(scope='module')
def ux():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'email': UX[0], 'password': UX[1]})
    if r.status_code != 200:
        pytest.skip(f'login failed {r.status_code} {r.text[:200]}')
    return s


@pytest.fixture(scope='module')
def ready(ux):
    r = ux.get(f"{API}/texting/ready")
    assert r.status_code == 200, r.text
    return r.json()


# --- /texting/suggest auth + validation
def test_texting_suggest_unauth():
    r = requests.post(f"{API}/texting/suggest", json={'text': 'Online shop in the UK, order updates'})
    assert r.status_code == 401, r.text


def test_texting_suggest_too_short(ux):
    r = ux.post(f"{API}/texting/suggest", json={'text': 'hi uk'})
    assert r.status_code == 400
    assert r.json().get('error') == 'too_short'


# --- /texting/suggest LLM answers
def test_texting_suggest_uk(ux, ready):
    r = ux.post(f"{API}/texting/suggest", json={'text': 'Online shop in the UK, order updates by text'}, timeout=40)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ('country', 'name', 'alt', 'reason'):
        assert k in d
    codes = [i['country'] for i in ready.get('items', [])]
    print('sold', codes, 'answer', d)
    if 'GB' in codes:
        assert d['country'] == 'GB'
    assert d['country'] in codes
    assert isinstance(d['reason'], str) and d['reason']


def test_texting_suggest_us(ux):
    r = ux.post(f"{API}/texting/suggest", json={'text': 'I text my US customers appointment reminders'}, timeout=40)
    assert r.status_code == 200, r.text
    d = r.json(); print(d)
    assert d['country'] == 'US'


def test_texting_suggest_verification(ux):
    r = ux.post(f"{API}/texting/suggest", json={'text': 'I need to receive verification codes'}, timeout=40)
    assert r.status_code == 200, r.text
    d = r.json(); print(d)
    assert d['alt'] in (None, 'esim', 'mobile')


def test_texting_suggest_offtopic(ux):
    r = ux.post(f"{API}/texting/suggest", json={'text': 'Write me a poem about pirates and the sea'}, timeout=40)
    print(r.status_code, r.text)
    assert r.status_code in (200, 422)


# --- /public/plan-suggest kind
@pytest.mark.parametrize('text,kind', [
    ('Dental clinic, 3 front-desk phones', 'calls'),
    ('Law office that sends and receives faxes', 'fax'),
    ('Salon that texts appointment reminders', 'texting'),
])
def test_plan_suggest_kind(text, kind):
    r = requests.post(f"{API}/public/plan-suggest", json={'text': text}, timeout=40)
    if r.status_code == 429:
        pytest.skip('rate limited')
    assert r.status_code == 200, r.text
    d = r.json(); print(text, d)
    assert d['kind'] in ('calls', 'texting', 'fax')
    assert d['kind'] == kind
    assert d['plan'] and d['name'] and isinstance(d['price'], (int, float))


def test_plan_suggest_too_short():
    r = requests.post(f"{API}/public/plan-suggest", json={'text': 'dentist'})
    assert r.status_code == 400 and r.json()['error'] == 'too_short'
