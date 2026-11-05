import json, collections
R = json.load(open("/app/test_reports/usability_audit.json"))
ok = [r for r in R if "error" not in r]
print(f"pages audited: {len(ok)} / {len(R)}  (errors: {len(R)-len(ok)})")
for r in R:
    if "error" in r: print("  ERR", r.get("device"), r.get("path"), r["error"][:80])

def by_page(key, fn):
    agg = collections.defaultdict(list)
    for r in ok:
        v = fn(r)
        if v: agg[r["path"]].append((r["device"], v))
    return agg

print("\n== Horizontal overflow (px wider than screen) ==")
for path, items in sorted(by_page("h", lambda r: r["measure"]["hOverflow"] if r["measure"]["hOverflow"] > 2 else None).items()):
    print(f"  {path}: " + ", ".join(f"{d}:{v}px" for d, v in items))
    for r in ok:
        if r["path"] == path and r["measure"]["hOverflow"] > 2 and r["measure"]["overflowEls"]:
            print("     ", r["device"], [f"{e['el']}→{e['right']}" for e in r["measure"]["overflowEls"][:3]]); break

print("\n== Small tap targets (fail <24px; warn <40px on touch) — distinct elements per page, phones only ==")
for path in sorted({r["path"] for r in ok}):
    seen = {}
    for r in ok:
        if r["path"] != path or r["device"] not in ("iPhone SE", "iPhone 14"): continue
        for t in r["measure"]["smallTargets"]: seen[t["el"]] = t
    fails = [t for t in seen.values() if t["sev"] == "fail"]; warns = [t for t in seen.values() if t["sev"] == "warn"]
    if seen: print(f"  {path}: {len(fails)} fail, {len(warns)} warn | fails: " + "; ".join(f"{t['el']}({t['w']}x{t['h']})" for t in fails[:6]))

print("\n== Inputs <16px on phones (iOS auto-zoom on focus) ==")
for path, items in sorted(by_page("z", lambda r: len(r["measure"]["zoomInputs"]) if r["device"] in ("iPhone SE","iPhone 14") else None).items()):
    ex = next(r["measure"]["zoomInputs"][:3] for r in ok if r["path"] == path and r["measure"]["zoomInputs"])
    print(f"  {path}: {max(v for _, v in items)} inputs e.g. {[(e['el'], e['fs']) for e in ex]}")

print("\n== Text under 12px ==")
for path, items in sorted(by_page("t", lambda r: len(r["measure"]["tinyText"]) if r["device"]=="iPhone SE" else None).items()):
    ex = next(r["measure"]["tinyText"][:3] for r in ok if r["path"] == path and r["device"]=="iPhone SE")
    print(f"  {path}: {items[0][1]} e.g. {[(e['text'], e['fs']) for e in ex]}")

print("\n== Clipped text (content wider than its box, no ellipsis) ==")
for path, items in sorted(by_page("c", lambda r: r["measure"]["clipped"] or None).items()):
    print(f"  {path}: " + " | ".join(f"{d}: {[c['el'] or c['text'] for c in v[:3]]}" for d, v in items[:3]))

print("\n== Fixed/sticky bars covering >=25% of phone screen ==")
for path, items in sorted(by_page("f", lambda r: r["measure"]["fixedCover"] if r["measure"]["fixedCover"] >= 25 and r["device"] in ("iPhone SE","iPhone 14") else None).items()):
    print(f"  {path}: " + ", ".join(f"{d}:{v}%" for d, v in items))

print("\n== Overlapping interactive elements ==")
for path, items in sorted(by_page("o", lambda r: r["measure"]["overlaps"] or None).items()):
    print(f"  {path}: {items[0][0]} {items[0][1][:2]}")

print("\n== Keyboard focus: tabbed elements without a visible focus ring (desktop) ==")
for path, items in sorted(by_page("k", lambda r: r["focus_no_ring"] if r["device"]=="Desktop" and r["focus_no_ring"] else None).items()):
    print(f"  {path}: {len(items[0][1])}/{next(r['focus_total'] for r in ok if r['path']==path and r['device']=='Desktop')} e.g. {items[0][1][:4]}")

print("\n== Page weight / timing (Desktop load_s, phone page height in screens) ==")
for path in sorted({r["path"] for r in ok}):
    d = next((r for r in ok if r["path"]==path and r["device"]=="Desktop"), None)
    m = next((r for r in ok if r["path"]==path and r["device"]=="iPhone SE"), None)
    if d and m: print(f"  {path}: load {d['load_s']}s | SE height {round(m['measure']['pageHeight']/667,1)} screens | h1={m['measure']['h1']}")

print("\n== Console errors ==")
for path, items in sorted(by_page("e", lambda r: r["console_errors"] or None).items()):
    print(f"  {path}: {items[0][1][:2]}")

print("\n== axe-core violations (WCAG 2.1 AA + best practice), aggregated ==")
agg = collections.defaultdict(lambda: {"pages": set(), "impact": "", "help": "", "ex": set()})
for r in ok:
    for v in r["axe"]:
        a = agg[v["id"]]; a["pages"].add(r["path"]); a["impact"] = v["impact"]; a["help"] = v["help"]; a["ex"].update(v["ex"][:2])
order = {"critical": 0, "serious": 1, "moderate": 2, "minor": 3}
for vid, a in sorted(agg.items(), key=lambda kv: (order.get(kv[1]["impact"], 9), -len(kv[1]["pages"]))):
    print(f"  [{a['impact']}] {vid}: {a['help']} — {len(a['pages'])} pages; e.g. {list(a['ex'])[:2]}")
    print(f"       pages: {sorted(a['pages'])[:8]}")
