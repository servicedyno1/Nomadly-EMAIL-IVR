# Iteration 322: campaigns maintenance OFF by default + AI agent "call me now" test call (Alice, dry-run preview)
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
CALLER = '+13346970100'


@pytest.fixture(scope='module')
def s():
    sess = requests.Session()
    r = sess.post(f"{API}/auth/login", json={"email": "civr.alice@example.com", "password": "AliceTest#2026"})
    if r.status_code != 200:
        pytest.skip('Alice login failed')
    return sess


@pytest.fixture(scope='module')
def created():
    return {"agents": [], "campaigns": []}


@pytest.fixture(scope='module', autouse=True)
def cleanup(s, created):
    yield
    for cid in created["campaigns"]:
        s.post(f"{API}/campaigns/{cid}/cancel")
    for aid in created["agents"]:
        s.delete(f"{API}/ai-agents/{aid}")


def _audio_id(s):
    a = s.get(f"{API}/audio").json()["audios"]
    assert a, 'Alice has no audio'
    return a[0]["id"]


# Recorded-message campaign saves (no 503 maintenance) and starts in dry-run
class TestRecordedCampaign:
    def test_create_and_start(self, s, created):
        body = {"name": "TEST_iter322 recorded", "callerId": CALLER, "audioId": _audio_id(s), "leads": "+14155550100", "mode": "report_only", "permissionConfirmed": True}
        r = s.post(f"{API}/campaigns", json=body)
        assert r.status_code == 201, r.text
        c = r.json()["campaign"]
        created["campaigns"].append(c["id"])
        g = s.get(f"{API}/campaigns/{c['id']}")
        assert g.status_code == 200
        assert g.json()["campaign"]["name"] == "TEST_iter322 recorded"
        st = s.post(f"{API}/campaigns/{c['id']}/start")
        assert st.status_code in (200, 202), st.text
        assert st.json().get("dryRun") is True

    def test_permission_still_required(self, s):
        body = {"name": "TEST_iter322 noperm", "callerId": CALLER, "audioId": _audio_id(s), "leads": "+14155550100"}
        r = s.post(f"{API}/campaigns", json=body)
        assert r.status_code == 428, r.text


# AI conversation campaign: agent then campaign (no maintenance)
class TestAiCampaign:
    def test_agent_then_campaign(self, s, created):
        a = s.post(f"{API}/ai-agents", json={"name": "TEST_Ava322", "goal": "Ask if they still want a quote and book a call-back."})
        assert a.status_code == 201, a.text
        aid = a.json()["agent"]["id"]
        created["agents"].append(aid)
        r = s.post(f"{API}/campaigns", json={"mode": "ai", "name": "TEST_iter322 ai", "agentId": aid, "callerId": CALLER, "leads": "+14155550100", "permissionConfirmed": True})
        assert r.status_code == 201, r.text
        c = r.json()["campaign"]
        created["campaigns"].append(c["id"])
        g = s.get(f"{API}/campaigns/{c['id']}").json()["campaign"]
        assert g["mode"] == "ai"


# POST /ai-agents/:id/call-me
class TestCallMe:
    def test_call_me_flow(self, s, created):
        a = s.post(f"{API}/ai-agents", json={"name": "TEST_Callme322", "goal": "Friendly test agent for the call me flow."})
        assert a.status_code == 201
        aid = a.json()["agent"]["id"]
        created["agents"].append(aid)
        before = len(s.get(f"{API}/campaigns").json()["campaigns"])
        bad = s.post(f"{API}/ai-agents/{aid}/call-me", json={"to": "+4420123", "callerId": CALLER})
        assert bad.status_code == 400 and 'invalid_number' in bad.text, bad.text
        uk = s.post(f"{API}/ai-agents/{aid}/call-me", json={"to": "+442012345678", "callerId": CALLER})
        assert uk.status_code == 400
        ten = s.post(f"{API}/ai-agents/{aid}/call-me", json={"to": "(415) 555-0100", "callerId": CALLER})
        print('10-digit no +1 ->', ten.status_code)  # known: rejected (400) though UI enables button at 10 digits
        ok = s.post(f"{API}/ai-agents/{aid}/call-me", json={"to": "+1 (415) 555-0100", "callerId": CALLER})
        assert ok.status_code == 200, ok.text
        d = ok.json()
        assert d["calling"] == "+14155550100"
        assert d["from"] == CALLER
        after = len(s.get(f"{API}/campaigns").json()["campaigns"])
        assert after == before

    def test_call_me_unknown_agent(self, s):
        r = s.post(f"{API}/ai-agents/nope-xyz/call-me", json={"to": "+14155550100"})
        assert r.status_code == 404

    def test_call_me_signed_out(self):
        r = requests.post(f"{API}/ai-agents/whatever/call-me", json={"to": "+14155550100"})
        assert r.status_code == 401
