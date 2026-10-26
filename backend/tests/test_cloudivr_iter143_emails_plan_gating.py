# CloudIVR iteration 143: plan gating (Pro vs Business), email prefs/preview/test/log/unsubscribe, email engine (welcome/topup/numberLive)
import os, re, time, random, html as htmlmod
import pytest, requests

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE}/api/cloudivr-web"
ALICE = ("civr.alice@example.com", "AliceTest#2026")
BUS, PRO, STARTER = "+13313039039", "+13313039077", "+13313039088"
TYPES = ["welcome", "numberLive", "renewed", "upgraded", "renewSoon", "renewFailed", "suspended", "topup",
         "lowBalance", "walletEmpty", "campaignDone", "voicemail", "missed", "weekly"]


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    return s


@pytest.fixture(scope="module")
def alice():
    return login(*ALICE)


# ---- Plan gating ----
class TestPlanGating:
    def test_schedule_from_pro_403(self, alice):
        at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 3600))
        r = alice.post(f"{API}/calls/quick", json={"callerId": PRO, "targets": "+14155550123", "mode": "otp", "otp": {"length": 6}, "text": "Hello, enter your code.", "scheduleAt": at})
        assert r.status_code == 403, r.text
        assert r.json().get("error") == "plan_upgrade_required"

    def test_schedule_from_business_ok(self, alice):
        at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 3600))
        r = alice.post(f"{API}/calls/quick", json={"callerId": BUS, "targets": "+14155550123", "mode": "otp", "otp": {"length": 6}, "text": "Hello, enter your code.", "scheduleAt": at})
        assert r.status_code == 201, r.text
        assert r.json()["scheduled"] == 1
        # cleanup scheduled preview
        for c in alice.get(f"{API}/calls/scheduled").json()["calls"]:
            if c["status"] in ("preview", "pending"):
                alice.delete(f"{API}/calls/scheduled/{c['id']}")

    def test_preset_pro_403_business_ok(self, alice):
        r = alice.post(f"{API}/calls/presets", json={"name": "TEST_pro", "setup": {"callerId": PRO, "mode": "otp", "otp": {"length": 6}, "text": "Hello, enter your code."}})
        assert r.status_code == 403, r.text
        r = alice.post(f"{API}/calls/presets", json={"name": "TEST_bus", "setup": {"callerId": BUS, "mode": "otp", "otp": {"length": 6}, "text": "Hello, enter your code."}})
        assert r.status_code == 201, r.text
        pid = r.json()["preset"]["id"]
        assert any(p["id"] == pid for p in alice.get(f"{API}/calls/presets").json()["presets"])
        assert alice.delete(f"{API}/calls/presets/{pid}").status_code == 200

    def test_pro_immediate_quick_call_allowed(self, alice):
        r = alice.post(f"{API}/calls/quick", json={"callerId": PRO, "targets": "+14155550123", "mode": "otp", "otp": {"length": 6}, "text": "Hello, enter your code."})
        assert r.status_code in (200, 201, 202), r.text

    def test_prefs_voice_put(self, alice):
        g = alice.get(f"{API}/prefs/voice").json()
        assert g["canSave"] is True
        r = alice.put(f"{API}/prefs/voice", json={"voice": g.get("voice"), "speed": g.get("speed")})
        assert r.status_code == 200, r.text

    def test_relay_from_pro_403(self, alice):
        r = alice.post(f"{API}/relay/calls", json={"callerId": PRO, "to": "+14155550123"})
        assert r.status_code == 403, r.text
        assert "Business" in r.json()["message"]

    def test_text_triggers_gating(self, alice):
        r = alice.get(f"{API}/numbers/%2B13313039077/text-triggers")
        assert r.status_code == 403 and "Text Triggers need the Business plan" in r.json()["message"], r.text
        r = alice.put(f"{API}/numbers/%2B13313039077/text-triggers", json={"triggers": []})
        assert r.status_code == 403, r.text
        r = alice.get(f"{API}/numbers/%2B13313039039/text-triggers")
        assert r.status_code == 200, r.text


