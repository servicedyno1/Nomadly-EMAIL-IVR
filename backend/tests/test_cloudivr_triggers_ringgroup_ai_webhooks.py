# CloudIVR: Text Triggers, Ring group, AI summaries, Webhooks feed, PWA assets, plan gating (iteration 135)
import os
import random
import time
import urllib.parse
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
BIZ = '+18582696527'
PRO = '+13465372632'
enc = lambda p: urllib.parse.quote(p, safe='')


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code} {r.text[:200]}")
    return s


@pytest.fixture(scope='module')
def alice():
    return login('civr.alice@example.com', 'AliceTest#2026')


@pytest.fixture(scope='module')
def bob():
    return login('civr.bob@example.com', 'BobTest#2026')


def rand_sender():
    return f"+1415555{random.randint(1000, 9999)}"


# ---------- Text Triggers ----------
class TestTextTriggers:
    def test_get_triggers(self, alice):
        r = alice.get(f"{API}/numbers/{enc(BIZ)}/text-triggers")
        assert r.status_code == 200, r.text
        d = r.json()
        tt = d['textTriggers']
        assert tt['enabled'] is True
        assert [x['action'] for x in tt['rules']][:3] == ['callback', 'message', 'ai']
        assert d['canAi'] is True and isinstance(d['agents'], list) and len(d['agents']) >= 1
        assert isinstance(d['runs'], list)

    def test_try_text_callback(self, alice):
        r = alice.post(f"{API}/numbers/{enc(BIZ)}/text-triggers/test", json={"from": rand_sender(), "text": "please call me"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['matched']['action'] == 'callback'
        assert d['status'] == 'preview'
        assert d['checks'][0]['result'] == 'match'

    def test_try_text_message(self, alice):
        r = alice.post(f"{API}/numbers/{enc(BIZ)}/text-triggers/test", json={"from": rand_sender(), "text": "what are your hours"})
        d = r.json()
        assert r.status_code == 200 and d['matched']['action'] == 'message', d
        assert d['checks'][0]['result'] == 'no_keyword'

    def test_try_text_bad_from(self, alice):
        r = alice.post(f"{API}/numbers/{enc(BIZ)}/text-triggers/test", json={"from": "abc", "text": "x"})
        assert r.status_code == 400

    def test_validation_errors(self, alice):
        cur = alice.get(f"{API}/numbers/{enc(BIZ)}/text-triggers").json()['textTriggers']
        bad_kw = {**cur, 'rules': [{'action': 'message', 'message': 'hi', 'keywordOnly': True, 'keywords': ''}]}
        r = alice.put(f"{API}/numbers/{enc(BIZ)}/text-triggers", json=bad_kw)
        assert r.status_code == 400 and 'keyword' in r.json()['message']
        r = alice.put(f"{API}/numbers/{enc(BIZ)}/text-triggers", json={**cur, 'myPhone': '', 'rules': [{'action': 'callback'}]})
        assert r.status_code == 400 and 'phone' in r.json()['message'].lower()
        r = alice.put(f"{API}/numbers/{enc(BIZ)}/text-triggers", json={**cur, 'rules': [{'action': 'message', 'message': ''}]})
        assert r.status_code == 400 and 'message' in r.json()['message']
        r = alice.put(f"{API}/numbers/{enc(BIZ)}/text-triggers", json={**cur, 'rules': [{'action': 'message', 'message': 'x'}] * 6})
        assert r.status_code == 400
        # unchanged
        after = alice.get(f"{API}/numbers/{enc(BIZ)}/text-triggers").json()['textTriggers']
        assert len(after['rules']) == len(cur['rules'])

    def test_put_roundtrip(self, alice):
        cur = alice.get(f"{API}/numbers/{enc(BIZ)}/text-triggers").json()['textTriggers']
        r = alice.put(f"{API}/numbers/{enc(BIZ)}/text-triggers", json=cur)
        assert r.status_code == 200, r.text
        assert [x['id'] for x in r.json()['textTriggers']['rules']] == [x['id'] for x in cur['rules']]

    def test_inbound_sms_records_run_and_hourly_limit(self, alice):
        sender = rand_sender()
        body = lambda t: {"data": {"event_type": "message.received", "id": f"t{random.random()}", "payload": {"id": f"m{random.random()}", "from": {"phone_number": sender}, "to": [{"phone_number": BIZ}], "text": t}}}
        r = requests.post(f"{BASE_URL}/api/telnyx/sms-webhook", json=body("please call me"))
        assert r.status_code == 200
        time.sleep(3)
        runs = alice.get(f"{API}/numbers/{enc(BIZ)}/text-triggers").json()['runs']
        mine = [x for x in runs if x['from'] == sender]
        assert mine and mine[0]['status'] == 'preview' and mine[0]['action'] == 'callback', runs[:3]
        r = requests.post(f"{BASE_URL}/api/telnyx/sms-webhook", json=body("call me again"))
        time.sleep(3)
        runs = alice.get(f"{API}/numbers/{enc(BIZ)}/text-triggers").json()['runs']
        mine = [x for x in runs if x['from'] == sender]
        assert len(mine) == 2 and mine[0]['status'] == 'skipped', mine


# ---------- Plan gating ----------
class TestPlanGating:
    def test_pro_ai_refused(self, alice):
        cur = alice.get(f"{API}/numbers/{enc(PRO)}/text-triggers")
        assert cur.status_code == 200, cur.text
        assert cur.json()['canAi'] is False
        r = alice.put(f"{API}/numbers/{enc(PRO)}/text-triggers", json={'enabled': False, 'myPhone': '+14155550111', 'rules': [{'action': 'ai', 'agentId': 'x'}]})
        assert r.status_code == 400 and 'Business' in r.json()['message']

    def test_bob_starter_403(self, bob):
        nums = bob.get(f"{API}/numbers").json()
        lst = nums.get('numbers', nums) if isinstance(nums, dict) else nums
        assert lst, nums
        p = enc(lst[0]['phoneNumber'])
        for method, path, body in [('put', 'text-triggers', {'rules': []}), ('put', 'ring-group', {'enabled': False}), ('patch', 'ai-summary', {'enabled': True})]:
            r = getattr(bob, method)(f"{API}/numbers/{p}/{path}", json=body)
            assert r.status_code == 403 and r.json()['error'] == 'plan_upgrade_required', (path, r.text)


# ---------- Ring group ----------
class TestRingGroup:
    def test_validation(self, alice):
        u = f"{API}/numbers/{enc(BIZ)}/ring-group"
        r = alice.put(u, json={'enabled': True, 'members': ['+14155550101'], 'fallback': 'voicemail'})
        assert r.status_code == 400 and 'at least 2' in r.json()['message']
        r = alice.put(u, json={'enabled': True, 'members': ['+14155550101', '+14155550102'], 'fallback': 'forward', 'fallbackTo': ''})
        assert r.status_code == 400
        r = alice.put(u, json={'enabled': True, 'members': ['+14155550101', '+14155550102'], 'fallback': 'forward', 'fallbackTo': '+14155550101'})
        assert r.status_code == 400 and 'already rings' in r.json()['message']
        r = alice.put(u, json={'enabled': True, 'members': [f'+1415555010{i}' for i in range(6)]})
        assert r.status_code == 400

    def test_save_and_route_summary(self, alice):
        u = f"{API}/numbers/{enc(BIZ)}/ring-group"
        body = {'enabled': True, 'members': ['+14155550101', '+14155550102'], 'ringTimeout': 25, 'fallback': 'forward', 'fallbackTo': '+14155550103'}
        r = alice.put(u, json=body)
        assert r.status_code == 200, r.text
        assert r.json()['ringGroup']['members'] == body['members']
        n = alice.get(f"{API}/numbers/{enc(BIZ)}").json()
        assert 'ring' in str(n).lower()


# ---------- AI summary ----------
class TestAiSummary:
    def test_toggle(self, alice):
        u = f"{API}/numbers/{enc(BIZ)}/ai-summary"
        r = alice.patch(u, json={'enabled': True})
        assert r.status_code == 200 and r.json()['aiSummary']['enabled'] is True and r.json()['rate'] == 0.1

    def test_summarize_bad_id(self, alice):
        r = alice.post(f"{API}/numbers/{enc(BIZ)}/logs/000000000000000000000000/summarize")
        assert r.status_code == 404
        r = alice.post(f"{API}/numbers/{enc(BIZ)}/logs/zzz/summarize")
        assert r.status_code == 404


# ---------- Webhooks ----------
class TestWebhooks:
    def test_get(self, alice):
        r = alice.get(f"{API}/webhooks")
        assert r.status_code == 200
        d = r.json()
        assert len(d['events']) == 5 and d['webhook']['url'] == 'https://httpbin.org/post'
        assert d['webhook']['secret'].startswith('whsec_')

    @pytest.mark.parametrize('url', ['http://httpbin.org/post', 'https://127.0.0.1/x', 'https://localhost/x', 'https://10.0.0.1/x', 'https://[::1]/x'])
    def test_bad_urls(self, alice, url):
        r = alice.put(f"{API}/webhooks", json={'enabled': True, 'url': url, 'events': ['call.ended']})
        assert r.status_code == 400 and 'https://' in r.json()['message'], (url, r.text)

    def test_no_events(self, alice):
        r = alice.put(f"{API}/webhooks", json={'enabled': True, 'url': 'https://httpbin.org/post', 'events': []})
        assert r.status_code == 400 and r.json()['error'] == 'no_events'

    def test_test_event(self, alice):
        r = alice.post(f"{API}/webhooks/test", json={'type': 'call.ended'})
        assert r.status_code == 200
        d = r.json()
        assert d['event']['type'] == 'call.ended'
        print('webhook test', d['ok'], d['status'], d['error'])


# ---------- PWA assets ----------
class TestPwa:
    def test_manifest(self):
        r = requests.get(f"{BASE_URL}/civr/manifest-prefixed.webmanifest")
        assert r.status_code == 200
        m = r.json()
        sizes = {i['sizes'] for i in m['icons']}
        assert '192x192' in sizes and '512x512' in sizes
        for i in m['icons']:
            src = i['src'] if i['src'].startswith('http') else f"{BASE_URL}{i['src'] if i['src'].startswith('/') else '/civr/' + i['src']}"
            ir = requests.get(src)
            assert ir.status_code == 200 and ir.headers.get('content-type', '').startswith('image'), src

    @pytest.mark.parametrize('path', ['/civr-ring-sw.js', '/civr/offline.html', '/civr/brand/icon-512.png', '/civr/brand/icon-maskable-512.png'])
    def test_assets(self, path):
        r = requests.get(f"{BASE_URL}{path}")
        assert r.status_code == 200 and 'text/html' not in r.headers.get('content-type', '') or path.endswith('.html'), (path, r.headers.get('content-type'))
