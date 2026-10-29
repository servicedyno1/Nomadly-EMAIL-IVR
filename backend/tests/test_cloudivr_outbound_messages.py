# CloudIVR outbound regression: Quick IVR, Bulk campaigns (now / scheduled / repeat / cancel), IVR keypad message, SMS (dry-run preview)
import os
import time
from datetime import datetime, timedelta, timezone
import pytest
import requests

def _base():
    url = os.environ.get('REACT_APP_BACKEND_URL')
    if not url:
        for line in open('/app/frontend/.env'):
            if line.startswith('REACT_APP_BACKEND_URL='):
                url = line.split('=', 1)[1].strip()
    return url.rstrip('/') + '/api/cloudivr-web'

BASE = _base()
LEADS = '+12025550123\n+12025550124\n+12025550125'


@pytest.fixture(scope='module')
def s():
    ses = requests.Session()
    r = ses.post(f'{BASE}/auth/login', json={'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'})
    if r.status_code != 200:
        pytest.skip('login failed')
    return ses


@pytest.fixture(scope='module')
def ctx(s):
    nums = [n for n in s.get(f'{BASE}/numbers').json()['numbers'] if n['status'] == 'active']
    audios = s.get(f'{BASE}/audio').json()['audios']
    assert nums and audios
    data = {'caller': nums[0]['phoneNumber'], 'audio': audios[0]['id'], 'created': []}
    yield data
    for cid in data['created']:
        s.post(f'{BASE}/campaigns/{cid}/cancel')


# Quick IVR
def test_quick_call_script_dry_run(s, ctx):
    r = s.post(f'{BASE}/calls/quick', json={'callerId': ctx['caller'], 'targets': '+12025550123', 'text': 'Hello, press 1 to talk to us.', 'mode': 'transfer', 'transferTo': '+14155550199', 'activeKeys': ['1']})
    assert r.status_code == 202, r.text
    d = r.json()
    assert d['dryRun'] is True and d['count'] == 1


def test_quick_call_audio_menu_dry_run(s, ctx):
    r = s.post(f'{BASE}/calls/quick', json={'callerId': ctx['caller'], 'targets': '+12025550123', 'audioId': ctx['audio'], 'mode': 'transfer', 'menu': {'1': {'action': 'forward', 'forwardTo': '+14155550199'}, '2': {'action': 'message', 'message': 'Bye'}}})
    assert r.status_code == 202, r.text


def test_quick_call_menu_missing_forward_validation(s, ctx):
    r = s.post(f'{BASE}/calls/quick', json={'callerId': ctx['caller'], 'targets': '+12025550123', 'audioId': ctx['audio'], 'mode': 'transfer', 'menu': {'1': {'action': 'forward'}}})
    assert r.status_code == 400


def test_quick_call_history_lists_call(s):
    r = s.get(f'{BASE}/calls/history')
    assert r.status_code == 200
    calls = r.json().get('calls', [])
    assert any('+12025550123' in (c.get('targets') or []) for c in calls)


def test_quick_call_schedule_and_cancel(s, ctx):
    at = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    r = s.post(f'{BASE}/calls/quick', json={'callerId': ctx['caller'], 'targets': '+12025550124', 'text': 'Hello there', 'mode': 'transfer', 'transferTo': '+14155550199', 'scheduleAt': at})
    assert r.status_code == 201, r.text
    lst = s.get(f'{BASE}/calls/scheduled').json()['calls']
    mine = [c for c in lst if '+12025550124' in str(c)]
    assert mine
    assert s.delete(f"{BASE}/calls/scheduled/{mine[0]['id']}").status_code == 200


# Bulk campaigns
def test_campaign_create_now_and_start(s, ctx):
    r = s.post(f'{BASE}/campaigns', json={'name': 'TEST_api now', 'callerId': ctx['caller'], 'audioId': ctx['audio'], 'leads': LEADS, 'mode': 'report_only', 'activeKeys': ['1'], 'concurrency': 3})
    assert r.status_code == 201, r.text
    c = r.json()['campaign']
    ctx['created'].append(c['id'])
    assert c['status'] == 'created' and c['stats']['total'] == 3
    st = s.post(f"{BASE}/campaigns/{c['id']}/start")
    assert st.status_code in (200, 202)
    got = s.get(f"{BASE}/campaigns/{c['id']}").json()['campaign']
    # In dry-run the preview simulator runs it (iteration 177+)
    assert got['status'] in ('running', 'completed')


def test_campaign_scheduled_in_preview(s, ctx):
    at = (datetime.now(timezone.utc) + timedelta(minutes=4)).isoformat()
    r = s.post(f'{BASE}/campaigns', json={'name': 'TEST_api sched', 'callerId': ctx['caller'], 'audioId': ctx['audio'], 'leads': LEADS, 'scheduledFor': at})
    # Scheduling is allowed in preview since iteration 177 (simulated launcher)
    assert r.status_code == 201, r.text
    c = r.json()['campaign']
    ctx['created'].append(c['id'])
    assert c['status'] == 'scheduled'


def test_campaign_repeat_without_schedule_stop_repeat(s, ctx):
    r = s.post(f'{BASE}/campaigns', json={'name': 'TEST_api repeat', 'callerId': ctx['caller'], 'audioId': ctx['audio'], 'leads': LEADS, 'repeat': 'daily', 'tz': 'UTC'})
    assert r.status_code == 201, r.text
    c = r.json()['campaign']
    ctx['created'].append(c['id'])
    assert c['repeat'] == 'daily'
    sr = s.post(f"{BASE}/campaigns/{c['id']}/stop-repeat")
    assert sr.status_code == 200, sr.text


def test_campaign_cancel(s, ctx):
    r = s.post(f'{BASE}/campaigns', json={'name': 'TEST_api cancel', 'callerId': ctx['caller'], 'audioId': ctx['audio'], 'leads': LEADS})
    cid = r.json()['campaign']['id']
    x = s.post(f'{BASE}/campaigns/{cid}/cancel')
    assert x.status_code == 200
    assert s.get(f'{BASE}/campaigns/{cid}').json()['campaign']['status'] == 'cancelled'


def test_campaign_no_audio_validation(s, ctx):
    r = s.post(f'{BASE}/campaigns', json={'callerId': ctx['caller'], 'leads': LEADS})
    assert r.status_code == 400 and 'invalid_audio' in r.text
