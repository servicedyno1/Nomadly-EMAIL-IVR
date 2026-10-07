"""E2E Linux VPS: storage-step NVMe/SSD + per-region plan filtering.
Drives bot via webhook; reads mock Telegram sendMessage recordings.
Stops BEFORE payment, cancels order, asserts no wallet debit.
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from bot_harness import send_text, all_button_labels
from pymongo import MongoClient

db = MongoClient("mongodb://localhost:27017")["test"]
CHAT = "777000123"

results = []
def rec(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": detail})
    print(f"{'OK ' if ok else 'FAIL'} {name} {detail}")

def last_screen(calls):
    for c in reversed(calls or []):
        if c.get("buttons") or c.get("reply_markup"):
            return c
    return (calls or [None])[-1]

def go(text, wait=3.5):
    calls = send_text(text, wait=wait)
    c = last_screen(calls)
    if c:
        print(f"\n>>> {text}")
        print(" text:", (c.get('text') or '')[:260].replace('\n', ' | '))
        print(" btns:", all_button_labels(c))
    return c

def labels(c):
    """De-duplicate labels: harness returns reply_markup buttons twice (once via buttons[], once via reply_markup)."""
    if not c: return []
    raw = all_button_labels(c)
    seen = set(); out = []
    for b in raw:
        if b not in seen: seen.add(b); out.append(b)
    return out

def find_btn(c, needles):
    for b in labels(c):
        if any(n in b for n in needles):
            return b
    return None

# wallet snapshot BEFORE
w0 = db.walletOf.find_one({"_id": CHAT}) or {}
usd_out_before = w0.get("usdOut", 0) or 0

# -- reset chat state cleanly --
go("/start", wait=2.0)
# If a language picker shows, pick English and then /start again
en_btn_present = False
c = go("🇬🇧 English", wait=2.5)
go("/start", wait=2.0)

# ================= EU flow =================
c = go("🖥️ VPS / RDP")
c = go("🐧 Create Linux VPS")
rec("EU-00: Linux VPS entry reached", any("region" in (c.get('text') or '').lower() or "country" in (c.get('text') or '').lower() or any("🇩🇪" in b or "🇬🇧" in b or "🇺🇸" in b or "Germany" in b or "New York" in b for b in labels(c)) for _ in [0]))

# ---- country if a country list appears ----
btns = labels(c)
country_btn = find_btn(c, ["🇩🇪", "Germany"])
if country_btn:
    c = go(country_btn)
    btns = labels(c)
# region: pick Frankfurt / FRA
region_btn = find_btn(c, ["Europe (EU)", "🇪🇺", "Frankfurt", "FRA", "fra1"])
if not region_btn:
    # try any EU country list
    for cand in ["🇳🇱 Netherlands", "🇬🇧 United Kingdom", "Amsterdam", "London"]:
        b = find_btn(c, [cand])
        if b:
            c = go(b); btns = labels(c)
            region_btn = find_btn(c, ["Frankfurt", "FRA", "Amsterdam", "AMS", "London", "LON"])
            if region_btn: break
rec("EU-01: EU region button found", region_btn is not None, f"btn={region_btn}")
if region_btn:
    c = go(region_btn)

text = (c.get('text') or '') if c else ''
btns = labels(c)
print("\nSTORAGE SCREEN TEXT:", text)
print("STORAGE SCREEN BTNS:", btns)

rec("EU-02: storage step shown with intro line", "NVMe costs more" in text and "SSD is the budget pick" in text)
rec("EU-02b: intro does NOT say 'cost the same'", "cost the same" not in text.lower())
nvme_btn = find_btn(c, ["⚡ NVMe SSD", "NVMe SSD — Premium", "NVMe SSD"])
ssd_btn = find_btn(c, ["💾 SSD", "SSD — Standard"])
rec("EU-03: NVMe button present", nvme_btn is not None, f"btn={nvme_btn}")
rec("EU-04: SSD button present", ssd_btn is not None, f"btn={ssd_btn}")

# --- SSD path first ---
if ssd_btn:
    c_ssd = go(ssd_btn)
    btns_ssd = labels(c_ssd)
    print("\nSSD PLAN BTNS:", btns_ssd)
    cloud_count = sum(1 for b in btns_ssd if "Cloud VPS" in b)
    rec("EU-05: SSD plan list contains 'Cloud VPS' plans (6 expected)", cloud_count >= 6, f"count={cloud_count}")
    # back button returns to storage
    back = find_btn(c_ssd, ["Back", "⬅️", "🔙"])
    if back:
        c_back = go(back)
        tback = (c_back.get('text') or '')
        rec("EU-06: Back from SSD plan list returns to storage step", "NVMe costs more" in tback and "SSD is the budget pick" in tback)
        c = c_back
    else:
        rec("EU-06: Back from SSD plan list returns to storage step", False, "no back button")

# --- NVMe path ---
if nvme_btn:
    c_nv = go(nvme_btn)
    btns_nv = labels(c_nv)
    print("\nNVMe PLAN BTNS:", btns_nv)
    amd_count = sum(1 for b in btns_nv if "NVMe AMD" in b)
    intel_count = sum(1 for b in btns_nv if "NVMe Intel" in b)
    rec("EU-07: NVMe list has 9 'NVMe AMD' plans", amd_count == 9, f"amd={amd_count}")
    rec("EU-08: NVMe list has 15 'NVMe Intel' plans", intel_count == 15, f"intel={intel_count}")
    rec("EU-09: cheapest plan starred (🌟)", any("🌟" in b and "$21" in b for b in btns_nv))
    rec("EU-10: $21 cheapest and $576 most expensive both listed",
        any("$21" in b and "NVMe AMD" in b for b in btns_nv) and any("$576" in b and "NVMe Intel" in b for b in btns_nv))

    # pick a cheap NVMe plan, proceed to coupon/OS, then CANCEL
    plan_btn = find_btn(c_nv, ["🌟"]) or next((b for b in btns_nv if "NVMe AMD" in b and "$21" in b), None)
    if plan_btn:
        c_after = go(plan_btn)
        text2 = (c_after.get('text') or ''); btns2 = labels(c_after)
        # Possibly coupon step: skip it
        skip = find_btn(c_after, ["Skip"])
        if skip:
            c_after = go(skip); text2 = (c_after.get('text') or ''); btns2 = labels(c_after)
        has_os = ("Ubuntu" in text2 or "Debian" in text2 or any("Ubuntu" in b or "Debian" in b for b in btns2))
        rec("EU-11: After NVMe plan pick reaches OS step (Ubuntu/Debian)", has_os)
        # Cancel BEFORE payment
        go("❌ Cancel Order")

# ================= US-east flow =================
go("/start", wait=2.0)
c = go("🖥️ VPS / RDP")
c = go("🐧 Create Linux VPS")
# navigate to US / New York
us_country = find_btn(c, ["US East", "🇺🇸 US East"])
if us_country:
    c = go(us_country); btns = labels(c)
ny_btn = find_btn(c, ["New York", "NYC", "nyc"]) or us_country
rec("US-00: US-East (New York) region button found", ny_btn is not None, f"btn={ny_btn}")
if ny_btn and ny_btn != us_country:
    c = go(ny_btn)

text_us = (c.get('text') or '') if c else ''
btns_us = labels(c)
print("\nUS PLAN/STORAGE SCREEN TEXT:", text_us[:200])
print("US PLAN/STORAGE SCREEN BTNS:", btns_us)

# Storage step must be AUTO-SKIPPED
rec("US-01: Storage step auto-skipped in US-east (no NVMe/SSD choice buttons)",
    not ("NVMe costs more" in text_us or any("💾 SSD — Standard" in b for b in btns_us)))

amd_us = sum(1 for b in btns_us if "NVMe AMD" in b)
intel_us = sum(1 for b in btns_us if "NVMe Intel" in b)
cloud_us = sum(1 for b in btns_us if "Cloud VPS" in b)
rec("US-02: US-east shows only 9 NVMe AMD plans", amd_us == 9, f"amd={amd_us}")
rec("US-03: US-east shows no NVMe Intel plans", intel_us == 0, f"intel={intel_us}")
rec("US-04: US-east shows no legacy 'Cloud VPS' SSD plans", cloud_us == 0, f"cloud={cloud_us}")

# cancel safely
go("❌ Cancel Order")

# ================= wallet unchanged =================
w1 = db.walletOf.find_one({"_id": CHAT}) or {}
delta = (w1.get("usdOut", 0) or 0) - usd_out_before
rec("WALLET: no wallet debit on chat 777000123", abs(delta) < 0.01, f"delta=${delta}")

ok = sum(1 for r in results if r['ok'])
tot = len(results)
with open("/tmp/nvme_e2e_results.json", "w") as f:
    json.dump({"passed": ok, "total": tot, "results": results}, f, indent=2)
print(f"\n{ok}/{tot} passed")
sys.exit(0 if ok == tot else 1)
