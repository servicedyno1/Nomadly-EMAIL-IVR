# CloudIVR iter274: Travel eSIM shop (Bird catalog, dry-run orders), MultiTEL GB mobile search, regression pages
import os
import requests
import pytest
from pymongo import MongoClient
from dotenv import dotenv_values

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE}/api/cloudivr-web"
ENV = dotenv_values('/app/backend/.env')
ALICE = ('civr.alice@example.com', 'AliceTest#2026')
BOB = ('civr.bob@example.com', 'BobTest#2026')
ALICE_ID, BOB_ID = '5000000000000900', '5000000000000901'
S = {}
CREATED = []  # (chatId, orderId, price)
CACHE = {}


def db():
    return MongoClient(ENV['MONGO_URL'])[ENV['DB_NAME']]


def login(creds):
    if creds[0] in S:
        return S[creds[0]]
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'email': creds[0], 'password': creds[1]})
    assert r.status_code == 200, r.text
    S[creds[0]] = s
    return s


def bal(cid):
    w = db().walletOf.find_one({'_id': cid}) or {}
    return round((w.get('usdIn', 0) or 0) - (w.get('usdOut', 0) or 0), 4)


def plans():
    if 'z' not in CACHE:
        r = login(ALICE).get(f"{API}/travel-esim/plans", timeout=120)
        assert r.status_code == 200, r.text
        CACHE['z'] = r.json()
    return CACHE['z']


@pytest.fixture(scope='module', autouse=True)
def cleanup():
    yield
    d = db()
    for cid, oid, price in CREATED:
        d.travelEsims.delete_one({'_id': oid})
        d.transactions.delete_one({'_id': f'travel-esim-{oid}'})
        d.walletOf.update_one({'_id': cid}, {'$inc': {'usdOut': -price}})


# Travel eSIM catalog
class TestTravelPlans:
    def test_unauth(self):
        r = requests.get(f"{API}/travel-esim/plans")
        assert r.status_code == 401

    def test_zone_count_and_markup(self):
        d = plans()
        assert d['markup'] == 3
        assert len(d['zones']) == 187, len(d['zones'])
        for z in d['zones']:
            for o in z['offers']:
                assert abs(o['price'] - round(o['cost'] * 3, 2)) < 0.011, o
            assert z['from'] == min(o['price'] for o in z['offers'])

    def test_uk_offers(self):
        uk = next(z for z in plans()['zones'] if z['zone'] == 'United Kingdom')
        got = sorted((o['gb'], o['price'], o['cost']) for o in uk['offers'])
        print(got)
        assert [g[1] for g in got] == [6, 12, 18, 45]
        assert [g[0] for g in got] == [1, 5, 10, 20]
        assert [g[2] for g in got] == [2, 4, 6, 15]

    def test_no_internal_leak(self):
        o = plans()['zones'][0]['offers'][0]
        assert {'id', 'name', 'gb', 'days', 'price'} <= set(o)


# Travel eSIM orders (dry-run)
class TestTravelOrders:
    def test_buy_uk_1gb(self):
        uk = next(z for z in plans()['zones'] if z['zone'] == 'United Kingdom')
        offer = min(uk['offers'], key=lambda o: o['price'])
        b0 = bal(ALICE_ID)
        r = login(ALICE).post(f"{API}/travel-esim/orders", json={'offerId': offer['id']})
        assert r.status_code == 200, r.text
        d = r.json()
        CREATED.append((ALICE_ID, d['id'], d['price']))
        assert d['status'] == 'active'
        assert d['dryRun'] is True
        assert d['price'] == offer['price'] == 6
        assert d['install']['activationCode'].startswith('LPA:')
        assert 'cost' not in d and 'idemKey' not in d and 'chatId' not in d
        assert round(b0 - bal(ALICE_ID), 2) == 6
        doc = db().travelEsims.find_one({'_id': d['id']})
        assert doc and doc['chatId'] in (ALICE_ID, int(ALICE_ID)) and doc['status'] == 'active'
        CACHE['order'] = d['id']

    def test_list_orders(self):
        r = login(ALICE).get(f"{API}/travel-esim/orders")
        assert r.status_code == 200
        ids = [o['id'] for o in r.json()['orders']]
        assert CACHE.get('order') in ids
        # Bob does not see Alice's
        r2 = login(BOB).get(f"{API}/travel-esim/orders")
        assert CACHE.get('order') not in [o['id'] for o in r2.json()['orders']]

    def test_unknown_offer_404(self):
        r = login(ALICE).post(f"{API}/travel-esim/orders", json={'offerId': 'nope-123'})
        assert r.status_code == 404
        assert r.json()['error'] == 'offer_not_found'

    def test_missing_offer_404(self):
        r = login(ALICE).post(f"{API}/travel-esim/orders", json={})
        assert r.status_code == 404

    def test_insufficient_402(self):
        allo = [o for z in plans()['zones'] for o in z['offers']]
        b = bal(BOB_ID)
        pricey = [o for o in allo if o['price'] > b]
        if not pricey:
            pytest.skip(f'no offer above Bob balance {b}')
        o = min(pricey, key=lambda x: x['price'])
        r = login(BOB).post(f"{API}/travel-esim/orders", json={'offerId': o['id']})
        if r.status_code == 200:
            CREATED.append((BOB_ID, r.json()['id'], r.json()['price']))
        assert r.status_code == 402, r.text
        assert bal(BOB_ID) == b


# MultiTEL search (one call only)
class TestMultitelSearch:
    def test_gb_mobile_texting(self):
        r = login(ALICE).get(f"{API}/numbers/search", params={'country': 'GB', 'type': 'mobile', 'texting': 1}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        nums = d.get('numbers') or d.get('results') or d.get('items') or []
        print({k: (v if k not in ('numbers', 'results', 'items') else len(v)) for k, v in d.items()})
        print(nums[:2])
        assert len(nums) > 0
        assert all(str(n.get('phoneNumber') or n.get('phone_number')).startswith('+44') for n in nums)


# Regression
class TestRegression:
    @pytest.mark.parametrize('path', ['/texting/ready', '/plans'])
    def test_pages(self, path):
        r = login(ALICE).get(f"{API}{path}")
        assert r.status_code in (200, 404), r.text
        print(path, r.status_code)
