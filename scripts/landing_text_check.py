import asyncio
from playwright.async_api import async_playwright
BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]
JS = r"""() => { const vis = e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
 const tiny = [], clip = [], seen = new Set(); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
 while ((n = w.nextNode())) { const t = n.textContent.trim(); if (t.length < 2) continue; const p = n.parentElement; if (!p || seen.has(p) || !vis(p)) continue; seen.add(p);
  const cs = getComputedStyle(p); if (parseFloat(cs.fontSize) < 12) tiny.push([t.slice(0, 30), cs.fontSize]);
  if ((p.scrollWidth > p.clientWidth + 1 || p.scrollHeight > p.clientHeight + 2) && cs.overflow !== 'visible' && cs.textOverflow !== 'ellipsis') clip.push([t.slice(0, 30), p.scrollWidth - p.clientWidth, p.scrollHeight - p.clientHeight]); }
  const spill = []; for (const p of seen) { const rg = document.createRange(); rg.selectNodeContents(p); const tr = rg.getBoundingClientRect(); const box = (p.closest('button,[class*=rounded-full],[class*=civr-key],span[class*=w-],div[class*=w-]') || p).getBoundingClientRect();
  if (tr.width && (tr.right > box.right + 1 || tr.left < box.left - 1 || tr.bottom > box.bottom + 1)) spill.push([p.textContent.trim().slice(0, 25), Math.round(tr.right - box.right), Math.round(tr.bottom - box.bottom)]); }
 return { spill, tiny, clip, over: document.documentElement.scrollWidth - innerWidth }; }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for w, h, m in [(320, 640, True), (375, 667, True), (768, 1024, True), (1366, 768, False), (1920, 1080, False)]:
            c = await b.new_context(viewport={'width': w, 'height': h}, is_mobile=m, has_touch=m); pg = await c.new_page()
            for path in ['/cloudivr', '/cloudivr/sip', '/cloudivr/terms']:
                await pg.goto(BASE + path, timeout=60000); await pg.wait_for_timeout(2000)
                for y in range(0, 40):
                    await pg.evaluate(f"window.scrollTo(0,{y}*innerHeight)"); await pg.wait_for_timeout(60)
                await pg.wait_for_timeout(800)
                r = await pg.evaluate(JS)
                print(w, path, 'overflow', r['over'], 'tiny', r['tiny'][:6], 'clip', r['clip'][:6], 'spill', r['spill'][:8], flush=True)
            await c.close()
        await b.close()
asyncio.run(main())
