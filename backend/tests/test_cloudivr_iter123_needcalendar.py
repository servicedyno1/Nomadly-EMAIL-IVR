# CloudIVR web iter123: needCalendar lockout fix (agent with booking already ON stays saveable without calendar)
import os
import pytest
import requests
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
AVA = "6155bd1b-e392-4566-83a8-2a229bf3a34e"


def _env(k):
    with open('/app/backend/.env') as f:
        for line in f:
            if line.startswith(k + '='):
                return line.split('=', 1)[1].strip().strip('"')


db = MongoClient(_env('MONGO_URL'))[_env('DB_NAME')]


@pytest.fixture(scope="module")
def alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ALICE, timeout=20)
    if r.status_code != 200:
        pytest.skip("alice login failed")
    return s


@pytest.fixture(scope="module")
def ava(alice):
    a = alice.get(f"{API}/ai-agents/{AVA}").json()["agent"]
    yield a
    # restore booking OFF + original greeting directly in DB
    db.aiAgents.update_one({"id": AVA}, {"$set": {"booking.enabled": False}})
    alice.put(f"{API}/ai-agents/{AVA}", json={**a, "booking": {**a["booking"], "enabled": False}})


class TestNeedCalendar:
    def test_calendar_not_connected(self, alice):
        st = alice.get(f"{API}/calendar").json()
        assert not st.get("connected"), st

    def test_off_to_on_rejected(self, alice, ava):
        r = alice.put(f"{API}/ai-agents/{AVA}", json={**ava, "booking": {**ava["booking"], "enabled": True}})
        assert r.status_code == 400
        assert r.json()["error"] == "calendar_not_connected"

    def test_already_on_stays_saveable(self, alice, ava):
        res = db.aiAgents.update_one({"id": AVA}, {"$set": {"booking.enabled": True}})
        assert res.matched_count == 1
        g = alice.get(f"{API}/ai-agents/{AVA}").json()["agent"]
        assert g["booking"]["enabled"] is True
        body = {**g, "greeting": (ava.get("greeting") or "Hi") + " TEST123"}
        r = alice.put(f"{API}/ai-agents/{AVA}", json=body)
        assert r.status_code == 200, r.text
        g2 = alice.get(f"{API}/ai-agents/{AVA}").json()["agent"]
        assert g2["greeting"].endswith("TEST123")
        assert g2["booking"]["enabled"] is True
        # restore greeting
        r = alice.put(f"{API}/ai-agents/{AVA}", json={**g2, "greeting": ava.get("greeting")})
        assert r.status_code == 200

    def test_on_to_off_allowed(self, alice, ava):
        g = alice.get(f"{API}/ai-agents/{AVA}").json()["agent"]
        r = alice.put(f"{API}/ai-agents/{AVA}", json={**g, "booking": {**g["booking"], "enabled": False}})
        assert r.status_code == 200
        assert alice.get(f"{API}/ai-agents/{AVA}").json()["agent"]["booking"]["enabled"] is False
