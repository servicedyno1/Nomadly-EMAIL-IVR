# CloudIVR web: 21 bot-parity features (Quick IVR, trial, presets, redial, schedule, downgrade, extras, coupons,
# test-call/sip, IVR templates, voice prefs, campaign CSV, isolation). Calls/purchases are DRY-RUN in preview.
import os
import datetime as dt
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
A = ("civr.alice@example.com", "AliceTest#2026")
B = ("civr.bob@example.com", "BobTest#2026")
ALICE_MAIN = "+15156445205"
ALICE_EXTRA = "+15512568232"
BOB_MAIN = "+19565971129"


def enc(p):
    return requests.utils.quote(p, safe='')


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


QUICK = {"callerId": ALICE_MAIN, "to": "+14155550123", "text": "Hello, this is a test call. Press 1.", "transferTo": "+14155550199", "activeKeys": ["1"]}


# ── Quick IVR ──
class TestQuickIvr:
    def test_templates(self, sa):
        r = sa.get(f"{API}/outbound/templates")
        assert r.status_code == 200
        d = r.json()
        assert len(d["templates"]) > 0 and len(d["categories"]) > 0

    def test_fill(self, sa):
        r = sa.post(f"{API}/outbound/fill", json={"names": ["Amount", "Name"]})
        assert r.status_code == 200 and "values" in r.json()

    def test_quick_transfer_dryrun(self, sa):
        r = sa.post(f"{API}/calls/quick", json=QUICK)
        assert r.status_code == 202, r.text
        d = r.json()
        assert d["dryRun"] is True and "Preview mode: 1 call(s) validated" in d["message"]

    def test_quick_otp_and_menu(self, sa):
        r = sa.post(f"{API}/calls/quick", json={**QUICK, "mode": "otp", "otp": {"length": 8, "confirmMsg": "ok", "rejectMsg": "no"}})
        assert r.status_code == 202 and "8-digit" in r.json()["message"], r.text
        menu = {"1": {"action": "forward", "forwardTo": "+14155550111"}, "2": {"action": "message", "message": "Bye"},
                "3": {"action": "submenu", "greeting": "Pick", "options": {"1": {"action": "message", "message": "x"}}}}
        r = sa.post(f"{API}/calls/quick", json={**QUICK, "menu": menu})
        assert r.status_code == 202 and "route keys" in r.json()["message"], r.text

    def test_too_many_and_placeholders(self, sa):
        many = ",".join(f"+1415555{1000 + i}" for i in range(11))
        r = sa.post(f"{API}/calls/quick", json={**QUICK, "to": many})
        assert r.status_code == 400 and r.json()["error"] == "too_many_numbers"
        r = sa.post(f"{API}/calls/quick", json={**QUICK, "text": "Hello [Name], your code [Amount]"})
        assert r.status_code == 400 and r.json()["error"] == "unfilled_placeholders"

    def test_schedule_and_cancel(self, sa):
        at = (dt.datetime.utcnow() + dt.timedelta(minutes=30)).isoformat() + "Z"
        r = sa.post(f"{API}/calls/quick", json={**QUICK, "scheduleAt": at})
        assert r.status_code == 201 and r.json()["scheduled"] == 1, r.text
        bad = sa.post(f"{API}/calls/quick", json={**QUICK, "scheduleAt": (dt.datetime.utcnow() + dt.timedelta(minutes=1)).isoformat() + "Z"})
        assert bad.status_code == 400 and bad.json()["error"] == "invalid_schedule"
        lst = sa.get(f"{API}/calls/scheduled").json()["calls"]
        sid = [c for c in lst if c["status"] == "preview"][0]["id"]
        assert sa.delete(f"{API}/calls/scheduled/{sid}").status_code == 200
        assert sa.delete(f"{API}/calls/scheduled/{sid}").status_code == 404

    def test_history_recent_redial(self, sa, sb):
        h = sa.get(f"{API}/calls/history").json()["calls"]
        assert len(h) > 0
        assert "+14155550123" in sa.get(f"{API}/calls/recent").json()["numbers"]
        cid = [c for c in h if not c["trial"]][0]["id"]
        r = sa.post(f"{API}/calls/history/{cid}/redial")
        assert r.status_code == 202, r.text
        assert sb.post(f"{API}/calls/history/{cid}/redial").status_code == 404

    def test_presets_crud_and_isolation(self, sa, sb):
        setup = {k: v for k, v in QUICK.items() if k != "to"}
        r = sa.post(f"{API}/calls/presets", json={"name": "TEST_preset", "setup": setup})
        assert r.status_code == 201, r.text
        pid = r.json()["preset"]["id"]
        assert any(p["id"] == pid for p in sa.get(f"{API}/calls/presets").json()["presets"])
        assert sb.delete(f"{API}/calls/presets/{pid}").status_code == 404
        assert sa.delete(f"{API}/calls/presets/{pid}").status_code == 200
        assert not any(p["id"] == pid for p in sa.get(f"{API}/calls/presets").json()["presets"])

    def test_menu_stats(self, sa):
        assert sa.get(f"{API}/calls/menu-stats").status_code == 200

    def test_bob_cannot_use_alice_caller(self, sb):
        r = sb.post(f"{API}/calls/quick", json=QUICK)
        assert r.status_code == 400 and r.json()["error"] == "invalid_caller"


