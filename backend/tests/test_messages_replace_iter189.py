# Iter189: unified Messages API, picture upload/serve, send/block rules, Replace number ($25) for calling numbers (Bob) and eSIM (Alice simulated).
# SAFE: never touches es_69fcb8db0c34 or Alice's +13346972125 replace; wallets restored; TEST_iter189 seed logs removed.
import os, io, time, struct, zlib, pytest, requests
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026', '5000000000000001')
BOB = ('civr.bob@example.com', 'BobTest#2026', '5000000000000002')
PROTECTED = 'es_69fcb8db0c34'
A_NUM, CA = '+13346972125', '+14165550188'
db = MongoClient('mongodb://localhost:27017')['test']
SEED = 'TEST_iter189'
STATE = {}


def bal(cid):
    w = db.walletOf.find_one({'_id': cid}) or {}
    return round((w.get('usdIn') or 0) - (w.get('usdOut') or 0), 4)


def png(w=4, h=4):
    raw = b''.join(b'\x00' + b'\xff\x00\x00' * w for _ in range(h))
    def ch(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b'')


def login(c):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": c[0], "password": c[1]})
    if r.status_code != 200:
        pytest.skip(f"login {c[0]} {r.status_code}")
    return s


@pytest.fixture(scope='module')
def alice():
    return login(ALICE)


@pytest.fixture(scope='module')
def bob():
    return login(BOB)


@pytest.fixture(scope='module', autouse=True)
def guard():
    wa, wb = db.walletOf.find_one({'_id': ALICE[2]}), db.walletOf.find_one({'_id': BOB[2]})
    now = datetime.now(timezone.utc)
    # seed: unknown contact that only received an outbound text (never contacted us) + a voicemail-only thread
    db.phoneLogs.insert_many([
        {'phoneNumber': A_NUM, 'from': '+14165550111', 'type': 'voicemail', 'duration': 9, 'transcript': 'TEST_zebra voicemail', 'timestamp': now.isoformat(), 'seed': SEED},
        {'phoneNumber': A_NUM, 'from': '+14165550111', 'to': A_NUM, 'type': 'sms', 'direction': 'inbound', 'body': 'TEST_zebra text', 'timestamp': (now - timedelta(minutes=1)).isoformat(), 'seed': SEED},
    ])
    yield
    db.phoneLogs.delete_many({'seed': SEED})
    db.webBlocked.delete_many({'contact': '+14165550111'})
    db.walletOf.update_one({'_id': ALICE[2]}, {'$set': {'usdIn': wa['usdIn'], 'usdOut': wa['usdOut']}})
    db.walletOf.update_one({'_id': BOB[2]}, {'$set': {'usdIn': wb['usdIn'], 'usdOut': wb['usdOut']}})


# ---- Messages list ----
def test_list_numbers_and_threads(alice):
    d = alice.get(f"{API}/messages").json()
    nums = {n['phone']: n for n in d['numbers']}
    assert nums[A_NUM]['kind'] == 'calling' and set(nums[A_NUM]['caps']) == {'send', 'receive', 'pictures', 'calls'}
    assert nums[A_NUM]['caps']['send'] is True
    assert any(n['kind'] == 'esim' for n in d['numbers'])
    ts = [t['at'] for t in d['threads']]
    assert ts == sorted(ts, reverse=True)
    t = next(t for t in d['threads'] if t['contact'] == '+14165550111')
    assert t['unread'] is True and t['has']['voicemail']
    assert isinstance(d['unread'], int) and d['unread'] >= 1


@pytest.mark.parametrize('f,key', [('voicemail', 'voicemail'), ('missed', 'missed'), ('texts', 'texts')])
def test_filters(alice, f, key):
    th = alice.get(f"{API}/messages", params={'filter': f}).json()['threads']
    assert th and all(t['has'][key] for t in th)


def test_filter_unread_and_search(alice):
    th = alice.get(f"{API}/messages", params={'filter': 'unread'}).json()['threads']
    assert th and all(t['unread'] for t in th)
    q = alice.get(f"{API}/messages", params={'q': 'TEST_zebra'}).json()['threads']
    assert [t['contact'] for t in q] == ['+14165550111']
    q2 = alice.get(f"{API}/messages", params={'q': '5550111'}).json()['threads']
    assert any(t['contact'] == '+14165550111' for t in q2)


