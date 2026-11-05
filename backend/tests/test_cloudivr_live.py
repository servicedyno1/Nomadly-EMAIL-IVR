# CloudIVR web: Live page API, campaign detail live/feed/areas/nextRun, repeat + daily limit, stop-repeat, DNC multi-add, dashboard liveCampaigns
# Requires: `node scripts/seed_civr_live_demo.js` run beforehand (seed-live-running / -limited / -next for Alice)
import os
import pytest, requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
A = ("civr.alice@example.com", "AliceTest#2026")
OTHERS = [("civr.carol@example.com", "CarolTest#2026"), ("qa.trial1793002485@example.com", "QaTest#2026x"), ("civr.bob@example.com", "BobTest#2026")]
CALLER = "+17377031678"
AUDIO = "00ae083c-7cc7-4a4a-8c23-f141dad09937"
CREATED = []


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    return s if r.status_code == 200 else None


@pytest.fixture(scope="module")
def sa():
    s = login(*A)
    if not s:
        pytest.skip("alice login failed")
    return s


@pytest.fixture(scope="module")
def sb():
    for e, p in OTHERS:
        s = login(e, p)
        if s:
            return s
    pytest.skip("no second account")


def base_body(**kw):
    b = {"name": "TEST_live_campaign", "callerId": CALLER, "audioId": AUDIO, "mode": "report_only", "leads": "+14155550131\n+14155550132\n+12125550133", "concurrency": 2}
    b.update(kw)
    return b


# --- Live endpoint ---
class TestLive:
    def test_unauth_401(self):
        r = requests.get(f"{API}/campaigns/live?tz=America/New_York")
        assert r.status_code == 401

    def test_live_shape(self, sa):
        r = sa.get(f"{API}/campaigns/live?tz=America/New_York")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["running", "paused", "callsToday", "answeredToday", "linesInUse", "lineCapacity", "ratePerMin"]:
            assert k in d["summary"], k
        ids = [c["id"] for c in d["campaigns"]]
        assert "seed-live-running" in ids and "seed-live-limited" in ids
        run = next(c for c in d["campaigns"] if c["id"] == "seed-live-running")
        assert set(run["live"]["pipeline"].keys()) == {"waiting", "ringing", "talking", "done"}
        assert run["live"]["pipeline"]["ringing"] == 1 and run["live"]["pipeline"]["talking"] == 1
        assert run["live"]["pipeline"]["waiting"] == 6
        assert run["live"]["linesInUse"] == 2
        assert run["repeat"] == "daily"
        assert d["summary"]["running"] >= 2
        assert d["summary"]["linesInUse"] >= 2
        up = [c["id"] for c in d["upcoming"]]
        assert "seed-live-next" in up
        sf = [c["scheduledFor"] for c in d["upcoming"]]
        assert sf == sorted(sf)
        assert len(d["feed"]) > 0
        f = d["feed"][0]
        for k in ["number", "area", "status", "phase", "at", "duration", "digitPressed", "transferred", "voicemailDropped", "outcome", "campaignName"]:
            assert k in f, k
        # in-flight first
        assert d["feed"][0]["phase"] in ("ringing", "talking")
        lim = next(c for c in d["campaigns"] if c["id"] == "seed-live-limited")
        assert lim["waitingForDailyLimit"] is True and lim["dailyLimit"] == 2 and lim["callsToday"] == 2
        assert lim["live"]["etaSec"] is None

    def test_isolation(self, sb):
        r = sb.get(f"{API}/campaigns/live?tz=America/New_York")
        assert r.status_code == 200
        d = r.json()
        ids = [c["id"] for c in d["campaigns"]] + [c["id"] for c in d["upcoming"]]
        assert not any(i.startswith("seed-live") for i in ids)
        assert not any("demo" in (f.get("campaignName") or "") for f in d["feed"])

    def test_dashboard_live_count(self, sa):
        r = sa.get(f"{API}/dashboard")
        assert r.status_code == 200
        assert r.json().get("liveCampaigns", 0) >= 2


# --- Campaign detail ---
class TestDetail:
    def test_detail_live_feed_areas(self, sa):
        r = sa.get(f"{API}/campaigns/seed-live-running")
        assert r.status_code == 200, r.text
        c = r.json()["campaign"]
        assert c["live"]["pipeline"]["done"] == 7
        assert c["nextRun"]["id"] == "seed-live-next" and c["nextRun"]["status"] == "scheduled"
        feed = c["feed"]
        assert feed[0]["phase"] in ("ringing", "talking") and feed[1]["phase"] in ("ringing", "talking")
        done = [f for f in feed[2:]]
        ats = [f["at"] for f in done]
        assert ats == sorted(ats, reverse=True)
        areas = {a["area"]: a for a in c["areas"]}
        print(areas)
        assert len(areas) > 0
        for a in areas.values():
            assert a["answered"] <= a["called"] <= a["numbers"]
        # Illinois (+1312) is talking (in-flight) → answered must be 0
        il = [a for k, a in areas.items() if "Illinois" in k]
        if il:
            assert il[0]["answered"] == 0

    def test_detail_other_account_404(self, sb):
        r = sb.get(f"{API}/campaigns/seed-live-running")
        assert r.status_code == 404


