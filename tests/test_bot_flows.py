"""E2E bot flow test: RDP purchase, management, Linux VPS separation."""
import json, time, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from bot_harness import send_text, send_callback, all_button_labels, CHAT_ID
from pymongo import MongoClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test")
db = MongoClient(MONGO_URL)[DB_NAME]

results = []

def rec(name, ok, detail=""):
    results.append({"name": name, "ok": ok, "detail": detail})
    print(f"{'✅' if ok else '❌'} {name}  {detail}")

def last_with_buttons(calls):
    for c in reversed(calls):
        rm = c.get("reply_markup")
        if isinstance(rm, str):
            try: rm = json.loads(rm)
            except: rm = None
        if (c.get("buttons") or []) or rm:
            return c
    return calls[-1] if calls else None

def dump(call, label):
    if not call:
        print(f"[{label}] no message"); return
    print(f"--- {label} ---")
    print("text:", (call.get("text") or "")[:280])
    print("buttons:", all_button_labels(call))

def wait_last(text_query, wait=3.0):
    calls = send_text(text_query, wait=wait)
    return last_with_buttons(calls), calls

# ============================================================
# FLOW 1 — VPS/RDP hub
# ============================================================
print("\n### FLOW 1: VPS/RDP hub ###")
call, all_calls = wait_last("/start", wait=3.0)
dump(call, "after /start")

call, _ = wait_last("🖥️ VPS / RDP", wait=3.0)
dump(call, "hub")
btns = all_button_labels(call) if call else []
rec("F1: hub has Create Linux VPS", any("Create Linux VPS" in b for b in btns))
rec("F1: hub has Create Windows RDP", any("Create Windows RDP" in b for b in btns))
rec("F1: hub has Manage my servers", any("Manage my servers" in b for b in btns))
text = (call.get("text") or "") if call else ""
rec("F1: hub text mentions Linux VPS", "Linux" in text)
rec("F1: hub text mentions Windows RDP", "Windows RDP" in text or "RDP" in text)

# ============================================================
# FLOW 2 — RDP purchase (creates real DO droplet)
# ============================================================
print("\n### FLOW 2: RDP purchase (LIVE DO droplet) ###")
call, _ = wait_last("🪟 Create Windows RDP", wait=3.0)
dump(call, "regions")
btns = all_button_labels(call) if call else []
rec("F2: has NY region", any("New York" in b for b in btns))
rec("F2: has 9 DO regions", sum(1 for b in btns if any(r in b for r in ["New York","Francisco","Toronto","London","Frankfurt","Amsterdam","Bangalore","Singapore","Sydney"])) >= 9)

call, _ = wait_last("🇺🇸 United States (New York)", wait=3.0)
dump(call, "after region")

# Skip storage-type if it appears
text = (call.get("text") or "") if call else ""
btns = all_button_labels(call) if call else []
if "storage" in text.lower() or "disk" in text.lower():
    print("(storage step detected, picking first)")
    if btns:
        call, _ = wait_last(btns[0], wait=3.0)
        dump(call, "after storage")

# Plan screen
text = (call.get("text") or "") if call else ""
btns = all_button_labels(call) if call else []
rec("F2: plan screen shows Windows RDP header", "Windows RDP" in text or "RDP" in text)
rec("F2: plan screen NOT Cloud VPS", "Cloud VPS" not in text)
starter_btn = next((b for b in btns if "Starter" in b and "$" in b), None)
rec("F2: has Starter tier button", starter_btn is not None, f"btn={starter_btn}")

if not starter_btn:
    print("Cannot continue without Starter button. Buttons:", btns)
    print("Text:", text[:500])
    sys.exit(1)

call, _ = wait_last(starter_btn, wait=3.0)
dump(call, "after starter")

# Duration screen
text = (call.get("text") or "") if call else ""
btns = all_button_labels(call) if call else []
rec("F2: duration screen prompt", "prepay" in text.lower() or "how long" in text.lower())
mo1 = next((b for b in btns if "1 month" in b), None)
mo2 = next((b for b in btns if "2 month" in b), None)
mo3 = next((b for b in btns if "3 month" in b), None)
rec("F2: has 1-month duration button", mo1 is not None, f"1m={mo1}")
rec("F2: has 2-month duration button", mo2 is not None, f"2m={mo2}")
rec("F2: has 3-month duration button", mo3 is not None, f"3m={mo3}")

