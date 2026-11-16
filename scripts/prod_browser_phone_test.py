"""Live browser-phone check on cloudivr.net (session cookie in /tmp/civr_cookie).
Tab A registers on <from> and calls <to>; with a third arg, tab B registers on <to> and answers.
Usage: python3 scripts/prod_browser_phone_test.py <from> [<to> [answer]]"""
import asyncio, sys, json
from playwright.async_api import async_playwright

FROM = sys.argv[1]
TO = sys.argv[2] if len(sys.argv) > 2 else ''
ANSWER = len(sys.argv) > 3
T = lambda id: f'[data-testid="{id}"]'
INIT = """
  window.__pcs=[]; const O=window.RTCPeerConnection;
  window.RTCPeerConnection=function(...a){const pc=new O(...a); window.__pcs.push(pc); return pc}; window.RTCPeerConnection.prototype=O.prototype;
  window.__ws=[]; const W=window.WebSocket;
  window.WebSocket=function(u,pr){const w=new W(u,pr); if(/8443/.test(u)){ w.addEventListener('message',e=>window.__ws.push('< '+String(e.data).split('\\r\\n')[0])); const s=w.send.bind(w); w.send=d=>{window.__ws.push('> '+String(d).split('\\r\\n')[0]); return s(d)}; w.addEventListener('close',e=>window.__ws.push('closed '+e.code));} return w}; window.WebSocket.prototype=W.prototype; Object.assign(window.WebSocket,{OPEN:1,CLOSED:3,CONNECTING:0,CLOSING:2});
"""
STATS = """async()=>{const o=[];for(const pc of window.__pcs){if(pc.connectionState==='closed')continue;const r=await pc.getStats();let i=0,ob=0;r.forEach(s=>{if(s.type==='inbound-rtp')i+=s.bytesReceived||0;if(s.type==='outbound-rtp')ob+=s.bytesSent||0});o.push(pc.iceConnectionState+' in='+i+' out='+ob)}return o.join(';')}"""

async def tab(b, name, line):
    ctx = await b.new_context(viewport={'width': 1400, 'height': 900}, permissions=['microphone'])
    await ctx.add_cookies([{'name': 'civr_session', 'value': open('/tmp/civr_cookie').read().strip(), 'domain': 'cloudivr.net', 'path': '/', 'secure': True, 'httpOnly': True}])
    await ctx.add_init_script(INIT)
    page = await ctx.new_page()
    page.on('console', lambda m: print(name, 'console:', m.text[:260]) if m.type == 'error' and 'sip' in m.text.lower() else None)
    await page.goto('https://cloudivr.net/app', wait_until='domcontentloaded')
    await page.wait_for_timeout(5000)
    try: await page.get_by_role('button', name='Got it').click(timeout=3000)
    except Exception: pass
    await page.click(T('topbar-softphone-button'), force=True)
    await page.wait_for_selector(T('softphone-number-select'), timeout=15000)
    await page.select_option(T('softphone-number-select'), line)
    await page.click(T('softphone-connect-button'), force=True)
    st = ''
    for _ in range(15):
        await page.wait_for_timeout(1000)
        st = (await page.inner_text(T('softphone-status'))).replace('\n', ' | ')
        if 'Online' in st or 'Not connected' in st: break
    print(name, line, 'STATUS:', st)
    return page

async def click(page, id, label):
    try: await page.click(T(id), force=True, timeout=2000); print(label, 'OK')
    except Exception as e: print(label, 'FAILED', str(e)[:80])

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        B = await tab(b, 'B', TO) if ANSWER else None
        A = await tab(b, 'A', FROM)
        if TO:
            await A.fill(T('softphone-destination-input'), TO)
            await A.click(T('softphone-call-button'), force=True)
            answered = False
            for i in range(26):
                await A.wait_for_timeout(1000)
                line = f"{i} A[{(await A.inner_text(T('softphone-status'))).splitlines()[0]}] {await A.evaluate(STATS)}"
                if B:
                    line += f" | B[{(await B.inner_text(T('softphone-status'))).splitlines()[0]}] {await B.evaluate(STATS)}"
                    if not answered and await B.locator(T('softphone-answer-button')).count():
                        await click(B, 'softphone-answer-button', 'B answer'); answered = True
                print(line)
                if i == 9: await click(A, 'softphone-key-5', 'A DTMF 5')
                if i == 15: await click(A, 'softphone-hangup-button', 'A hangup')
        for n, pg in (('A', A), ('B', B)):
            if pg: print(n, 'SIP:', json.dumps(await pg.evaluate('window.__ws')))
        await A.screenshot(path='/tmp/prod_phone.jpg', quality=30, type='jpeg')
        await b.close()

asyncio.run(main())
