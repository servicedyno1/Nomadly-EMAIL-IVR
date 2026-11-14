# CloudIVR iter280: only Bird code-verified caller IDs usable (presets, list, request 410, attest 400, admin approve no-op, resolve).
import os
import subprocess
import time

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
QA = ('civr.uxtest@example.com', 'UxTest#2026')
db = MongoClient('mongodb://localhost:27017')['test']
ATT = '+14155558801'   # TEST attested
REV = '+14155558802'   # TEST manual review (status review)
REVV = '+14155558803'  # TEST method=review but status verified (legacy approved)
VER = '+14155558804'   # TEST code-verified (method call)
IDS = [ATT, REV, REVV, VER]


@pytest.fixture(scope='module')
def qa():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'email': QA[0], 'password': QA[1]})
    assert r.status_code == 200, r.text
    cid = str(int(db.webAccounts.find_one({'email': QA[0]})['_id']))
    now = int(time.time() * 1000)
    docs = [
        {'_id': ATT, 'status': 'verified', 'method': 'attested', 'attested': True},
        {'_id': REV, 'status': 'review', 'method': 'review'},
        {'_id': REVV, 'status': 'verified', 'method': 'review', 'adminApproved': True},
        {'_id': VER, 'status': 'verified', 'method': 'call'},
    ]
    for d in docs:
        db.webCallerIds.replace_one({'_id': d['_id']}, {**d, 'chatId': cid, 'createdAt': now, 'charged': 0}, upsert=True)
    sw = db.appSettings.find_one({'_id': 'customCallerId'})
    if not (sw or {}).get('enabled'):
        db.appSettings.update_one({'_id': 'customCallerId'}, {'$set': {'enabled': True, 'by': 'TEST_iter280'}}, upsert=True)
        time.sleep(32)
    yield s, cid
    if sw is None:
        db.appSettings.delete_one({'_id': 'customCallerId'})
    else:
        db.appSettings.replace_one({'_id': 'customCallerId'}, sw)
    db.webCallerIds.delete_many({'_id': {'$in': IDS}})


class TestPresets:
    def test_presets_only_code_verified(self, qa):
        s, _ = qa
        r = s.get(f"{API}/caller-ids/presets")
        assert r.status_code == 200
        nums = [p['number'] for p in r.json()['items']]
        assert VER in nums
        for bad in (ATT, REV, REVV):
            assert bad not in nums, f"{bad} leaked into presets"


class TestListEndpoint:
    # UI caller-IDs manager renders everything with status=verified as usable
    def test_list_does_not_show_attested_or_review_as_verified(self, qa):
        s, _ = qa
        r = s.get(f"{API}/caller-ids")
        assert r.status_code == 200
        items = {i['number']: i for i in r.json()['items']}
        leaked = [n for n in (ATT, REVV) if items.get(n, {}).get('status') == 'verified']
        assert not leaked, f"GET /caller-ids still lists non-code caller IDs as verified: {leaked}"


class TestRetiredEndpoints:
    def test_request_410(self, qa):
        s, _ = qa
        r = s.post(f"{API}/caller-ids/request", json={'number': '+14155550199', 'note': 'TEST_'})
        assert r.status_code == 410
        assert r.json()['error'] == 'verification_required'

    @pytest.mark.parametrize('body', [{'number': '+14155550198', 'authorized': True}, {'number': '+14155550198'}])
    def test_attest_400(self, qa, body):
        s, _ = qa
        r = s.post(f"{API}/caller-ids/attest", json=body)
        assert r.status_code == 400
        assert r.json()['error'] == 'verification_required'
        assert db.webCallerIds.find_one({'_id': '+14155550198'}) is None


class TestServerSide:
    def _node(self, code):
        return subprocess.run(['node', '-e', code], cwd='/app', capture_output=True, text=True, timeout=60)

    def test_admin_approve_and_resolve(self, qa):
        _, cid = qa
        js = ("require('/app/node_modules/dotenv').config({path:'/app/backend/.env'});const {MongoClient}=require('/app/node_modules/mongodb');"
              "(async()=>{const c=await MongoClient.connect('mongodb://localhost:27017');const db=c.db('test');const m=require('/app/js/cloudivr-web/caller-ids');"
              "m.init&&await m.init(db);await m.loadSwitch();const a=m.adminApi(db);const ap=await a.approve('" + REV + "');"
              "const d=await db.collection('webCallerIds').findOne({_id:'" + REV + "'});"
              "const out=[];for(const n of ['" + REVV + "','" + ATT + "','" + VER + "']){try{await m.resolve('" + cid + "',n);out.push(n+':ok')}catch(e){out.push(n+':rej')}}"
              "console.log('RES '+JSON.stringify({ap,st:d&&d.status,out}));await c.close();process.exit(0)})().catch(e=>{console.log('ERR '+e.message);process.exit(1)})")
        p = self._node(js)
        line = [l for l in p.stdout.splitlines() if l.startswith('RES ') or l.startswith('ERR ')]
        assert line and line[-1].startswith('RES '), p.stdout[-800:] + p.stderr[-800:]
        import json
        res = json.loads(line[-1][4:])
        assert res['ap'] is None
        assert res['st'] == 'review'
        assert f"{REVV}:rej" in res['out'] and f"{ATT}:rej" in res['out']
        assert f"{VER}:ok" in res['out'], res
