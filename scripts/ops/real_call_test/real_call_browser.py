"""LIVE end-to-end test of 'answer incoming calls in the browser' on https://cloudivr.net (real Telnyx calls).
Usage: python3 real_call_browser.py <email> <password> <testNumber>
A real call is placed from TELNYX_DEFAULT_ANI to the test number; a headless Chromium (fake mic) logged in as the
test account answers it. Results → /app/test_reports/real_call_test_2026-10-24.json, screenshots → /app/test_reports/real_call/.
"""
import asyncio, json, os, re, sys, time, urllib.request

from playwright.async_api import async_playwright

SITE = 'https://cloudivr.net'
OUT_DIR = '/app/test_reports/real_call'
REPORT = '/app/test_reports/real_call_test_2026-10-24.json'
SINK = 'https://httpbin.org/post'
ENV = dict(re.findall(r'^([A-Z0-9_]+)="?([^"\n]*)"?$', open('/app/backend/.env').read(), re.M))
KEY, APP, ANI = ENV['TELNYX_API_KEY'], ENV['TELNYX_CALL_CONTROL_APP_ID'], ENV['TELNYX_DEFAULT_ANI']
results = {'started': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'caller': ANI, 'tests': {}}


def tx(method, path, body=None):
    req = urllib.request.Request(f'https://api.telnyx.com/v2{path}', method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return {'error': e.code, 'body': e.read().decode()[:300]}


def dial(to):
    r = tx('POST', '/calls', {'connection_id': APP, 'to': to, 'from': ANI, 'webhook_url': SINK, 'timeout_secs': 60})
    return r.get('data', {}).get('call_control_id'), r


def alive(ccid):
    return tx('GET', f'/calls/{ccid}').get('data', {}).get('is_alive')


def say(ccid, text):
    return tx('POST', f'/calls/{ccid}/actions/speak', {'payload': text, 'voice': 'female', 'language': 'en-US'})


def hang(ccid):
    if ccid and alive(ccid):
        tx('POST', f'/calls/{ccid}/actions/hangup', {})


async def shot(page, name):
    os.makedirs(OUT_DIR, exist_ok=True)
    await page.screenshot(path=f'{OUT_DIR}/{name}.png', full_page=False)


async def wait_for(fn, secs, step=1.0):
    end = time.time() + secs
    while time.time() < end:
        v = await fn()
        if v:
            return v
        await asyncio.sleep(step)
    return None


def absent(page, sel):
    async def check():
        return await page.locator(sel).count() == 0
    return check


async def api(page, path, method='GET', body=None):
    r = await (page.request.get(f'{SITE}/cloudivr-web{path}') if method == 'GET' else page.request.post(f'{SITE}/cloudivr-web{path}', data=body or {}))
    try:
        return await r.json()
    except Exception:
        return {'status': r.status}


async def banner(page, secs=30):
    try:
        await page.wait_for_selector('[data-testid=incoming-banner]', timeout=secs * 1000)
        return True
    except Exception:
        return False


async def test_text(page, num):
    t, ccid = {}, None
    try:
        await page.goto(f'{SITE}/app', wait_until='domcontentloaded')
        await asyncio.sleep(5)
        t0 = time.time()
        ccid, raw = dial(num)
        t['dial'] = bool(ccid) or raw
        t['banner'] = await banner(page)
        t['banner_after_s'] = round(time.time() - t0, 1)
        if not t['banner']:
            return t
        t['banner_from'] = await page.inner_text('[data-testid=incoming-from]')
        await shot(page, '1_text_banner')
        await page.click('[data-testid=incoming-text-button]')
        ok = await wait_for(lambda: page.locator('[data-testid=relay-status]').filter(has_text='Connected').count(), 20)
        t['connected'] = bool(ok)
        info = await api(page, '/relay/info')
        cid = info.get('live')
        t['call_id'] = cid
        await asyncio.sleep(3)
        t['caller_spoke'] = say(ccid, 'Hello, this is the CloudIVR automatic test caller. I am checking that answering by text works today.')

        async def heard():
            c = (await api(page, f'/relay/calls/{cid}')).get('call', {})
            return [l['text'] for l in c.get('lines', []) if l['who'] == 'them'] or None
        t['caller_words_seen_as_text'] = await wait_for(heard, 45, 2)
        await page.fill('[data-testid=relay-input]', 'Hello caller, this is the browser answering by text.')
        await page.click('[data-testid=relay-send-button]')
        await asyncio.sleep(6)
        c = (await api(page, f'/relay/calls/{cid}')).get('call', {})
        t['my_line_sent'] = any(l['who'] == 'me' for l in c.get('lines', []))
        t['notes'] = [l['text'] for l in c.get('lines', []) if l['who'] == 'note']
        await shot(page, '2_text_live')
        await page.click('[data-testid=relay-hangup-button]')
        await asyncio.sleep(5)
        c = (await api(page, f'/relay/calls/{cid}')).get('call', {})
        t['ended'] = {'status': c.get('status'), 'outcome': c.get('outcome'), 'duration': c.get('duration'), 'charge': c.get('charge'), 'direction': c.get('direction')}
        t['caller_leg_alive_after_hangup'] = alive(ccid)
        await shot(page, '3_text_ended')
    except Exception as e:
        t['error'] = str(e)[:300]
    finally:
        hang(ccid)
    return t


async def test_voice(page, num):
    t, ccid = {}, None
    try:
        await page.goto(f'{SITE}/app/numbers/{num.replace("+", "%2B")}?tab=browser', wait_until='domcontentloaded')
        online = await wait_for(lambda: page.locator('[data-testid=browser-ring-voice-status]').filter(has_text='Online now').count(), 40)
        t['browser_phone_online'] = bool(online)
        if not online:
            t['voice_note'] = await page.inner_text('[data-testid=browser-ring-voice-note]')
            await shot(page, '4_voice_offline')
            return t
        ccid, raw = dial(num)
        t['dial'] = bool(ccid) or raw
        t['banner'] = await banner(page)
        if not t['banner']:
            return t
        enabled = await wait_for(lambda: page.locator('[data-testid=incoming-voice-button]:not([disabled])').count(), 10)
        t['voice_button_enabled'] = bool(enabled)
        await asyncio.sleep(4)  # let the SIP ring reach the browser phone
        await shot(page, '5_voice_banner')
        await page.click('[data-testid=incoming-voice-button]')
        active = await wait_for(lambda: page.locator('[data-testid=softphone-status]').filter(has_text='active').count(), 20)
        t['browser_call_active'] = bool(active)
        t['softphone_status'] = await page.inner_text('[data-testid=softphone-status]')
        say(ccid, 'This is the voice answer test. The browser should hear me now.')
        await asyncio.sleep(8)
        await shot(page, '6_voice_active')
        hang(ccid)
        gone = await wait_for(absent(page, '[data-testid=softphone-hangup-button]'), 15)
        t['browser_call_ended_after_caller_hangup'] = bool(gone)
    except Exception as e:
        t['error'] = str(e)[:300]
    finally:
        hang(ccid)
    return t


async def test_fallback(page, num):
    t, ccid = {}, None
    try:
        await page.goto(f'{SITE}/app/inbox', wait_until='domcontentloaded')
        await asyncio.sleep(4)
        ccid, raw = dial(num)
        t['dial'] = bool(ccid) or raw
        t['banner'] = await banner(page)
        t0 = time.time()
        gone = await wait_for(absent(page, '[data-testid=incoming-banner]'), 45)
        t['banner_gone_after_s'] = round(time.time() - t0, 1) if gone else None
        ended = await wait_for(lambda: asyncio.sleep(0, result=not alive(ccid)), 30, 2)
        t['caller_hung_up_by_fallback'] = bool(ended)
        await asyncio.sleep(8)
        m = await api(page, '/missed-calls')
        row = next((c for c in m.get('calls', []) if c.get('from') == ANI), None)
        t['missed_call_logged'] = row
        await page.reload(wait_until='domcontentloaded')
        await asyncio.sleep(4)
        await shot(page, '7_inbox_missed')
        if row and row.get('canReply'):
            r = await api(page, f"/missed-calls/{row['id']}/reply", 'POST', {'text': 'Sorry I missed your call. This is an automated CloudIVR test.'})
            t['text_back'] = r
    except Exception as e:
        t['error'] = str(e)[:300]
    finally:
        hang(ccid)
    return t


async def test_decline_text(page, num):
    t, ccid = {}, None
    try:
        await page.goto(f'{SITE}/app', wait_until='domcontentloaded')
        await asyncio.sleep(4)
        ccid, raw = dial(num)
        t['dial'] = bool(ccid) or raw
        t['banner'] = await banner(page)
        if not t['banner']:
            return t
        await page.click('[data-testid=incoming-decline-message-button]')
        await page.click('[data-testid=incoming-message-preset-1]')
        await asyncio.sleep(3)
        t['toasts'] = await page.locator('[data-sonner-toast]').all_inner_texts()
        await shot(page, '8_decline_text')
        ended = await wait_for(lambda: asyncio.sleep(0, result=not alive(ccid)), 30, 2)
        t['caller_hung_up_by_fallback'] = bool(ended)
    except Exception as e:
        t['error'] = str(e)[:300]
    finally:
        hang(ccid)
    return t


async def main(email, password, num):
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 1920, 'height': 800}, permissions=['microphone'])
        page = await ctx.new_page()
        await page.goto(f'{SITE}/login', wait_until='domcontentloaded')
        await page.wait_for_selector('[data-testid=auth-email-input]', timeout=30000)
        await page.fill('[data-testid=auth-email-input]', email)
        await page.fill('input[type=password]', password)
        await page.keyboard.press('Enter')
        await page.wait_for_url(re.compile(r'/app'), timeout=30000)
        for name, fn in [('text_answer', test_text), ('voice_answer', test_voice), ('fallback_and_text_back', test_fallback), ('decline_with_text', test_decline_text)]:
            results['tests'][name] = await fn(page, num)
            json.dump(results, open(REPORT, 'w'), indent=2)
            await asyncio.sleep(5)
        await b.close()
    results['finished'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    json.dump(results, open(REPORT, 'w'), indent=2)
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    asyncio.run(main(*sys.argv[1:4]))
