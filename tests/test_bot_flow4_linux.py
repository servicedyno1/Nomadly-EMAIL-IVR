"""FLOW 4 - Linux VPS flow separation (no confirm)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from bot_harness import send_text, all_button_labels
from pymongo import MongoClient

db = MongoClient("mongodb://localhost:27017")["test"]
results=[]
def rec(n,ok,d=""): results.append({"name":n,"ok":ok,"detail":d}); print(f"{'✅' if ok else '❌'} {n} {d}")

def last_screen(calls):
    for c in reversed(calls):
        rm = c.get("reply_markup")
        if isinstance(rm,str):
            try: rm = json.loads(rm)
            except: rm = None
        if (c.get("buttons") or []) or rm: return c
    return calls[-1] if calls else None

def go(text, wait=3.0):
    calls = send_text(text, wait=wait)
    c = last_screen(calls)
    if c:
        print(f"\n>>> {text}")
        print(" text:", (c.get("text") or "")[:300].replace("\n"," | "))
        print(" btns:", all_button_labels(c))
    return c

wb = db.walletOf.find_one({"_id":"777000123"}) or {}
usd_out_before = wb.get("usdOut",0) or 0

go("/start", wait=2.0)
go("🖥️ VPS / RDP")
c = go("🐧 Create Linux VPS")
# Region
btns = all_button_labels(c)
region_btn = next((b for b in btns if "New York" in b or "United States" in b or "🇺🇸" in b), None)
rec("F4: region list shown", region_btn is not None)
c = go(region_btn or btns[0])

# Should NOT be a duration screen
text = (c.get("text") or "")
btns = all_button_labels(c)
rec("F4: no duration/prepay step for Linux", "prepay" not in text.lower() and "how long" not in text.lower())

# Should be plan list with Cloud VPS names not RDP tiers
# Might be storage step first
if "storage" in text.lower() or "nvme" in text.lower() and "vCPU" not in text and "RDP" not in text and "$" not in text:
    print("(storage step)")
    c = go(btns[0])
    text = (c.get("text") or ""); btns = all_button_labels(c)

rec("F4: plan not Windows RDP", "Windows RDP" not in text)
rec("F4: plan mentions Cloud VPS or Linux tier names", "Cloud VPS" in text or "Linux" in text or "cloud-vps" in text.lower())
rec("F4: no RDP tier buttons (Starter — Windows RDP)", not any("Windows RDP" in b for b in btns))
print("PLAN BTNS:", btns)

# Pick first plan
plan_btn = next((b for b in btns if "$" in b and "Windows RDP" not in b), None)
if plan_btn:
    c = go(plan_btn)
    text = (c.get("text") or ""); btns = all_button_labels(c)
    rec("F4: after plan pick — NOT a duration step", "prepay" not in text.lower() and "how long" not in text.lower() and "1 month —" not in text)
    # Coupon skip
    skip = next((b for b in btns if "Skip" in b), None)
    if skip:
        c = go(skip)
        text = (c.get("text") or ""); btns = all_button_labels(c)
    # OS list — should show Linux
    rec("F4: OS screen has Ubuntu/Debian", "Ubuntu" in text or "Debian" in text or any("Ubuntu" in b or "Debian" in b for b in btns))
    rec("F4: OS screen has NO Windows edition buttons", not any("Windows Server" in b or "🪟" in b for b in btns))
    rec("F4: OS screen does NOT mention 3389/Administrator", "3389" not in text and "Administrator" not in text)

# Cancel
go("❌ Cancel Order")

wa = db.walletOf.find_one({"_id":"777000123"}) or {}
delta = (wa.get("usdOut",0) or 0) - usd_out_before
rec("F4: no wallet debit", abs(delta) < 0.01, f"delta=${delta}")

with open("/tmp/flow4_results.json","w") as f: json.dump(results,f,indent=2)
print(f"\n{sum(1 for r in results if r['ok'])}/{len(results)} passed")
