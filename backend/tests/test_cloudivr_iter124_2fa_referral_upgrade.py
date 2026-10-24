# CloudIVR web iter124: SIP domain, Pro recording, crypto upgrade, 2FA, referrals, suggestions, backup numbers
import os, time, hmac, hashlib, struct, base64, uuid
import pytest, requests
from pymongo import MongoClient

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for l in open('/app/frontend/.env'):
        if l.startswith('REACT_APP_BACKEND_URL='):
            BASE = l.split('=', 1)[1].strip().rstrip('/')
API = BASE + '/api/cloudivr-web'
ALICE = ('civr.alice@example.com', 'AliceTest#2026')
BOB = ('civr.bob@example.com', 'BobTest#2026')
PRO = '%2B15674050075'
QA_PW = 'QaTest#2026x'


def mongo():
    url = None
    for l in open('/app/backend/.env'):
        if l.startswith('MONGO_URL='):
            url = l.split('=', 1)[1].strip().strip('"')
    return MongoClient(url)['test']


def totp(secret, offset=0):
    key = base64.b32decode(secret + '=' * (-len(secret) % 8))
    c = struct.pack('>Q', int(time.time() // 30) + offset)
    h = hmac.new(key, c, hashlib.sha1).digest()
    o = h[19] & 15
    return str((struct.unpack('>I', h[o:o + 4])[0] & 0x7fffffff) % 1000000).zfill(6)


def login(email, pw, s=None, **kw):
    s = s or requests.Session()
    r = s.post(f'{API}/auth/login', json={'email': email, 'password': pw, **kw})
    return s, r


def register(ref=None):
    s = requests.Session()
    email = f'qa.it124.{uuid.uuid4().hex[:8]}@example.com'
    r = s.post(f'{API}/auth/register', json={'email': email, 'password': QA_PW, **({'ref': ref} if ref else {})})
    assert r.status_code == 201, r.text
    return s, email, r.json()['account']


@pytest.fixture(scope='module')
def alice():
    s, r = login(*ALICE)
    assert r.status_code == 200 and 'account' in r.json(), r.text
    return s


@pytest.fixture(scope='module')
def bob():
    s, r = login(*BOB)
    assert r.status_code == 200, r.text
    return s


# --- SIP domain ---
class TestSip:
    def test_catalog_sip(self):
        assert requests.get(f'{API}/public/catalog').json()['sipDomain'] == 'sip.cloudivr.net'

    def test_numbers_sip(self, alice):
        nums = alice.get(f'{API}/numbers').json()['numbers']
        assert nums and all(n['sipDomain'] == 'sip.cloudivr.net' for n in nums)
        r = alice.get(f'{API}/numbers/{PRO}/sip')
        assert r.status_code == 200 and r.json()['domain'] == 'sip.cloudivr.net'


# --- Recording on Pro ---
class TestRecording:
    def test_catalog_plans(self):
        d = requests.get(f'{API}/public/catalog').json()
        plans = {p['id']: p for p in d['plans']}
        assert plans['pro']['access']['callRecording'] is True
        assert plans['starter']['access']['callRecording'] is False

    def test_pro_recording_patch(self, alice):
        r = alice.patch(f'{API}/numbers/{PRO}/recording', json={'enabled': True})
        assert r.status_code == 200, r.text
        r = alice.patch(f'{API}/numbers/{PRO}/recording', json={'enabled': False})
        assert r.status_code == 200

    def test_bob_starter_recording_403(self, bob):
        n = bob.get(f'{API}/numbers').json()['numbers'][0]['phoneNumber']
        r = bob.patch(f"{API}/numbers/{n.replace('+', '%2B')}/recording", json={'enabled': True})
        assert r.status_code == 403


# --- Crypto upgrade ---
class TestUpgradeCheckout:
    def test_invalid_coin(self, alice):
        r = alice.post(f'{API}/numbers/{PRO}/upgrade-checkout', json={'plan': 'business', 'coin': 'DOGEX'})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_coin'

    def test_same_lower_plan(self, alice):
        for p in ('pro', 'starter'):
            r = alice.post(f'{API}/numbers/{PRO}/upgrade-checkout', json={'plan': p, 'coin': 'BTC'})
            assert r.status_code == 400, (p, r.text)

    def test_upgrade_flow_and_restore(self, alice):
        coins = requests.get(f'{API}/public/catalog').json().get('coins') or ['BTC']
        r = alice.post(f'{API}/numbers/{PRO}/upgrade-checkout', json={'plan': 'business', 'coin': coins[0] if isinstance(coins[0], str) else coins[0].get('id', 'BTC')})
        assert r.status_code == 201, r.text
        o = r.json()['order']
        assert o['kind'] == 'upgrade' and o['status'] == 'awaiting_payment'
        r = alice.post(f"{API}/numbers/orders/{o['id']}/simulate-payment", json={})
        assert r.status_code == 200, r.text
        assert r.json()['order']['status'] == 'active', r.json()
        n = [x for x in alice.get(f'{API}/numbers').json()['numbers'] if x['phoneNumber'] == '+15674050075'][0]
        assert n['plan'] == 'business'
        r = alice.post(f'{API}/numbers/{PRO}/downgrade', json={'plan': 'pro', 'confirm': True})
        assert r.status_code == 200, r.text
        n = [x for x in alice.get(f'{API}/numbers').json()['numbers'] if x['phoneNumber'] == '+15674050075'][0]
        assert n['plan'] == 'pro'


# --- 2FA ---
class Test2FA:
    def test_email_2fa_full(self):
        s, email, _ = register()
        r = s.post(f'{API}/auth/2fa/setup', json={'method': 'email'})
        assert r.status_code == 200 and len(r.json()['previewCode']) == 6
        assert s.post(f'{API}/auth/2fa/enable', json={'method': 'email', 'code': '000001'}).status_code == 400
        r = s.post(f'{API}/auth/2fa/enable', json={'method': 'email', 'code': r.json()['previewCode']})
        assert r.status_code == 200 and len(r.json()['backupCodes']) == 8
        backups = r.json()['backupCodes']
        s.post(f'{API}/auth/logout', json={})
        s2, r = login(email, QA_PW, remember=True)
        tf = r.json()['twoFactor']
        assert tf['method'] == 'email' and tf['previewCode'] and 'account' not in r.json()
        assert s2.get(f'{API}/auth/me').status_code == 401
        r = s2.post(f'{API}/auth/2fa/verify', json={'challenge': tf['challenge'], 'code': '111111'})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_code'
        r = s2.post(f'{API}/auth/2fa/verify', json={'challenge': tf['challenge'], 'code': tf['previewCode'], 'remember': True})
        assert r.status_code == 200, r.text
        assert 'civr_trust' in s2.cookies.get_dict()
        assert s2.get(f'{API}/auth/me').status_code == 200
        s2.post(f'{API}/auth/logout', json={})
        _, r = login(email, QA_PW, s=s2)
        assert 'account' in r.json(), r.text  # remembered browser
        # backup code once (fresh browser)
        s3, r = login(email, QA_PW)
        ch = r.json()['twoFactor']['challenge']
        assert s3.post(f'{API}/auth/2fa/verify', json={'challenge': ch, 'code': backups[0]}).status_code == 200
        s4, r = login(email, QA_PW)
        assert s4.post(f'{API}/auth/2fa/verify', json={'challenge': r.json()['twoFactor']['challenge'], 'code': backups[0]}).status_code == 400
        # disable
        assert s3.post(f'{API}/auth/2fa/disable', json={'password': 'wrong'}).status_code == 400
        r = s3.post(f'{API}/auth/2fa/disable', json={'password': QA_PW})
        assert r.status_code == 200 and r.json()['enabled'] is False
        _, r = login(email, QA_PW)
        assert 'account' in r.json()

    def test_totp_2fa(self):
        s, email, _ = register()
        r = s.post(f'{API}/auth/2fa/setup', json={'method': 'totp'})
        sec = r.json()['secret']
        assert r.json()['otpauthUrl'].startswith('otpauth://totp/')
        r = s.post(f'{API}/auth/2fa/enable', json={'method': 'totp', 'code': totp(sec)})
        assert r.status_code == 200, r.text
        assert s.get(f'{API}/auth/2fa').json()['method'] == 'totp'
        s2, r = login(email, QA_PW)
        ch = r.json()['twoFactor']['challenge']
        # same step as enable reused → rejected (replay); next step accepted
        assert s2.post(f'{API}/auth/2fa/verify', json={'challenge': ch, 'code': totp(sec)}).status_code == 400
        assert s2.post(f'{API}/auth/2fa/verify', json={'challenge': ch, 'code': totp(sec, 1)}).status_code == 200

    def test_bad_challenge(self):
        r = requests.post(f'{API}/auth/2fa/verify', json={'challenge': 'x', 'code': '123456'})
        assert r.status_code == 401


# --- Referrals ---
class TestReferral:
    def test_referral_payout_once(self, alice):
        ref = alice.get(f'{API}/referrals').json()
        code = ref['code']
        base_rewarded = ref['stats']['rewarded']
        a_bal0 = alice.get(f'{API}/wallet').json()['balance']
        s, email, acc = register(ref=code)
        db = mongo()
        db.walletOf.update_one({'_id': str(acc['id'])}, {'$inc': {'usdIn': 200}}, upsert=True)
        bal0 = s.get(f'{API}/wallet').json()['balance']
        assert bal0 >= 200
        bought = 0
        for _ in range(2):
            r = s.get(f'{API}/numbers/search', params={'country': 'US', 'type': 'local'})
            assert r.status_code == 200, r.text
            num = r.json()['numbers'][0]['phoneNumber']
            r = s.post(f'{API}/numbers/checkout', json={'phoneNumber': num, 'plan': 'starter', 'method': 'wallet'})
            assert r.status_code in (201, 202), r.text
            bought += 1
            if bought == 1:
                time.sleep(1)
                a_bal1 = alice.get(f'{API}/wallet').json()['balance']
                assert round(a_bal1 - a_bal0, 2) == 10.0
                assert alice.get(f'{API}/referrals').json()['stats']['rewarded'] == base_rewarded + 1
        a_bal2 = alice.get(f'{API}/wallet').json()['balance']
        assert round(a_bal2 - a_bal0, 2) == 10.0  # second purchase pays nothing more
        bal = s.get(f'{API}/wallet').json()['balance']
        assert round(bal0 - 100 + 5 - bal, 2) == 0, (bal0, bal)  # 2 x Starter $50, +$5 friend gift once


# --- Suggestions ---
class TestSuggestions:
    def test_suggest_adopt(self, alice, bob):
        s, email, acc = register()
        assert s.post(f'{API}/suggestions', json={'text': 'short'}).status_code == 400
        r = s.post(f'{API}/suggestions', json={'text': 'TEST_ add a dark mode toggle please'})
        assert r.status_code == 201
        sid = r.json()['suggestion']['id']
        assert bob.get(f'{API}/admin/suggestions').status_code == 403
        lst = alice.get(f'{API}/admin/suggestions').json()['suggestions']
        assert any(x['id'] == sid for x in lst)
        bal0 = s.get(f'{API}/wallet').json()['balance']
        r = alice.post(f'{API}/admin/suggestions/{sid}/adopt', json={'credit': 7})
        assert r.status_code == 200 and r.json()['suggestion']['status'] == 'adopted'
        assert alice.post(f'{API}/admin/suggestions/{sid}/adopt', json={'credit': 7}).status_code == 409
        assert round(s.get(f'{API}/wallet').json()['balance'] - bal0, 2) == 7.0
        mine = s.get(f'{API}/suggestions').json()['suggestions']
        assert mine[0]['status'] == 'adopted'


# --- Backup numbers ---
class TestBackups:
    def test_forwarding_backups(self, alice):
        r = alice.patch(f'{API}/numbers/{PRO}/forwarding', json={'mode': 'busy', 'forwardTo': '+14155550100', 'backups': '+14155550101, +14155550102'})
        assert r.status_code == 200, r.text
        assert r.json()['callForwarding']['backups'] == ['+14155550101', '+14155550102']
        n = [x for x in alice.get(f'{API}/numbers').json()['numbers'] if x['phoneNumber'] == '+15674050075'][0]
        assert n['features']['callForwarding']['backups'] == ['+14155550101', '+14155550102']
        r = alice.patch(f'{API}/numbers/{PRO}/forwarding', json={'mode': 'busy', 'forwardTo': '+14155550100', 'backups': 'abc123'})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_backup'
        r = alice.patch(f'{API}/numbers/{PRO}/forwarding', json={'mode': 'busy', 'forwardTo': '+14155550100', 'backups': ['+14155550101', '+14155550102', '+14155550103', '+14155550104', '+14155550105']})
        assert r.status_code == 400
        r = alice.patch(f'{API}/numbers/{PRO}/forwarding', json={'mode': 'disabled'})
        assert r.status_code == 200 and r.json()['callForwarding']['enabled'] is False

    def test_disabled_ignores_bad_backups_and_junk_rejected(self, alice):
        r = alice.patch(f'{API}/numbers/{PRO}/forwarding', json={'mode': 'disabled', 'backups': '12ab'})
        assert r.status_code == 200 and r.json()['callForwarding']['backups'] == []
        r = alice.patch(f'{API}/numbers/{PRO}/forwarding', json={'mode': 'busy', 'forwardTo': '+14155550100', 'backups': 'bad'})
        assert r.status_code == 400 and r.json()['error'] == 'invalid_backup'
        r = alice.patch(f'{API}/numbers/{PRO}/forwarding', json={'mode': 'busy', 'forwardTo': '+14155550100', 'backups': '+1 (415) 555-0101'})
        assert r.status_code == 200 and r.json()['callForwarding']['backups'] == ['+14155550101']
        assert alice.patch(f'{API}/numbers/{PRO}/forwarding', json={'mode': 'disabled'}).status_code == 200


class TestEmailThrottle:
    def test_one_code_per_minute(self):
        s, email, _ = register()
        code = s.post(f'{API}/auth/2fa/setup', json={'method': 'email'}).json()['previewCode']
        assert s.post(f'{API}/auth/2fa/enable', json={'method': 'email', 'code': code}).status_code == 200
        _, r1 = login(email, QA_PW)
        _, r2 = login(email, QA_PW)
        a, b = r1.json()['twoFactor'], r2.json()['twoFactor']
        assert a['previewCode'] == b['previewCode']  # second login within a minute re-uses the code, no new email
        r = requests.post(f'{API}/auth/2fa/resend', json={'challenge': b['challenge']})
        assert r.status_code == 429 and r.json()['error'] == 'slow_down'
        r = s.post(f'{API}/auth/2fa/disable-code', json={})
        assert r.status_code == 429
