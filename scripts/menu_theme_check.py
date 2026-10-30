import asyncio
from playwright.async_api import async_playwright
BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]
COL = "(sel) => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e); let p = e, bg = 'rgba(0, 0, 0, 0)'; while (p && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) { bg = getComputedStyle(p).backgroundColor; p = p.parentElement; } return [c.color, bg]; }"
def lum(rgb):
    v = [int(x) / 255 for x in rgb[rgb.index('(') + 1:rgb.index(')')].split(',')[:3]]
    v = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in v]
    return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]
def ratio(a, b): la, lb = sorted([lum(a), lum(b)], reverse=True); return round((la + .05) / (lb + .05), 2)
async def login(pg):
    await pg.goto(BASE + '/cloudivr/login', timeout=60000); await pg.wait_for_timeout(1500)
    x = pg.locator('[data-testid=cookie-allow-all]')
    if await x.count() and await x.first.is_visible(): await x.first.click()
    await pg.fill('[data-testid=auth-email-input]', 'civr.alice@example.com'); await pg.fill('[data-testid=auth-password-input]', 'AliceTest#2026')
    await pg.click('[data-testid=auth-submit-button]'); await pg.wait_for_url('**/cloudivr/app**'); await pg.wait_for_timeout(1500)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        c = await b.new_context(viewport={'width': 375, 'height': 760}, is_mobile=True, has_touch=True, color_scheme='light'); pg = await c.new_page(); await login(pg)
        await pg.tap('[data-testid=mobile-nav-more]'); await pg.wait_for_timeout(500)
        r = await pg.evaluate(COL, '[data-testid=mobile-more-settings] > div'); print('phone More "Language" (light):', r, ratio(*r))
        r = await pg.evaluate(COL, '[data-testid=mobile-lang-switcher] span.uppercase'); print('phone More "EN" pill (light):', r, ratio(*r))
        await c.close()
        c = await b.new_context(viewport={'width': 1366, 'height': 800}, color_scheme='light'); pg = await c.new_page(); await login(pg)
        await pg.click('[data-testid=topbar-lang-switcher]'); await pg.wait_for_timeout(400)
        r = await pg.evaluate(COL, '[data-testid=topbar-lang-switcher-option-fr]'); print('app lang menu item (light):', r, ratio(*r))
        await c.close()
        c = await b.new_context(viewport={'width': 1366, 'height': 800}, color_scheme='dark'); pg = await c.new_page()
        for path, t in (('/cloudivr/sip', 'sip-lang-switcher'), ('/cloudivr/terms', 'terms-lang-switcher'), ('/cloudivr', 'landing-lang-switcher')):
            await pg.goto(BASE + path, timeout=60000); await pg.wait_for_timeout(1500)
            x = pg.locator('[data-testid=cookie-allow-all]')
            if await x.count() and await x.first.is_visible(): await x.first.click()
            await pg.click(f'[data-testid={t}]'); await pg.wait_for_timeout(400)
            r = await pg.evaluate(COL, f'[data-testid={t}-option-es]'); print(f'{path} lang menu (dark):', r, ratio(*r))
            await pg.keyboard.press('Escape')
        await b.close()
asyncio.run(main())
