# Iter193: landing products — public mobile-offer, waitlist validation, dashboard textsThisMonth, signup + mobile-numbers gating.
import os, time, pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
db = MongoClient('mongodb://localhost:27017')['test']


def login(e, p):
    x = requests.Session()
    r = x.post(f"{API}/auth/login", json={"email": e, "password": p})
    if r.status_code != 200:
        pytest.skip(f"login {r.status_code}")
    return x


# --- Public offer
def test_mobile_offer_public():
    r = requests.get(f"{API}/public/mobile-offer")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d['available'] is True and d['price'] == 75


def test_esim_plans_public():
    r = requests.get(f"{API}/public/esim-plans")
    assert r.status_code == 200
    plans = r.json()['plans']
    assert len(plans) >= 1 and plans[0]['price'] == 75


# --- Waitlist
@pytest.mark.parametrize('bad', ['', 'foo', 'a@b', 'a b@c.com', 'x@y.c'])
def test_waitlist_bad_email(bad):
    r = requests.post(f"{API}/public/waitlist", json={'email': bad})
    assert r.status_code == 400, r.text
    assert r.json()['error'] == 'bad_email'


def test_waitlist_ok_idempotent():
    e = f"TEST_wait{int(time.time())}@example.com"
    for _ in range(2):
        r = requests.post(f"{API}/public/waitlist", json={'email': e})
        assert r.status_code == 200 and r.json()['ok'] is True
    assert db.webWaitlist.count_documents({'email': e.lower()}) == 1
    db.webWaitlist.delete_many({'email': e.lower()})


def test_waitlist_no_body():
    r = requests.post(f"{API}/public/waitlist")
    assert r.status_code == 400


# --- Dashboard texts stat
def test_dashboard_texts_this_month():
    s = login('civr.alice@example.com', 'AliceTest#2026')
    r = s.get(f"{API}/dashboard")
    assert r.status_code == 200, r.text
    d = r.json()
    assert 'textsThisMonth' in d, list(d.keys())
    assert isinstance(d['textsThisMonth'], int)


def test_dashboard_unauth():
    assert requests.get(f"{API}/dashboard").status_code == 401


# --- New account: empty mobile list, $0 wallet, short-wallet 402
def test_new_account_mobile_402():
    e = f"landing.qa+{int(time.time())}@example.com"
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={'email': e, 'password': 'QaTest#2026x', 'name': ''})
    assert r.status_code in (200, 201), r.text
    m = s.get(f"{API}/mobile-numbers").json()
    assert m['available'] is True and m['items'] == []
    w = s.get(f"{API}/wallet").json()
    assert w['balance'] == 0
    r = s.post(f"{API}/mobile-numbers", json={'zipcode': '10011'})
    assert r.status_code == 402, r.text


def test_bob_mobile_empty():
    s = login('civr.bob@example.com', 'BobTest#2026')
    d = s.get(f"{API}/mobile-numbers").json()
    assert d['items'] == []
