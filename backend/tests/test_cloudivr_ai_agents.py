# CloudIVR web: AI voice agents (CRUD, test token, number assignment, DNC, AI calls, AI campaigns, catalog, WS proxy)
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL')
if not BASE_URL:
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip()
BASE_URL = BASE_URL.rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = {"email": "civr.alice@example.com", "password": "AliceTest#2026"}
BOB = {"email": "civr.bob@example.com", "password": "BobTest#2026"}


def login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {creds['email']}: {r.status_code}")
    return s


@pytest.fixture(scope="module")
def alice():
    return login(ALICE)


@pytest.fixture(scope="module")
def bob():
    return login(BOB)


@pytest.fixture(scope="module")
def alice_business_number(alice):
    nums = alice.get(f"{API}/numbers").json()["numbers"]
    for n in nums:
        if n.get("plan") == "business" and n.get("status") == "active":
            return n["phoneNumber"]
    pytest.skip("no business number for alice")


def _number_on_plan(session, plan):
    for n in session.get(f"{API}/numbers").json()["numbers"]:
        if n.get("plan") == plan and n.get("status") == "active":
            return n["phoneNumber"]
    return None


@pytest.fixture(scope="module")
def bob_number(bob):
    # Bob's number is bought fresh on every preview pod, so look it up instead of hard-coding it.
    p = _number_on_plan(bob, "starter")
    if not p:
        pytest.skip("no starter number for bob")
    return p


@pytest.fixture(scope="module")
def alice_pro_number(alice):
    p = _number_on_plan(alice, "pro")
    if not p:
        pytest.skip("no pro number for alice")
    return p


def _num(session, phone):
    g = session.get(f"{API}/numbers/{requests.utils.quote(phone)}").json()
    return g.get("number", g)


IVR_BODY = {"enabled": True, "greeting": "TEST menu. Press 1 for sales.",
            "options": {"1": {"action": "forward", "forwardTo": "+14155550101", "label": "Sales"}}}


@pytest.fixture(scope="module")
def test_agent(alice):
    r = alice.post(f"{API}/ai-agents", json={
        "name": "TEST_Agent", "businessName": "TEST Biz", "goal": "Answer questions about our bakery hours politely.",
        "language": "en", "voice": "cedar", "transferTo": "+14155550100", "maxMinutes": 3, "takeMessages": True,
    })
    assert r.status_code == 201, r.text
    a = r.json()["agent"]
    yield a
    alice.delete(f"{API}/ai-agents/{a['id']}")


# --- listing
class TestList:
    def test_alice_list(self, alice):
        r = alice.get(f"{API}/ai-agents")
        assert r.status_code == 200
        d = r.json()
        assert d["rate"] == 0.2
        assert "marin" in d["voices"]
        assert d["canUse"] is True
        assert any(a["name"] == "Ava" for a in d["agents"])
        assert "_id" not in str(d)

    def test_bob_list(self, bob):
        r = bob.get(f"{API}/ai-agents")
        assert r.status_code == 200
        print("Bob canUse:", r.json()["canUse"])

    def test_unauth(self):
        assert requests.get(f"{API}/ai-agents").status_code in (401, 403)


