import asyncio
from playwright.async_api import async_playwright
BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]
HDR = {'/cloudivr': 'civr-nav', '/cloudivr/sip': 'sip-nav', '/cloudivr/terms': 'terms-header'}
JS = r"""(t) => { const h = document.querySelector(`[data-testid=${t}]`); const vw = innerWidth; const bad = []; let n = 0;
 for (const e of h.querySelectorAll('a,button')) { const r = e.getBoundingClientRect(); if (!r.width) continue; n++; if (r.right > vw + 0.5 || r.left < -0.5) bad.push([e.getAttribute('data-testid'), Math.round(r.left), Math.round(r.right)]); }
 const els = [...h.querySelectorAll('a,button')].map(e => e.getBoundingClientRect()).filter(r => r.width); let ov = 0;
 for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i], b = els[j]; if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) ov++; }
 return { visible: n, offscreen: bad, overlaps: ov }; }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for w in (320, 360, 375, 390, 414, 430, 768, 1024, 1366):
            c = await b.new_context(viewport={'width': w, 'height': 700}, is_mobile=w < 1024, has_touch=w < 1024); pg = await c.new_page()
            for path, t in HDR.items():
                await pg.goto(BASE + path, timeout=60000); await pg.wait_for_timeout(1200)
                r = await pg.evaluate(JS, t)
                print(w, path, r, flush=True)
            await c.close()
        await b.close()
asyncio.run(main())
