"""Capture real CloudIVR screens (demo account, sample data) for channel posts: stills + short clips."""
import asyncio, os, sys, shutil
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
OUT = '/tmp/chads'
os.makedirs(OUT, exist_ok=True)
STILLS = [
    ('home', '/cloudivr/app', None),
    ('ai-campaign', '/cloudivr/app/campaigns/new?kind=ai', None),
    ('quick-call', '/cloudivr/app/quick-call', None),
    ('ivr', '/cloudivr/app/answer/ivr', None),
    ('sip', '/cloudivr/app/sip', None),
    ('live', '/cloudivr/app/live', None),
    ('renewals', '/cloudivr/app/renewals', None),
    ('buy', '/cloudivr/app/buy', None),
    ('ai-conversations', '/cloudivr/app/ai-agents', None),
]

HIDE = "document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='[data-testid=preview-mode-banner]{display:none!important}';document.head.appendChild(s)})"

async def login(page):
    await page.context.add_init_script(HIDE)
    await page.goto(BASE + '/cloudivr/login'); await page.wait_for_timeout(2500)
    b = page.locator('[data-testid="cookie-allow-all"]')
    if await b.count(): await b.click()
    await page.fill('input[type="email"]', 'civr.alice@example.com')
    await page.fill('input[type="password"]', 'AliceTest#2026')
    await page.keyboard.press('Enter'); await page.wait_for_timeout(4500)

async def stills(p):
    br = await p.chromium.launch()
    ctx = await br.new_context(viewport={'width': 1280, 'height': 800}, device_scale_factor=1.5)
    page = await ctx.new_page(); await login(page)
    for name, path, _ in STILLS:
        try:
            await page.goto(BASE + path); await page.wait_for_timeout(4500)
            await page.screenshot(path=f'{OUT}/{name}.png'); print('still', name)
        except Exception as e: print('fail', name, e)
    await br.close()

async def clip(p, name, steps):
    br = await p.chromium.launch()
    ctx = await br.new_context(viewport={'width': 1280, 'height': 800}, record_video_dir=f'{OUT}/v_{name}', record_video_size={'width': 1280, 'height': 800})
    page = await ctx.new_page(); await login(page)
    try:
        await steps(page)
    except Exception as e: print('clip fail', name, e)
    await ctx.close(); await br.close()
    vids = os.listdir(f'{OUT}/v_{name}')
    if vids: shutil.move(f'{OUT}/v_{name}/{vids[0]}', f'{OUT}/{name}.webm'); print('clip', name)

async def emily_ivr(page):
    await page.goto(BASE + '/cloudivr/app/quick-call'); await page.wait_for_timeout(4000)
    inp = page.locator('input[placeholder*="Remind"], textarea[placeholder*="Remind"]').first
    await inp.click(); await inp.type('Remind +14155550123 about her 3pm appointment, press 1 to confirm or 2 to talk to us', delay=30)
    await page.keyboard.press('Enter'); await page.wait_for_timeout(9000)
    btn = page.get_by_role('button', name='Fill in the form')
    if await btn.count(): await btn.first.click(); await page.wait_for_timeout(3500)

async def number_search(page):
    await page.goto(BASE + '/cloudivr/app/buy'); await page.wait_for_timeout(3500)
    k = page.locator('[data-testid^="buy-kind-calls"] button, [data-testid="buy-kind-calls"]').first
    if await k.count(): await k.click(); await page.wait_for_timeout(2500)
    ac = page.locator('[data-testid="buy-area-code-input"]').first
    await ac.click(); await ac.type('415', delay=180); await page.keyboard.press('Enter'); await page.wait_for_timeout(4500)
    await page.mouse.wheel(0, 300); await page.wait_for_timeout(1500)

async def plan_pick(page):
    await page.goto(BASE + '/cloudivr#plans'); await page.wait_for_timeout(3500)
    s = page.locator('[data-testid="pricing-plan-suggest"]'); await s.scroll_into_view_if_needed()
    i = page.locator('[data-testid="pricing-plan-suggest-input"]'); await i.click()
    await i.type('Dental clinic with 3 front-desk phones', delay=40)
    await page.click('[data-testid="pricing-plan-suggest-button"]'); await page.wait_for_timeout(7000)
    await page.mouse.wheel(0, 250); await page.wait_for_timeout(2000)

async def main():
    async with async_playwright() as p:
        what = sys.argv[2] if len(sys.argv) > 2 else 'all'
        if what in ('all', 'stills'): await stills(p)
        if what in ('all', 'clips'):
            await clip(p, 'emily-ivr', emily_ivr)
            await clip(p, 'number-search', number_search)
            await clip(p, 'plan-pick', plan_pick)

asyncio.run(main())
