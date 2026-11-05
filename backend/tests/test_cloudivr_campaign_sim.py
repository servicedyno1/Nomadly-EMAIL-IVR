# CloudIVR preview campaign simulator (dry-run): start/double-start, outcomes+stats, CSV, pause/resume, validateOnly,
# empty leads copy, scheduled auto-start via minute tick, daily repeat next run + stop-repeat, cancel of scheduled.
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
LEADS = '+14155550201,Ann\n+14155550202\n+14155550203\n+14155550204\n+14155550205'


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
    return {'caller': nums[0]['phoneNumber'], 'audio': audios[0]['id']}


def _create(s, ctx, **kw):
    body = {'name': 'TEST_sim', 'callerId': ctx['caller'], 'audioId': ctx['audio'], 'voicemailAudioId': ctx['audio'], 'leads': LEADS, 'mode': 'report_only'}
    body.update(kw)
    return s.post(f'{BASE}/campaigns', json=body)


def _get(s, cid):
    return s.get(f'{BASE}/campaigns/{cid}').json()['campaign']


def _wait(s, cid, status, secs):
    end = time.time() + secs
    while time.time() < end:
        c = _get(s, cid)
        if c['status'] == status:
            return c
        time.sleep(2)
    return _get(s, cid)


# validation
def test_empty_leads_message(s, ctx):
    r = _create(s, ctx, leads='')
    assert r.status_code == 400
    assert r.json().get('message', r.text).startswith('Add at least one number to call')


def test_validate_only_does_not_create(s, ctx):
    before = len(s.get(f'{BASE}/campaigns').json()['campaigns'])
    r = s.post(f'{BASE}/campaigns', json={'callerId': ctx['caller'], 'leads': LEADS, 'validateOnly': True, 'audioPending': True})
    assert r.status_code == 200 and r.json() == {'ok': True}
    assert len(s.get(f'{BASE}/campaigns').json()['campaigns']) == before


def test_validate_only_past_schedule_rejected(s, ctx):
    past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    r = s.post(f'{BASE}/campaigns', json={'callerId': ctx['caller'], 'leads': LEADS, 'validateOnly': True, 'audioPending': True, 'scheduledFor': past})
    assert r.status_code == 400


# simulator run
def test_start_simulates_and_completes(s, ctx):
    cid = _create(s, ctx).json()['campaign']['id']
    r = s.post(f'{BASE}/campaigns/{cid}/start')
    assert r.status_code == 202 and r.json()['dryRun'] is True
    r2 = s.post(f'{BASE}/campaigns/{cid}/start')
    assert r2.status_code == 400  # can't start twice
    c = _wait(s, cid, 'completed', 25)
    assert c['status'] == 'completed'
    st = c['stats']
    assert st['completed'] == 5 and st['answered'] == 3 and st['keyPressed'] == 1 and st['noAnswer'] == 1 and st['busy'] == 1
    assert st['voicemail'] == 1 and st['voicemailLeft'] == 1
    csv = s.get(f'{BASE}/campaigns/{cid}/report.csv')
    assert csv.status_code == 200 and 'machine (message left)' in csv.text
    assert s.post(f'{BASE}/campaigns/{cid}/start').status_code == 400


def test_pause_resume_in_sim(s, ctx):
    cid = _create(s, ctx).json()['campaign']['id']
    s.post(f'{BASE}/campaigns/{cid}/start')
    time.sleep(2)
    assert s.post(f'{BASE}/campaigns/{cid}/pause').status_code == 200
    time.sleep(3)
    c = _get(s, cid)
    assert c['status'] == 'paused'
    done = c['stats'].get('completed', 0)
    time.sleep(3)
    assert _get(s, cid)['stats'].get('completed', 0) == done  # no progress while paused
    assert s.post(f'{BASE}/campaigns/{cid}/resume').status_code == 202
    assert _wait(s, cid, 'completed', 25)['stats']['completed'] == 5


def test_cancel_scheduled(s, ctx):
    at = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    r = _create(s, ctx, scheduledFor=at)
    assert r.status_code == 201 and r.json()['campaign']['status'] == 'scheduled'
    cid = r.json()['campaign']['id']
    assert s.post(f'{BASE}/campaigns/{cid}/cancel').status_code == 200
    assert _get(s, cid)['status'] == 'cancelled'


# scheduled + repeat (waits for the minute tick)
def test_scheduled_daily_auto_starts_and_repeats(s, ctx):
    at = (datetime.now(timezone.utc) + timedelta(seconds=75)).replace(microsecond=0)
    r = _create(s, ctx, scheduledFor=at.isoformat(), repeat='daily', leads='+14155550211\n+14155550212')
    assert r.status_code == 201
    cid = r.json()['campaign']['id']
    c = _wait(s, cid, 'completed', 200)
    assert c['status'] == 'completed', c['status']
    nr = c.get('nextRun')
    assert nr and nr['status'] == 'scheduled'
    nxt = datetime.fromisoformat(nr['scheduledFor'].replace('Z', '+00:00'))
    assert abs((nxt - at).total_seconds() - 86400) < 5
    sr = s.post(f'{BASE}/campaigns/{cid}/stop-repeat')
    assert sr.status_code == 200
    assert _get(s, nr['id'])['status'] == 'cancelled'
