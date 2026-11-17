# Real-browser test: sign in to the test page with own SIP credentials, answer an incoming call, report status.
# usage: python3 browser_inbound_e2e.py <page_url> <user> <passFile> <waitSecs>
import asyncio, sys
from playwright.async_api import async_playwright

url, user, pass_file, wait = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
pw_ = open(pass_file).read().strip()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(permissions=['microphone'])
        await ctx.add_init_script("(() => { const O = window.RTCPeerConnection; window.__pcs = []; window.RTCPeerConnection = function (...a) { const pc = new O(...a); window.__pcs.push(pc); return pc }; window.RTCPeerConnection.prototype = O.prototype; })()")
        page = await ctx.new_page()
        page.on('console', lambda m: print('console:', m.text[:160]) if any(k in m.text.lower() for k in ['sip', 'call', 'error', 'ice']) else None)
        await page.goto(url, wait_until='networkidle')
        await page.click('[data-testid="tab-my-credentials"]')
        await page.fill('[data-testid="own-username-input"]', user)
        await page.fill('[data-testid="own-password-input"]', pw_)
        await page.click('[data-testid="btn-connect"]')
        await page.wait_for_selector('[data-testid="btn-disconnect"]', timeout=20000)
        print('STEP connected', flush=True)
        open('/tmp/browser_ready', 'w').write('1')
        await page.wait_for_selector('[data-testid="btn-answer-incoming"]', timeout=wait * 1000)
        print('STEP incoming call shown', flush=True)
        await page.click('[data-testid="btn-answer-incoming"]')
        await page.wait_for_timeout(8000)
        stats = await page.evaluate("""async () => {
          const out = [];
          for (const pc of (window.__pcs || [])) { const s = await pc.getStats(); s.forEach(r => { if (r.type === 'inbound-rtp' || r.type === 'outbound-rtp') out.push(r.type + ':' + (r.kind||'') + ':' + (r.packetsReceived ?? r.packetsSent)); }); }
          return out;
        }""")
        print('STEP rtp', stats, flush=True)
        await page.screenshot(path='/tmp/inbound_answered.png')
        body = await page.inner_text('body')
        print('STEP page has active timer/status:', [l for l in body.split('\n') if any(k in l.lower() for k in ['active', 'connected', 'call', '00:'])][:12], flush=True)
        await page.wait_for_timeout(4000)
        await b.close()

asyncio.run(main())
