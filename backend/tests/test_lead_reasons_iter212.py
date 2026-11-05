# iter212 — specific lead-error reasons (pasted campaign leads, saved contact lists, manual contact add) + blocked prefix
import os
import datetime
import subprocess
import json
import pytest
import requests

BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]).rstrip('/')
API = f'{BASE_URL}/api/cloudivr-web'
GOOD = '+17072206410'
NO_ONE = '+7072206410'
MISSING = '+1707220640'
CREATED = {'contacts': [], 'lists': [], 'campaigns': [], 'mongo': []}


def mongo(js):
    out = subprocess.run(['mongosh', '--quiet', 'test', '--eval', js], capture_output=True, text=True, timeout=30)
    return out.stdout.strip()


@pytest.fixture(scope='module')
def alice():
    s = requests.Session()
    r = s.post(f'{API}/auth/login', json={'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f'login failed {r.status_code}')
    yield s
    for cid in CREATED['campaigns']:
        s.post(f'{API}/campaigns/{cid}/cancel', timeout=20)
    for cid in CREATED['contacts']:
        s.delete(f'{API}/contacts/{cid}', timeout=20)
    for lid in CREATED['lists']:
        s.delete(f'{API}/contacts/lists/{lid}', timeout=20)
    for mid in CREATED['mongo']:
        mongo(f"db.webContacts.deleteOne({{_id: '{mid}'}})")


@pytest.fixture(scope='module')
def num(alice):
    act = [n for n in alice.get(f'{API}/numbers', timeout=20).json()['numbers'] if n.get('status') == 'active' and n.get('plan') in ('pro', 'business')]
    if not act:
        pytest.skip('no active pro/business number')
    return act[0]['phoneNumber']


@pytest.fixture(scope='module')
def audio_id(alice):
    a = alice.get(f'{API}/audio', timeout=20).json().get('audios') or []
    if not a:
        pytest.skip('no audio')
    return a[0]['id']


# Blocked premium/satellite prefix answers blocked_destination (not the '+1' suggestion)
def test_quick_ivr_blocked_prefix(alice, num):
    r = alice.post(f'{API}/calls/quick', json={'callerId': num, 'targets': '+8816123456', 'text': 'Hi', 'transferTo': '+14155550199'}, timeout=20)
    assert r.status_code == 400 and r.json()['error'] == 'blocked_destination', r.text
    assert 'Did you mean' not in r.json()['message']


# Pasted leads: estimate lists specific reasons
def test_estimate_specific_reasons(alice):
    r = alice.post(f'{API}/campaigns/estimate', json={'leads': f'{GOOD},Ann\n{NO_ONE}\n{MISSING}'}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d['count'] == 1
    assert d['errors'][0] == f'Line 2: {NO_ONE} looks like a USA number missing the 1. Did you mean +17072206410?'
    assert d['errors'][1].startswith(f'Line 3: {MISSING} is missing a digit')


# Pasted leads: create campaign returns 400 invalid_leads with the specific reasons
def test_campaign_create_invalid_leads(alice, num, audio_id):
    for extra in ({}, {'validateOnly': True}):
        r = alice.post(f'{API}/campaigns', json={'callerId': num, 'audioId': audio_id, 'name': 'TEST_iter212', 'leads': f'{GOOD}\n{NO_ONE}\n{MISSING}', **extra}, timeout=20)
        assert r.status_code == 400 and r.json()['error'] == 'invalid_leads', r.text
        m = r.json()['message']
        assert m.startswith('2 numbers need fixing'), m
        assert 'Did you mean +17072206410?' in m and 'is missing a digit' in m


# Manual contact add shows the specific reason
def test_contact_add_specific_reason(alice):
    r = alice.post(f'{API}/contacts', json={'phone': NO_ONE, 'name': 'TEST_bad'}, timeout=20)
    assert r.status_code == 400 and r.json()['error'] == 'invalid_contact', r.text
    assert r.json()['message'] == f'{NO_ONE} looks like a USA number missing the 1. Did you mean +17072206410?'
    r = alice.post(f'{API}/contacts', json={'phone': '+170722064100', 'name': 'TEST_bad'}, timeout=20)
    assert r.status_code == 400 and 'extra digit' in r.json()['message'], r.text


# Saved list with a legacy bad contact: estimate reports it, campaign starts with the valid ones
def test_list_leads_skip_legacy_bad(alice, num, audio_id):
    lst = alice.post(f'{API}/contacts/lists', json={'name': 'TEST_iter212_list'}, timeout=20)
    assert lst.status_code == 201, lst.text
    lid = lst.json()['list']['id']
    CREATED['lists'].append(lid)
    import random
    good_phone = f'+1415555{random.randint(2000, 9999)}'
    c = alice.post(f'{API}/contacts', json={'phone': good_phone, 'name': 'TEST_good', 'listIds': [lid]}, timeout=20)
    if c.status_code == 409:
        pytest.skip('contact already exists')
    assert c.status_code == 201, c.text
    CREATED['contacts'].append(c.json()['contact']['id'])
    chat = mongo(f"print(db.webContactLists.findOne({{_id: '{lid}'}}).chatId)")
    assert chat, 'list not in Mongo test db'
    mid = 'TEST_iter212_legacy'
    mongo(f"db.webContacts.insertOne({{_id: '{mid}', chatId: '{chat}', phone: '{NO_ONE}', name: 'TEST_legacy', email: '', company: '', notes: '', fields: [], listIds: ['{lid}'], source: 'manual', createdAt: new Date(), updatedAt: new Date()}})")
    CREATED['mongo'].append(mid)

    e = alice.post(f'{API}/campaigns/estimate', json={'listId': lid}, timeout=20)
    assert e.status_code == 200, e.text
    d = e.json()
    assert d['count'] == 1, d
    assert d['errors'] == [f'TEST_legacy: {NO_ONE} looks like a USA number missing the 1. Did you mean +17072206410?'], d['errors']

    v = alice.post(f'{API}/campaigns', json={'callerId': num, 'audioId': audio_id, 'name': 'TEST_iter212', 'listId': lid, 'validateOnly': True}, timeout=20)
    assert v.status_code == 200 and v.json().get('ok') is True, v.text

    when = (datetime.datetime.utcnow() + datetime.timedelta(days=2)).isoformat() + 'Z'
    r = alice.post(f'{API}/campaigns', json={'callerId': num, 'audioId': audio_id, 'name': 'TEST_iter212', 'listId': lid, 'scheduledFor': when}, timeout=20)
    assert r.status_code == 201, r.text
    camp = r.json()['campaign']
    CREATED['campaigns'].append(camp['id'])
    assert r.json()['skipped'] == 1
    g = alice.get(f'{API}/campaigns/{camp["id"]}', timeout=20).json()
    blob = json.dumps(g)
    assert good_phone in blob and NO_ONE not in blob.replace('+17072206410', ''), blob[:500]


# List with only bad contacts → no_leads with the reason
def test_list_all_bad(alice):
    lst = alice.post(f'{API}/contacts/lists', json={'name': 'TEST_iter212_bad'}, timeout=20)
    lid = lst.json()['list']['id']
    CREATED['lists'].append(lid)
    chat = mongo(f"print(db.webContactLists.findOne({{_id: '{lid}'}}).chatId)")
    mid = 'TEST_iter212_legacy2'
    mongo(f"db.webContacts.insertOne({{_id: '{mid}', chatId: '{chat}', phone: '{MISSING}', name: '', listIds: ['{lid}'], createdAt: new Date()}})")
    CREATED['mongo'].append(mid)
    e = alice.post(f'{API}/campaigns/estimate', json={'listId': lid}, timeout=20).json()
    assert e['count'] == 0 and e['errors'][0].startswith(f'{MISSING} is missing a digit'), e
