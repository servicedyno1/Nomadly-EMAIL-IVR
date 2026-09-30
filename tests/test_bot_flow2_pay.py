"""Continue: tap Pay from Wallet, then poll for credentials."""
import json, time, sys, os, re
sys.path.insert(0, os.path.dirname(__file__))
from bot_harness import send_text, all_button_labels, CHAT_ID
from pymongo import MongoClient
import requests as R

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test")
db = MongoClient(MONGO_URL)[DB_NAME]

results = []
def rec(name, ok, d=""):
    results.append({"name":name,"ok":ok,"detail":d})
    print(f"{'✅' if ok else '❌'} {name} {d}")

# Wallet before
wb = db.walletOf.find_one({"_id":"777000123"}) or {}
usd_out_before = wb.get("usdOut", 0) or 0

# Tap pay
calls = send_text("👛 Pay $24.00 from Wallet", wait=6.0)
for c in calls:
    print("PAY REPLY:", (c.get("text") or "")[:200])

# Poll for credentials up to 7 minutes
print(">>> polling for RDP credentials...")
cred_msg=None; ipv4=None; password=None
deadline = time.time() + 420
last_ts = int(time.time()*1000) - 60000
saw_msgs = []
while time.time() < deadline:
    time.sleep(15)
    resp = R.get("http://127.0.0.1:5099/_calls", params={"chat_id":CHAT_ID,"since":last_ts,"method":"sendMessage"}, timeout=10).json()
    for c in resp:
        t = c.get("text") or ""
        if t not in saw_msgs:
            saw_msgs.append(t)
            print(f"  [{int(time.time()-(deadline-420))}s] MSG:", t[:180].replace("\n"," | "))
        if "Administrator" in t and "3389" in t:
            cred_msg = c
            m = re.search(r"(\d{1,3}(?:\.\d{1,3}){3})", t)
            if m: ipv4 = m.group(1)
            pm = re.search(r"[Pp]assword[:\s\*`<b>/]*([A-Za-z0-9!@#$%^&*()_+\-=]{8,})", t)
            if pm: password = pm.group(1)
            break
    if cred_msg: break
    if resp: last_ts = max(x.get("ts", last_ts) for x in resp)

rec("F2: RDP credentials delivered within 7min", cred_msg is not None)
if cred_msg:
    print("CRED:", cred_msg.get("text")[:500])
    rec("F2: cred has IPv4", ipv4 is not None, f"ip={ipv4}")
    rec("F2: cred has password", password is not None, f"pw={password}")
    rec("F2: cred mentions Administrator", "Administrator" in cred_msg.get("text",""))
    rec("F2: cred mentions 3389", "3389" in cred_msg.get("text",""))

wa = db.walletOf.find_one({"_id":"777000123"}) or {}
delta = (wa.get("usdOut",0) or 0) - usd_out_before
rec("F2: wallet debit=$24", abs(delta-24)<0.01, f"delta=${delta}")

plan = db.vpsPlansOf.find_one({"chatId":str(CHAT_ID),"provider":"digitalocean-rdp"}, sort=[("createdAt",-1)])
if plan is None:
    plan = db.vpsPlansOf.find_one({"chatId":CHAT_ID,"provider":"digitalocean-rdp"}, sort=[("createdAt",-1)])
rec("F2: vpsPlansOf exists", plan is not None)
srv = None
if plan:
    print("PLAN:", {k:plan.get(k) for k in ["_id","provider","isRDP","osType","osId","durationMonths","status","instanceId"]})
    rec("F2: plan.provider=digitalocean-rdp", plan.get("provider")=="digitalocean-rdp")
    rec("F2: plan.osId=ws2025", plan.get("osId")=="ws2025")
    rec("F2: plan.durationMonths=1", plan.get("durationMonths")==1)
    rec("F2: plan.status active/RUNNING", str(plan.get("status","")).lower() in ["active","running"])
    iid = plan.get("instanceId") or ""
    sid = iid.replace("rdp-","")
    srv = db.doRdpServers.find_one({"server_id":sid}) or db.doRdpServers.find_one({"_id":sid})
    rec("F2: doRdpServers exists", srv is not None)
    if srv:
        print("SRV:", {k:srv.get(k) for k in ["server_id","status","fast_deploy","os_id","do_droplet_id"]})
        rec("F2: doRdpServers.status=active", srv.get("status")=="active")
        rec("F2: doRdpServers.fast_deploy=true", srv.get("fast_deploy") is True)
        rec("F2: doRdpServers.os_id=ws2025", srv.get("os_id")=="ws2025")

state = {"ipv4":ipv4,"password":password,"instance_id":(plan or {}).get("instanceId"),"do_droplet_id":(srv or {}).get("do_droplet_id"), "plan_id": (plan or {}).get("_id")}
with open("/tmp/rdp_state.json","w") as f: json.dump(state,f,default=str)
print("STATE:", state)
with open("/tmp/flow2_results.json","w") as f: json.dump(results,f,indent=2)
