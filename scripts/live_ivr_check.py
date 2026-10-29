import asyncio, re
from playwright.async_api import async_playwright
ENV = dict(re.findall(r'^(CLOUDIVR_LIVE_TEST_(?:EMAIL|PASSWORD))=(.*)$', open('/app/backend/.env').read(), re.M))
EMAIL, PW = ENV['CLOUDIVR_LIVE_TEST_EMAIL'].strip().strip('"'), ENV['CLOUDIVR_LIVE_TEST_PASSWORD'].strip().strip('"')
SITE = 'https://cloudivr.net'
OUT = []
def say(*a): print(*a, flush=True); OUT.append(' '.join(map(str, a)))
async def vis(pg, sel):
    loc = pg.locator(sel)
    return await loc.count() > 0 and await loc.first.is_visible()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); c = await b.new_context(viewport={'width': 1366, 'height': 900}); pg = await c.new_page()
        await pg.goto(SITE + '/login', timeout=60000, wait_until='domcontentloaded'); await pg.wait_for_timeout(2000)
        if await vis(pg, '[data-testid=cookie-allow-all]'): await pg.click('[data-testid=cookie-allow-all]')
        await pg.fill('[data-testid=auth-email-input]', EMAIL); await pg.fill('[data-testid=auth-password-input]', PW)
        await pg.click('[data-testid=auth-submit-button]'); await pg.wait_for_timeout(5000)
        say('after login url:', pg.url.replace(SITE, ''))
        if '/app' not in pg.url:
            say('LOGIN BLOCKED:', (await pg.locator('main').inner_text())[:300].replace('\n', ' | ')); await b.close(); return
        # Quick IVR: fill only, never press Call
        await pg.goto(SITE + '/app/quick-call', wait_until='domcontentloaded'); await pg.wait_for_timeout(3500)
        say('quick-call page:', await vis(pg, '[data-testid=quick-source-audio]'), '| no-number empty state:', await vis(pg, '[data-testid=quick-call-empty-action]'))
        if await vis(pg, '[data-testid=quick-source-audio]'):
            await pg.click('[data-testid=quick-source-audio]'); await pg.wait_for_timeout(600)
            empty = await vis(pg, '[data-testid=quick-call-audio-select-empty]')
            n = await pg.locator('[data-testid=quick-call-audio-select] option').count()
            say('quick audio picker: empty-state', empty, '| options', n, '| +New audio', await vis(pg, '[data-testid=quick-call-audio-select-add-new-button]'))
            btn = pg.locator('[data-testid=quick-call-audio-select-add-new-button], [data-testid=quick-call-audio-select-empty-upload-button]')
            if await btn.count():
                await btn.first.click(); await pg.wait_for_timeout(600)
                bb = await pg.locator('[data-testid=quick-call-audio-select-dialog]').bounding_box()
                say('add-audio dialog height px:', round(bb['height']) if bb else None); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
            sch = pg.locator('[data-testid^=quick-schedule-mode], [data-testid*=quick-when-later], [data-testid*=schedule-toggle]')
            say('quick schedule controls found:', await sch.count())
        # Campaign: schedule a week out, then cancel immediately. Never press Start.
        await pg.goto(SITE + '/app/campaigns/new', wait_until='domcontentloaded'); await pg.wait_for_timeout(3500)
        can = await vis(pg, '[data-testid=campaign-schedule-trigger]')
        say('campaign form available:', can)
        await b.close()

asyncio.run(main())
