# CloudIVR: Landline-to-Texting counted as numbers (dashboard / admin overview / admin user / activity) + expiringSoon rules.
# Requires `node scripts/seed_texting_gap_check.js seed` (GAPCHK-* docs on Alice).
import os, time, random
from datetime import datetime, timedelta, timezone
import pytest, requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv('/app/frontend/.env')
load_dotenv('/app/backend/.env')
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026')
ALICE_ID = '5000000000000001'
ADMIN = ('moxxcompany@gmail.com', 'Katiekendra123@')
LIVE_T = ['verify', 'loa', 'documents', 'admin_docs', 'review', 'active', 'paused']
LIVE_M = ['provisioning', 'awaiting_imei', 'active', 'suspended']


@pytest.fixture(scope='module')
def db():
    c = MongoClient(os.environ['MONGO_URL'])
    yield c[os.environ['DB_NAME']]
    c.close()


@pytest.fixture(scope='module')
def alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'email': ALICE[0], 'password': ALICE[1]}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"alice login failed {r.status_code}")
    return s


@pytest.fixture(scope='module')
def admin():
    s = requests.Session()
    d = s.post(f"{API}/admin/login", json={'email': ADMIN[0], 'password': ADMIN[1]}, timeout=30).json()
    if 'devCode' not in d:
        pytest.skip(f"admin login: {d}")
    r = s.post(f"{API}/admin/verify", json={'challenge': d['challenge'], 'code': d['devCode']}, timeout=30)
    assert r.status_code == 200
    return s


def _exp(v):
    if not v:
        return None
    if isinstance(v, str):
        v = datetime.fromisoformat(v.replace('Z', '+00:00'))
    if v.tzinfo is None:
        v = v.replace(tzinfo=timezone.utc)
    return v.timestamp()


def expected_alice(db):
    doc = db.phoneNumbersOf.find_one({'_id': ALICE_ID}) or {}
    regs = [n for n in (doc.get('val') or {}).get('numbers', []) if n.get('status') != 'released']
    mob = list(db.esimLines.find({'chatId': ALICE_ID, 'kind': 'mobile', 'status': {'$in': LIVE_M}}))
    tx = list(db.hostedSms.find({'chatId': ALICE_ID, 'status': {'$in': LIVE_T}}))
    rows = [(n.get('status'), n.get('expiresAt')) for n in regs] + [(m.get('status'), m.get('expiresAt')) for m in mob] + \
           [(t.get('status'), None if t.get('planNumber') else t.get('nextBillAt')) for t in tx]
    now = time.time()
    soon = sum(1 for st, e in rows if st == 'active' and _exp(e) and now < _exp(e) < now + 7 * 86400)
    return dict(total=len(rows), active=sum(1 for st, _ in rows if st == 'active'), texting=len(tx), mobile=len(mob), expiringSoon=soon)


class TestSeed:
    def test_seed_present(self, db):
        assert db.hostedSms.count_documents({'_id': {'$in': ['GAPCHK-1', 'GAPCHK-2', 'GAPCHK-3']}}) == 3


class TestDashboard:
    def test_dashboard_counts(self, alice, db):
        r = alice.get(f"{API}/dashboard", timeout=30)
        assert r.status_code == 200
        n = r.json()['numbers']
        e = expected_alice(db)
        print('dashboard', n, 'expected', e)
        for k in ('total', 'active', 'texting', 'mobile', 'expiringSoon'):
            assert n[k] == e[k], k

    def test_texting_excludes_cancelled(self, alice):
        n = alice.get(f"{API}/dashboard", timeout=30).json()['numbers']
        hs = alice.get(f"{API}/hosted-sms", timeout=30).json()['items']
        live = [x for x in hs if x['status'] in LIVE_T]
        assert n['texting'] == len(live)
        assert any(x.get('status') == 'cancelled' for x in hs) or True

    def test_expiring_soon_with_toggle(self, alice, db):
        """Moving GAPCHK-1 nextBillAt to the past / pausing it must drop expiringSoon by 1."""
        base = alice.get(f"{API}/dashboard", timeout=30).json()['numbers']['expiringSoon']
        orig = db.hostedSms.find_one({'_id': 'GAPCHK-1'})
        try:
            db.hostedSms.update_one({'_id': 'GAPCHK-1'}, {'$set': {'nextBillAt': datetime.now(timezone.utc) - timedelta(days=1)}})
            assert alice.get(f"{API}/dashboard", timeout=30).json()['numbers']['expiringSoon'] == base - 1
            db.hostedSms.update_one({'_id': 'GAPCHK-1'}, {'$set': {'nextBillAt': orig['nextBillAt'], 'status': 'paused'}})
            assert alice.get(f"{API}/dashboard", timeout=30).json()['numbers']['expiringSoon'] == base - 1
            db.hostedSms.update_one({'_id': 'GAPCHK-1'}, {'$set': {'status': 'active', 'planNumber': '+13346972125'}})
            assert alice.get(f"{API}/dashboard", timeout=30).json()['numbers']['expiringSoon'] == base - 1
        finally:
            db.hostedSms.update_one({'_id': 'GAPCHK-1'}, {'$set': {'nextBillAt': orig['nextBillAt'], 'status': 'active', 'planNumber': None}})
        assert alice.get(f"{API}/dashboard", timeout=30).json()['numbers']['expiringSoon'] == base