# ── Free trial ──
class TestTrial:
    def test_alice_no_trial(self, sa):
        assert sa.get(f"{API}/calls/trial").json()["available"] is False
        assert sa.post(f"{API}/calls/trial", json={"to": "+14155550123", "text": "hi", "transferTo": "+14155550199"}).status_code == 403

    def test_bob_trial_once(self, sb):
        assert sb.get(f"{API}/calls/trial").json()["available"] is True
        r = sb.post(f"{API}/calls/trial", json={"to": "+14155550123,+14155550124", "text": "hi", "transferTo": "+14155550199"})
        assert r.status_code == 400 and r.json()["error"] == "too_many_numbers"
        assert sb.get(f"{API}/calls/trial").json()["available"] is True  # validation failure must not burn the trial
        r = sb.post(f"{API}/calls/trial", json={"to": "+14155550123", "text": "hi", "transferTo": "+14155550199"})
        assert r.status_code == 202 and r.json()["dryRun"] is True, r.text
        r2 = sb.post(f"{API}/calls/trial", json={"to": "+14155550123", "text": "hi", "transferTo": "+14155550199"})
        assert r2.status_code == 403 and r2.json()["error"] == "trial_used"
        assert sb.get(f"{API}/calls/trial").json()["available"] is False


# ── Downgrade / extras / number tools ──
class TestNumberTools:
    def test_downgrade_preview_and_errors(self, sa):
        r = sa.post(f"{API}/numbers/{enc(ALICE_MAIN)}/downgrade", json={"plan": "pro"})
        assert r.status_code == 200, r.text
        p = r.json()["preview"]
        assert p["plan"] == "pro" and isinstance(p["lost"], list) and len(p["lost"]) > 0
        assert sa.post(f"{API}/numbers/{enc(ALICE_MAIN)}/downgrade", json={"plan": "business"}).json()["error"] == "invalid_plan"
        assert sa.post(f"{API}/numbers/{enc(ALICE_EXTRA)}/downgrade", json={"plan": "pro"}).json()["error"] == "is_extra"

    def test_extra_info(self, sa):
        d = sa.get(f"{API}/numbers/{enc(ALICE_MAIN)}/extra").json()
        assert d["allowed"] is True and d["used"] >= 1 and d["price"] == 25
        assert sa.get(f"{API}/numbers/{enc(ALICE_EXTRA)}/extra").json()["allowed"] is False

    def test_test_call_and_sip(self, sa, sb):
        r = sa.post(f"{API}/numbers/{enc(ALICE_MAIN)}/test-call")
        assert r.status_code == 202 and "Preview mode" in r.json()["message"]
        assert sa.post(f"{API}/numbers/{enc(ALICE_MAIN)}/test-sip").status_code == 202
        assert sb.post(f"{API}/numbers/{enc(BOB_MAIN)}/test-sip").status_code == 403
        assert sb.post(f"{API}/numbers/{enc(ALICE_MAIN)}/test-call").status_code == 404

    def test_ivr_templates_crud(self, sa, sb):
        d = sa.get(f"{API}/ivr/templates").json()
        assert len(d["builtin"]) > 0
        ivr = {"greeting": "Welcome", "options": {"1": {"action": "forward", "forwardTo": "+14155550111"}}}
        r = sa.post(f"{API}/ivr/templates", json={"name": "TEST_tpl", "ivr": ivr})
        assert r.status_code == 201, r.text
        tid = r.json()["template"]["id"]
        assert sb.delete(f"{API}/ivr/templates/{tid}").status_code == 404
        assert sa.delete(f"{API}/ivr/templates/{tid}").status_code == 200


