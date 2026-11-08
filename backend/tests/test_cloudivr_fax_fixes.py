# CloudIVR web Fax "fix all" round: bulk report CSV, held / no-media statuses, held PDF 402, numbers features.fax.line
import os
import time
import uuid
import datetime
import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = f'{BASE}/api/cloudivr-web'
ALICE = {'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'}
BOB = {'email': 'civr.bob@example.com', 'password': 'BobTest#2026'}
BIZ2 = '+18037534921'
FX = '/tmp/faxfx'

_env = dotenv_values('/app/backend/.env')
DB = MongoClient(_env['MONGO_URL'])[_env['DB_NAME']]


def login(creds):
    s = requests.Session()
    r = s.post(f'{API}/auth/login', json=creds)
    if r.status_code != 200:
        pytest.skip(f'login failed {r.status_code}')
    return s


@pytest.fixture(scope='module')
def alice():
    return login(ALICE)


@pytest.fixture(scope='module')
def bob():
    return login(BOB)


@pytest.fixture(scope='module')
def alice_chat():
    return str(int(DB.webAccounts.find_one({'email': ALICE['email']})['_id']))


@pytest.fixture(scope='module')
def seeded(alice_chat):
    """Insert TEST_ inbound faxes (held / no-media / media_failed) for Alice; removed by id afterwards."""
    src = DB.faxes.find_one({'chatId': alice_chat, 'fileId': {'$ne': None}})
    base = {'chatId': alice_chat, 'phoneNumber': BIZ2, 'direction': 'inbound', 'from': '+14155550777', 'to': BIZ2,
            'pages': 3, 'createdAt': datetime.datetime.utcnow(), 'settled': True}
    ids = {k: f'TEST_{k}_{uuid.uuid4().hex[:8]}' for k in ('held', 'nomedia', 'mfail')}
    DB.faxes.insert_many([
        {**base, '_id': ids['held'], 'status': 'received', 'held': True, 'cost': 9999, 'paidPages': 3, 'freePages': 0,
         'fileId': src['fileId'] if src else None},
        {**base, '_id': ids['nomedia'], 'status': 'received_no_media', 'fileId': None, 'mediaTries': 1},
        {**base, '_id': ids['mfail'], 'status': 'media_failed', 'fileId': None, 'mediaTries': 10},
    ])
    yield ids
    DB.faxes.delete_many({'_id': {'$in': list(ids.values())}})


class TestHeldStatuses:
    def test_list_statuses(self, alice, seeded):
        faxes = {f['id']: f for f in alice.get(f'{API}/fax').json()['faxes']}
        assert faxes[seeded['held']]['status'] == 'held'
        assert faxes[seeded['nomedia']]['status'] == 'received_no_media'
        assert faxes[seeded['mfail']]['status'] == 'media_failed'

    def test_held_pdf_402(self, alice, seeded):
        r = alice.get(f'{API}/fax/{seeded["held"]}/pdf')
        assert r.status_code == 402, r.text
        assert r.json()['error'] == 'insufficient_balance'

    def test_nomedia_pdf_404(self, alice, seeded):
        assert alice.get(f'{API}/fax/{seeded["nomedia"]}/pdf').status_code == 404

    def test_bob_cannot_see_held(self, bob, seeded):
        assert bob.get(f'{API}/fax/{seeded["held"]}/pdf').status_code == 404


class TestBulkReport:
    def test_report_csv(self, alice):
        batches = alice.get(f'{API}/fax').json()['batches']
        if not batches:
            pytest.skip('no batch for Alice')
        b = batches[0]
        r = alice.get(f'{API}/fax/bulk/{b["id"]}/report.csv')
        assert r.status_code == 200, r.text
        assert r.headers['content-type'].startswith('text/csv')
        assert 'attachment' in r.headers.get('content-disposition', '')
        lines = r.text.strip().split('\n')
        assert lines[0] == 'fax_number,status,reason,pages,cost_usd'
        assert len(lines) - 1 == b.get('total', len(lines) - 1)
        for ln in lines[1:]:
            assert ln.startswith('+')

    def test_report_bob_404(self, alice, bob):
        batches = alice.get(f'{API}/fax').json()['batches']
        if not batches:
            pytest.skip('no batch for Alice')
        assert bob.get(f'{API}/fax/bulk/{batches[0]["id"]}/report.csv').status_code == 404

    def test_report_unknown_404(self, alice):
        assert alice.get(f'{API}/fax/bulk/nope123/report.csv').status_code == 404

    def test_report_unauth(self):
        assert requests.get(f'{API}/fax/bulk/nope123/report.csv').status_code == 401


class TestNumbersFaxLine:
    def test_line_flag_roundtrip(self, alice):
        def flag():
            n = next(x for x in alice.get(f'{API}/numbers').json()['numbers'] if x['phoneNumber'] == BIZ2)
            return n['features']['fax']['line']
        assert isinstance(flag(), bool)
        r = alice.patch(f'{API}/fax/line', json={'phone': BIZ2, 'enabled': True})
        assert r.status_code == 200, r.text
        assert flag() is True
        r = alice.patch(f'{API}/fax/line', json={'phone': BIZ2, 'enabled': False})
        assert r.status_code == 200
        assert flag() is False
