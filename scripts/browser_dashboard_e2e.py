# Real-browser test of the CloudIVR web dashboard phone. mode=in: answer an incoming call; mode=out: dial <dest>.
# usage: python3 browser_dashboard_e2e.py <base_url> <cookieFile> in|out [dest] [holdSecs]
import asyncio, sys
from playwright.async_api import async_playwright

base, cookie_file, mode = sys.argv[1], sys.argv[2], sys.argv[3]
dest = sys.argv[4] if len(sys.argv) > 4 else ''
hold = int(sys.argv[5]) if len(sys.argv) > 5 else 25
token = open(cookie_file).read().strip()
STATS = """async () => { const out = []; for (const pc of (window.__pcs || [])) { const s = await pc.getStats(); s.forEach(r => { if (r.type === 'inbound-rtp' || r.type === 'outbound-rtp') out.push(r.type + ':' + (r.packetsReceived ?? r.packetsSent)); }); } return out; }"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(permissions=['microphone'])
        host = base.split('//')[1].split('/')[0]
        await ctx.add_cookies([{'name': 'civr_session', 'value': token, 'domain': host, 'path': '/', 'secure': True, 'httpOnly': True}])
        await ctx.add_init_script("(() => { const O = window.RTCPeerConnection; window.__pcs = []; window.RTCPeerConnection = function (...a) { const pc = new O(...a); window.__pcs.push(pc); return pc }; window.RTCPeerConnection.prototype = O.prototype; })()")
        page = await ctx.new_page()
        await page.goto(base + '/app', wait_until='networkidle')
        try: await page.click('[data-testid="cookie-allow-all"]', timeout=3000)
        except Exception: pass
        for sel in ['onboarding-skip', 'whats-new-close', 'onboarding-skip', 'whats-new-close']:
            try: await page.click(f'[data-testid="{sel}"]', timeout=2500)
            except Exception: pass
        await page.click('[data-testid="topbar-softphone-button"]')
        await page.wait_for_selector('[data-testid="softphone-status"]', timeout=15000)
        for _ in range(20):
            st = (await page.inner_text('[data-testid="softphone-status"]')).strip()
            if 'ready' in st.lower() or 'connected' in st.lower() or 'online' in st.lower(): break
            await page.wait_for_timeout(1000)
        print('STEP status:', st, '| line:', await page.input_value('[data-testid="softphone-number-select"]'), flush=True)
        open('/tmp/browser_ready', 'w').write('1')
        if mode == 'in':
            btn = await page.wait_for_selector('[data-testid="incoming-voice-button"], [data-testid="softphone-answer-button"]', timeout=60000)
            print('STEP incoming:', (await page.inner_text('body'))[:0] or await btn.get_attribute('data-testid'), flush=True)
            try: print('STEP from:', await page.inner_text('[data-testid="incoming-from"]', timeout=2000))
            except Exception: pass
            await page.wait_for_timeout(1500)
            await page.locator('[data-testid="incoming-voice-button"], [data-testid="softphone-answer-button"]').first.click(timeout=10000)
            print('STEP clicked answer', flush=True)
            try: await page.click('[data-testid="softphone-answer-button"]', timeout=4000); print('STEP clicked softphone answer')
            except Exception: pass
        else:
            await page.fill('[data-testid="softphone-destination-input"]', dest)
            await page.click('[data-testid="softphone-call-button"]')
            print('STEP dialing', dest, flush=True)
        for i in range(hold // 5):
            await page.wait_for_timeout(5000)
            print(f'STEP t+{(i+1)*5}s rtp', await page.evaluate(STATS), '|', (await page.inner_text('[data-testid="softphone-status"]')).strip()[:80], flush=True)
        await page.screenshot(path=f'/tmp/dash_{mode}.png')
        try: await page.click('[data-testid="softphone-hangup-button"]', timeout=3000)
        except Exception: pass
        await page.wait_for_timeout(2000)
        await b.close()

asyncio.run(main())
