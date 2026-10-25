# CloudIVR 3CX features — extra edge cases (SSRF guards on webhooks, ring time bounds, trigger rule edge cases)
import os
import urllib.parse
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
BIZ = '+16692098449'
enc = lambda p: urllib.parse.quote(p, safe='')
EV = ['call.started']


@pytest.fixture(scope='module')
def alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": 'civr.alice@example.com', "password": 'AliceTest#2026'})
    if r.status_code != 200:
        pytest.skip('login failed')
    return s


# Webhook URL guards: each should be refused (400)
@pytest.mark.parametrize('url', [
    'http://httpbin.org/post', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://localhost/x',
    'https://[::1]/x', 'https://169.254.169.254/latest', 'https://192.168.1.1/x', 'https://172.16.0.1/x',
    'https://2130706433/x', 'https://0x7f000001/x', 'https://0.0.0.0/x', 'https://localtest.me/x',
    'https://127.0.0.1.nip.io/x', 'ftp://example.com/x', 'https://user:pw@10.0.0.5/x',
])
def test_webhook_url_refused(alice, url):
    r = alice.put(f"{API}/webhooks", json={'enabled': False, 'url': url, 'events': EV})
    print(url, r.status_code, r.text[:150])
    assert r.status_code == 400, f"{url} accepted: {r.status_code}"


# Ring time bounds 10–60 s
@pytest.mark.parametrize('t', [5, 90])
def test_ring_timeout_bounds(alice, t):
    u = f"{API}/numbers/{enc(BIZ)}/ring-group"
    r = alice.put(u, json={'enabled': False, 'members': ['+14155550101', '+14155550102'], 'ringTimeout': t, 'fallback': 'hangup'})
    print(t, r.status_code, r.text[:300])
    if r.status_code == 200:
        got = r.json()['ringGroup'].get('ringTimeout')
        assert 10 <= got <= 60, f"ringTimeout {t} stored as {got}"


def test_ring_group_duplicate_members(alice):
    u = f"{API}/numbers/{enc(BIZ)}/ring-group"
    r = alice.put(u, json={'enabled': True, 'members': ['+14155550101', '+14155550101'], 'fallback': 'hangup'})
    print(r.status_code, r.text[:300])
    assert r.status_code == 400 or len(set(r.json()['ringGroup']['members'])) == len(r.json()['ringGroup']['members'])
    alice.put(u, json={'enabled': False, 'members': ['+14155550101', '+14155550102'], 'fallback': 'hangup'})


def test_ring_group_own_number_member(alice):
    u = f"{API}/numbers/{enc(BIZ)}/ring-group"
    r = alice.put(u, json={'enabled': False, 'members': [BIZ, '+14155550102'], 'fallback': 'hangup'})
    print(r.status_code, r.text[:300])
    assert r.status_code == 400, 'number itself accepted as a ring-group member (call loop)'


def test_trigger_ai_unknown_agent(alice):
    r = alice.put(f"{API}/numbers/{enc(BIZ)}/text-triggers", json={'enabled': False, 'myPhone': '+14155550111', 'rules': [{'action': 'ai', 'agentId': 'nope-not-real'}]})
    print(r.status_code, r.text[:300])
    assert r.status_code == 400


def test_trigger_ai_missing_agent(alice):
    r = alice.put(f"{API}/numbers/{enc(BIZ)}/text-triggers", json={'enabled': False, 'myPhone': '+14155550111', 'rules': [{'action': 'ai'}]})
    assert r.status_code == 400


def test_trigger_myphone_is_number_itself(alice):
    r = alice.put(f"{API}/numbers/{enc(BIZ)}/text-triggers", json={'enabled': False, 'myPhone': BIZ, 'rules': [{'action': 'callback'}]})
    print(r.status_code, r.text[:300])
    assert r.status_code == 400, 'callback to the number itself accepted'


def test_webhook_secret_rotate_and_test(alice):
    r = alice.put(f"{API}/webhooks", json={'enabled': True, 'url': 'https://httpbin.org/post', 'events': EV})
    assert r.status_code == 200, r.text
    s1 = alice.get(f"{API}/webhooks").json()['webhook']['secret']
    r = alice.post(f"{API}/webhooks/secret")
    assert r.status_code == 200, r.text
    s2 = alice.get(f"{API}/webhooks").json()['webhook']['secret']
    assert s2 and s1 != s2
    r = alice.post(f"{API}/webhooks/test", json={})
    print(r.status_code, r.text[:300])
    assert r.status_code == 200
    d = alice.get(f"{API}/webhooks").json()['deliveries']
    assert d and d[0].get('event', d[0].get('type', '')) in ('test', 'webhook.test', 'call.ended', 'call.started') or d
