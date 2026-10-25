# CloudIVR iteration 136 — verify round-2 fixes: webhook SSRF guard (save + delivery), SMS-forward webhook guard, /webhooks/test body
import os
import urllib.parse
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
BIZ = '+16692098449'
ALICE = '5000000000000001'
enc = lambda p: urllib.parse.quote(p, safe='')
MSG = 'That address leads to a private or internal network. Use a public web address that starts with https://'


def _env():
    d = {}
    for line in open('/app/backend/.env'):
        if '=' in line and not line.strip().startswith('#'):
            k, v = line.strip().split('=', 1)
            d[k] = v.strip().strip('"').strip("'")
    return d


@pytest.fixture(scope='module')
def db():
    e = _env()
    return MongoClient(e['MONGO_URL'])[e['DB_NAME']]


@pytest.fixture(scope='module')
def alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": 'civr.alice@example.com', "password": 'AliceTest#2026'})
    if r.status_code != 200:
        pytest.skip('login failed')
    yield s
    # restore: disabled hook to httpbin, SMS webhook cleared
    s.put(f"{API}/webhooks", json={'enabled': False, 'url': 'https://httpbin.org/post', 'events': ['call.started']})
    s.patch(f"{API}/numbers/{enc(BIZ)}/sms", json={'webhookUrl': ''})


PRIVATE = ['https://[::ffff:127.0.0.1]/x', 'https://[::ffff:a9fe:a9fe]/latest', 'https://[::]/x', 'https://100.64.0.1/x',
           'https://localtest.me/x', 'https://127.0.0.1.nip.io/x', 'https://[64:ff9b::7f00:1]/x', 'https://[fd00::1]/x',
           'https://[::ffff:0:7f00:1]/x', 'https://2130706433/x', 'https://0x7f.1/x', 'https://mongodb/x',
           'https://metadata.google.internal/x']


# Save-time guard: private targets → 400 with the exact message
@pytest.mark.parametrize('url', PRIVATE)
def test_private_refused_with_message(alice, url):
    r = alice.put(f"{API}/webhooks", json={'enabled': False, 'url': url, 'events': ['call.started']})
    assert r.status_code == 400, f"{url} → {r.status_code} {r.text[:120]}"
    assert r.json().get('message') == MSG, r.text


def test_http_refused(alice):
    r = alice.put(f"{API}/webhooks", json={'enabled': False, 'url': 'http://httpbin.org/post', 'events': ['call.started']})
    assert r.status_code == 400


@pytest.mark.parametrize('url', ['https://httpbin.org/post', 'https://hooks.zapier.com/hooks/catch/1/abc/'])
def test_public_saves(alice, url):
    r = alice.put(f"{API}/webhooks", json={'enabled': False, 'url': url, 'events': ['call.started']})
    assert r.status_code == 200, r.text
    assert r.json()['webhook']['url'] == url


# Delivery-time re-check: hook planted directly in Mongo is not contacted
def test_delivery_blocked_for_planted_private_hook(alice, db):
    db.webPrefs.update_one({'_id': ALICE}, {'$set': {'webhook': {'enabled': True, 'url': 'https://[::ffff:127.0.0.1]/x', 'events': ['call.started'], 'secret': 'whsec_x'}}}, upsert=True)
    try:
        r = alice.post(f"{API}/webhooks/test", json={'type': 'call.started'})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['ok'] is False and d['error'] == 'Blocked: private or internal address', d
        g = alice.get(f"{API}/webhooks").json()
        assert g['deliveries'][0]['error'] == 'Blocked: private or internal address'
    finally:
        r = alice.put(f"{API}/webhooks", json={'enabled': False, 'url': 'https://httpbin.org/post', 'events': ['call.started']})
        assert r.status_code == 200


def test_send_test_event_public_ok(alice):
    alice.put(f"{API}/webhooks", json={'enabled': False, 'url': 'https://httpbin.org/post', 'events': ['call.started']})
    r = alice.post(f"{API}/webhooks/test", json={'type': 'call.started'})
    d = r.json()
    print(d.get('status'), d.get('error'))
    assert r.status_code == 200 and d['ok'] is True and d['status'] == 200, d


def test_webhook_test_empty_text_body(alice):
    r = alice.post(f"{API}/webhooks/test", data='', headers={'Content-Type': 'text/plain'})
    assert r.status_code in (200, 400), r.text


# SMS-forward webhook (web) guard
def test_sms_webhook_private_refused(alice):
    r = alice.patch(f"{API}/numbers/{enc(BIZ)}/sms", json={'webhookUrl': 'https://[::ffff:127.0.0.1]/x'})
    print(r.status_code, r.text[:200])
    assert r.status_code == 400 and r.json().get('error') == 'private_webhook', r.text


def test_sms_webhook_public_then_clear(alice):
    r = alice.patch(f"{API}/numbers/{enc(BIZ)}/sms", json={'webhookUrl': 'https://httpbin.org/post'})
    assert r.status_code == 200, r.text
    r2 = alice.patch(f"{API}/numbers/{enc(BIZ)}/sms", json={'webhookUrl': ''})
    assert r2.status_code == 200, r2.text
