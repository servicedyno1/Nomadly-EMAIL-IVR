"""Mobile UX audit for the CloudIVR web app: overflow, tap targets, tiny text, screenshots at 390x844."""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

BASE = os.environ.get('BASE') or open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split('\n')[0].strip()
OUT = '/tmp/mobile_audit'
os.makedirs(OUT, exist_ok=True)
EMAIL, PW = 'civr.alice@example.com', 'AliceTest#2026'

PAGES = ['', 'numbers', 'sip', 'buy', 'quick-call', 'text-call', 'ai-agents', 'ai-agents/new', 'campaigns', 'campaigns/new',
         'audio', 'wallet', 'inbox', 'settings', 'verification']
NUM_TABS = ['overview', 'forwarding', 'hours', 'ivr', 'voicemail', 'sms', 'sip', 'recording', 'logs', 'browser', 'ai', 'billing']

METRICS = """() => {
  const vw = document.documentElement.clientWidth;
  const clipped = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(p).overflowX)) return true; } return false; };
  const over = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && !clipped(e); })
    .slice(0, 8).map(e => (e.tagName + '.' + String(e.className || '').split(' ').slice(0, 3).join('.') + (e.dataset.testid ? '#' + e.dataset.testid : '')));
  const sw = document.documentElement.scrollWidth;
  const small = [...document.querySelectorAll('a,button,input,select,textarea,[role=button],[role=tab]')].filter(e => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && (r.height < 40 || r.width < 40) && !(e.type === 'checkbox' || e.type === 'radio');
  }).slice(0, 12).map(e => { const r = e.getBoundingClientRect(); return `${e.tagName}${e.dataset.testid ? '#' + e.dataset.testid : ''} ${Math.round(r.width)}x${Math.round(r.height)} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 25)}"`; });
  const tiny = [...document.querySelectorAll('body *')].filter(e => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.width > 0 && e.children.length === 0 && (e.textContent || '').trim().length > 2 && parseFloat(cs.fontSize) < 12; })
    .slice(0, 8).map(e => `${e.tagName}${e.dataset.testid ? '#' + e.dataset.testid : ''} ${getComputedStyle(e).fontSize} "${e.textContent.trim().slice(0, 30)}"`);
  const inputsZoom = [...document.querySelectorAll('input,select,textarea')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && parseFloat(getComputedStyle(e).fontSize) < 16; }).length;
  return { vw, sw, over, small, tiny, inputsZoom, h: document.documentElement.scrollHeight };
}"""


async def audit(page, name, url, report):
    try:
        await page.goto(url, wait_until='networkidle', timeout=40000)
    except Exception as e:
        print('goto fail', name, e)
    await page.wait_for_timeout(1200)
    m = await page.evaluate(METRICS)
    m['url'] = url
    report[name] = m
    await page.screenshot(path=f'{OUT}/{name.replace("/", "_") or "dashboard"}.png', full_page=True)
    flag = 'OVERFLOW' if m['sw'] > m['vw'] + 1 or m['over'] else 'ok'
    print(f"{name or 'dashboard':28s} {flag:9s} sw={m['sw']} small={len(m['small'])} tiny={len(m['tiny'])} inputs<16px={m['inputsZoom']}")
    for s in m['over'][:4]: print('   over:', s)
    for s in m['small'][:6]: print('   small:', s)
    for s in m['tiny'][:4]: print('   tiny:', s)


async def main():
    report = {}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        await audit(page, 'landing', f'{BASE}/cloudivr', report)
        await audit(page, 'login', f'{BASE}/cloudivr/login', report)
        await page.fill('[data-testid=auth-email-input]', EMAIL)
        await page.fill('[data-testid=auth-password-input]', PW)
        await page.click('[data-testid=auth-submit-button]')
        await page.wait_for_url('**/app**', timeout=30000)
        for pth in PAGES:
            await audit(page, pth, f'{BASE}/cloudivr/app/{pth}', report)
        # number detail tabs
        await page.goto(f'{BASE}/cloudivr/app/numbers', wait_until='networkidle')
        link = await page.query_selector('a[href*="/app/numbers/%2B"], a[href*="/app/numbers/+"]')
        href = await link.get_attribute('href') if link else None
        if href:
            for t in NUM_TABS:
                await audit(page, f'num-{t}', f'{BASE}{href.split("?")[0]}?tab={t}', report)
        await page.goto(f'{BASE}/cloudivr/app/campaigns', wait_until='networkidle')
        clink = await page.query_selector('a[href*="/app/campaigns/"]:not([href$="/new"])')
        chref = await clink.get_attribute('href') if clink else None
        if chref:
            await audit(page, 'campaign-detail', f'{BASE}{chref}', report)
        # More menu + softphone open states
        await page.goto(f'{BASE}/cloudivr/app', wait_until='networkidle')
        await page.click('[data-testid=mobile-nav-more]')
        await page.wait_for_timeout(600)
        m = await page.evaluate(METRICS); report['more-menu'] = m
        print('more-menu', 'OVERFLOW' if m['sw'] > m['vw'] + 1 else 'ok', [s for s in m['small'] if 'mobile-' in s][:6])
        await page.screenshot(path=f'{OUT}/more-menu.png')
        await page.keyboard.press('Escape')
        await page.wait_for_timeout(300)
        await page.click('[data-testid=topbar-softphone-button]')
        await page.wait_for_timeout(800)
        m = await page.evaluate(METRICS); report['softphone'] = m
        print('softphone', 'OVERFLOW' if m['sw'] > m['vw'] + 1 else 'ok', m['small'][:6])
        await page.screenshot(path=f'{OUT}/softphone.png')
        await b.close()
    json.dump(report, open(f'{OUT}/report.json', 'w'), indent=1)

asyncio.run(main())
