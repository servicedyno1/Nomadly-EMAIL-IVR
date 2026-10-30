import asyncio, sys
from playwright.async_api import async_playwright
BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]
LANG = sys.argv[1] if len(sys.argv) > 1 else 'es'
JS = """(sel) => { const out = []; for (const root of document.querySelectorAll(sel)) { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const t = n.textContent.trim(); if (t.length > 1 && /[a-z]/i.test(t) && !n.parentElement.closest('[data-no-translate]')) out.push(t); } } return [...new Set(out)]; }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for w, h, m, sel in [(1366, 900, False, 'aside.civr-side, header'), (390, 844, True, '[data-testid=mobile-more-menu], [data-testid=mobile-bottom-nav]')]:
            c = await b.new_context(viewport={'width': w, 'height': h}, is_mobile=m, has_touch=m); pg = await c.new_page()
            await pg.goto(BASE + '/cloudivr/login', timeout=60000); await pg.wait_for_timeout(1200)
            x = pg.locator('[data-testid=cookie-allow-all]')
            if await x.count() and await x.first.is_visible(): await x.first.click()
            await pg.fill('[data-testid=auth-email-input]', 'civr.alice@example.com'); await pg.fill('[data-testid=auth-password-input]', 'AliceTest#2026')
            await pg.click('[data-testid=auth-submit-button]'); await pg.wait_for_url('**/cloudivr/app**')
            await pg.evaluate(f"localStorage.setItem('civr.lang', '{LANG}')"); await pg.reload(); await pg.wait_for_timeout(3000)
            if m: await pg.tap('[data-testid=mobile-nav-more]'); await pg.wait_for_timeout(600)
            print(w, await pg.evaluate(JS, sel))
            await c.close()
        await b.close()
asyncio.run(main())
