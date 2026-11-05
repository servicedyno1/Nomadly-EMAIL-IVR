# Iter194: mobile-number outbound browser calling — /numbers/:phone/sip?browser=1 mobile branch + Messages caps.
# SAFE: never calls the sip endpoint for the real linked line +16462556424.
import os, pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
MOBILE = '+15554586272'
CALLING = '+13346972125'
db = MongoClient('mongodb://localhost:27017')['test']


def login(e, p):
    x = requests.Session()
    r = x.post(f"{API}/auth/login", json={"email": e, "password": p})
    if r.status_code != 200:
        pytest.skip(f"login {r.status_code}")
    return x


@pytest.fixture(scope='module')
def alice():
    return login('civr.alice@example.com', 'AliceTest#2026')


@pytest.fixture(scope='module')
def bob():
    return login('civr.bob@example.com', 'BobTest#2026')


# --- SIP credentials for mobile line
def test_mobile_sip_browser(alice):
    r = alice.get(f"{API}/numbers/%2B15554586272/sip?browser=1")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d['mobile'] is True and d['browserOnly'] is True and d['live'] is False
    assert isinstance(d['username'], str) and d['username'] and d['password'] and d['browserKey']
    assert 'domain' not in d


def test_mobile_sip_stable(alice):
    a = alice.get(f"{API}/numbers/%2B15554586272/sip?browser=1").json()
    b = alice.get(f"{API}/numbers/%2B15554586272/sip?browser=1").json()
    assert a['username'] == b['username'] and a['password'] == b['password']
    doc = db.esimLines.find_one({'phoneNumber': MOBILE, 'kind': 'mobile', 'status': 'active'})
    assert doc['sip']['username'] == a['username']


def test_mobile_sip_without_browser_flag(alice):
    r = alice.get(f"{API}/numbers/%2B15554586272/sip")
    assert r.status_code in (403, 404), r.text


def test_calling_number_sip_unchanged(alice):
    r = alice.get(f"{API}/numbers/%2B13346972125/sip?browser=1")
    assert r.status_code == 200, r.text
    d = r.json()
    assert 'mobile' not in d and d['username'] and 'browserKey' in d and 'domain' in d


def test_not_owned_404(alice, bob):
    r = alice.get(f"{API}/numbers/%2B15550000001/sip?browser=1")
    assert r.status_code == 404, r.text
    r2 = bob.get(f"{API}/numbers/%2B15554586272/sip?browser=1")
    assert r2.status_code == 404, r2.text


def test_unauth_401():
    r = requests.get(f"{API}/numbers/%2B15554586272/sip?browser=1")
    assert r.status_code == 401


# --- Messages caps
def test_messages_caps(alice):
    rows = alice.get(f"{API}/messages").json()['numbers']
    mob = [n for n in rows if n.get('mobile') and n['status'] == 'active']
    esim = [n for n in rows if n['kind'] == 'esim' and not n.get('mobile') and n['status'] == 'active']
    assert {n['phone'] for n in mob} >= {MOBILE, '+16462556424'}
    for n in mob:
        assert n['caps']['calls'] is True and n['caps']['pictures'] is False and n['caps']['send'] is True
    assert esim
    for n in esim:
        assert n['caps']['send'] is False and n['caps']['calls'] is False
