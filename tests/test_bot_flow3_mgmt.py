"""FLOW 3 - RDP management on live server."""
import json, time, sys, os, re
sys.path.insert(0, os.path.dirname(__file__))
from bot_harness import send_text, all_button_labels, CHAT_ID
from pymongo import MongoClient
import requests as R

db = MongoClient("mongodb://localhost:27017")["test"]
results=[]
def rec(n,ok,d=""): results.append({"name":n,"ok":ok,"detail":d}); print(f"{'✅' if ok else '❌'} {n} {d}")

# Load state
state = json.load(open("/tmp/rdp_state.json"))
purchase_ip = state["ipv4"]
plan = db.vpsPlansOf.find_one({"provider":"digitalocean-rdp","chatId":str(CHAT_ID)}, sort=[("start_time",-1)])
vps_id = plan.get("vpsId")
srv_id = vps_id.replace("rdp-","")
print(f"Testing server vps_id={vps_id} ip={purchase_ip}")

def last_screen(calls):
    for c in reversed(calls):
        rm = c.get("reply_markup")
        if isinstance(rm,str):
            try: rm = json.loads(rm)
            except: rm = None
        if (c.get("buttons") or []) or rm: return c
    return calls[-1] if calls else None

def go(text, wait=3.5):
    calls = send_text(text, wait=wait)
    c = last_screen(calls)
    if c:
        print(f"\n>>> {text} =>")
        print("   text:", (c.get("text") or "")[:250].replace("\n"," | "))
        print("   btns:", all_button_labels(c))
    return c, calls

# Navigate to Manage
go("/start", wait=2.5)
c, _ = go("🖥️ VPS / RDP")
c, _ = go("🖥️ Manage my servers")
btns = all_button_labels(c) if c else []
text = (c.get("text") or "") if c else ""
rec("F3: server list has Windows RDP marker/label", "🪟" in text or "Windows RDP" in text)
rec("F3: server list has Create Linux VPS btn", any("Create Linux VPS" in b for b in btns))
rec("F3: server list has Create Windows RDP btn", any("Create Windows RDP" in b for b in btns))

# Pick server (the name is nomadly-... or contains the ip)
server_btn = None
for b in btns:
    if "nomadly-777000123" in b or purchase_ip in b or "🪟" in b:
        server_btn = b; break
if not server_btn:
    print("No server button found. Buttons:", btns)
    server_btn = next((b for b in btns if "Back" not in b and "Cancel" not in b and "Create" not in b), None)

c, _ = go(server_btn or "back")
text = (c.get("text") or "") if c else ""
btns = all_button_labels(c) if c else []
rec("F3: details mentions Windows RDP", "Windows RDP" in text or "🪟" in text)
rec("F3: details mentions 3389", "3389" in text)
rec("F3: details mentions Administrator", "Administrator" in text)
rec("F3: btn Stop", any("Stop" in b for b in btns))
rec("F3: btn Restart", any("Restart" in b for b in btns))
rec("F3: btn Show Password", any("Show Password" in b for b in btns))
rec("F3: btn Reset Password", any("Reset Password" in b for b in btns))
rec("F3: btn Reinstall Windows", any("Reinstall Windows" in b for b in btns))
rec("F3: btn Subscriptions", any("Subscriptions" in b for b in btns))
rec("F3: btn Upgrade", any("Upgrade" in b for b in btns))
rec("F3: btn Delete", any("Delete" in b for b in btns))
rec("F3: NO SSH Keys button (RDP)", not any("SSH Keys" in b for b in btns))

# (a) Show Password
c, _ = go("🔐 Show Password")
text = (c.get("text") or "") if c else ""
rec("F3a: password shown (non-empty response)", len(text) > 20 and "error" not in text.lower())
# The password might be in the same response
print("PW REPLY:", text[:400])

# Get back to details
c, _ = go("🔙 Back", wait=2.5)
btns_now = all_button_labels(c) if c else []
if not any("Delete" in b for b in btns_now):
    c, _ = go("🖥️ Manage my servers")
    server_btn = next((b for b in all_button_labels(c) if "nomadly-777000123" in b or "🪟" in b), server_btn)
    c, _ = go(server_btn)

# (b) Reset Password (cancel)
c, _ = go("🔑 Reset Password")
text = (c.get("text") or "") if c else ""
btns = all_button_labels(c) if c else []
rec("F3b: reset confirm mentions KEPT/in-place (data preserved)",
    any(w in text.lower() for w in ["kept","in-place","in place","preserved","no reinstall"]))
rec("F3b: reset has Confirm", any(b for b in btns if "Confirm" in b and "Cancel" not in b))
rec("F3b: reset has Cancel", any(b for b in btns if "Cancel" in b))
cancel_btn = next((b for b in btns if "Cancel" in b and "Confirm" not in b), "❌ Cancel")
c, _ = go(cancel_btn)

# Get back to details
c, _ = go("🖥️ Manage my servers")
server_btn = next((b for b in all_button_labels(c) if "nomadly-777000123" in b or "🪟" in b), server_btn)
c, _ = go(server_btn)

