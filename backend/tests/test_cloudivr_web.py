# CloudIVR web app API tests: auth, isolation, numbers, IVR, wallet, audio, calls, campaigns (preview dry-run)
import os, uuid, time, urllib.parse
import pytest, requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
A = ("civr.alice@example.com", "AliceTest#2026")
B = ("civr.bob@example.com", "BobTest#2026")


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code} {r.text}")
    return s


@pytest.fixture(scope="module")
def sa():
    return login(*A)


@pytest.fixture(scope="module")
def sb():
    return login(*B)


@pytest.fixture(scope="module")
def a_phone(sa):
    nums = sa.get(f"{API}/numbers").json()["numbers"]
    act = [n for n in nums if n["status"] == "active" and n["plan"] in ("pro", "business")]
    if not act:
        pytest.skip("Alice has no active pro/business number")
    return act[0]["phoneNumber"]


def enc(p):
    return urllib.parse.quote(p, safe="")


# --- Auth ---
class TestAuth:
    def test_config_google_null(self):
        r = requests.get(f"{API}/auth/config")
        assert r.status_code == 200 and r.json()["googleClientId"] is None

    def test_register_login_logout(self):
        s = requests.Session()
        email = f"civr.qa+{uuid.uuid4().hex[:8]}@example.com"
        r = s.post(f"{API}/auth/register", json={"email": email, "password": "QaTest#2026", "name": "QA"})
        assert r.status_code == 201, r.text
        assert r.json()["account"]["email"] == email
        assert s.get(f"{API}/auth/me").json()["account"]["email"] == email
        # duplicate
        assert requests.post(f"{API}/auth/register", json={"email": email, "password": "QaTest#2026"}).status_code == 409
        s.post(f"{API}/auth/logout")
        s.cookies.clear()
        assert s.get(f"{API}/auth/me").status_code == 401

    def test_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": f"civr.nobody{uuid.uuid4().hex[:5]}@example.com", "password": "x" * 9})
        assert r.status_code == 401 and r.json()["error"] == "invalid_credentials"

    def test_forgot_generic(self):
        r = requests.post(f"{API}/auth/forgot", json={"email": "nonexistent-xyz@example.com"})
        assert r.status_code == 200 and "If an account exists" in r.json().get("message", "")

    @pytest.mark.parametrize("path", ["/numbers", "/wallet", "/notifications", "/audio", "/campaigns", "/dashboard", "/catalog"])
    def test_401_without_cookie(self, path):
        assert requests.get(f"{API}{path}").status_code == 401


# --- Account isolation ---
class TestIsolation:
    def test_b_cannot_access_a_number(self, sb, a_phone):
        p = enc(a_phone)
        checks = [
            sb.get(f"{API}/numbers/{p}"),
            sb.patch(f"{API}/numbers/{p}/forwarding", json={"mode": "always", "forwardTo": "+14155550100"}),
            sb.patch(f"{API}/numbers/{p}/voicemail", json={"enabled": True}),
            sb.patch(f"{API}/numbers/{p}/sms", json={}),
            sb.patch(f"{API}/numbers/{p}/recording", json={"enabled": True}),
            sb.put(f"{API}/numbers/{p}/ivr", json={"enabled": False, "options": {}}),
            sb.get(f"{API}/numbers/{p}/sip"),
            sb.post(f"{API}/numbers/{p}/sip/reset"),
            sb.get(f"{API}/numbers/{p}/logs"),
            sb.post(f"{API}/numbers/{p}/renew"),
            sb.post(f"{API}/numbers/{p}/upgrade", json={"plan": "business"}),
            sb.post(f"{API}/numbers/{p}/auto-renew", json={"enabled": False}),
            sb.delete(f"{API}/numbers/{p}", json={"confirm": a_phone}),
        ]
        codes = [r.status_code for r in checks]
        assert all(c == 404 for c in codes), codes

    def test_b_cannot_use_a_caller_id(self, sb, a_phone):
        r1 = sb.post(f"{API}/calls/quick", json={"callerId": a_phone, "to": "+14155550100", "audioId": "x", "transferTo": "+14155550101"})
        r2 = sb.post(f"{API}/campaigns", json={"callerId": a_phone, "audioId": "x", "leads": "+14155550100"})
        assert r1.status_code == 400 and r1.json()["error"] == "invalid_caller"
        assert r2.status_code == 400 and r2.json()["error"] == "invalid_caller"

    def test_b_lists_only_own(self, sa, sb, a_phone):
        bn = [n["phoneNumber"] for n in sb.get(f"{API}/numbers").json()["numbers"]]
        assert a_phone not in bn
        a_aud = {x["id"] for x in sa.get(f"{API}/audio").json()["audios"]}
        b_aud = {x["id"] for x in sb.get(f"{API}/audio").json()["audios"]}
        assert not (a_aud & b_aud)


