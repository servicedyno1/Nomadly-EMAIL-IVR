# Light-mode app screenshots for the landing page (desktop + phone), saved as webp in frontend/public/cloudivr/shots.
import asyncio, io, os, sys
from playwright.async_api import async_playwright
from PIL import Image

BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0] + '/cloudivr'
OUT = '/app/frontend/public/cloudivr/shots'
MN = sys.argv[1] if len(sys.argv) > 1 else '+15554586272'
q = lambda s: s.replace('+', '%2B')
PAGES = [
    ('messages', f'/app/messages?number={q(MN)}&contact={q("+18885550134")}', None, None),
    ('numbers', '/app/numbers', '[data-testid="mobile-lines"]', None),
    ('esim', '/app/esim', '[data-testid="esim-list"], [data-testid^="esim-line-"]', 'Show install QR'),
    ('ivr', f'/app/numbers/{q("+13346972125")}?tab=ivr', 'text=Keypad menu (IVR)', None),
    ('overview', '/app', None, None),
    ('campaigns', '/app/campaigns', None, None),
    ('live', '/app/live', None, None),
]
HIDE = """
document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '[aria-label="Preview mode notice"],[data-testid="support-chat-toggle"],[data-testid="dashboard-channel-card"],.civr-offer{display:none!important}'; document.head.appendChild(st); });
setInterval(() => document.querySelectorAll('.civr-card').forEach(c => { if (/how is CloudIVR so far/i.test(c.textContent)) c.style.display = 'none'; }), 300);
"""
SIZES = {'desktop': dict(viewport={'width': 1440, 'height': 900}, device_scale_factor=1), 'phone': dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)}

async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for size, opts in SIZES.items():
            ctx = await b.new_context(**opts, color_scheme='light')
            await ctx.add_init_script("localStorage.setItem('civr.theme','light'); localStorage.setItem('civr.lang','en');" + HIDE)
            pg = await ctx.new_page()
            await pg.goto(BASE + '/login', wait_until='load'); await pg.wait_for_timeout(2000)
            await pg.fill('input[type=email]', 'civr.alice@example.com'); await pg.fill('input[type=password]', 'AliceTest#2026'); await pg.keyboard.press('Enter')
            await pg.wait_for_timeout(4000)
            for name, path, scroll, click in PAGES:
                for _ in range(3):
                    try: await pg.goto(BASE + path, wait_until='load'); break
                    except Exception: await pg.wait_for_timeout(1500)
                await pg.wait_for_timeout(3500)
                for t in ['Deny', 'Got it']:
                    btn = pg.get_by_role('button', name=t, exact=True)
                    if await btn.count(): await btn.first.click(); await pg.wait_for_timeout(300)
                if click:
                    btn = pg.get_by_text(click).first
                    if await btn.count(): await btn.click(); await pg.wait_for_timeout(1500)
                if scroll:
                    el = pg.locator(scroll).first
                    if await el.count(): await el.evaluate('(e, b) => e.scrollIntoView({block: b})', 'start'); await pg.evaluate('window.scrollBy(0, %d)' % (330 if name == 'ivr' else -90))
                await pg.wait_for_timeout(600)
                png = await pg.screenshot(full_page=False)
                Image.open(io.BytesIO(png)).convert('RGB').save(f'{OUT}/{name}-{size}.webp', 'WEBP', quality=78, method=6)
                print(size, name, os.path.getsize(f'{OUT}/{name}-{size}.webp') // 1024, 'KB')
            await ctx.close()
        await b.close()

asyncio.run(main())
