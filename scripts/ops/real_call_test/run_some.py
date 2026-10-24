import asyncio, sys
import real_call_browser as r


async def main(email, password, num, names):
    from playwright.async_api import async_playwright
    import json, re, time
    fns = {'text_answer': r.test_text, 'voice_answer': r.test_voice, 'fallback_and_text_back': r.test_fallback, 'decline_with_text': r.test_decline_text}
    prev = json.load(open(r.REPORT))
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 1920, 'height': 800}, permissions=['microphone'])
        page = await ctx.new_page()
        await page.goto(f'{r.SITE}/login', wait_until='domcontentloaded')
        await page.wait_for_selector('[data-testid=auth-email-input]', timeout=30000)
        await page.fill('[data-testid=auth-email-input]', email)
        await page.fill('input[type=password]', password)
        await page.keyboard.press('Enter')
        await page.wait_for_url(re.compile(r'/app'), timeout=30000)
        for n in names:
            prev['tests'][n] = await fns[n](page, num)
            json.dump(prev, open(r.REPORT, 'w'), indent=2)
            await asyncio.sleep(5)
        await b.close()
    prev['finished'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    json.dump(prev, open(r.REPORT, 'w'), indent=2)
    print('DONE')


if __name__ == '__main__':
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split(',')))
