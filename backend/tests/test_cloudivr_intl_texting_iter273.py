# CloudIVR iter273: International Texting (MultiTEL/Infobip no-ID texting countries) — /texting/ready, texting search,
# Basic-plan purchase, extra-number price (3x, floor $25), pricing module (node), Spenza USA $0 text price.
import os
import json
import subprocess
import pytest
import requests
from pymongo import MongoClient
from dotenv import dotenv_values

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE}/api/cloudivr-web"
ENV = dotenv_values('/app/backend/.env')
UX = ('civr.uxtest@example.com', 'UxTest#2026')
MAIN = '+13341112222'
S = {'bought': []}

EXP_TEXT = {'BR': 0.27, 'CA': 0.05, 'CO': 0.21, 'DK': 0.27, 'LT': 0.15, 'NL': 0.24, 'PE': 1.45, 'PL': 0.11, 'PR': 0.12, 'ES': 0.22, 'GB': 0.18}


def db():
    return MongoClient(ENV['MONGO_URL'])[ENV['DB_NAME']]


@pytest.fixture(scope='module')
def ux():
    # fresh TEST_ account (uxtest has no legal profile → purchases return 428 profile_required)
    import time
    s = requests.Session()
    email = f"test_it273{int(time.time()*1000)}@example.com"
    r = s.post(f"{API}/auth/register", json={'email': email, 'password': 'TestComp#2026', 'name': 'TEST_IT273', 'acceptPolicy': True})
    assert r.status_code == 201, r.text
    s.chat_id = str(r.json()['account']['id'])
    s.email = email
    r = s.put(f"{API}/profile/legal", json={'type': 'individual', 'fullName': 'TEST Intl Texter', 'address': {'line1': '1 Main Street', 'city': 'Austin', 'postalCode': '78701', 'countryCode': 'US'}})
    assert r.status_code == 200, r.text
    db().walletOf.update_one({'_id': s.chat_id}, {'$set': {'usdIn': 500, 'usdOut': 0}}, upsert=True)
    S['email'] = email
    yield s
    d = db()
    d.phoneNumbersOf.delete_one({'_id': s.chat_id})
    d.walletOf.delete_one({'_id': s.chat_id})


def balance(s):
    r = s.get(f"{API}/wallet")
    assert r.status_code == 200, r.text
    j = r.json()
    return float(j.get('balance', j.get('usd', 0)) if not isinstance(j.get('balance'), dict) else j['balance'].get('usd', 0))


# --- /texting/ready ---
def test_ready_requires_auth():
    r = requests.get(f"{API}/texting/ready")
    assert r.status_code == 401


def test_ready_items(ux):
    r = ux.get(f"{API}/texting/ready")
    assert r.status_code == 200, r.text
    j = r.json()
    S['ready'] = j
    isos = [i['country'] for i in j['items']]
    assert sorted(isos) == sorted(EXP_TEXT.keys()), isos
    assert 'US' not in isos
    for i in j['items']:
        assert i['typeName'] == 'Mobile'
        assert i['textPrice'] == EXP_TEXT[i['country']], (i['country'], i['textPrice'])
        assert i['extraPrice'] >= 25
        assert i['caps']['sms'] is True
        assert i['caps']['voice'] is (i['country'] not in ('LT', 'PL', 'ES')), i
    by = {i['country']: i for i in j['items']}
    assert by['PL']['extraPrice'] == 58.56 and by['ES']['extraPrice'] == 117.09 and by['PE']['extraPrice'] == 74.94
    assert by['GB']['extraPrice'] == 25
    assert j['price'] == 50
    assert j['usa'] == {'caps': {'sms': True, 'voice': False}, 'assigned': True}


# --- search (live Infobip / MultiTEL — 2 searches only) ---
def test_search_gb_mobile(ux):
    r = ux.get(f"{API}/numbers/search", params={'country': 'GB', 'type': 'mobile', 'texting': '1'})
    assert r.status_code == 200, r.text
    nums = r.json()['numbers']
    assert nums, 'no GB mobile numbers'
    for n in nums:
        assert n['capabilities']['sms'] and n['capabilities']['voice'], n
        assert n['extraPrice'] == 25 and n['textPrice'] == 0.18
    S['gb'] = [n['phoneNumber'] for n in nums]