def price_of(label):
    import re
    m = re.search(r"\$([\d.]+)", label or "")
    return float(m.group(1)) if m else None

p1, p2, p3 = price_of(mo1), price_of(mo2), price_of(mo3)
if p1 and p2 and p3:
    rec("F2: 2m ≈ 2×1m", abs(p2 - 2*p1) < 1e-3, f"{p2}={2*p1}?")
    rec("F2: 3m ≈ 3×1m", abs(p3 - 3*p1) < 1e-3, f"{p3}={3*p1}?")

call, _ = wait_last(mo1, wait=3.0)
dump(call, "after 1m")

# Coupon
btns = all_button_labels(call) if call else []
skip_btn = next((b for b in btns if "Skip" in b), None)
rec("F2: coupon screen has skip", skip_btn is not None)
call, _ = wait_last(skip_btn or "❌ Skip", wait=3.0)
dump(call, "after skip -> edition")

btns = all_button_labels(call) if call else []
ws19 = next((b for b in btns if "2019" in b), None)
ws22 = next((b for b in btns if "2022" in b), None)
ws25 = next((b for b in btns if "2025" in b), None)
rec("F2: edition has ws2019", ws19 is not None, f"{ws19}")
rec("F2: edition has ws2022", ws22 is not None, f"{ws22}")
rec("F2: edition has ws2025", ws25 is not None, f"{ws25}")
rec("F2: ws2019 has fast-deploy marker (⚡)", "⚡" in (ws19 or ""))
rec("F2: ws2022 has fast-deploy marker (⚡)", "⚡" in (ws22 or ""))
rec("F2: ws2025 has fast-deploy marker (⚡)", "⚡" in (ws25 or ""))

# Test back
call, _ = wait_last("🔙 Back", wait=3.0)
btns = all_button_labels(call) if call else []
back_to_coupon = any("Skip" in b for b in btns)
rec("F2: back from edition -> coupon", back_to_coupon)
call, _ = wait_last("❌ Skip", wait=3.0)
btns = all_button_labels(call) if call else []
rec("F2: skip again -> edition", any("2025" in b for b in btns))
ws25 = next((b for b in btns if "2025" in b), ws25)

# Pick ws2025
call, _ = wait_last(ws25, wait=3.0)
dump(call, "after ws2025 -> summary")
text = (call.get("text") or "") if call else ""
btns = all_button_labels(call) if call else []
rec("F2: summary mentions 2025", "2025" in text)
rec("F2: summary mentions 1 month", "1 month" in text.lower() or "1-month" in text.lower())
confirm_btn = next((b for b in btns if "Confirm Order" in b), None)
cancel_btn = next((b for b in btns if "Cancel Order" in b), None)
rec("F2: summary has Confirm Order", confirm_btn is not None)
rec("F2: summary has Cancel Order", cancel_btn is not None)

# Back from summary
call, _ = wait_last("🔙 Back", wait=3.0)
btns = all_button_labels(call) if call else []
rec("F2: back from summary -> edition", any("2025" in b for b in btns))
ws25 = next((b for b in btns if "2025" in b), ws25)
call, _ = wait_last(ws25, wait=3.0)
btns = all_button_labels(call) if call else []
confirm_btn = next((b for b in btns if "Confirm Order" in b), confirm_btn)

# Record wallet before
wallet_before = db["walletOf"].find_one({"_id": "777000123"})
usd_out_before = (wallet_before or {}).get("usdOut", 0) or 0
print(f"[wallet before] usdOut={usd_out_before}")

# Confirm order — this creates a real droplet!
print("\n>>> CONFIRMING RDP ORDER — real DO droplet will be created")
call, _ = wait_last(confirm_btn or "✅ Confirm Order", wait=6.0)
dump(call, "after confirm")
text = (call.get("text") or "") if call else ""
rec("F2: payment success message", "success" in text.lower() or "paid" in text.lower() or "processing" in text.lower() or "provisioning" in text.lower())