# --- CRUD + validation + isolation
class TestCrud:
    def test_create_persist(self, alice, test_agent):
        assert test_agent["voice"] == "cedar" and test_agent["maxMinutes"] == 3
        g = alice.get(f"{API}/ai-agents/{test_agent['id']}")
        assert g.status_code == 200
        assert g.json()["agent"]["name"] == "TEST_Agent"
        assert g.json()["agent"]["transferTo"] == "+14155550100"

    @pytest.mark.parametrize("body", [
        {"name": "", "goal": "A long enough goal text here"},
        {"name": "X", "goal": "short"},
        {"name": "X", "goal": "A long enough goal text here", "transferTo": "123"},
    ])
    def test_validation(self, alice, body):
        r = alice.post(f"{API}/ai-agents", json=body)
        assert r.status_code == 400
        assert r.json()["error"] == "invalid_agent"

    def test_update(self, alice, test_agent):
        r = alice.put(f"{API}/ai-agents/{test_agent['id']}", json={"name": "TEST_Agent2", "goal": "Book appointments for the clinic."})
        assert r.status_code == 200, r.text
        assert r.json()["agent"]["name"] == "TEST_Agent2"
        assert alice.get(f"{API}/ai-agents/{test_agent['id']}").json()["agent"]["name"] == "TEST_Agent2"
        bad = alice.put(f"{API}/ai-agents/{test_agent['id']}", json={"name": "Y", "goal": "short"})
        assert bad.status_code == 400

    def test_isolation(self, bob, test_agent):
        aid = test_agent["id"]
        assert bob.get(f"{API}/ai-agents/{aid}").status_code == 404
        assert bob.put(f"{API}/ai-agents/{aid}", json={"name": "hack", "goal": "hack hack hack hack"}).status_code == 404
        assert bob.delete(f"{API}/ai-agents/{aid}").status_code == 404
        assert bob.post(f"{API}/ai-agents/{aid}/test", json={}).status_code == 404

    def test_test_token(self, alice, test_agent):
        r = alice.post(f"{API}/ai-agents/{test_agent['id']}/test", json={"as": "outbound"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["path"].startswith("/api/cloudivr-web/ai-agents/test/")
        assert 0 < d["maxSeconds"] <= 180

    def test_delete(self, alice):
        r = alice.post(f"{API}/ai-agents", json={"name": "TEST_Del", "goal": "Temporary agent for deletion test"})
        aid = r.json()["agent"]["id"]
        assert alice.delete(f"{API}/ai-agents/{aid}").json()["deleted"] is True
        assert alice.get(f"{API}/ai-agents/{aid}").status_code == 404


# --- number assignment
class TestNumberAssign:
    def test_assign_and_unassign(self, alice, test_agent, alice_business_number):
        p = alice_business_number
        orig = _num(alice, p)
        orig_ai = (orig.get("features") or {}).get("aiAgent")
        orig_ivr = (orig.get("features") or {}).get("ivr")
        try:
            r = alice.put(f"{API}/numbers/{p}/ai-agent", json={"enabled": True, "agentId": test_agent["id"]})
            assert r.status_code == 200, r.text
            assert r.json()["aiAgent"] == {"enabled": True, "agentId": test_agent["id"]}
            n = _num(alice, p)
            assert n["features"]["aiAgent"]["agentId"] == test_agent["id"]
            assert "aiAgent" in n.get("access", {}), n.get("access")
            lst = alice.get(f"{API}/ai-agents").json()["agents"]
            assert p in next(a for a in lst if a["id"] == test_agent["id"])["numbers"]
        finally:
            body = orig_ai if orig_ai and orig_ai.get("agentId") else {"enabled": False, "agentId": None}
            assert alice.put(f"{API}/numbers/{p}/ai-agent", json=body).status_code == 200
            if orig_ivr and orig_ivr.get("enabled"):
                assert alice.put(f"{API}/numbers/{p}/ivr", json=orig_ivr).status_code == 200

    def test_invalid_agent(self, alice, alice_business_number):
        r = alice.put(f"{API}/numbers/{alice_business_number}/ai-agent", json={"enabled": True, "agentId": "nope"})
        assert r.status_code == 400 and r.json()["error"] == "invalid_agent"

    def test_bob_starter_locked(self, bob, bob_number):
        r = bob.put(f"{API}/numbers/{bob_number}/ai-agent", json={"enabled": True, "agentId": "x"})
        assert r.status_code == 403 and r.json()["error"] == "plan_upgrade_required"
        assert "Business" in r.json()["message"]

    def test_pro_locked(self, alice, alice_pro_number):
        # The AI voice agent is Business-only now: a Pro number can no longer switch it on.
        r = alice.put(f"{API}/numbers/{alice_pro_number}/ai-agent", json={"enabled": True, "agentId": "x"})
        assert r.status_code == 403 and r.json()["error"] == "plan_upgrade_required"
        assert "Business" in r.json()["message"]
        n = _num(alice, alice_pro_number)
        assert n["access"]["aiAgent"] is False
        assert n["routeSummary"]["primary"] != "ai_agent"

    def test_not_mine(self, bob, alice_business_number):
        r = bob.put(f"{API}/numbers/{alice_business_number}/ai-agent", json={"enabled": False})
        assert r.status_code == 404


# --- only one answers a number: keypad menu (IVR) vs AI voice agent
class TestOneAnswers:
    def test_switches_each_other_off(self, alice, test_agent, alice_business_number):
        p = alice_business_number
        orig = _num(alice, p)
        orig_ai = orig["features"]["aiAgent"]
        orig_ivr = orig["features"]["ivr"]
        try:
            # keypad menu on (AI off) → turning the AI agent on switches the keypad menu off
            assert alice.put(f"{API}/numbers/{p}/ai-agent", json={"enabled": False, "agentId": None}).status_code == 200
            r = alice.put(f"{API}/numbers/{p}/ivr", json=IVR_BODY)
            assert r.status_code == 200, r.text
            assert r.json()["aiAgentTurnedOff"] is False
            r = alice.put(f"{API}/numbers/{p}/ai-agent", json={"enabled": True, "agentId": test_agent["id"]})
            assert r.status_code == 200, r.text
            assert r.json()["ivrTurnedOff"] is True
            n = _num(alice, p)
            assert n["features"]["ivr"]["enabled"] is False
            assert n["features"]["aiAgent"]["enabled"] is True
            assert n["routeSummary"]["primary"] == "ai_agent"

            # AI agent on → turning the keypad menu on switches the AI agent off
            r = alice.put(f"{API}/numbers/{p}/ivr", json=IVR_BODY)
            assert r.status_code == 200, r.text
            assert r.json()["aiAgentTurnedOff"] is True
            n = _num(alice, p)
            assert n["features"]["ivr"]["enabled"] is True
            assert n["features"]["aiAgent"]["enabled"] is False
            assert n["features"]["aiAgent"]["agentId"] == test_agent["id"]  # agent choice is kept, only switched off
            assert n["routeSummary"]["primary"] != "ai_agent"

            # Switching the AI agent OFF never touches the keypad menu
            r = alice.put(f"{API}/numbers/{p}/ai-agent", json={"enabled": False, "agentId": test_agent["id"]})
            assert r.status_code == 200 and r.json()["ivrTurnedOff"] is False
            assert _num(alice, p)["features"]["ivr"]["enabled"] is True
        finally:
            alice.put(f"{API}/numbers/{p}/ai-agent", json={"enabled": False, "agentId": None})
            if orig_ivr.get("enabled"):
                alice.put(f"{API}/numbers/{p}/ivr", json=orig_ivr)
            else:
                alice.put(f"{API}/numbers/{p}/ivr", json={**IVR_BODY, "enabled": False})
            if orig_ai.get("enabled") and orig_ai.get("agentId"):
                alice.put(f"{API}/numbers/{p}/ai-agent", json=orig_ai)


# --- do-not-call
class TestDnc:
    def test_dnc_crud(self, alice, bob):
        num = "+14155550199"
        r = alice.post(f"{API}/ai-dnc", json={"number": num})
        assert r.status_code == 201 and r.json()["number"] == num
        assert any(x["number"] == num for x in alice.get(f"{API}/ai-dnc").json()["numbers"])
        assert not any(x["number"] == num for x in bob.get(f"{API}/ai-dnc").json()["numbers"])
        assert alice.post(f"{API}/ai-dnc", json={"number": "12"}).status_code == 400
        assert alice.delete(f"{API}/ai-dnc/{requests.utils.quote(num)}").status_code == 200
        assert not any(x["number"] == num for x in alice.get(f"{API}/ai-dnc").json()["numbers"])


# --- AI call history
class TestCalls:
    def test_calls(self, alice, bob):
        calls = alice.get(f"{API}/ai-calls").json()["calls"]
        if not calls:
            pytest.skip("no AI calls yet on this preview DB (a browser test talk creates one)")
        assert "transcript" not in calls[0]
        c = alice.get(f"{API}/ai-calls/{calls[0]['id']}")
        assert c.status_code == 200
        assert isinstance(c.json()["call"]["transcript"], list)
        assert bob.get(f"{API}/ai-calls/{calls[0]['id']}").status_code == 404


# --- AI campaigns
class TestCampaigns:
    def test_ai_campaign(self, alice, test_agent, alice_business_number):
        alice.post(f"{API}/ai-dnc", json={"number": "+14155550177"})
        try:
            r = alice.post(f"{API}/campaigns", json={"mode": "ai", "agentId": test_agent["id"], "callerId": alice_business_number,
                                                    "leads": "+14155550177,Dnc\n+14155550178,Joe", "concurrency": 2})
            assert r.status_code == 201, r.text
            d = r.json()
            assert d["doNotCall"] == 1 and d["rate"] == 0.2
            c = d["campaign"]
            assert c["mode"] == "ai"
            assert c.get("audioName") == "AI agent: TEST_Agent2" or c.get("audioName", "").startswith("AI agent:")
            print("campaign keys:", list(c.keys()))
            g = alice.get(f"{API}/campaigns/{c['id']}").json()["campaign"]
            assert g["mode"] == "ai"
            print("agentName:", g.get("agentName"))
            s = alice.post(f"{API}/campaigns/{c['id']}/start")
            assert s.status_code == 202 and s.json()["dryRun"] is True
        finally:
            alice.delete(f"{API}/ai-dnc/{requests.utils.quote('+14155550177')}")

    def test_ai_campaign_invalid_agent(self, alice, alice_business_number):
        r = alice.post(f"{API}/campaigns", json={"mode": "ai", "agentId": "bad", "callerId": alice_business_number, "leads": "+14155550178"})
        assert r.status_code == 400 and r.json()["error"] == "invalid_agent"

    def test_ai_campaign_bob(self, bob, bob_number):
        r = bob.post(f"{API}/campaigns", json={"mode": "ai", "agentId": "x", "callerId": bob_number, "leads": "+14155550178"})
        assert r.status_code == 403, r.text

    def test_audio_campaign_regression(self, alice, alice_business_number):
        audios = alice.get(f"{API}/audio").json()["audios"]
        if not audios:
            pytest.skip("no audio")
        r = alice.post(f"{API}/campaigns", json={"mode": "report_only", "audioId": audios[0]["id"], "callerId": alice_business_number,
                                                "leads": "+14155550178", "concurrency": 1})
        assert r.status_code == 201, r.text
        assert r.json()["campaign"]["mode"] != "ai"


# --- catalog
class TestCatalog:
    def test_public_catalog(self):
        d = requests.get(f"{API}/public/catalog").json()
        plans = {p["id"]: p for p in d["plans"]}
        inc = lambda pid: next(f for f in plans[pid]["webFeatures"] if f["key"] == "aiAgent")["included"]
        assert inc("starter") is False and inc("pro") is False and inc("business") is True
        rate = d["rates"]["aiAgentPerMin"]
        assert isinstance(rate, (int, float)) and rate > 0