def test_search_pl_texting(ux):
    r = ux.get(f"{API}/numbers/search", params={'country': 'PL', 'type': 'local', 'texting': '1'})
    assert r.status_code == 200, r.text
    nums = r.json()['numbers']
    assert nums, 'no PL SMS numbers'
    for n in nums:
        assert n['capabilities']['sms'] is True and n['capabilities']['voice'] is False, n
        assert n['textPrice'] == 0.11 and n['extraPrice'] == 58.56
    S['pl'] = [n['phoneNumber'] for n in nums]
    S['pl_cache'] = db().webSearchCache.find_one({'_id': ux.chat_id}) if 'webSearchCache' in db().list_collection_names() else None


# --- purchases (dry-run) from the PL search cache ---
def test_buy_pl_basic(ux):
    if not S.get('pl'):
        pytest.skip('no PL numbers')
    before = balance(ux)
    phone = S['pl'][0]
    r = ux.post(f"{API}/numbers/checkout", json={'phoneNumber': phone, 'plan': 'starter', 'method': 'wallet', 'autoRenew': True})
    assert r.status_code == 201, r.text
    got = r.json()['number']['phoneNumber']
    S['bought'].append(got)
    after = balance(ux)
    assert round(before - after, 2) == 50.0, (before, after)
    n = ux.get(f"{API}/numbers/{requests.utils.quote(got)}").json()['number']
    S['pl_num'] = n
    assert n['plan'] == 'starter'
    print('PL number caps:', n.get('capabilities'), 'provider', n.get('provider'))


def test_pl_basic_caps_voice_false(ux):
    # Infobip PL numbers are SMS-only; the saved number should not claim voice.
    n = S.get('pl_num')
    if not n:
        pytest.skip('no PL purchase')
    raw = next(x for x in db().phoneNumbersOf.find_one({'val.numbers.phoneNumber': n['phoneNumber']})['val']['numbers'] if x['phoneNumber'] == n['phoneNumber'])
    assert raw['capabilities']['voice'] is False, raw['capabilities']


def test_buy_pl_extra_price(ux):
    if not S.get('pl_num') or len(S['pl']) < 2:
        pytest.skip('need 2 PL numbers')
    before = balance(ux)
    main = S['pl_num']['phoneNumber']
    # purchase clears the search cache; restore the PL search snapshot (avoids another live Infobip search)
    if S.get('pl_cache'):
        db().webSearchCache.replace_one({'_id': ux.chat_id}, S['pl_cache'], upsert=True)
    r = ux.post(f"{API}/numbers/{requests.utils.quote(main)}/extra", json={'phoneNumber': S['pl'][1], 'autoRenew': True})
    assert r.status_code == 201, r.text
    got = r.json()['number']['phoneNumber']
    S['bought'].append(got)
    after = balance(ux)
    assert round(before - after, 2) == 58.56, (before, after)
    raw = next(x for x in db().phoneNumbersOf.find_one({'val.numbers.phoneNumber': got})['val']['numbers'] if x['phoneNumber'] == got)
    assert raw['planPrice'] == 58.56 and raw['isSubNumber'] is True and raw['parentNumber'] == main


# --- pricing module (node) ---
def node(js):
    out = subprocess.run(['node', '-e', js], cwd='/app', capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_rate_for():
    r = node("const t=require('./js/texting-countries');console.log(JSON.stringify({"
             "a:t.rateFor({provider:'multitel'},'+447700900123'),b:t.rateFor({provider:'infobip'},'+48500100200'),"
             "c:t.rateFor({provider:'telnyx'},'+447700900123'),d:t.rateFor({provider:'multitel'},'+12025550123'),"
             "e:t.rateFor({provider:'infobip'},'+17875550123'),f:t.textPrice(0.001),g:t.extraPrice(1),"
             "h:t.localTextPrice({provider:'multitel',phoneNumber:'+447700900123'})}))")
    assert r['a']['price'] == 0.18 and r['a']['iso'] == 'GB'
    assert r['b']['price'] == 0.11
    assert r['c'] is None and r['d'] is None
    assert r['e']['iso'] == 'PR' and r['e']['price'] == 0.12
    assert r['f'] == 0.05 and r['g'] == 25 and r['h'] == 0.18


def test_spenza_mobile_text_free():
    r = node("const s=require('./js/spenza');console.log(JSON.stringify({m:s.MOBILE_TEXT_PRICE}))")
    assert r['m'] == 0