# --- Create with repeat / daily limit ---
class TestCreate:
    def test_invalid_repeat(self, sa):
        r = sa.post(f"{API}/campaigns", json=base_body(repeat="monthly"))
        assert r.status_code == 400 and r.json()["error"] == "invalid_repeat", r.text

    @pytest.mark.parametrize("lim", [0, 10001, 2.5])
    def test_invalid_daily_limit(self, sa, lim):
        r = sa.post(f"{API}/campaigns", json=base_body(dailyLimit=lim))
        assert r.status_code == 400 and r.json()["error"] == "invalid_daily_limit", r.text

    def test_schedule_dry_run_refused(self, sa):
        import datetime
        t = (datetime.datetime.utcnow() + datetime.timedelta(hours=2)).isoformat() + "Z"
        r = sa.post(f"{API}/campaigns", json=base_body(scheduledFor=t, repeat="daily"))
        assert r.status_code == 400 and r.json()["error"] == "dry_run"

    def test_create_repeat_weekly_with_dnc(self, sa):
        sa.post(f"{API}/ai-dnc", json={"numbers": "+14155550131"})
        r = sa.post(f"{API}/campaigns", json=base_body(repeat="weekly", dailyLimit=50, tz="America/New_York"))
        assert r.status_code == 201, r.text
        d = r.json()
        c = d["campaign"]
        CREATED.append(c["id"])
        assert c["repeat"] == "weekly" and c["seriesId"] == c["id"] and c["runNumber"] == 1
        assert c["dailyLimit"] == 50
        assert d["doNotCall"] == 1
        g = sa.get(f"{API}/campaigns/{c['id']}").json()["campaign"]
        assert g["repeat"] == "weekly" and g["dailyLimit"] == 50 and g["callsToday"] == 0
        sa.delete(f"{API}/ai-dnc/%2B14155550131")

    def test_stop_repeat(self, sa):
        r = sa.post(f"{API}/campaigns", json=base_body(repeat="daily", name="TEST_stop_repeat"))
        assert r.status_code == 201, r.text
        cid = r.json()["campaign"]["id"]
        CREATED.append(cid)
        r = sa.post(f"{API}/campaigns/{cid}/stop-repeat")
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True and r.json()["cancelledRuns"] == 0
        assert sa.get(f"{API}/campaigns/{cid}").json()["campaign"]["repeat"] is None
        r = sa.post(f"{API}/campaigns/{cid}/stop-repeat")
        assert r.status_code == 400 and r.json()["error"] == "stop_repeat_failed"

    def test_stop_repeat_non_repeating(self, sa):
        r = sa.post(f"{API}/campaigns", json=base_body(name="TEST_norepeat"))
        assert r.status_code == 201, r.text
        cid = r.json()["campaign"]["id"]
        CREATED.append(cid)
        assert r.json()["campaign"]["repeat"] is None
        r = sa.post(f"{API}/campaigns/{cid}/stop-repeat")
        assert r.status_code == 400 and r.json()["error"] == "stop_repeat_failed"


# --- Do-not-call ---
class TestDnc:
    def test_multi_add_list_delete(self, sa):
        r = sa.post(f"{API}/ai-dnc", json={"numbers": "+14155550111, +14155550112 junk"})
        assert r.status_code == 201, r.text
        assert r.json()["added"] == 2 and r.json()["invalid"] == 1
        r = sa.post(f"{API}/ai-dnc", json={"number": "+14155550113"})
        assert r.status_code == 201 and r.json()["added"] == 1
        r = sa.post(f"{API}/ai-dnc", json={"numbers": "junk abc"})
        assert r.status_code == 400
        lst = sa.get(f"{API}/ai-dnc").json()["numbers"]
        nums = [n.get("number") if isinstance(n, dict) else n for n in lst]
        for n in ["+14155550111", "+14155550112", "+14155550113"]:
            assert n in nums
        for n in ["+14155550111", "+14155550112", "+14155550113"]:
            assert sa.delete(f"{API}/ai-dnc/{requests.utils.quote(n)}").status_code == 200
        lst = sa.get(f"{API}/ai-dnc").json()["numbers"]
        nums = [n.get("number") if isinstance(n, dict) else n for n in lst]
        assert "+14155550111" not in nums


def teardown_module(module):
    s = login(*A)
    if s:
        for cid in CREATED:
            s.post(f"{API}/campaigns/{cid}/cancel")
    print("created campaigns:", CREATED)
