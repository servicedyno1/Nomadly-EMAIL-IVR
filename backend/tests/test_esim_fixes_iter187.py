# Iter187: eSIM fix verification — customer plan shape, QR data URL, admin webhook preview, friendly errors,
# eSIM notification link. SAFE: no real texts, no cancel of the real line, webhook only in DRY_RUN preview.
import os, json, pytest, requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
LINE = 'es_69fcb8db0c34'
NUM = '+16462556424'
KEYS = {'planId', 'label', 'price', 'validityDays', 'data', 'voiceMinutes', 'sms', 'carrier'}


@pytest.fixture(scope='module')
def alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": 'civr.alice@example.com', "password": 'AliceTest#2026'})
    if r.status_code != 200:
        pytest.skip('alice login failed')
    return s


@pytest.fixture(scope='module')
def admin():
    s = requests.Session()
    d = s.post(f"{API}/admin/login", json={'email': 'moxxcompany@gmail.com', 'password': 'Katiekendra123@'}).json()
    r = s.post(f"{API}/admin/verify", json={'challenge': d['challenge'], 'code': d['devCode']})
    if r.status_code != 200:
        pytest.skip('admin login failed')
    return s


# customer plan shape
def test_customer_plan_keys(alice):
    plans = alice.get(f"{API}/esim").json()['plans']
    assert plans
    for p in plans:
        assert set(p.keys()) == KEYS, p
        assert p['carrier'] == 'US network'


def test_public_plan_keys():
    plans = requests.get(f"{API}/public/esim-plans").json()['plans']
    for p in plans:
        assert set(p.keys()) == KEYS | {'name'}, p
        assert p['carrier'] == 'US network'


# QR returns data URL, no provider file name
def test_qr_data_url(alice):
    r = alice.get(f"{API}/esim/{LINE}/qr")
    assert r.status_code == 200
    d = r.json()
    if d.get('image'):
        assert d['image'].startswith('data:image/')
        assert 'spenza' not in d['image'][:200].lower() and 's3' not in d['image'][:40].lower()
    else:
        assert d.get('qrCode')
    assert 'spenza' not in json.dumps({k: v for k, v in d.items() if k != 'image'}).lower()


# admin webhook in preview
def test_admin_webhook_preview(admin):
    r = admin.post(f"{API}/admin/esim/webhook")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d['ok'] is True and d['preview'] is True and d['url'].endswith('/api/cloudivr-web/public/spenza/webhook')


def test_admin_webhook_requires_admin(alice):
    assert alice.post(f"{API}/admin/esim/webhook").status_code == 401


# friendly errors without "Spenza"
def test_errors_no_spenza(alice):
    msgs = []
    msgs.append(alice.post(f"{API}/esim/{LINE}/sms", json={'to': '+447700900123', 'text': 'x'}).json()['message'])
    msgs.append(alice.post(f"{API}/esim", json={'planId': 'SPENZA_001', 'imei': '123'}).json()['message'])
    msgs.append(alice.post(f"{API}/esim", json={'planId': 'NOPE', 'imei': '356938035643809'}).json()['message'])
    msgs.append(alice.get(f"{API}/esim/nope/qr").json()['message'])
    print(msgs)
    assert all('spenza' not in m.lower() for m in msgs)


# notifications for eSIM link to /app/esim
def test_esim_notification_link(alice):
    items = alice.get(f"{API}/notifications").json()
    items = items.get('items') or items.get('notifications') or []
    es = [x for x in items if (x.get('meta') or {}).get('esim')]
    print([(x.get('link'), x.get('href')) for x in es[:5]])
    assert es
    assert all((x.get('link') or x.get('href')) == '/app/esim' for x in es)
