import asyncio
from playwright.async_api import async_playwright
BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]
AXE = open('/app/frontend/node_modules/axe-core/axe.min.js').read()
PAGES = ['/cloudivr/login', '/cloudivr/signup', '/cloudivr/forgot', '/cloudivr/sip', '/cloudivr/app/numbers/+15156445901',
         '/cloudivr/app/numbers/%2B13346972125', '/cloudivr/app/settings', '/cloudivr/app/ai-agents/new', '/cloudivr/app/live',
         '/cloudivr/app/wallet', '/cloudivr/app/help', '/cloudivr/app/quick-call', '/cloudivr']


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for w, h, m in [(1920, 1080, False), (375, 667, True)]:
            c = await b.new_context(viewport={'width': w, 'height': h}, is_mobile=m, has_touch=m)
            pg = await c.new_page()
            await pg.goto(BASE + '/cloudivr/login'); await pg.wait_for_timeout(1500)
            x = pg.locator('[data-testid=cookie-allow-all]')
            if await x.count() and await x.first.is_visible(): await x.first.click(force=True)
            await pg.fill('[data-testid=auth-email-input]', 'civr.alice@example.com')
            await pg.fill('[data-testid=auth-password-input]', 'AliceTest#2026')
            await pg.click('[data-testid=auth-submit-button]')
            await pg.wait_for_url('**/cloudivr/app**')
            for path in PAGES:
                await pg.goto(BASE + path); await pg.wait_for_timeout(2000); await pg.evaluate(AXE)
                r = await pg.evaluate("async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}});return r.violations.map(v=>[v.id,v.impact,v.nodes.length,v.nodes[0].html.slice(0,140)])}")
                print(w, path, r if r else 'CLEAN', flush=True)
            await c.close()
        await b.close()

asyncio.run(main())