# Poll for credentials up to 7 minutes
print(">>> polling for RDP credentials up to 7 min...")
import requests as R
cred_msg = None
ipv4 = None
password = None
deadline = time.time() + 420
last_seen_ts = int(time.time() * 1000) - 5000
while time.time() < deadline:
    time.sleep(15)
    resp = R.get("http://127.0.0.1:5099/_calls", params={"chat_id": CHAT_ID, "since": last_seen_ts, "method": "sendMessage"}, timeout=10).json()
    for c in resp:
        t = c.get("text") or ""
        if ("Administrator" in t and "3389" in t) or ("is active" in t.lower() and "3389" in t):
            cred_msg = c
            import re
            m = re.search(r"(\d{1,3}(?:\.\d{1,3}){3})", t)
            if m: ipv4 = m.group(1)
            pm = re.search(r"[Pp]assword[:\s\*`]*([A-Za-z0-9!@#$%^&*()_+\-=]{6,})", t)
            if pm: password = pm.group(1)
            break
    if cred_msg: break
    if resp: last_seen_ts = max(x.get("ts", last_seen_ts) for x in resp)
    print(f"   ... elapsed {int(time.time()-(deadline-420))}s")

rec("F2: RDP credentials delivered within 7min", cred_msg is not None)
if cred_msg:
    print("CRED MSG:", (cred_msg.get("text") or "")[:400])
    rec("F2: cred has IPv4", ipv4 is not None, f"ip={ipv4}")
    rec("F2: cred has password", password is not None, f"pw={password}")
    rec("F2: cred mentions Administrator", "Administrator" in (cred_msg.get("text") or ""))
    rec("F2: cred mentions port 3389", "3389" in (cred_msg.get("text") or ""))

# Verify wallet debit
wallet_after = db["walletOf"].find_one({"_id": "777000123"})
usd_out_after = (wallet_after or {}).get("usdOut", 0) or 0
delta = usd_out_after - usd_out_before
rec("F2: wallet debit == $24 (starter 1m)", abs(delta - 24) < 0.01, f"delta=${delta}")

# Verify Mongo vpsPlansOf
plan = db["vpsPlansOf"].find_one({"chatId": str(CHAT_ID), "provider": "digitalocean-rdp"}, sort=[("createdAt", -1)])
if plan is None:
    plan = db["vpsPlansOf"].find_one({"chatId": CHAT_ID, "provider": "digitalocean-rdp"}, sort=[("createdAt", -1)])
rec("F2: vpsPlansOf record exists", plan is not None)
if plan:
    print("PLAN:", {k: plan.get(k) for k in ["_id", "provider", "isRDP", "osType", "osId", "durationMonths", "status", "instanceId"]})
    rec("F2: plan.provider=digitalocean-rdp", plan.get("provider") == "digitalocean-rdp")
    rec("F2: plan.osId=ws2025", plan.get("osId") == "ws2025")
    rec("F2: plan.durationMonths=1", plan.get("durationMonths") == 1)
    rec("F2: plan.status active/RUNNING", str(plan.get("status", "")).lower() in ["active", "running"])
    instance_id = plan.get("instanceId")
    if instance_id:
        server_id = instance_id.replace("rdp-", "")
        srv = db["doRdpServers"].find_one({"server_id": server_id}) or db["doRdpServers"].find_one({"_id": server_id})
        rec("F2: doRdpServers record exists", srv is not None)
        if srv:
            print("SRV:", {k: srv.get(k) for k in ["server_id", "status", "fast_deploy", "os_id", "do_droplet_id"]})
            rec("F2: doRdpServers.status=active", srv.get("status") == "active")
            rec("F2: doRdpServers.fast_deploy=true", srv.get("fast_deploy") is True)
            rec("F2: doRdpServers.os_id=ws2025", srv.get("os_id") == "ws2025")

# Save state
state = {"ipv4": ipv4, "password": password, "instance_id": (plan or {}).get("instanceId"), "do_droplet_id": None}
if plan:
    srv = db["doRdpServers"].find_one({"server_id": (plan.get("instanceId") or "").replace("rdp-", "")})
    if srv: state["do_droplet_id"] = srv.get("do_droplet_id")
with open("/tmp/rdp_state.json", "w") as f:
    json.dump(state, f)
print("STATE:", state)

# Save results
with open("/tmp/flow_results.json", "w") as f:
    json.dump(results, f, indent=2)
print(f"\n{sum(1 for r in results if r['ok'])}/{len(results)} passed")