# ---- Thread + read ----
def test_thread_and_mark_read(alice):
    t = alice.get(f"{API}/messages/thread", params={'number': A_NUM, 'contact': CA}).json()
    assert t['replyFrom'] == A_NUM and t['canText'] is True and t['maxLength'] == 160 and 'each' in t['cost']
    ats = [e['at'] for e in t['events']]
    assert ats == sorted(ats) and all(e['kind'] in ('text', 'voicemail', 'call') for e in t['events'])
    before = alice.get(f"{API}/dashboard").json()['messagesUnread']
    r = alice.post(f"{API}/messages/read", json={'number': A_NUM, 'contact': '+14165550111'})
    assert r.status_code == 200
    after = alice.get(f"{API}/dashboard").json()['messagesUnread']
    assert after == before - 1
    t2 = next(t for t in alice.get(f"{API}/messages").json()['threads'] if t['contact'] == '+14165550111')
    assert t2['unread'] is False


def test_thread_404(alice):
    assert alice.get(f"{API}/messages/thread", params={'number': '+19999999999', 'contact': CA}).status_code == 404


# ---- Media ----
def test_media_upload_serve_and_send(alice):
    r = alice.post(f"{API}/messages/media", files={'file': ('t.png', png(), 'image/png')})
    assert r.status_code in (200, 201), r.text
    mid = r.json()['id']
    g = requests.get(f"{API}/public/media/{mid}")
    assert g.status_code == 200 and g.headers['content-type'].startswith('image/png') and g.content[:4] == b'\x89PNG'
    s = alice.post(f"{API}/messages/send", json={'number': A_NUM, 'contact': CA, 'text': 'TEST_iter189 pic', 'media': [mid]})
    assert s.status_code == 200, s.text
    ev = s.json()['event']
    assert ev['media'][0]['id'] == mid and ev['out'] is True
    STATE['sent_id'] = ev['id']
    log = db.phoneLogs.find_one({'body': 'TEST_iter189 pic', 'phoneNumber': A_NUM})
    assert log and log['media'][0]['id'] == mid
    db.phoneLogs.update_one({'_id': log['_id']}, {'$set': {'seed': SEED}})


def test_media_bad_type_and_too_big(alice):
    assert alice.post(f"{API}/messages/media", files={'file': ('t.txt', b'hello', 'text/plain')}).status_code == 400
    assert alice.post(f"{API}/messages/media", files={'file': ('b.png', b'\x89PNG' + b'0' * (601 * 1024), 'image/png')}).status_code == 400
    assert requests.get(f"{API}/public/media/{'0' * 32}").status_code == 404


def test_send_not_contacted(alice):
    r = alice.post(f"{API}/messages/send", json={'number': A_NUM, 'contact': '+14165550123', 'text': 'hi'})
    assert r.status_code == 400 and r.json()['error'] == 'not_contacted'


def test_block_toggle_and_refuse(alice):
    r = alice.post(f"{API}/messages/block", json={'contact': '+14165550111', 'on': True})
    assert r.json() == {'blocked': True}
    assert alice.get(f"{API}/messages/thread", params={'number': A_NUM, 'contact': '+14165550111'}).json()['blocked'] is True
    s = alice.post(f"{API}/messages/send", json={'number': A_NUM, 'contact': '+14165550111', 'text': 'hi'})
    assert s.status_code == 400 and s.json()['error'] == 'blocked'
    assert alice.post(f"{API}/messages/block", json={'contact': '+14165550111', 'on': False}).json() == {'blocked': False}
    assert alice.get(f"{API}/messages/thread", params={'number': A_NUM, 'contact': '+14165550111'}).json()['blocked'] is False


def test_esim_thread_rejects_media(alice):
    line = db.esimLines.find_one({'chatId': ALICE[2], 'status': 'active', 'simulated': True})
    db.phoneLogs.insert_one({'phoneNumber': line['phoneNumber'], 'from': CA, 'to': line['phoneNumber'], 'type': 'sms', 'direction': 'inbound', 'body': 'TEST esim in', 'timestamp': datetime.now(timezone.utc).isoformat(), 'seed': SEED})
    t = alice.get(f"{API}/messages/thread", params={'number': line['phoneNumber'], 'contact': CA}).json()
    assert t['maxLength'] == 1000 and t['number']['caps']['pictures'] is False
    mid = alice.post(f"{API}/messages/media", files={'file': ('t.png', png(), 'image/png')}).json()['id']
    s = alice.post(f"{API}/messages/send", json={'number': line['phoneNumber'], 'contact': CA, 'text': 'x', 'media': [mid]})
    assert s.status_code == 400 and s.json()['error'] == 'no_mms'


