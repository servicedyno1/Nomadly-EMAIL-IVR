# Programmatic UX review of every texting touchpoint: phone + desktop, English + Spanish.
# Checks horizontal overflow, small tap targets, English left in Spanish, and leftover old wording.
import asyncio, json, re
from playwright.async_api import async_playwright

URL = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0].rstrip('/')
BAD = [r'\$50\b(?!0)', r'sent or received', r'Send and receive', r'Use my existing business number', r'ownership code', r'phone bill', r'authorization letter']
VIEWS = {'phone': (390, 844), 'desktop': (1440, 900)}
PAGES = [('landing-pricing', '/cloudivr/#pricing', False, '[data-testid="pricing-section"]'),
         ('signup-texting', '/cloudivr/signup?plan=texting', False, 'main'),
         ('buy', '/cloudivr/app/buy', True, '[data-testid="buy-page"]'),
         ('texting', '/cloudivr/app/texting', True, '[data-testid="texting-page"]'),
         ('texting-add', '/cloudivr/app/texting?add=1', True, '[data-testid="texting-new"]'),
         ('texting-start', '/cloudivr/app/texting?start=texting', True, '[data-testid="texting-new"]'),
         ('admin-texting', None, False, None)]
JS = """(sel) => { const root = document.querySelector(sel) || document.body; const out = { overflow: document.documentElement.scrollWidth - window.innerWidth, small: [], english: [], text: root.innerText };
  for (const el of root.querySelectorAll('button,a,input,[role=radio],[role=tab]')) { const r = el.getBoundingClientRect(); if (r.width && r.height && (r.height < 24 || r.width < 24) && getComputedStyle(el).visibility !== 'hidden') out.small.push((el.dataset.testid || el.innerText || el.tagName).slice(0, 40) + ` ${Math.round(r.width)}x${Math.round(r.height)}`); }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.nodeValue.trim(); if (t.split(' ').length >= 3 && /\\b(the|your|and|with|texts?|number|plan|month)\\b/.test(t) && !n.parentElement.closest('[data-no-translate],code,input')) out.english.push(t.slice(0, 90)); }
  return out; }"""

async def main():
    report = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for vname, (w, h) in VIEWS.items():
            for lang in ('en', 'es'):
                ctx = await b.new_context(viewport={'width': w, 'height': h})
                page = await ctx.new_page()
                await page.goto(URL + '/cloudivr/login'); await page.wait_for_timeout(1500)
                await page.evaluate(f"localStorage.setItem('civr.lang','{lang}'); localStorage.setItem('civr.consent', JSON.stringify({{necessary:true,analytics:true,marketing:true,at:Date.now()}}))")
                for name, path, auth, sel in PAGES:
                    if not path: continue
                    if auth and not getattr(page, '_in', False):
                        await page.goto(URL + '/cloudivr/login'); await page.wait_for_timeout(1500)
                        try: await page.click('[data-testid="cookie-allow-all"]', timeout=1500)
                        except Exception: pass
                        await page.fill('[data-testid="auth-email-input"]', 'civr.bob@example.com'); await page.fill('[data-testid="auth-password-input"]', 'BobTest#2026')
                        await page.click('[data-testid="auth-submit-button"]'); await page.wait_for_timeout(3000); page._in = True
                    await page.goto(URL + path, wait_until='load'); await page.wait_for_timeout(3000)
                    try: await page.click('[data-testid="cookie-allow-all"]', timeout=800)
                    except Exception: pass
                    r = await page.evaluate(JS, sel)
                    bad = [x for x in BAD if re.search(x, r['text'], re.I)]
                    report.append({'view': vname, 'lang': lang, 'page': name, 'overflow': r['overflow'], 'small': r['small'][:8], 'old_wording': bad, 'english_in_es': r['english'][:15] if lang == 'es' else []})
                await ctx.close()
        await b.close()
    json.dump(report, open('/app/test_reports/texting_ux_review.json', 'w'), indent=1)
    for x in report:
        flags = {k: v for k, v in x.items() if k not in ('view', 'lang', 'page') and v}
        print(x['view'], x['lang'], x['page'], json.dumps(flags, ensure_ascii=False)[:700])

asyncio.run(main())