# --- Number settings (Alice, business plan) ---
class TestNumberSettings:
    def test_forwarding_validation(self, sa, a_phone):
        p = enc(a_phone)
        assert sa.patch(f"{API}/numbers/{p}/forwarding", json={"mode": "always", "forwardTo": "123"}).status_code == 400
        r = sa.patch(f"{API}/numbers/{p}/forwarding", json={"mode": "always", "forwardTo": a_phone})
        assert r.status_code == 400 and r.json()["error"] == "self_forward"
        r = sa.patch(f"{API}/numbers/{p}/forwarding", json={"mode": "busy", "forwardTo": "+14155550123"})
        assert r.status_code == 200 and r.json()["callForwarding"]["mode"] == "busy"
        n = sa.get(f"{API}/numbers/{p}").json()["number"]
        assert n["features"]["callForwarding"]["forwardTo"] == "+14155550123"
        assert sa.patch(f"{API}/numbers/{p}/forwarding", json={"mode": "disabled"}).status_code == 200

    def test_ivr_validation_and_save(self, sa, a_phone):
        p = enc(a_phone)
        r = sa.put(f"{API}/numbers/{p}/ivr", json={"enabled": True, "options": {}})
        assert r.status_code == 400
        r = sa.put(f"{API}/numbers/{p}/ivr", json={"enabled": True, "options": {"1": {"action": "forward", "forwardTo": "12"}}})
        assert r.status_code == 400
        body = {"enabled": True, "greeting": "Hi", "options": {
            "1": {"action": "forward", "forwardTo": "+14155550111"},
            "2": {"action": "message", "message": "We are open 9-5"},
            "3": {"action": "voicemail"},
            "4": {"action": "submenu", "subMenu": {"greeting": "Sub", "options": {"1": {"action": "message", "message": "sub msg"}}}}}}
        r = sa.put(f"{API}/numbers/{p}/ivr", json=body)
        assert r.status_code == 200, r.text
        n = sa.get(f"{API}/numbers/{p}").json()["number"]
        assert n["features"]["ivr"]["enabled"] is True and set(n["features"]["ivr"]["options"]) == {"1", "2", "3", "4"}

    def test_sms_https_only(self, sa, a_phone):
        p = enc(a_phone)
        assert sa.patch(f"{API}/numbers/{p}/sms", json={"webhookUrl": "http://x.com/h"}).status_code == 400
        assert sa.patch(f"{API}/numbers/{p}/sms", json={"webhookUrl": "https://x.com/h", "toEmail": "a@b.com"}).status_code == 200

    def test_sip_live_false(self, sa, a_phone):
        r = sa.get(f"{API}/numbers/{enc(a_phone)}/sip")
        assert r.status_code == 200 and r.json()["live"] is False and r.json()["password"]

    def test_upgrade_quote_invalid(self, sa, a_phone):
        r = sa.post(f"{API}/numbers/{enc(a_phone)}/upgrade", json={"plan": "starter"})
        assert r.status_code == 400

    def test_delete_requires_confirm(self, sa, a_phone):
        r = sa.delete(f"{API}/numbers/{enc(a_phone)}", json={"confirm": "wrong"})
        assert r.status_code == 400 and r.json()["error"] == "confirm_required"


