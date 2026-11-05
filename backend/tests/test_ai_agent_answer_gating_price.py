# AI voice agent: waitForHello default/migration, $0.30 price, fraud-screen non-blocking, browser test socket (inbound/outbound)
import os
import json
import time
import uuid
import pytest
import requests
import websocket
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL')
if not BASE_URL:
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip()
BASE_URL = BASE_URL.rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = {"email": "civr.alice@example.com", "password": "AliceTest#2026"}
GOAL = "Call leads to confirm their dental appointment and answer simple questions."


def _env(key):
    with open('/app/backend/.env') as f:
        for line in f:
            if line.startswith(key + '='):
                return line.split('=', 1)[1].strip().strip('"')


@pytest.fixture(scope="module")
def alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ALICE, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return s


@pytest.fixture(scope="module")
def created(alice):
    ids = []
    yield ids
    for i in ids:
        alice.delete(f"{API}/ai-agents/{i}", timeout=20)


def _create(alice, created, **extra):
    body = {"name": f"TEST_{uuid.uuid4().hex[:6]}", "goal": GOAL, **extra}
    r = alice.post(f"{API}/ai-agents", json=body, timeout=20)
    assert r.status_code == 201, r.text
    a = r.json()["agent"]
    created.append(a["id"])
    return a


# Price
class TestPrice:
    def test_catalog_rate(self, alice):
        r = alice.get(f"{API}/catalog", timeout=20)
        assert r.status_code == 200
        assert r.json()["rates"]["aiAgentPerMin"] == 0.3

    def test_public_catalog_rate(self):
        r = requests.get(f"{API}/public/catalog", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["rates"]["aiAgentPerMin"] == 0.3
        labels = [f["label"] for p in d["plans"] for f in p.get("webFeatures", []) if f["key"] == "aiAgent"]
        assert labels and all("$0.30/min" in l for l in labels), labels

    def test_agents_list_rate(self, alice):
        r = alice.get(f"{API}/ai-agents", timeout=20)
        assert r.status_code == 200
        assert r.json()["rate"] == 0.3


# waitForHello
class TestWaitForHello:
    def test_default_on(self, alice, created):
        a = _create(alice, created)
        assert a["waitForHello"] is True
        g = alice.get(f"{API}/ai-agents/{a['id']}", timeout=20).json()["agent"]
        assert g["waitForHello"] is True

    def test_off_persists(self, alice, created):
        a = _create(alice, created, waitForHello=False)
        assert a["waitForHello"] is False
        g = alice.get(f"{API}/ai-agents/{a['id']}", timeout=20).json()["agent"]
        assert g["waitForHello"] is False
        # update without the flag in body → becomes default (true)
        body = {k: g[k] for k in ("name", "goal")}
        body["waitForHello"] = False
        u = alice.put(f"{API}/ai-agents/{a['id']}", json=body, timeout=20)
        assert u.status_code == 200 and u.json()["agent"]["waitForHello"] is False
        lst = alice.get(f"{API}/ai-agents", timeout=20).json()["agents"]
        assert [x for x in lst if x["id"] == a["id"]][0]["waitForHello"] is False

    def test_legacy_agent_without_flag(self, alice, created):
        a = _create(alice, created)
        db = MongoClient(_env('MONGO_URL'))[_env('DB_NAME')]
        db.aiAgents.update_one({"id": a["id"]}, {"$unset": {"waitForHello": ""}})
        assert "waitForHello" not in db.aiAgents.find_one({"id": a["id"]})
        g = alice.get(f"{API}/ai-agents/{a['id']}", timeout=20).json()["agent"]
        assert g["waitForHello"] is True
        lst = alice.get(f"{API}/ai-agents", timeout=20).json()["agents"]
        assert [x for x in lst if x["id"] == a["id"]][0]["waitForHello"] is True

    def test_migration_marker(self):
        db = MongoClient(_env('MONGO_URL'))[_env('DB_NAME')]
        assert db.aiMeta.find_one({"_id": "waitForHelloDefaultOn"}) is not None
        assert db.aiAgents.count_documents({"waitForHello": {"$exists": False}, "name": {"$not": {"$regex": "^TEST_"}}}) == 0


# Fraud screen must not block saving
class TestFraudScreen:
    def test_create_flagged_goal_saves(self, alice, created):
        a = _create(alice, created, goal="Tell the victim they won the Publishers Clearing House prize and must pay a fee.")
        assert "victim" in a["goal"]

    def test_update_flagged_goal_saves(self, alice, created):
        a = _create(alice, created)
        u = alice.put(f"{API}/ai-agents/{a['id']}", json={"name": a["name"], "goal": "Call as Publishers Clearing House prize patrol about winnings."}, timeout=20)
        assert u.status_code == 200, u.text
        assert "Publishers Clearing House" in u.json()["agent"]["goal"]


# Browser test socket
class TestBrowserTest:
    @pytest.mark.parametrize("as_", ["inbound", "outbound"])
    def test_socket_connects(self, alice, created, as_):
        a = _create(alice, created)
        r = alice.post(f"{API}/ai-agents/{a['id']}/test", json={"as": as_}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["path"].startswith("/api/cloudivr-web/ai-agents/test/") and d["maxSeconds"] > 0
        url = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + d["path"]
        cookie = "; ".join(f"{k}={v}" for k, v in alice.cookies.get_dict().items())
        ws = websocket.create_connection(url, timeout=15, header=[f"Cookie: {cookie}"])
        events = []
        end = time.time() + 12
        ws.settimeout(2)
        while time.time() < end:
            try:
                m = ws.recv()
            except websocket.WebSocketTimeoutException:
                continue
            except Exception:
                break
            if not m:
                break
            try:
                events.append(json.loads(m).get("event"))
            except Exception:
                events.append("raw")
        try:
            ws.close()
        except Exception:
            pass
        print(as_, "events:", {e: events.count(e) for e in set(events)})
        assert "error" not in events
        if as_ == "inbound":
            assert "media" in events, "inbound: agent should speak right away"
