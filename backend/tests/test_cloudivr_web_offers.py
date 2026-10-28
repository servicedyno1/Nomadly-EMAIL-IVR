# CloudIVR web: personal daily offers (number code, renew, upgrade, topup tiers, firstTopup), dismiss, coupons.
import copy
import os
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026', '5000000000000001')
BOB = ('civr.bob@example.com', 'BobTest#2026', '5000000000000002')

db = MongoClient('mongodb://localhost:27017')['test']
TODAY = datetime.now(timezone.utc).strftime('%Y-%m-%d')
EOD = datetime.now(timezone.utc).replace(hour=23, minute=59, second=59, microsecond=0)
START = datetime.now(timezone.utc)


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'email': email, 'password': pw})
    assert r.status_code == 200, r.text
    return s


def oid(cid):
    return f"{TODAY}:{cid}"


@pytest.fixture(scope='module', autouse=True)
def snapshot():
    snap = {}
    for _, _, cid in (ALICE, BOB):
        snap[cid] = {c: copy.deepcopy(db[c].find_one({'_id': cid})) for c in ('phoneNumbersOf', 'walletOf')}
        snap[cid]['offer'] = copy.deepcopy(db.webOffers.find_one({'_id': oid(cid)}))
    yield snap
    for cid, s in snap.items():
        for c in ('phoneNumbersOf', 'walletOf'):
            if s[c] is None:
                db[c].delete_one({'_id': cid})
            else:
                db[c].replace_one({'_id': cid}, s[c], upsert=True)
        if s['offer'] is None:
            db.webOffers.delete_one({'_id': oid(cid)})
        else:
            db.webOffers.replace_one({'_id': oid(cid)}, s['offer'], upsert=True)
        db.phoneTransactions.delete_many({'chatId': cid, 'timestamp': {'$gte': START.isoformat().replace('+00:00', 'Z')[:19]}})
        db.transactions.delete_many({'chatId': cid, 'createdAt': {'$gte': START.replace(tzinfo=None)}, 'type': {'$ne': 'keep'}})


def set_offer(cid, **kind):
    db.webOffers.replace_one({'_id': oid(cid)}, {'_id': oid(cid), 'chatId': cid, 'day': TODAY, **kind, 'dismissed': False, 'used': False, 'expiresAt': EOD, 'createdAt': datetime.now(timezone.utc)}, upsert=True)


def wallet(s):
    r = s.get(f"{API}/wallet")
    assert r.status_code == 200
    return r.json()


# --- offers/current structure ---
class TestCurrent:
    def test_bob_number_offer(self):
        s = login(*BOB[:2])
        o = s.get(f"{API}/offers/current").json()['offer']
        for k in ('id', 'kind', 'discount', 'code', 'phones', 'phone', 'plan', 'tiers', 'first', 'dismissed', 'used', 'expiresAt', 'title', 'text', 'cta'):
            assert k in o
        assert o['kind'] == 'number' and o['code'].startswith('CIVR') and o['discount'] in (10, 15, 20)
        assert o['cta']['to'].startswith('/app/buy?coupon=')

    def test_alice_idempotent(self):
        s = login(*ALICE[:2])
        a = s.get(f"{API}/offers/current").json()['offer']
        b = s.get(f"{API}/offers/current").json()['offer']
        assert a['id'] == b['id'] == oid(ALICE[2])

    def test_unauth(self):
        assert requests.get(f"{API}/offers/current").status_code == 401

    def test_choose_renew_when_expiring(self):
        cid = ALICE[2]
        db.webOffers.delete_one({'_id': oid(cid)})
        exp = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat().replace('+00:00', 'Z')
        db.phoneNumbersOf.update_one({'_id': cid}, {'$set': {'val.numbers.0.expiresAt': exp}})
        s = login(*ALICE[:2])
        o = s.get(f"{API}/offers/current").json()['offer']
        assert o['kind'] == 'renew' and o['discount'] == 15 and o['phones']
        assert 'tab=billing' in o['cta']['to']


# --- renew with/without offer ---
class TestRenew:
    def test_renew_discount_and_used(self, snapshot):
        cid = ALICE[2]
        phone = snapshot[cid]['phoneNumbersOf']['val']['numbers'][0]['phoneNumber']
        set_offer(cid, kind='renew', discount=15, phones=[phone])
        s = login(*ALICE[:2])
        r = s.post(f"{API}/numbers/{requests.utils.quote(phone)}/renew", json={})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['discount'] == 15
        assert d['price'] == round(120 * 0.85, 2), d
        assert db.webOffers.find_one({'_id': oid(cid)})['used'] is True
        # second renew → full price
        r2 = s.post(f"{API}/numbers/{requests.utils.quote(phone)}/renew", json={})
        assert r2.status_code == 200 and r2.json()['discount'] == 0 and r2.json()['price'] == 120