# ── Coupons, voice prefs, support chat, CSV ──
class TestMisc:
    def test_coupons(self, sa, sb):
        t = sa.get(f"{API}/coupons/today").json()["coupon"]
        assert t and t["code"]
        ra = sa.post(f"{API}/coupons/check", json={"code": t["code"], "amount": 50})
        # fresh account (Bob already redeemed today's code in an earlier purchase)
        sn = requests.Session()
        email = f"qa.coupon{int(dt.datetime.utcnow().timestamp())}@example.com"
        assert sn.post(f"{API}/auth/register", json={"email": email, "password": "QaTest#2026x"}).status_code in (200, 201)
        rb = sn.post(f"{API}/coupons/check", json={"code": t["code"], "amount": 50})
        print("alice", ra.status_code, ra.text, "new", rb.status_code, rb.text)
        assert rb.status_code == 200
        assert ra.status_code == 400 and "already used" in ra.json()["message"]
        bad = sa.post(f"{API}/coupons/check", json={"code": "NOPE_XYZ", "amount": 50})
        assert bad.status_code == 400

    def test_voice_prefs(self, sa, sb):
        assert sa.put(f"{API}/prefs/voice", json={"voice": "onyx", "speed": 1}).status_code == 200
        r = sb.put(f"{API}/prefs/voice", json={"voice": "onyx"})
        assert r.status_code == 403 and r.json()["error"] == "plan_upgrade_required"

    def test_campaign_csv_isolation(self, sa, sb):
        camps = sa.get(f"{API}/campaigns").json()
        lst = camps.get("campaigns", camps) if isinstance(camps, dict) else camps
        if not lst:
            pytest.skip("no campaigns for alice")
        cid = lst[0]["id"]
        r = sa.get(f"{API}/campaigns/{cid}/report.csv")
        print("csv", r.status_code, r.headers.get("content-type"), r.text[:200])
        assert r.status_code == 200
        assert sb.get(f"{API}/campaigns/{cid}/report.csv").status_code == 404

    def test_support_chat(self, sa):
        assert sa.delete(f"{API}/support/chat").status_code == 200
        r = sa.post(f"{API}/support/chat", json={"message": "How do I add an extra number?", "lang": "en"}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        print("howto:", d)
        assert d["reply"] and d["escalate"] is False
        r = sa.post(f"{API}/support/chat", json={"message": "I want a refund", "lang": "en"}, timeout=90)
        d = r.json()
        print("refund:", d)
        assert d["escalate"] is True and "t.me/onarrival1" in d["supportLink"]
        g = sa.get(f"{API}/support/chat").json()
        assert len(g["messages"]) == 4


# ── Isolation: Bob vs Alice resources ──
class TestIsolation:
    def test_bob_cannot_touch_alice_numbers(self, sb):
        for method, path, body in [("get", f"/numbers/{enc(ALICE_MAIN)}", None), ("get", f"/numbers/{enc(ALICE_MAIN)}/extra", None),
                                   ("post", f"/numbers/{enc(ALICE_MAIN)}/downgrade", {"plan": "pro"}), ("post", f"/numbers/{enc(ALICE_MAIN)}/extra", {"phoneNumber": "+14155550100"}),
                                   ("post", f"/numbers/{enc(ALICE_MAIN)}/test-sip", None), ("patch", f"/numbers/{enc(ALICE_MAIN)}/fax", {"toInbox": False})]:
            r = getattr(sb, method)(f"{API}{path}", json=body)
            assert r.status_code == 404, f"{method} {path} -> {r.status_code}"

    def test_bob_lists_do_not_leak(self, sa, sb):
        a_hist = {c["id"] for c in sa.get(f"{API}/calls/history").json()["calls"]}
        b_hist = {c["id"] for c in sb.get(f"{API}/calls/history").json()["calls"]}
        assert not (a_hist & b_hist)
        a_sched = [c["id"] for c in sa.get(f"{API}/calls/scheduled").json()["calls"]]
        if a_sched:
            assert sb.delete(f"{API}/calls/scheduled/{a_sched[0]}").status_code == 404
        a_tpl = {t["id"] for t in sa.get(f"{API}/ivr/templates").json()["mine"]}
        b_tpl = {t["id"] for t in sb.get(f"{API}/ivr/templates").json()["mine"]}
        assert not (a_tpl & b_tpl)
        a_pre = {p["id"] for p in sa.get(f"{API}/calls/presets").json()["presets"]}
        assert not (a_pre & {p["id"] for p in sb.get(f"{API}/calls/presets").json()["presets"]})

    def test_unauthenticated_blocked(self):
        for p in ["/calls/history", "/calls/presets", "/support/chat", "/coupons/today", "/calls/trial"]:
            assert requests.get(f"{API}{p}").status_code == 401, p
