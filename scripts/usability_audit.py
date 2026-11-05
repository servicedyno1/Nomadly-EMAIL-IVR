import asyncio, json, os, sys, time
from playwright.async_api import async_playwright

BASE = os.environ.get("AUDIT_BASE") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]
AXE = open("/app/frontend/node_modules/axe-core/axe.min.js").read()
OUT = os.environ.get("AUDIT_OUT") or "/app/test_reports/usability_audit.json"
EMAIL, PASSWORD = "civr.alice@example.com", "AliceTest#2026"

DEVICES = [
    {"name": "iPhone SE", "w": 375, "h": 667, "mobile": True, "scale": 2},
    {"name": "iPhone 14", "w": 390, "h": 844, "mobile": True, "scale": 3},
    {"name": "iPad", "w": 768, "h": 1024, "mobile": True, "scale": 2},
    {"name": "iPad landscape", "w": 1024, "h": 768, "mobile": True, "scale": 2},
    {"name": "Laptop", "w": 1366, "h": 768, "mobile": False, "scale": 1},
    {"name": "Desktop", "w": 1920, "h": 1080, "mobile": False, "scale": 1},
]
PUBLIC = ["/cloudivr", "/cloudivr/login", "/cloudivr/signup", "/cloudivr/forgot", "/cloudivr/sip", "/cloudivr/terms"]
APP = ["", "/numbers", "/numbers/+15156445901", "/numbers/%2B13346972125", "/buy", "/audio", "/contacts", "/texting", "/quick-call", "/text-call",
       "/ai-agents", "/ai-agents/new", "/campaigns", "/campaigns/new", "/live", "/do-not-call", "/wallet", "/inbox",
       "/settings", "/help", "/verification", "/sip"]

MEASURE = r"""
(mobile) => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const desc = el => (el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 60);
  const out = { hOverflow: document.documentElement.scrollWidth - vw, overflowEls: [], smallTargets: [], tinyText: [],
    zoomInputs: [], clipped: [], fixedCover: 0, noViewportMeta: !document.querySelector('meta[name=viewport]'), overlaps: [] };
  const all = [...document.querySelectorAll('body *')];
  for (const el of all) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && r.left < vw && out.overflowEls.length < 8 && getComputedStyle(el).position !== 'fixed')
      out.overflowEls.push({ el: desc(el), right: Math.round(r.right), cls: (el.className || '').toString().slice(0, 80) });
  }
  const inter = [...document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=link],[role=tab],[role=switch],[role=menuitem],[tabindex]:not([tabindex="-1"])')];
  const rects = [];
  for (const el of inter) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > document.documentElement.scrollHeight) continue;
    const cs = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' && ['hidden','checkbox','radio','range','file'].includes(el.type)) continue;
    const min = Math.min(r.width, r.height);
    if (min < 24 || (mobile && min < 40)) {
      const inline = tag === 'a' && cs.display === 'inline' && el.closest('p,li,span,td');
      if (!inline) out.smallTargets.push({ el: desc(el), w: Math.round(r.width), h: Math.round(r.height), sev: min < 24 ? 'fail' : 'warn' });
    }
    if (mobile && ['input','select','textarea'].includes(tag) && parseFloat(cs.fontSize) < 16)
      out.zoomInputs.push({ el: desc(el) || el.placeholder || el.name, fs: cs.fontSize });
    rects.push({ el: desc(el), r });
  }
  for (let i = 0; i < rects.length && out.overlaps.length < 5; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i].r, b = rects[j].r;
    const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ix > 8 && iy > 8 && ix * iy > 0.5 * Math.min(a.width * a.height, b.width * b.height) && rects[i].el !== rects[j].el) {
      const A = inter.find(e => desc(e) === rects[i].el), B = inter.find(e => desc(e) === rects[j].el);
      if (A && B && !A.contains(B) && !B.contains(A)) out.overlaps.push([rects[i].el, rects[j].el]);
    }
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; const seen = new Set();
  while ((n = walker.nextNode())) {
    const t = n.textContent.trim(); if (t.length < 3) continue;
    const p = n.parentElement; if (!p || !vis(p) || seen.has(p)) continue; seen.add(p);
    const fs = parseFloat(getComputedStyle(p).fontSize);
    if (fs < 12) out.tinyText.push({ text: t.slice(0, 40), fs });
    const cs = getComputedStyle(p);
    if (p.scrollWidth > p.clientWidth + 2 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis' && !p.closest('pre,code,[role=tablist],.overflow-x-auto'))
      out.clipped.push({ text: t.slice(0, 40), el: desc(p), extra: p.scrollWidth - p.clientWidth });
  }
  let cover = 0;
  for (const el of all) { const cs = getComputedStyle(el); if ((cs.position === 'fixed' || cs.position === 'sticky') && vis(el)) {
    const r = el.getBoundingClientRect(); if (r.width > vw * 0.6 && r.top < vh && r.bottom > 0) cover += Math.min(r.bottom, vh) - Math.max(r.top, 0); } }
  out.fixedCover = Math.round(100 * cover / vh);
  out.h1 = document.querySelectorAll('h1').length;
  out.pageHeight = document.documentElement.scrollHeight;
  return out;
}
"""