# --- upgrade quote/confirm with offer ---
class TestUpgrade:
    def test_upgrade_offer(self, snapshot):
        cid = ALICE[2]
        db.phoneNumbersOf.replace_one({'_id': cid}, snapshot[cid]['phoneNumbersOf'])
        db.phoneNumbersOf.update_one({'_id': cid}, {'$set': {'val.numbers.0.plan': 'pro', 'val.numbers.0.planPrice': 75}})
        phone = snapshot[cid]['phoneNumbersOf']['val']['numbers'][0]['phoneNumber']
        set_offer(cid, kind='upgrade', discount=20, phone=phone, **{'from': 'pro', 'to': 'business'})
        s = login(*ALICE[:2])
        url = f"{API}/numbers/{requests.utils.quote(phone)}/upgrade"
        q = s.post(url, json={'plan': 'business', 'confirm': False}).json()['quote']
        assert q['discount'] == 20 and q['charge'] == round(q['fullCharge'] * 0.8, 2), q
        before = wallet(s)
        r = s.post(url, json={'plan': 'business', 'confirm': True})
        assert r.status_code == 200, r.text
        assert r.json()['charged'] == q['charge']
        assert db.webOffers.find_one({'_id': oid(cid)})['used'] is True
        print('wallet before', before.get('balance'), 'after', r.json()['balance'])


# --- top-up tier bonus ---
class TestTopup:
    def test_topup_bonus_paid(self, snapshot):
        cid = ALICE[2]
        db.phoneNumbersOf.replace_one({'_id': cid}, snapshot[cid]['phoneNumbersOf'])
        set_offer(cid, kind='topup')
        s = login(*ALICE[:2])
        o = s.get(f"{API}/offers/current").json()['offer']
        assert o['kind'] == 'topup' and len(o['tiers']) == 3
        r = s.post(f"{API}/wallet/topup", json={'amountUsd': 100, 'coin': 'BTC'})
        if r.status_code == 400 and 'coin' in r.text:
            pytest.skip(r.text)
        assert r.status_code == 201, r.text
        d = r.json()
        assert d['bonus'] and d['bonus']['kind'] == 'topup' and d['dryRun'] is True
        ref = d['ref']
        db.transactions.insert_one({'chatId': cid, 'type': 'wallet-topup', 'amount': 100, 'status': 'completed', 'metadata': {'ref': ref, 'coin': 'BTC', 'value': 'test'}, 'createdAt': datetime.utcnow()})
        db.walletOf.update_one({'_id': cid}, {'$inc': {'usdIn': 100}})
        bonus = None
        for _ in range(26):
            bonus = db.transactions.find_one({'chatId': cid, 'type': 'topup-bonus', 'metadata.ref': ref})
            if bonus:
                break
            time.sleep(5)
        assert bonus and bonus['amount'] == 15, bonus
        dep = db.webDeposits.find_one({'ref': ref})
        assert dep['bonusUsd'] == 15 and dep['bonusPaidAt']
        hist = s.get(f"{API}/wallet").json()
        assert 'Top-up bonus' in str(hist), 'wallet history lacks Top-up bonus'


# --- number code coupons ---
class TestNumberCode:
    def test_code_owner_only(self):
        sb = login(*BOB[:2])
        code = sb.get(f"{API}/offers/current").json()['offer']['code']
        r = sb.post(f"{API}/coupons/check", json={'code': code, 'amount': 50})
        assert r.status_code == 200 and r.json()['newPrice'] < 50
        sa = login(*ALICE[:2])
        r2 = sa.post(f"{API}/coupons/check", json={'code': code})
        assert r2.status_code == 400 and r2.json()['message'] == 'That coupon code is not valid.'

    def test_bot_daily_code(self):
        sb = login(*BOB[:2])
        c = sb.get(f"{API}/coupons/today").json().get('coupon')
        if not c:
            pytest.skip('no bot daily coupon today')
        r = sb.post(f"{API}/coupons/check", json={'code': c['code']})
        assert r.status_code == 200 and r.json()['discount'] == c['discount'], r.text

    def test_buy_with_code_then_reuse_rejected(self):
        sb = login(*BOB[:2])
        o = sb.get(f"{API}/offers/current").json()['offer']
        code = o['code']
        sr = sb.get(f"{API}/numbers/search", params={'country': 'US'})
        assert sr.status_code == 200, sr.text
        nums = sr.json()['numbers']
        assert nums
        r = sb.post(f"{API}/numbers/buy", json={'phoneNumber': nums[0]['phoneNumber'], 'plan': 'starter', 'coupon': code})
        assert r.status_code == 201, r.text
        tx = db.phoneTransactions.find_one({'chatId': BOB[2], 'phoneNumber': r.json()['number']['phoneNumber']})
        assert tx['discountPct'] == o['discount'], tx
        assert db.webOffers.find_one({'_id': oid(BOB[2])})['used'] is True
        r2 = sb.post(f"{API}/coupons/check", json={'code': code})
        assert r2.status_code == 400 and r2.json()['message'] == 'You have already used this coupon.'


# --- dismiss ---
class TestDismiss:
    def test_dismiss(self):
        sb = login(*BOB[:2])
        r = sb.post(f"{API}/offers/dismiss", json={})
        assert r.status_code == 200 and r.json()['offer']['dismissed'] is True
        assert sb.get(f"{API}/offers/current").json()['offer']['dismissed'] is True