# --- Wallet ---
class TestWallet:
    def test_topup_validation_and_preview(self, sb):
        w = sb.get(f"{API}/wallet").json()
        coin = w["coins"][0]
        assert sb.post(f"{API}/wallet/topup", json={"amountUsd": 5, "coin": coin}).status_code == 400
        assert sb.post(f"{API}/wallet/topup", json={"amountUsd": 10001, "coin": coin}).status_code == 400
        r = sb.post(f"{API}/wallet/topup", json={"amountUsd": 25, "coin": coin})
        assert r.status_code == 201 and r.json()["address"] == "PREVIEW-MODE-DO-NOT-SEND-FUNDS"


# --- Search / catalog ---
class TestCatalog:
    def test_catalog_no_carrier(self, sa):
        r = sa.get(f"{API}/catalog")
        txt = r.text.lower()
        assert len(r.json()["countries"]) >= 17
        assert "twilio" not in txt

    def test_buy_needs_search(self, sb):
        r = sb.post(f"{API}/numbers/buy", json={"phoneNumber": "+14155550100", "plan": "pro"})
        assert r.status_code == 400 and r.json()["error"] == "search_again"


# --- Audio + quick call + campaigns ---
class TestAudioCalls:
    def test_audio_tts_rename_isolation_quick_campaign(self, sa, sb, a_phone):
        voices = sa.get(f"{API}/audio/voices").json()["voices"]
        r = sa.post(f"{API}/audio/tts", json={"text": "Hello from the QA test.", "voice": voices[0]["key"], "speed": 1, "name": "TEST_tts"}, timeout=90)
        assert r.status_code == 201, r.text
        aud = r.json()["audio"]
        assert BASE_URL.split("//")[1] in aud["audioUrl"] or aud["audioUrl"].startswith("/api/"), aud["audioUrl"]
        f = requests.get(aud["audioUrl"] if aud["audioUrl"].startswith("http") else BASE_URL + aud["audioUrl"])
        assert f.status_code == 200
        # B can't rename/delete
        assert sb.patch(f"{API}/audio/{aud['id']}", json={"name": "hack"}).status_code == 404
        assert sb.delete(f"{API}/audio/{aud['id']}").status_code == 404
        assert sa.patch(f"{API}/audio/{aud['id']}", json={"name": "TEST_renamed"}).status_code == 200
        # quick call dry run
        q = sa.post(f"{API}/calls/quick", json={"callerId": a_phone, "to": "+14155550100", "audioId": aud["id"], "transferTo": "+14155550101"})
        assert q.status_code == 202 and "validated but not dialed" in q.json()["message"]
        bad = sa.post(f"{API}/calls/quick", json={"callerId": a_phone, "to": "12", "audioId": aud["id"], "transferTo": "+14155550101"})
        assert bad.status_code == 400
        # campaign
        sch = sa.post(f"{API}/campaigns", json={"callerId": a_phone, "audioId": aud["id"], "leads": "+14155550100", "scheduledFor": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 3600))})
        assert sch.status_code == 400 and sch.json()["error"] == "dry_run"
        c = sa.post(f"{API}/campaigns", json={"callerId": a_phone, "audioId": aud["id"], "leads": "+14155550100\n+14155550102,Bob", "mode": "report_only"})
        assert c.status_code == 201, c.text
        cid = c.json()["campaign"]["id"]
        assert sb.get(f"{API}/campaigns/{cid}").status_code == 404
        assert sb.post(f"{API}/campaigns/{cid}/cancel").status_code == 404
        st = sa.post(f"{API}/campaigns/{cid}/start")
        assert st.status_code == 202 and st.json()["dryRun"] is True
        cn = sa.post(f"{API}/campaigns/{cid}/cancel")
        assert cn.status_code == 200, cn.text
        assert sa.get(f"{API}/campaigns/{cid}").json()["campaign"]["status"] == "cancelled"
        assert sa.delete(f"{API}/audio/{aud['id']}").status_code == 200