FOCUS = r"""
() => { const el = document.activeElement; if (!el || el === document.body) return null;
  const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none' || el.matches(':focus-visible') && cs.outlineStyle !== 'none';
  return { el: (el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 50), ring, offscreen: r.bottom < 0 || r.top > innerHeight }; }
"""


async def audit_page(page, url, mobile):
    errs = []
    page.on("console", lambda m: errs.append(m.text[:160]) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(str(e)[:160]))
    t0 = time.time()
    try:
        await page.goto(url, wait_until="load", timeout=45000)
    except Exception as e:
        return {"url": url, "error": str(e)[:200]}
    load = round(time.time() - t0, 2)
    await page.wait_for_timeout(2500)
    for tid in ("cookie-allow-all",):
        b = page.locator(f"[data-testid={tid}]").first
        if await b.count() and await b.is_visible():
            await b.click(force=True); await page.wait_for_timeout(300)
    meas = await page.evaluate(MEASURE, mobile)
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)"); await page.wait_for_timeout(400)
    meas_bottom = await page.evaluate(MEASURE, mobile)
    meas["smallTargets"] = {json.dumps(x, sort_keys=True): x for x in meas["smallTargets"] + meas_bottom["smallTargets"]}
    meas["smallTargets"] = list(meas["smallTargets"].values())
    meas["hOverflow"] = max(meas["hOverflow"], meas_bottom["hOverflow"])
    await page.evaluate("window.scrollTo(0,0)")
    focus = []
    for _ in range(12):
        await page.keyboard.press("Tab")
        f = await page.evaluate(FOCUS)
        if f: focus.append(f)
    noring = [f["el"] for f in focus if not f["ring"]]
    await page.evaluate(AXE)
    axe = await page.evaluate("async () => { const r = await axe.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}}); return r.violations.map(v => ({id:v.id, impact:v.impact, help:v.help, n:v.nodes.length, ex: v.nodes.slice(0,3).map(nd => nd.target.join(' ').slice(0,80))})); }")
    return {"url": url, "load_s": load, "console_errors": errs[:5], "measure": meas, "focus_no_ring": noring, "focus_total": len(focus), "axe": axe}


async def main():
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        state = None
        ctx = await browser.new_context(viewport={"width": 1366, "height": 768})
        page = await ctx.new_page()
        await page.goto(BASE + "/cloudivr/login", wait_until="load"); await page.wait_for_timeout(1500)
        b = page.locator("[data-testid=cookie-allow-all]").first
        if await b.count(): await b.click(force=True)
        await page.fill("[data-testid=auth-email-input]", EMAIL)
        await page.fill("[data-testid=auth-password-input]", PASSWORD)
        await page.click("[data-testid=auth-submit-button]")
        await page.wait_for_url("**/cloudivr/app**", timeout=30000)
        state = await ctx.storage_state()
        await ctx.close()
        only = os.environ.get("AUDIT_DEVICES")
        for d in [d for d in DEVICES if not only or d["name"] in only.split(",")]:
            ctx = await browser.new_context(viewport={"width": d["w"], "height": d["h"]}, device_scale_factor=d["scale"],
                                            is_mobile=d["mobile"], has_touch=d["mobile"], storage_state=state)
            for path in PUBLIC + ["/cloudivr/app" + a for a in APP]:
                page = await ctx.new_page()
                try:
                    r = await asyncio.wait_for(audit_page(page, BASE + path, d["mobile"] or d["w"] < 1100), 120)
                except Exception as e:
                    r = {"url": BASE + path, "error": repr(e)[:200]}
                r["device"] = d["name"]; r["path"] = path
                results.append(r)
                await page.close()
                print(d["name"], path, "ok" if "error" not in r else r["error"], flush=True)
            await ctx.close()
            json.dump(results, open(OUT, "w"), indent=1)
        await browser.close()
    json.dump(results, open(OUT, "w"), indent=1)
    print("DONE", len(results))

asyncio.run(main())
