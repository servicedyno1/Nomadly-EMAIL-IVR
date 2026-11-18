# Iteration 321: AI conversation campaigns (agent create/update + campaign mode ai + Emily aicampaign assist)
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = {"email": "civr.alice@example.com", "password": "AliceTest#2026"}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    r = sess.post(f"{API}/auth/login", json=ALICE, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    return sess


@pytest.fixture(scope="module")
def created_agents(s):
    ids = []
    yield ids
    for i in ids:
        s.delete(f"{API}/ai-agents/{i}", timeout=30)


@pytest.fixture(scope="module")
def ai_number(s):
    r = s.get(f"{API}/numbers", timeout=30)
    assert r.status_code == 200
    nums = r.json().get("numbers", [])
    for n in nums:
        if n.get("status") == "active" and (n.get("access") or {}).get("aiAgent"):
            return n["phoneNumber"]
    pytest.skip(f"no AI-capable number: {[ (n.get('phoneNumber'), n.get('plan')) for n in nums]}")


# Auth gating
def test_unauth_ai_agents_401():
    r = requests.get(f"{API}/ai-agents", timeout=30)
    assert r.status_code == 401


def test_unauth_assist_401():
    r = requests.post(f"{API}/assist/aicampaign", json={"messages": [{"role": "user", "content": "hi"}]}, timeout=30)
    assert r.status_code == 401


# Assist validation
def test_assist_no_message_400(s):
    r = s.post(f"{API}/assist/aicampaign", json={"messages": []}, timeout=30)
    assert r.status_code == 400
    assert r.json().get("error") == "no_message"


# Agent CRUD (the campaign page's "New agent" path)
def test_create_update_agent(s, created_agents):
    body = {"name": "TEST_Ava", "businessName": "TEST_Sunrise Dental", "language": "en", "voice": "marin", "firstMessage": "",
            "goal": "Call patients who missed a cleaning and rebook them.", "knowledge": "Open Mon-Fri 9-5.", "transferTo": "+14155550100",
            "takeMessages": True, "discloseAi": True}
    r = s.post(f"{API}/ai-agents", json=body, timeout=30)
    assert r.status_code == 201, r.text
    a = r.json()["agent"]
    created_agents.append(a["id"])
    assert a["name"] == "TEST_Ava"
    g = s.get(f"{API}/ai-agents/{a['id']}", timeout=30)
    assert g.status_code == 200 and g.json()["agent"]["goal"].startswith("Call patients")
    # PUT with the full saved agent spread + edits (as Campaigns.js does)
    full = {**g.json()["agent"], "goal": "TEST edited script: rebook cleanings politely."}
    p = s.put(f"{API}/ai-agents/{a['id']}", json=full, timeout=30)
    assert p.status_code == 200, p.text
    assert s.get(f"{API}/ai-agents/{a['id']}", timeout=30).json()["agent"]["goal"].startswith("TEST edited")


# AI conversation campaign create
def test_create_ai_campaign(s, created_agents, ai_number):
    if not created_agents:
        pytest.skip("no agent")
    body = {"mode": "ai", "name": "TEST_ai_conv", "agentId": created_agents[0], "callerId": ai_number,
            "leads": "+14155550123\n+14155550124", "concurrency": 5, "scheduledFor": None, "repeat": None, "dailyLimit": None, "tz": "UTC", "permissionConfirmed": True}
    r = s.post(f"{API}/campaigns", json=body, timeout=60)
    print("AI campaign create:", r.status_code, r.text[:300])
    assert r.status_code in (201, 503), r.text
    if r.status_code == 201:
        c = r.json()["campaign"]
        g = s.get(f"{API}/campaigns/{c['id']}", timeout=30)
        assert g.status_code == 200
        assert g.json()["campaign"].get("mode") == "ai"
    else:
        assert r.json().get("error") == "bulk_maintenance"


def test_ai_campaign_invalid_agent(s, ai_number):
    r = s.post(f"{API}/campaigns", json={"mode": "ai", "agentId": "nope", "callerId": ai_number, "leads": "+14155550123", "permissionConfirmed": True}, timeout=30)
    assert r.status_code == 400
    assert r.json().get("error") == "invalid_agent"


# Emily aicampaign: one LLM call
def test_assist_aicampaign_proposal(s, ai_number):
    msg = ("Write a new agent: Ava from Sunrise Dental calls patients who missed a cleaning to rebook them, hand interested "
           "people to +14155550100. Call +14155550123 and +14155550124.")
    body = {"messages": [{"role": "user", "content": msg}], "current": {"agentId": "new"},
            "context": {"agents": [], "callerNumbers": [ai_number], "contactLists": []}}
    r = s.post(f"{API}/assist/aicampaign", json=body, timeout=120)
    print("assist:", r.status_code, r.text[:1500])
    assert r.status_code == 200, r.text
    d = r.json()
    p = d.get("proposal") or d.get("fields") or {}
    assert isinstance(p, dict)
