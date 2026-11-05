# Iter190: Messages extras — contact notes/tags, scheduled texts (worker send + failure notice), AI thread summary.
# SAFE: restores +14165550188 notes/tags, wallet; TEST_iter190 seed logs removed. Never touches es_69fcb8db0c34.
import os, time, pytest, requests
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026', '5000000000000001')
A_NUM, CA, US = '+13346972125', '+14165550188', '+15125550199'
db = MongoClient('mongodb://localhost:27017')['test']
SEED = 'TEST_iter190'
STATE = {}


def bal(cid):
    w = db.walletOf.find_one({'_id': cid}) or {}
    return round((w.get('usdIn') or 0) - (w.get('usdOut') or 0), 4)


def iso(sec):
    return (datetime.now(timezone.utc) + timedelta(seconds=sec)).isoformat().replace('+00:00', 'Z')


@pytest.fixture(scope='module')
def s():
    x = requests.Session()
    r = x.post(f"{API}/auth/login", json={"email": ALICE[0], "password": ALICE[1]})
    if r.status_code != 200:
        pytest.skip(f"login {r.status_code}")
    return x


@pytest.fixture(scope='module', autouse=True)
def guard():
    m = db.webThreadMeta.find_one({'_id': f"{ALICE[2]}|{CA}"})
    w = db.walletOf.find_one({'_id': ALICE[2]})
    yield
    if m:
        db.webThreadMeta.update_one({'_id': m['_id']}, {'$set': {'notes': m.get('notes', ''), 'tags': m.get('tags', [])}})
    db.webThreadMeta.delete_many({'contact': '+19995550190'})
    db.phoneLogs.delete_many({'seed': SEED})
    db.phoneLogs.delete_many({'body': {'$regex': '^TEST_iter190'}})
    db.webScheduledTexts.delete_many({'text': {'$regex': '^TEST_iter190'}})
    db.walletOf.update_one({'_id': ALICE[2]}, {'$set': {'usdIn': w['usdIn'], 'usdOut': w['usdOut']}})


def thread(s, contact, number=A_NUM):
    r = s.get(f"{API}/messages/thread", params={'number': number, 'contact': contact})
    assert r.status_code == 200, r.text
    return r.json()


# --- Auth
def test_unauth_401():
    for m, p in [('put', '/messages/contact'), ('post', '/messages/schedule'), ('delete', '/messages/schedule/x')]:
        assert getattr(requests, m)(f"{API}{p}", json={}).status_code == 401


# --- Contact notes + tags
def test_contact_meta_save_and_clean(s):
    tags = ['  VIP  ', 'VIP', 'x' * 40] + [f"T{i}" for i in range(15)]
    r = s.put(f"{API}/messages/contact", json={'contact': CA, 'notes': 'Wants Friday delivery TEST_kiwi', 'tags': tags})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d['tags'][0] == 'VIP' and d['tags'].count('VIP') == 1
    assert d['tags'][1] == 'x' * 24
    assert len(d['tags']) == 10
    t = thread(s, CA)
    assert t['notes'] == 'Wants Friday delivery TEST_kiwi' and t['tags'] == d['tags']
    assert 'VIP' in t['allTags']


def test_contact_meta_requires_contact(s):
    r = s.put(f"{API}/messages/contact", json={'notes': 'x'})
    assert r.status_code == 400


def test_list_tags_filter_and_search(s):
    s.put(f"{API}/messages/contact", json={'contact': CA, 'notes': 'Wants Friday delivery TEST_kiwi', 'tags': ['Lead', 'Toronto']})
    d = s.get(f"{API}/messages").json()
    assert 'Lead' in d['allTags']
    ca = [t for t in d['threads'] if t['contact'] == CA]
    assert ca and ca[0]['tags'] == ['Lead', 'Toronto']
    f = s.get(f"{API}/messages", params={'tag': 'Lead'}).json()['threads']
    assert f and all('Lead' in t['tags'] for t in f)
    assert all(t['contact'] != US for t in f)
    n = s.get(f"{API}/messages", params={'q': 'test_kiwi'}).json()['threads']
    assert any(t['contact'] == CA for t in n)
    g = s.get(f"{API}/messages", params={'q': 'toronto'}).json()['threads']
    assert any(t['contact'] == CA for t in g)


def test_tag_filter_combined_with_note_search(s):
    # ?tag must still apply when q matches by notes/tags of another contact
    s.put(f"{API}/messages/contact", json={'contact': US, 'notes': 'TEST_kiwi too', 'tags': ['Other190']})
    try:
        f = s.get(f"{API}/messages", params={'tag': 'Lead', 'q': 'test_kiwi'}).json()['threads']
        assert all('Lead' in t['tags'] for t in f), [t['contact'] for t in f]
    finally:
        s.put(f"{API}/messages/contact", json={'contact': US, 'notes': '', 'tags': []})


# --- Scheduled texts validation
@pytest.mark.parametrize('body,msg', [
    ({'sendAt': iso(5)}, 'minute'),
    ({'sendAt': iso(91 * 86400)}, '90 days'),
    ({'sendAt': 'garbage'}, 'minute'),
    ({'sendAt': iso(300), 'text': ''}, 'Type'),
    ({'sendAt': iso(300), 'text': 'x' * 2000}, 'characters'),
])
def test_schedule_validation(s, body, msg):
    p = {'number': A_NUM, 'contact': CA, 'text': 'hi', **body}
    r = s.post(f"{API}/messages/schedule", json=p)
    assert r.status_code == 400 and msg in r.json()['message'], r.text


