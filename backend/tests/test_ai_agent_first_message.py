# AI voice agent: First message / waitForHello / opening-preview / AI campaign regression
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
GOAL = "Book a free dental cleaning and get the caller's preferred time."


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    return s


@pytest.fixture(scope="module")
def alice():
    return login("civr.alice@example.com", "AliceTest#2026")


@pytest.fixture(scope="module")
def created(alice):
    ids = []
    yield ids
    for i in ids:
        alice.delete(f"{API}/ai-agents/{i}")


def preview(s, **kw):
    body = {"name": "Ava", "businessName": "Sunrise Dental", "language": "en", "firstMessage": "", "record": True}
    body.update(kw)
    r = s.post(f"{API}/ai-agents/opening-preview", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# --- agent CRUD with firstMessage/waitForHello ---
class TestAgentFields:
    def test_create_get_put(self, alice, created):
        r = alice.post(f"{API}/ai-agents", json={"name": "TEST_Fm", "businessName": "Sunrise Dental", "goal": GOAL,
                                                 "firstMessage": "Hi {lead_name|there}, this is {name}.", "waitForHello": True})
        assert r.status_code == 201, r.text
        a = r.json()["agent"]
        created.append(a["id"])
        assert a["firstMessage"] == "Hi {lead_name|there}, this is {name}."
        assert a["waitForHello"] is True
        for bad in ("outbound", "screening", "review", "flagged", "blocked"):
            assert not any(bad in k.lower() for k in a.keys()), a.keys()
        g = alice.get(f"{API}/ai-agents/{a['id']}").json()["agent"]
        assert g["firstMessage"] == a["firstMessage"] and g["waitForHello"] is True
        p = alice.put(f"{API}/ai-agents/{a['id']}", json={**g, "firstMessage": "Hello there.", "waitForHello": False})
        assert p.status_code == 200, p.text
        g2 = alice.get(f"{API}/ai-agents/{a['id']}").json()["agent"]
        assert g2["firstMessage"] == "Hello there." and g2["waitForHello"] is False

    def test_defaults(self, alice, created):
        r = alice.post(f"{API}/ai-agents", json={"name": "TEST_Def", "goal": GOAL})
        assert r.status_code == 201
        a = r.json()["agent"]
        created.append(a["id"])
        assert a["firstMessage"] == "" and a["waitForHello"] is False

    def test_list_no_review_fields(self, alice):
        r = alice.get(f"{API}/ai-agents")
        assert r.status_code == 200
        txt = r.text.lower()
        assert "screening" not in txt and "inreview" not in txt and '"review' not in txt


# --- opening preview ---
class TestPreview:
    def test_auth_required(self):
        r = requests.post(f"{API}/ai-agents/opening-preview", json={})
        assert r.status_code in (401, 403)

    def test_a_standard(self, alice):
        d = preview(alice)
        assert d["sampleLead"] == "Alex"
        assert d["outbound"]["text"] == "Hi, this is Ava, an AI assistant calling for Sunrise Dental. This call may be recorded. Do you have a minute?"
        assert d["outbound"]["custom"] is False
        assert set(d["inbound"].keys()) >= {"text", "custom", "aiAdded", "recAdded"}
        assert "Thanks for calling Sunrise Dental" in d["inbound"]["text"]

    def test_b_lead_name(self, alice):
        d = preview(alice, firstMessage="Hi, may I speak with {lead_name}?")
        o = d["outbound"]
        assert o["text"] == "Hi, I'm Ava, an AI assistant. This call may be recorded. May I speak with Alex?", o
        assert o["aiAdded"] is True and o["recAdded"] is True and o["custom"] is True
        assert d["outboundNoName"].endswith("May I speak with the right person?"), d["outboundNoName"]

    def test_c_already_has_notices(self, alice):
        msg = "Hello {lead_name}, this is {name}, an AI assistant from {business}. This call is recorded. Got a minute?"
        o = preview(alice, firstMessage=msg)["outbound"]
        assert o["aiAdded"] is False and o["recAdded"] is False
        assert o["text"] == "Hello Alex, this is Ava, an AI assistant from Sunrise Dental. This call is recorded. Got a minute?"

    def test_d_no_record(self, alice):
        d = preview(alice, firstMessage="Hi, may I speak with {lead_name}?", record=False)
        assert "recorded" not in d["outbound"]["text"] and d["outbound"]["recAdded"] is False
        assert "recorded" not in preview(alice, record=False)["outbound"]["text"]

    def test_e_fallback(self, alice):
        d = preview(alice, firstMessage="Hi {lead_name|there}, this is an AI assistant. This call may be recorded. Ok?")
        assert d["outbound"]["text"].startswith("Hi Alex,")
        assert d["outboundNoName"].startswith("Hi there,"), d["outboundNoName"]
        assert d["inbound"]["text"].startswith("Hi there,")

    def test_f_pause_removed(self, alice):
        d = preview(alice, firstMessage="Hi {lead_name}. [PAUSE] Do you have a minute?")
        assert "[" not in d["outbound"]["text"] and "PAUSE" not in d["outbound"]["text"]

    def test_g_named_short_form(self, alice):
        d = preview(alice, firstMessage="Hi, this is {name} from {business}. Do you have a minute?")
        t = d["outbound"]["text"]
        assert "I'm an AI assistant." in t and t.count("Ava") == 1, t

    def test_h_spanish(self, alice):
        d = preview(alice, language="es", firstMessage="Hola {lead_name}, ¿tiene un minuto?")
        assert "asistente de IA" in d["outbound"]["text"], d["outbound"]["text"]
        assert "grabada" in d["outbound"]["text"]


# --- AI campaign regression (DRY RUN) ---
class TestCampaign:
    def test_ai_campaign(self, alice, created):
        a = alice.post(f"{API}/ai-agents", json={"name": "TEST_Camp", "goal": GOAL}).json()["agent"]
        created.append(a["id"])
        r = alice.post(f"{API}/campaigns", json={"mode": "ai", "agentId": a["id"], "callerId": "+13346972125", "leads": "+14155550100,John"})
        print(r.status_code, r.text[:300])
        assert r.status_code == 201, r.text
