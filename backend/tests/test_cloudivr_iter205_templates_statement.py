# Iteration 205: saved text templates API (per account) + monthly statement opt-out prefs + statement unit test
import os
import subprocess
import time
import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

FE_ENV = dotenv_values('/app/frontend/.env')
BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or FE_ENV['REACT_APP_BACKEND_URL']).rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
BE_ENV = dotenv_values('/app/backend/.env')
DB = MongoClient(BE_ENV['MONGO_URL'])[BE_ENV['DB_NAME']]
ALICE = {"email": "civr.alice@example.com", "password": "AliceTest#2026"}
BOB = {"email": "civr.bob@example.com", "password": "BobTest#2026"}


def login(c):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=c)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return s


@pytest.fixture(scope="module")
def alice():
    return login(ALICE)


@pytest.fixture(scope="module")
def bob():
    return login(BOB)


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    DB.webTextTemplates.delete_many({"text": {"$regex": "^TEST_"}})


# ---- templates ----
class TestTemplates:
    def test_unauth(self):
        assert requests.get(f"{API}/messages/templates").status_code == 401

    def test_crud(self, alice):
        txt = f"TEST_tpl {int(time.time())}"
        r = alice.post(f"{API}/messages/templates", json={"text": "  " + txt + "   "})
        assert r.status_code == 200, r.text
        item = r.json()["item"]
        assert item["text"] == txt and item["id"].startswith("tpl_")
        lst = alice.get(f"{API}/messages/templates").json()["items"]
        assert lst[0]["id"] == item["id"]
        dup = alice.post(f"{API}/messages/templates", json={"text": txt})
        assert dup.status_code == 409 and dup.json()["error"] == "duplicate"
        d = alice.delete(f"{API}/messages/templates/{item['id']}")
        assert d.status_code == 200 and d.json()["ok"] is True
        assert all(x["id"] != item["id"] for x in alice.get(f"{API}/messages/templates").json()["items"])
        assert alice.delete(f"{API}/messages/templates/{item['id']}").status_code == 404

    def test_empty(self, alice):
        r = alice.post(f"{API}/messages/templates", json={"text": "   "})
        assert r.status_code == 400 and r.json()["error"] == "empty"

    def test_too_long(self, alice):
        ok = alice.post(f"{API}/messages/templates", json={"text": "TEST_" + "a" * 454})
        assert ok.status_code == 200, ok.text
        r = alice.post(f"{API}/messages/templates", json={"text": "TEST_" + "b" * 455})
        assert r.status_code == 400 and r.json()["error"] == "too_long"
        print("too_long msg:", r.json()["message"])

    def test_other_user_cannot_delete_or_see(self, alice, bob):
        item = alice.post(f"{API}/messages/templates", json={"text": f"TEST_priv {time.time()}"}).json()["item"]
        assert all(x["id"] != item["id"] for x in bob.get(f"{API}/messages/templates").json()["items"])
        assert bob.delete(f"{API}/messages/templates/{item['id']}").status_code == 404
        assert any(x["id"] == item["id"] for x in alice.get(f"{API}/messages/templates").json()["items"])

    def test_limit_50(self, bob):
        DB.webTextTemplates.delete_many({"text": {"$regex": "^TEST_lim"}})
        have = len(bob.get(f"{API}/messages/templates").json()["items"])
        last = None
        for i in range(51 - have):
            last = bob.post(f"{API}/messages/templates", json={"text": f"TEST_lim {i}"})
        assert last.status_code == 400 and last.json()["error"] == "limit", last.text
        assert len(bob.get(f"{API}/messages/templates").json()["items"]) == 50
        DB.webTextTemplates.delete_many({"text": {"$regex": "^TEST_lim"}})


# ---- statement prefs ----
class TestStatement:
    def test_unit(self):
        out = subprocess.run(["node", "/app/backend/tests/statement.test.js"], capture_output=True, text=True, timeout=60).stdout
        assert "PASS" in out

    def test_toggle(self, alice):
        r = alice.put(f"{API}/prefs/statement", json={"off": True})
        assert r.status_code == 200 and r.json()["statementOff"] is True
        assert alice.get(f"{API}/prefs/onboarding").json()["statementOff"] is True
        r = alice.put(f"{API}/prefs/statement", json={"off": False})
        assert r.json()["statementOff"] is False
        assert alice.get(f"{API}/prefs/onboarding").json()["statementOff"] is False

    def test_unauth(self):
        assert requests.put(f"{API}/prefs/statement", json={"off": True}).status_code == 401