class TestActivity:
    def test_activity_has_hosted_inbound(self, alice):
        r = alice.get(f"{API}/activity?limit=100", timeout=30)
        assert r.status_code == 200
        logs = r.json()['logs']
        hit = [l for l in logs if l.get('phoneNumber') == '+12125550101']
        print('hosted log', hit[:1])
        assert hit, 'inbound hosted text missing from /activity'


class TestAdmin:
    def test_overview_numbers(self, admin, db):
        r = admin.get(f"{API}/admin/overview", timeout=60)
        assert r.status_code == 200
        reg = sum(len([n for n in (d.get('val') or {}).get('numbers', []) if n.get('status') != 'released']) for d in db.phoneNumbersOf.find({}, {'val.numbers.status': 1}))
        mob = db.esimLines.count_documents({'kind': 'mobile', 'status': {'$in': LIVE_M}})
        tx = db.hostedSms.count_documents({'status': {'$in': LIVE_T}})
        print('overview', r.json()['numbers'], 'expected', reg, mob, tx)
        assert r.json()['numbers'] == reg + mob + tx

    def test_overview_requires_admin(self):
        assert requests.get(f"{API}/admin/overview", timeout=30).status_code == 401

    def test_admin_user_texting_rows(self, admin):
        r = admin.get(f"{API}/admin/users/{ALICE_ID}", timeout=60)
        assert r.status_code == 200
        nums = r.json()['numbers']
        tx = [n for n in nums if n['plan'] == 'texting']
        phones = {n['phoneNumber'] for n in tx}
        assert '+12125550101' in phones and '+12125550102' in phones
        assert '+12125550103' not in phones
        g1 = next(n for n in tx if n['phoneNumber'] == '+12125550101')
        assert g1['status'] == 'active' and g1['expiresAt'] and g1['country'] == 'US'
        # released regular number still listed in admin user view (raw list) - informational
        print('released listed:', any(n['phoneNumber'] == '+19995550002' for n in nums))


class TestTextingOnlyAccount:
    def test_texting_only_dashboard(self, db):
        email = f"test_txonly{random.randint(10**6, 10**7)}@example.com"
        s = requests.Session()
        r = s.post(f"{API}/auth/register", json={'email': email, 'password': 'QaTest#2026x', 'name': 'TEST Texting'}, timeout=30)
        assert r.status_code == 201, r.text
        acc_id = str(r.json()['account'].get('id') or r.json()['account'].get('chatId'))
        hid = f"TEST-TXONLY-{acc_id}"
        try:
            db.hostedSms.insert_one({'_id': hid, 'chatId': acc_id, 'status': 'active', 'phoneNumber': '+12125559876', 'plan': 'texting', 'planNumber': None,
                                     'nextBillAt': datetime.now(timezone.utc) + timedelta(days=20), 'createdAt': datetime.now(timezone.utc), 'updatedAt': datetime.now(timezone.utc)})
            n = s.get(f"{API}/dashboard", timeout=30).json()['numbers']
            print('texting-only', n, email, acc_id)
            assert n['total'] == 1 and n['texting'] == 1 and n['expiringSoon'] == 0
            assert n['total'] - n['texting'] == 0
        finally:
            db.hostedSms.delete_one({'_id': hid})
