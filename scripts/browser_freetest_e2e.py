# Real-browser test of the Free Test tab: OTP → test login → connect → outbound call → report media.
# usage: python3 browser_freetest_e2e.py <page_url> <otp> <destination> <holdSecs>
import asyncio, sys
from playwright.async_api import async_playwright

url, otp, dest, hold = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
STATS = """async () => { const out = []; for (const pc of (window.__pcs || [])) { const s = await pc.getStats(); s.forEach(r => { if (r.type === 'inbound-rtp' || r.type === 'outbound-rtp') out.push(r.type + ':' + (r.packetsReceived ?? r.packetsSent) + (r.audioLevel !== undefined ? ':lvl=' + r.audioLevel.toFixed(3) : '')); }); } return out; }"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(permissions=['microphone'])
        await ctx.add_init_script("(() => { const O = window.RTCPeerConnection; window.__pcs = []; window.RTCPeerConnection = function (...a) { const pc = new O(...a); window.__pcs.push(pc); return pc }; window.RTCPeerConnection.prototype = O.prototype; })()")
        page = await ctx.new_page()
        await page.goto(url, wait_until='networkidle')
        await page.fill('[data-testid="otp-input"]', otp)
        await page.click('[data-testid="btn-verify-otp"]')
        await page.wait_for_selector('[data-testid="test-credentials-card"]', timeout=15000)
        print('STEP otp accepted, domain:', await page.inner_text('[data-testid="sip-domain-display"]'), flush=True)
        await page.click('[data-testid="btn-connect"]')
        await page.wait_for_selector('[data-testid="btn-disconnect"]', timeout=20000)
        print('STEP connected:', (await page.inner_text('[data-testid="status-bar"]')).strip(), flush=True)
        await page.fill('[data-testid="destination-input"]', dest)
        await page.click('[data-testid="btn-call"]')
        for i in range(hold // 5):
            await page.wait_for_timeout(5000)
            print(f'STEP t+{(i+1)*5}s rtp', await page.evaluate(STATS), flush=True)
        print('STEP logs:', (await page.inner_text('[data-testid="logs-container"]')).split('\n')[:10], flush=True)
        await page.screenshot(path='/tmp/freetest.png')
        try: await page.click('[data-testid="btn-hangup"]', timeout=3000)
        except Exception: pass
        await page.wait_for_timeout(2000)
        await b.close()

asyncio.run(main())