# ---- Replace calling number (Bob) ----
@pytest.fixture(scope='module')
def bob_num(bob):
    s = bob.get(f"{API}/numbers/search", params={'country': 'US', 'type': 'local'}).json()['numbers']
    r = bob.post(f"{API}/numbers/buy", json={'phoneNumber': s[0]['phoneNumber'], 'plan': 'starter'})
    assert r.status_code in (200, 201), r.text
    return s[0]['phoneNumber']


def test_replace_search_again(bob, bob_num):
    r = bob.post(f"{API}/numbers/{bob_num}/replace", json={'phoneNumber': '+12025550000'})
    assert r.status_code == 400 and r.json()['error'] == 'search_again'


def test_replace_low_wallet_402(bob, bob_num):
    w = db.walletOf.find_one({'_id': BOB[2]})
    s = bob.get(f"{API}/numbers/search", params={'country': 'US', 'type': 'local'}).json()['numbers']
    db.walletOf.update_one({'_id': BOB[2]}, {'$set': {'usdOut': w['usdIn'] - 10}})
    try:
        r = bob.post(f"{API}/numbers/{bob_num}/replace", json={'phoneNumber': s[0]['phoneNumber']})
        assert r.status_code == 402 and r.json()['error'] == 'insufficient_balance'
    finally:
        db.walletOf.update_one({'_id': BOB[2]}, {'$set': {'usdIn': w['usdIn'], 'usdOut': w['usdOut']}})


def test_replace_success_and_twice(bob, bob_num):
    old = next(n for n in db.phoneNumbersOf.find_one({'_id': BOB[2]})['val']['numbers'] if n['phoneNumber'] == bob_num)
    s = bob.get(f"{API}/numbers/search", params={'country': 'US', 'type': 'local'}).json()['numbers']
    b0 = bal(BOB[2])
    r = bob.post(f"{API}/numbers/{bob_num}/replace", json={'phoneNumber': s[0]['phoneNumber']})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d['charged'] == 25 and abs(bal(BOB[2]) - (b0 - 25)) < 0.01
    nums = db.phoneNumbersOf.find_one({'_id': BOB[2]})['val']['numbers']
    new = next(n for n in nums if n['phoneNumber'] == s[0]['phoneNumber'])
    o = next(n for n in nums if n['phoneNumber'] == bob_num)
    assert new['plan'] == old['plan'] and new.get('expiresAt') == old.get('expiresAt') and new['replaces'] == bob_num
    assert o['replacedBy'] == new['phoneNumber'] and o['autoRenew'] is False
    rel = datetime.fromisoformat(o['releaseAt'].replace('Z', '+00:00'))
    assert timedelta(days=6.9) < rel - datetime.now(timezone.utc) < timedelta(days=7.1)
    s2 = bob.get(f"{API}/numbers/search", params={'country': 'US', 'type': 'local'}).json()['numbers']
    r2 = bob.post(f"{API}/numbers/{bob_num}/replace", json={'phoneNumber': s2[0]['phoneNumber']})
    assert r2.status_code == 409 and r2.json()['error'] == 'already_replaced'
    # messages list shows old
    m = {n['phone']: n for n in bob.get(f"{API}/messages").json()['numbers']}
    assert m[bob_num]['old']['newNumber'] == new['phoneNumber'] and m[bob_num]['caps']['send'] is False
    STATE['bob_old'], STATE['bob_new'] = bob_num, new['phoneNumber']


# ---- eSIM replace (Alice simulated line) ----
def test_esim_replace_number(alice):
    line = db.esimLines.find_one({'chatId': ALICE[2], 'status': 'active', 'simulated': True, '_id': {'$ne': PROTECTED}, 'numberChange': None})
    if not line:
        pytest.skip('no fresh simulated line')
    assert line['_id'] != PROTECTED
    b0 = bal(ALICE[2])
    r = alice.post(f"{API}/esim/{line['_id']}/replace-number")
    assert r.status_code == 200, r.text
    assert r.json()['item']['numberChange']['status'] == 'pending' and abs(bal(ALICE[2]) - (b0 - 25)) < 0.01
    r2 = alice.post(f"{API}/esim/{line['_id']}/replace-number")
    assert r2.status_code >= 400
    it = None
    for _ in range(20):
        time.sleep(3)
        it = next(x for x in alice.get(f"{API}/esim").json()['items'] if x['id'] == line['_id'])
        if it['numberChange']['status'] == 'done':
            break
    assert it['numberChange']['status'] == 'done' and it['phoneNumber'].startswith('+1555') and line['phoneNumber'] in it['formerNumbers']
    m = {n['phone']: n for n in alice.get(f"{API}/messages").json()['numbers']}
    assert m[line['phoneNumber']]['old']['newNumber'] == it['phoneNumber']
    STATE['esim'] = line['_id']
