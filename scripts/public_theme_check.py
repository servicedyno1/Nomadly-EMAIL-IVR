import asyncio
from playwright.async_api import async_playwright
BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]
AXE = open('/app/frontend/node_modules/axe-core/axe.min.js').read()
PAGES = [('/cloudivr', 'landing-theme-button'), ('/cloudivr/sip', 'sip-theme-button'), ('/cloudivr/terms', 'terms-theme-button')]
STATE = "() => [document.documentElement.dataset.civrNpTheme, getComputedStyle(document.querySelector('.civr-np')).backgroundColor, document.documentElement.scrollWidth - innerWidth]"
AXE_RUN = "async()=>{const r=await axe.run(document,{runOnly:['color-contrast']});return r.violations.flatMap(v=>v.nodes.slice(0,6).map(n=>n.html.slice(0,110)+' | '+(n.any[0]?n.any[0].message.slice(28,80):'')))}"


async def scroll_all(pg):
    for y in range(30):
        await pg.evaluate(f"window.scrollTo(0,{y}*innerHeight)"); await pg.wait_for_timeout(40)
    await pg.wait_for_timeout(900)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for scheme in ('light', 'dark'):
            for w, h, m in [(1366, 768, False), (320, 640, True)]:
                c = await b.new_context(viewport={'width': w, 'height': h}, is_mobile=m, has_touch=m, color_scheme=scheme)
                pg = await c.new_page()
                for path, _ in PAGES:
                    await pg.goto(BASE + path, timeout=60000); await pg.wait_for_timeout(1500)
                    x = pg.locator('[data-testid=cookie-allow-all]')
                    if await x.count() and await x.first.is_visible(): await x.first.click(force=True)
                    await scroll_all(pg); await pg.evaluate(AXE)
                    st = await pg.evaluate(STATE); bad = await pg.evaluate(AXE_RUN)
                    print(f'{scheme} {w} {path} theme={st[0]} bg={st[1]} overflow={st[2]} contrast_fails={len(bad)}', flush=True)
                    for line in bad: print('     ', line)
                await c.close()
        c = await b.new_context(viewport={'width': 1366, 'height': 768}, color_scheme='dark')
        pg = await c.new_page()
        for path, tid in PAGES:
            await pg.goto(BASE + path, timeout=60000); await pg.wait_for_timeout(1200)
            before = (await pg.evaluate(STATE))[0]
            await pg.click(f'[data-testid={tid}]'); await pg.wait_for_timeout(400)
            after = (await pg.evaluate(STATE))[0]
            await pg.reload(); await pg.wait_for_timeout(1200)
            kept = (await pg.evaluate(STATE))[0]
            print(f'toggle {path}: {before} -> {after}, after reload {kept}', flush=True)
            await pg.click(f'[data-testid={tid}]'); await pg.wait_for_timeout(300)
        await pg.click('[data-testid=terms-theme-button]'); await pg.wait_for_timeout(300)
        await pg.goto(BASE + '/cloudivr/login'); await pg.wait_for_timeout(1200)
        print('login after choosing light:', await pg.evaluate("document.documentElement.dataset.civrTheme"))
        await pg.goto(BASE + '/cloudivr'); await pg.wait_for_timeout(1200)
        print('back on landing: app attr =', await pg.evaluate("document.documentElement.dataset.civrTheme || 'none'"), 'site =', (await pg.evaluate(STATE))[0])
        await b.close()

asyncio.run(main())
