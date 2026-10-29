import asyncio
from playwright.async_api import async_playwright
BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]
NUM = '/cloudivr/app/numbers/%2B13346972125'
async def vis(pg, tid): return await pg.locator(f'[data-testid="{tid}"]').first.is_visible()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); c = await b.new_context(viewport={'width': 1366, 'height': 900}); pg = await c.new_page()
        await pg.goto(BASE + '/cloudivr/login', timeout=60000); await pg.wait_for_timeout(1500)
        x = pg.locator('[data-testid=cookie-allow-all]')
        if await x.count() and await x.first.is_visible(): await x.first.click()
        await pg.fill('[data-testid=auth-email-input]', 'civr.alice@example.com'); await pg.fill('[data-testid=auth-password-input]', 'AliceTest#2026')
        await pg.click('[data-testid=auth-submit-button]'); await pg.wait_for_url('**/cloudivr/app**')
        await pg.goto(BASE + '/cloudivr/app/quick-call'); await pg.wait_for_timeout(2500)
        await pg.click('[data-testid=quick-source-audio]'); await pg.wait_for_timeout(300)
        print('Quick Call empty state:', await vis(pg, 'quick-call-audio-select-empty'))
        await pg.goto(BASE + '/cloudivr/app/campaigns/new'); await pg.wait_for_timeout(2500)
        print('Campaign message empty state:', await vis(pg, 'campaign-audio-select-empty'))
        vm = pg.locator('[data-testid$=voicemail-audio-select-empty], [data-testid^=campaign-voicemail][data-testid$=-empty]')
        print('Campaign voicemail drop compact:', await vm.count() > 0 and await vm.first.is_visible())
        await pg.goto(BASE + NUM + '?tab=voicemail'); await pg.wait_for_timeout(2500)
        await pg.select_option('[data-testid=voicemail-greeting-type-select]', 'custom'); await pg.wait_for_timeout(300)
        print('Voicemail custom greeting empty state:', await vis(pg, 'voicemail-greeting-audio-select-empty'))
        await pg.goto(BASE + NUM + '?tab=ivr'); await pg.wait_for_timeout(2500)
        add = pg.locator('[data-testid^=ivr-add-option], [data-testid*=add-key]')
        if await add.count(): await add.first.click(); await pg.wait_for_timeout(300)
        act = pg.locator('[data-testid^=ivr-option-0][data-testid$=action-select]')
        if await act.count(): await act.first.select_option('message'); await pg.wait_for_timeout(300)
        print('IVR key message compact buttons:', await vis(pg, 'ivr-option-0-message-audio-select-empty'))
        await b.close()
asyncio.run(main())