def test_schedule_unknown_thread(s):
    r = s.post(f"{API}/messages/schedule", json={'number': A_NUM, 'contact': '+19995550190', 'text': 'hi', 'sendAt': iso(300)})
    assert r.status_code == 400, r.text


def test_schedule_and_cancel(s):
    r = s.post(f"{API}/messages/schedule", json={'number': A_NUM, 'contact': CA, 'text': 'TEST_iter190 cancel me', 'sendAt': iso(3600)})
    assert r.status_code == 200, r.text
    it = r.json()['item']
    assert it['status'] == 'scheduled' and it['id'].startswith('st_')
    assert any(x['id'] == it['id'] for x in thread(s, CA)['scheduled'])
    assert s.delete(f"{API}/messages/schedule/{it['id']}").status_code == 200
    assert not any(x['id'] == it['id'] for x in thread(s, CA)['scheduled'])
    assert s.delete(f"{API}/messages/schedule/{it['id']}").status_code == 400


def test_worker_sends_and_fails(s):
    before = bal(ALICE[2])
    n0 = db.webNotifications.count_documents({'chatId': ALICE[2]}) if 'webNotifications' in db.list_collection_names() else 0
    ok = s.post(f"{API}/messages/schedule", json={'number': A_NUM, 'contact': CA, 'text': 'TEST_iter190 scheduled ok', 'sendAt': iso(65)})
    bad = s.post(f"{API}/messages/schedule", json={'number': A_NUM, 'contact': US, 'text': 'TEST_iter190 scheduled fail', 'sendAt': iso(65)})
    assert ok.status_code == 200 and bad.status_code == 200, (ok.text, bad.text)
    oid, bid = ok.json()['item']['id'], bad.json()['item']['id']
    deadline = time.time() + 120
    while time.time() < deadline:
        a, b = db.webScheduledTexts.find_one({'_id': oid}), db.webScheduledTexts.find_one({'_id': bid})
        if a['status'] in ('sent', 'failed') and b['status'] in ('sent', 'failed'):
            break
        time.sleep(5)
    a, b = db.webScheduledTexts.find_one({'_id': oid}), db.webScheduledTexts.find_one({'_id': bid})
    STATE['sched'] = (a, b, before, n0)
    assert a['status'] == 'sent', a
    assert any(e['kind'] == 'text' and e['out'] and e['body'] == 'TEST_iter190 scheduled ok' for e in thread(s, CA)['events'])
    assert b['status'] == 'failed' and b.get('error'), b
    tf = thread(s, US)
    assert any(x['id'] == bid and x['status'] == 'failed' and x['error'] for x in tf['scheduled'])
    notes = list(db.webNotifications.find({'chatId': ALICE[2], 'meta.scheduled': bid}))
    assert notes and notes[0].get('kind') == 'sms', notes


def test_failed_schedule_not_charged():
    if 'sched' not in STATE:
        pytest.skip('worker test did not run')
    a, b, before, _ = STATE['sched']
    # failed text must not charge; the CA send may use plan texts (0) or overage
    ok_charge = db.phoneLogs.find_one({'phoneNumber': A_NUM, 'to': CA, 'body': 'TEST_iter190 scheduled ok'}) or {}
    assert round(before - (ok_charge.get('charge') or 0), 4) == bal(ALICE[2])
    assert not db.phoneLogs.find_one({'to': US, 'body': 'TEST_iter190 scheduled fail', 'charge': {'$gt': 0}})


# --- AI summary
def test_ai_summary_long_thread(s):
    t = thread(s, CA)
    assert len(t['events']) >= 10
    for _ in range(8):
        if t['ai'] and t['ai']['summary']:
            break
        time.sleep(5)
        t = thread(s, CA)
    ai = t['ai']
    assert ai and isinstance(ai['summary'], str) and len(ai['summary']) > 20
    assert isinstance(ai['replies'], list) and 1 <= len(ai['replies']) <= 3
    assert all(len(x) <= 160 for x in ai['replies'])
    assert 'updating' in ai


def test_ai_null_short_thread(s):
    now = datetime.now(timezone.utc)
    db.phoneLogs.insert_one({'phoneNumber': A_NUM, 'from': '+14165550190', 'to': A_NUM, 'type': 'sms', 'direction': 'inbound', 'body': 'TEST_iter190 short', 'timestamp': now.isoformat(), 'seed': SEED})
    t = thread(s, '+14165550190')
    assert t['ai'] is None and t['scheduled'] == [] and t['tags'] == [] and t['notes'] == ''


def test_ai_no_replies_when_cannot_text(s):
    # 10+ events from a contact who only received outbound texts → canText false → no suggested replies
    now = datetime.now(timezone.utc)
    db.phoneLogs.insert_many([{'phoneNumber': A_NUM, 'from': A_NUM, 'to': '+14165550191', 'type': 'sms_out', 'body': f'TEST_iter190 promo {i}: our bakery opens at 9 tomorrow', 'timestamp': (now - timedelta(minutes=20 - i)).isoformat(), 'seed': SEED} for i in range(11)])
    t = thread(s, '+14165550191')
    assert t['canText'] is False
    for _ in range(8):
        if t['ai'] and t['ai']['summary']:
            break
        time.sleep(5)
        t = thread(s, '+14165550191')
    assert t['ai'] and t['ai']['summary'], t['ai']
    assert t['ai']['replies'] == []
    db.webThreadSummaries.delete_many({'_id': {'$regex': r'\+14165550191$'}})
