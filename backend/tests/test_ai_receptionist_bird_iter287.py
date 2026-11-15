# iter287: AI receptionist (messages inbox, hours/role on agents, inbound call filter) + admin Bird spend estimate
import os
import pytest
import requests

BASE = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') + '/api/cloudivr-web'
USER = {"email": "civr.uxtest@example.com", "password": "UxTest#2026"}
ADMIN = {"email": "moxxcompany@gmail.com", "password": "Katiekendra123@"}
FRONT_DESK = "06e3af06-55a7-4c0a-8a2f-9da41a6ced2e"
SEED_MSG = "seed-rec-msg-1"


@pytest.fixture(scope="module")
def s():
    ss = requests.Session()
    r = ss.post(f"{BASE}/auth/login", json=USER)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    tok = (r.json() or {}).get("token")
    if tok:
        ss.headers["Authorization"] = f"Bearer {tok}"
    return ss


@pytest.fixture(scope="module")
def created(s):
    ids = []
    yield ids
    for i in ids:
        s.delete(f"{BASE}/ai-agents/{i}")


@pytest.fixture(scope="module")
def admin():
    ss = requests.Session()
    d = ss.post(f"{BASE}/admin/login", json=ADMIN)
    if d.status_code != 200 or "devCode" not in d.json():
        pytest.skip("admin login unavailable")
    j = d.json()
    v = ss.post(f"{BASE}/admin/verify", json={"challenge": j["challenge"], "code": j["devCode"]})
    if v.status_code != 200:
        pytest.skip("admin verify failed")
    tok = (v.json() or {}).get("token")
    if tok:
        ss.headers["Authorization"] = f"Bearer {tok}"
    return ss


class TestMessages:
    def test_unauth_401(self):
        r = requests.get(f"{BASE}/ai-receptionist/messages?open=1")
        assert r.status_code in (401, 403)

    def test_open_messages(self, s):
        r = s.get(f"{BASE}/ai-receptionist/messages?open=1")
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["messages"], list) and isinstance(d["open"], int)
        assert all(m.get("handledAt") is None for m in d["messages"])
        assert all("_id" not in m and "transcript" not in m for m in d["messages"])

    def test_mark_done_and_reopen(self, s):
        r = s.put(f"{BASE}/ai-receptionist/messages/{SEED_MSG}", json={"handled": True})
        assert r.status_code == 200, r.text
        assert r.json()["handled"] is True
        ids_open = [m["id"] for m in s.get(f"{BASE}/ai-receptionist/messages?open=1").json()["messages"]]
        assert SEED_MSG not in ids_open
        alls = s.get(f"{BASE}/ai-receptionist/messages?open=0").json()["messages"]
        m = next(x for x in alls if x["id"] == SEED_MSG)
        assert m["handledAt"]
        r = s.put(f"{BASE}/ai-receptionist/messages/{SEED_MSG}", json={"handled": False})
        assert r.status_code == 200 and r.json()["handled"] is False
        ids_open = [m["id"] for m in s.get(f"{BASE}/ai-receptionist/messages?open=1").json()["messages"]]
        assert SEED_MSG in ids_open

    def test_unknown_404(self, s):
        r = s.put(f"{BASE}/ai-receptionist/messages/nope-xyz", json={"handled": True})
        assert r.status_code == 404
        assert r.json()["error"] == "not_found"

    def test_inbound_filter(self, s):
        r = s.get(f"{BASE}/ai-calls?direction=inbound")
        assert r.status_code == 200
        calls = r.json()["calls"]
        assert all(c["direction"] == "inbound" for c in calls)


class TestAgentsHours:
    def test_front_desk(self, s):
        r = s.get(f"{BASE}/ai-agents/{FRONT_DESK}")
        assert r.status_code == 200
        a = r.json()["agent"]
        assert a["role"] == "receptionist"
        assert a["hours"]["enabled"] is True and a["hours"]["afterHours"] in ("message", "voicemail")
        assert a["openNow"] in (True, False)

    def test_create_receptionist_with_hours(self, s, created):
        body = {"name": "TEST_Rec", "goal": "Answer callers questions and take messages.", "role": "receptionist",
                "hours": {"enabled": True, "timezone": "America/New_York", "afterHours": "voicemail",
                          "days": {"mon": {"on": True, "start": "09:00", "end": "17:00"}}}}
        r = s.post(f"{BASE}/ai-agents", json=body)
        assert r.status_code == 201, r.text
        a = r.json()["agent"]
        created.append(a["id"])
        assert a["role"] == "receptionist"
        assert a["hours"]["timezone"] == "America/New_York" and a["hours"]["afterHours"] == "voicemail"
        g = s.get(f"{BASE}/ai-agents/{a['id']}").json()["agent"]
        assert g["hours"]["afterHours"] == "voicemail" and g["hours"]["days"]["mon"]["on"] is True
        # update to message
        body["hours"]["afterHours"] = "message"
        u = s.put(f"{BASE}/ai-agents/{a['id']}", json=body)
        assert u.status_code == 200 and u.json()["agent"]["hours"]["afterHours"] == "message"
        # bad afterHours value falls back to message
        body["hours"]["afterHours"] = "bogus"
        u = s.put(f"{BASE}/ai-agents/{a['id']}", json=body)
        assert u.status_code == 200 and u.json()["agent"]["hours"]["afterHours"] == "message"

    def test_invalid_timezone_400(self, s):
        r = s.post(f"{BASE}/ai-agents", json={"name": "TEST_BadTz", "goal": "Answer callers questions please.",
                                               "role": "receptionist", "hours": {"enabled": True, "timezone": "Mars/Base", "days": {}}})
        assert r.status_code == 400, r.text
        assert r.json()["error"] == "invalid_agent"

    def test_calling_agent_default_role(self, s, created):
        r = s.post(f"{BASE}/ai-agents", json={"name": "TEST_Caller", "goal": "Call leads and book demos politely."})
        assert r.status_code == 201
        a = r.json()["agent"]
        created.append(a["id"])
        assert a["role"] == "agent" and a["hours"] is None and a["openNow"] is None

    def test_list_contains_roles(self, s):
        d = s.get(f"{BASE}/ai-agents").json()
        assert any(a["role"] == "receptionist" for a in d["agents"])
        assert "receptionRate" in d


class TestBirdSpend:
    def test_requires_admin(self, s):
        assert requests.get(f"{BASE}/admin/bird-spend").status_code in (401, 403)
        assert s.get(f"{BASE}/admin/bird-spend").status_code in (401, 403)

    def test_status(self, admin):
        r = admin.get(f"{BASE}/admin/bird-spend")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("spent", "budget", "left", "pct", "last7", "by", "today"):
            assert k in d
        assert len(d["last7"]) == 7

    def test_topup_invalid(self, admin):
        r = admin.post(f"{BASE}/admin/bird-spend/topup", json={"amount": -5, "reason": "TEST"})
        assert r.status_code == 400, r.text
