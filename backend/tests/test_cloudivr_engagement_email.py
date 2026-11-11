# CloudIVR web Bulk IVR live engagement: live view rate/ETA, Results engagement, follow-up campaigns (owner only),
# campaign summary email (webEmailLog) incl. hot=0 rendering, and the "campaigns" email switch.
# Run: REACT_APP_BACKEND_URL=... pytest /app/backend/tests/test_cloudivr_engagement_email.py -p no:xdist -v
import os, time, uuid
from datetime import datetime, timedelta, timezone
import pytest, requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
OWNER = ("civr.uxtest@example.com", "UxTest#2026")  # Alice/Bob are not present in this pod's DB
OWNER_ID = "5000000000000077"
CALLER, AUDIO = "+13341112222", "aud-split-test"
db = MongoClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
CREATED = []
STATE = {}


def nums(n, base=7000):
    return "\n".join(f"+1212555{base + i:04d}" for i in range(n))


def login(email, pw):
    x = requests.Session()
    r = x.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    return x, r


@pytest.fixture(scope="module")
def s():
    x, r = login(*OWNER)
    if r.status_code != 200:
        pytest.skip(f"owner login failed {r.status_code}")
    prev = x.get(f"{API}/prefs/email").json()["prefs"].get("campaigns", True)
    yield x
    x.put(f"{API}/prefs/email", json={"campaigns": prev})
    for cid in CREATED:
        db.bulkCallCampaigns.delete_one({"id": cid, "chatId": OWNER_ID})


@pytest.fixture(scope="module")
def intruder():
    email = f"test_intruder{int(time.time())}@example.com"
    x = requests.Session()
    r = x.post(f"{API}/auth/register", json={"email": email, "password": "QaTest#2026x"}, timeout=30)
    if r.status_code != 201:
        pytest.skip(f"intruder register failed {r.status_code} {r.text}")
    yield x
    STATE["intruder_id"] = r.json()["account"]["id"]


def make(s, n, name, **extra):
    body = {"name": name, "callerId": CALLER, "audioId": AUDIO, "leads": nums(n), "mode": "report_only", **extra}
    r = s.post(f"{API}/campaigns", json=body, timeout=60)
    assert r.status_code == 201, r.text
    cid = r.json()["campaign"]["id"]
    CREATED.append(cid)
    return cid


def fast_finish(cid, outcomes):
    """Mark leads done (preview only) with given statuses/durations and complete the campaign now."""
    now = datetime.now(timezone.utc)
    doc = db.bulkCallCampaigns.find_one({"id": cid})
    st = {"total": len(doc["leads"]), "completed": 0, "answered": 0, "noAnswer": 0, "busy": 0, "keyPressed": 0}
    sets = {}
    for i, l in enumerate(doc["leads"]):
        status, dur = outcomes[i % len(outcomes)]
        p = f"leads.{i}"
        sets.update({f"{p}.status": status, f"{p}.duration": dur, f"{p}.completedAt": now, f"{p}.startedAt": now, f"{p}.digitPressed": None, f"{p}.transferred": False})
        st["completed"] += 1
        if status == "completed": st["answered"] += 1
        if status == "no_answer": st["noAnswer"] += 1
        if status == "busy": st["busy"] += 1
    sets.update({"status": "completed", "startedAt": now - timedelta(seconds=60), "completedAt": now, "stats": st})
    db.bulkCallCampaigns.update_one({"id": cid, "chatId": OWNER_ID}, {"$set": sets})


def wait_email(cid, secs=100):
    end = time.time() + secs
    while time.time() < end:
        row = db.webEmailLog.find_one({"_id": f"campaign:{cid}"})
        if row and row.get("subject"):
            return row
        time.sleep(5)
    return db.webEmailLog.find_one({"_id": f"campaign:{cid}"})


# --- simulated run: live view + engagement + follow-ups ---
def test_sim_run_live_view(s):
    cid = make(s, 10, "TEST_eng_sim")
    STATE["sim"] = cid
    r = s.post(f"{API}/campaigns/{cid}/start", json={})
    assert r.status_code == 202, r.text
    time.sleep(6)
    c = s.get(f"{API}/campaigns/{cid}").json()["campaign"]
    lv = c["live"]
    print("early live", lv)
    assert c["status"] == "running"
    assert lv["pipeline"]["done"] >= 2
    assert lv["ratePerMin"] >= 4, lv  # not the tiny 5-min average
    assert lv["etaSec"] is None or lv["etaSec"] < 600
    STATE["early_live"] = lv