# ---- Email prefs / preview / test / log ----
class TestEmailApi:
    def test_prefs_get(self, alice):
        d = alice.get(f"{API}/prefs/email").json()
        assert d["email"] == ALICE[0]
        for k in ("weekly", "campaigns", "voicemail", "missed", "lowBalanceAt"):
            assert k in d["prefs"], d
        assert set(TYPES) <= set(d["types"])

    def test_prefs_put_validation_and_persist(self, alice):
        assert alice.put(f"{API}/prefs/email", json={"weekly": "yes"}).status_code == 400
        for v in (0, 5000):
            r = alice.put(f"{API}/prefs/email", json={"lowBalanceAt": v})
            assert r.status_code == 400 and "between $1 and $1,000" in r.json()["message"]
        assert alice.put(f"{API}/prefs/email", json={}).status_code == 400
        r = alice.put(f"{API}/prefs/email", json={"missed": False, "lowBalanceAt": 25})
        assert r.status_code == 200
        d = alice.get(f"{API}/prefs/email").json()["prefs"]
        assert d["missed"] is False and d["lowBalanceAt"] == 25
        alice.put(f"{API}/prefs/email", json={"weekly": True, "campaigns": True, "voicemail": True, "missed": True, "lowBalanceAt": 10})
        d = alice.get(f"{API}/prefs/email").json()["prefs"]
        assert d["missed"] is True and d["lowBalanceAt"] == 10

    @pytest.mark.parametrize("lang", ["en", "fr", "es"])
    def test_previews_all_types(self, alice, lang):
        bad = []
        for t in TYPES:
            r = alice.get(f"{API}/emails/preview/{t}?lang={lang}")
            h = r.text
            if r.status_code != 200 or "text/html" not in r.headers.get("content-type", ""):
                bad.append(f"{t}:{r.status_code}"); continue
            if f'lang="{lang}"' not in h:
                bad.append(f"{t}:lang")
            for tok in ("undefined", "NaN", "[object"):
                if tok in h:
                    bad.append(f"{t}:{tok}")
        assert not bad, bad

    def test_preview_language_words(self, alice):
        fr = alice.get(f"{API}/emails/preview/topup?lang=fr").text.lower()
        es = alice.get(f"{API}/emails/preview/topup?lang=es").text.lower()
        assert any(w in fr for w in ("votre", "portefeuille", "solde")), fr[:500]
        assert any(w in es for w in ("tu ", "saldo", "billetera", "monedero", "cartera")), es[:500]

    def test_preview_unknown_and_unauth(self, alice):
        assert alice.get(f"{API}/emails/preview/nope").status_code == 404
        assert requests.get(f"{API}/emails/preview/weekly").status_code == 401

    def test_unsubscribe_link_flow(self, alice):
        h = alice.get(f"{API}/emails/preview/weekly?lang=en").text
        m = re.search(r'(/api/cloudivr-web/public/email/off\?[^"\']+)', h)
        assert m, "no unsubscribe link in weekly"
        url = BASE + htmlmod.unescape(m.group(1))
        r = requests.get(url)
        assert r.status_code == 200 and "Stop these emails?" in r.text and "<form" in r.text.lower()
        r = requests.post(url)
        assert r.status_code == 200 and "unsubscribed" in r.text
        assert alice.get(f"{API}/prefs/email").json()["prefs"]["weekly"] is False
        tampered = re.sub(r't=[^&]+', 't=deadbeef', url)
        assert requests.get(tampered).status_code == 400
        alice.put(f"{API}/prefs/email", json={"weekly": True})
        assert alice.get(f"{API}/prefs/email").json()["prefs"]["weekly"] is True


# ---- Email engine with a fresh account ----
class TestEmailEngine:
    def test_register_welcome_lang_checkout_and_rate_limit(self):
        email = f"qa.mail{random.randint(10**6, 10**7)}@example.com"
        s = requests.Session()
        r = s.post(f"{API}/auth/register", json={"email": email, "password": "QaTest#2026x"})
        assert r.status_code in (200, 201, 202), r.text
        print("registered", email)
        # welcome within ~100s
        types = []
        for _ in range(20):
            types = [e["type"] for e in s.get(f"{API}/emails/log").json()["emails"]]
            if "welcome" in types:
                break
            time.sleep(5)
        assert "welcome" in types, types
        assert s.put(f"{API}/prefs/lang", json={"lang": "fr"}).status_code == 200
        # checkout + simulate payment
        sr = s.get(f"{API}/numbers/search?country=US")
        assert sr.status_code == 200, sr.text
        sj = sr.json()
        nums = sj.get("numbers") or sj.get("results") or []
        assert nums, sj
        phone = nums[0].get("phoneNumber") or nums[0].get("phone")
        co = s.post(f"{API}/numbers/checkout", json={"phoneNumber": phone, "plan": "starter", "method": "crypto", "coin": "USDT"})
        if co.status_code == 400 and co.json().get("error") == "invalid_coin":
            coin = co.json()["message"].split(":")[1].split(",")[0].strip().rstrip(".")
            co = s.post(f"{API}/numbers/checkout", json={"phoneNumber": phone, "plan": "starter", "method": "crypto", "coin": coin})
        assert co.status_code == 201, co.text
        oid = co.json()["order"]["id"]
        pay = s.post(f"{API}/numbers/orders/{oid}/simulate-payment", json={})
        assert pay.status_code == 200, pay.text
        rows = []
        for _ in range(24):
            rows = s.get(f"{API}/emails/log").json()["emails"]
            t = [e["type"] for e in rows]
            if "topup" in t and "numberLive" in t:
                break
            time.sleep(5)
        t = [e["type"] for e in rows]
        print("log rows", [(e["type"], e["subject"]) for e in rows])
        assert "topup" in t and "numberLive" in t, t
        later = [e for e in rows if e["type"] in ("topup", "numberLive")]
        assert all(e["status"] == "preview" for e in later)
        time.sleep(65)
        rows2 = s.get(f"{API}/emails/log").json()["emails"]
        t2 = [e["type"] for e in rows2]
        assert t2.count("topup") == 1 and t2.count("numberLive") == 1 and t2.count("welcome") == 1, t2
        # language of later emails via mongo
        from pymongo import MongoClient
        db = MongoClient("mongodb://localhost:27017")["test"]
        docs = list(db.webEmailLog.find({"to": email}, {"html": 0}))
        print("mongo rows", docs)
        for d in docs:
            if d["type"] in ("topup", "numberLive"):
                assert d["lang"] == "fr", d
        # test emails + rate limit
        r = s.post(f"{API}/emails/test", json={"type": "weekly"})
        assert r.status_code == 200 and r.json()["preview"] is True, r.text
        assert s.post(f"{API}/emails/test", json={"type": "bogus"}).status_code == 400
        codes = [s.post(f"{API}/emails/test", json={"type": "weekly"}).status_code for _ in range(10)]
        assert codes[:9] == [200] * 9 and codes[9] == 429, codes
        lg = s.get(f"{API}/emails/log").json()["emails"]
        assert any(e["test"] for e in lg)
        # cleanup: release number
        for n in (s.get(f"{API}/numbers").json().get("numbers") or []):
            print("number on qa acct", n.get("phoneNumber"), n.get("status"))
