import asyncio
from playwright.async_api import async_playwright
BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]
NUM = '/cloudivr/app/numbers/%2B13346972125'


async def vis(pg, tid):
    return await pg.locator(f'[data-testid="{tid}"]').first.is_visible()


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        c = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pg = await c.new_page()
        await pg.goto(BASE + '/cloudivr/login', timeout=60000); await pg.wait_for_timeout(1500)
        x = pg.locator('[data-testid=cookie-allow-all]')
        if await x.count() and await x.first.is_visible(): await x.first.click()
        await pg.fill('[data-testid=auth-email-input]', 'civr.alice@example.com'); await pg.fill('[data-testid=auth-password-input]', 'AliceTest#2026')
        await pg.click('[data-testid=auth-submit-button]'); await pg.wait_for_url('**/cloudivr/app**')

        await pg.goto(BASE + NUM + '?tab=ivr'); await pg.wait_for_timeout(2500)
        await pg.click('[data-testid=ivr-greeting-mode-audio]'); await pg.wait_for_timeout(300)
        print('IVR empty state shown:', await vis(pg, 'ivr-greeting-audio-select-empty'))
        await pg.click('[data-testid=ivr-greeting-audio-select-empty-upload-button]'); await pg.wait_for_timeout(400)
        print('dialog open:', await vis(pg, 'ivr-greeting-audio-select-dialog'))
        await pg.set_input_files('[data-testid=audio-upload-file-input]', '/tmp/beep.mp3')
        await pg.fill('[data-testid=audio-upload-name-input]', 'Main greeting test')
        await pg.click('[data-testid=audio-upload-button]'); await pg.wait_for_timeout(3500)
        print('dialog closed:', not await vis(pg, 'ivr-greeting-audio-select-dialog'))
        sel = pg.locator('[data-testid=ivr-greeting-audio-select]')
        print('picker now a select:', await sel.evaluate('e => e.tagName'), '| picked:', await sel.evaluate('e => e.options[e.selectedIndex].text'))
        print('new-audio link:', await vis(pg, 'ivr-greeting-audio-select-add-new-button'))
        print('unsaved badge (edits kept):', await pg.get_by_text('Unsaved changes').first.is_visible())
        await pg.click('[data-testid=ivr-greeting-audio-select-add-new-button]'); await pg.wait_for_timeout(400)
        await pg.click('[data-testid=ivr-greeting-audio-select-tab-tts]'); await pg.wait_for_timeout(300)
        print('tts tab shows tts card:', await vis(pg, 'audio-tts-card'))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        print('escape closes:', not await vis(pg, 'ivr-greeting-audio-select-dialog'))
        await b.close()

asyncio.run(main())