def test_sim_completes_with_engagement(s):
    cid = STATE["sim"]
    end = time.time() + 60
    while time.time() < end:
        c = s.get(f"{API}/campaigns/{cid}").json()["campaign"]
        if c["status"] == "completed":
            break
        time.sleep(3)
    assert c["status"] == "completed"
    e = c["engagement"]
    print("engagement", e)
    assert e["called"] == 10 and e["total"] == 10
    assert e["hot"] == 2 and e["reached"] == 4 and e["listened"] == 2
    assert e["unanswered"] == 4 and e["people"] == 4
    assert e["bestHour"] is not None and e["bestArea"] is not None


def test_followup_owner_now_and_best(s):
    cid = STATE["sim"]
    r = s.post(f"{API}/campaigns/{cid}/followup", json={"kind": "unanswered", "when": "now"})
    assert r.status_code == 201, r.text
    d = r.json()
    CREATED.append(d["campaign"]["id"])
    assert d["leadsCount"] == 4 and d["scheduledFor"] is None
    doc = db.bulkCallCampaigns.find_one({"id": d["campaign"]["id"]})
    assert doc["chatId"] == OWNER_ID and doc["followupOf"] == cid and doc.get("dryRun") is True
    assert doc["name"].endswith("unanswered") and len(doc["leads"]) == 4
    # preview: the follow-up must be startable (simulated) like its parent
    st = s.post(f"{API}/campaigns/{d['campaign']['id']}/start", json={})
    assert st.status_code == 202, st.text
    r2 = s.post(f"{API}/campaigns/{cid}/followup", json={"kind": "unanswered", "when": "best"})
    assert r2.status_code == 201, r2.text
    fid = r2.json()["campaign"]["id"]
    CREATED.append(fid)
    assert r2.json()["scheduledFor"]
    assert db.bulkCallCampaigns.find_one({"id": fid})["dryRun"] is True  # never picked up by the real scheduler
    db.bulkCallCampaigns.delete_one({"id": fid, "chatId": OWNER_ID})
    r3 = s.post(f"{API}/campaigns/{cid}/followup", json={"kind": "listeners"})
    assert r3.status_code == 400  # both 30s+ listeners pressed a key


def test_followup_other_user_forbidden(s, intruder):
    cid = STATE["sim"]
    before = db.bulkCallCampaigns.count_documents({"followupOf": cid})
    r = intruder.post(f"{API}/campaigns/{cid}/followup", json={"kind": "unanswered"})
    assert r.status_code in (403, 404), r.text
    assert intruder.get(f"{API}/campaigns/{cid}").status_code in (403, 404)
    assert db.bulkCallCampaigns.count_documents({"followupOf": cid}) == before


def test_campaign_done_email_sim(s):
    row = wait_email(STATE["sim"])
    assert row, "no campaignDone email recorded"
    assert row["type"] == "campaignDone" and row["chatId"] == OWNER_ID
    html = row.get("html", "")
    assert "undefined" not in html and "NaN" not in html
    assert "People reached" in html and "Hot leads" in html


# --- hot = 0 email: reach + re-call tip shown, hot row hidden ---
def test_campaign_done_email_no_hot(s):
    assert s.put(f"{API}/prefs/email", json={"campaigns": True}).status_code == 200
    cid = make(s, 6, "TEST_eng_nohot")
    fast_finish(cid, [("completed", 40), ("no_answer", 0), ("busy", 0)])
    row = wait_email(cid)
    assert row, "no campaignDone email for hot=0 campaign"
    html = row.get("html", "")
    assert "undefined" not in html and "NaN" not in html
    assert "People reached" in html
    assert "Hot leads" not in html
    assert "didn’t answer" in html or "didn't answer" in html


# --- campaigns email switch OFF -> no email; ON again ---
def test_campaign_email_switch_off(s):
    r = s.put(f"{API}/prefs/email", json={"campaigns": False})
    assert r.status_code == 200 and r.json()["prefs"]["campaigns"] is False
    cid = make(s, 3, "TEST_eng_off")
    fast_finish(cid, [("completed", 40), ("no_answer", 0)])
    time.sleep(80)
    row = db.webEmailLog.find_one({"_id": f"campaign:{cid}"})
    assert row is None or row.get("ok") == "off"
    r = s.put(f"{API}/prefs/email", json={"campaigns": True})
    assert r.status_code == 200 and r.json()["prefs"]["campaigns"] is True
    assert s.get(f"{API}/prefs/email").json()["prefs"]["campaigns"] is True


def test_campaign_email_switch_on_again(s):
    cid = make(s, 3, "TEST_eng_on")
    fast_finish(cid, [("completed", 40), ("no_answer", 0)])
    assert wait_email(cid), "switch back ON did not restore campaignDone email"


def test_prefs_invalid_value(s):
    r = s.put(f"{API}/prefs/email", json={"campaigns": "no"})
    assert r.status_code == 400


def test_preview_campaign_done(s):
    r = s.get(f"{API}/emails/preview/campaignDone")
    assert r.status_code == 200
    assert "undefined" not in r.text and "NaN" not in r.text and "People reached" in r.text