# (c) Subscriptions
c, _ = go("🔄 Subscriptions")
text = (c.get("text") or "") if c else ""
rec("F3c: subscriptions has no error", "error" not in text.lower() and "went wrong" not in text.lower())
rec("F3c: subscriptions mentions expiry/renew/subscription", any(w in text.lower() for w in ["expir","renew","subscription","month","billing"]))
print("SUBS TEXT:", text[:300])

# Get back
c, _ = go("🖥️ Manage my servers")
server_btn = next((b for b in all_button_labels(c) if "nomadly-777000123" in b or "🪟" in b), server_btn)
c, _ = go(server_btn)

# (d) Reinstall Windows -> ws2022
c, _ = go("🔄 Reinstall Windows")
text = (c.get("text") or "") if c else ""
btns = all_button_labels(c) if c else []
rec("F3d: reinstall confirm mentions data erased/lost", any(w in text.lower() for w in ["erase","lost","wiped","destroy","delete","all data"]))
rec("F3d: reinstall has Confirm/Cancel", any("Confirm" in b for b in btns) and any("Cancel" in b for b in btns))
confirm = next((b for b in btns if "Confirm" in b), "✅ Confirm")
c, _ = go(confirm)
btns = all_button_labels(c) if c else []
ws22 = next((b for b in btns if "2022" in b), None)
rec("F3d: edition picker after confirm", ws22 is not None)

if ws22:
    since_ts = int(time.time()*1000) - 500
    c, _ = go(ws22, wait=5.0)
    text = (c.get("text") or "") if c else ""
    print("REINSTALL START:", text[:300])
    rec("F3d: reinstall started message", any(w in text.lower() for w in ["reinstall","starting","in progress","~3","begin","initiat"]))
    # Poll for new credentials
    print(">>> polling for new credentials after reinstall...")
    new_cred=None; new_ip=None; new_pw=None
    deadline = time.time() + 420
    while time.time() < deadline:
        time.sleep(15)
        resp = R.get("http://127.0.0.1:5099/_calls", params={"chat_id":CHAT_ID,"since":since_ts,"method":"sendMessage"}, timeout=10).json()
        for cc in resp:
            t = cc.get("text") or ""
            if "Administrator" in t and "3389" in t and "is active" in t.lower():
                new_cred=cc
                m = re.search(r"<code>(\d{1,3}(?:\.\d{1,3}){3})</code>", t)
                if m: new_ip = m.group(1)
                pm = re.search(r"<code>([A-Za-z0-9!@#$%^&*()_+\-=]{10,})</code>\s*</tg-spoiler>", t)
                if not pm: pm = re.search(r"tg-spoiler><code>([^<]+)</code>", t)
                if pm: new_pw = pm.group(1)
                break
        if new_cred: break
        if resp: since_ts = max(x.get("ts",since_ts) for x in resp)
    rec("F3d: new credentials arrived", new_cred is not None)
    if new_cred:
        rec("F3d: IP unchanged", new_ip == purchase_ip, f"old={purchase_ip} new={new_ip}")
    plan2 = db.vpsPlansOf.find_one({"_id": plan["_id"]})
    rec("F3d: vpsPlansOf.imageId=ws2022", plan2.get("imageId")=="ws2022", f"got={plan2.get('imageId')}")

# Get back to details for delete
c, _ = go("/start", wait=2.5)
c, _ = go("🖥️ VPS / RDP")
c, _ = go("🖥️ Manage my servers")
server_btn = next((b for b in all_button_labels(c) if "nomadly-777000123" in b or "🪟" in b), server_btn)
c, _ = go(server_btn)

# (f) Delete
do_droplet_id = None
srv_now = db.doRdpServers.find_one({"server_id": srv_id})
if srv_now: do_droplet_id = srv_now.get("do_droplet_id")
print(f"do_droplet_id={do_droplet_id}")

c, _ = go("🗑️ Delete")
btns = all_button_labels(c) if c else []
confirm = next((b for b in btns if "Confirm" in b), "✅ Confirm")
c, _ = go(confirm, wait=8.0)
text = (c.get("text") or "") if c else ""
rec("F3f: delete success message", "delet" in text.lower() or "success" in text.lower() or "removed" in text.lower())

# Poll destruction
time.sleep(5)
for _ in range(6):
    srv_final = db.doRdpServers.find_one({"server_id": srv_id})
    if srv_final and srv_final.get("status") == "destroyed": break
    time.sleep(5)
rec("F3f: doRdpServers.status=destroyed", srv_final and srv_final.get("status")=="destroyed", f"status={srv_final and srv_final.get('status')}")

# DO API check
if do_droplet_id:
    tok = os.environ.get("DIGITALOCEAN_API_TOKEN") or open("/app/backend/.env").read().split('DIGITALOCEAN_API_TOKEN="')[1].split('"')[0]
    time.sleep(5)
    r = R.get(f"https://api.digitalocean.com/v2/droplets/{do_droplet_id}", headers={"Authorization": f"Bearer {tok}"})
    rec("F3f: DO droplet returns 404", r.status_code==404, f"got {r.status_code}")

with open("/tmp/flow3_results.json","w") as f: json.dump(results,f,indent=2)
print(f"\n{sum(1 for r in results if r['ok'])}/{len(results)} passed")
