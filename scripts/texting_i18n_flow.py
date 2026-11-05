# iter182: walk Bob through a new Texting order in a given language (es/fr) and dump the post-payment screen text.
# Usage: python texting_i18n_flow.py es  (needs Bob wallet >= $200; cancels/refunds the order at the end)
import asyncio, os, random, re, sys
from playwright.async_api import async_playwright

URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
LANG = sys.argv[1] if len(sys.argv) > 1 else 'es'
EN = re.compile(r"\b(the|your|you|with|and|number|texting|letter|bill|wallet|refund|upload|business days|carrier|review|Sign|Step|Account|holder|Street|Current|optional|Active|Cancel|Under|Not approved)\b")
BILL = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"


async def txt(page, sel):
    try:
        return await page.inner_text(sel, timeout=4000)
    except Exception:
        return ''


def eng(s):
    return [l for l in s.split('\n') if l.strip() and EN.search(l)]


async def main():
    phone = f"+1312555{random.randint(1000, 9999)}"
    open('/tmp/bill.pdf', 'wb').write(BILL)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        page = await ctx.new_page()
        toasts = []
        async def on_dialog(d):
            print('NATIVE DIALOG:', d.type, d.message); await d.accept()
        page.on('dialog', on_dialog)
        await page.goto(URL + '/cloudivr/login'); await page.wait_for_timeout(1500)
        await page.evaluate(f"localStorage.setItem('civr.lang','{LANG}'); localStorage.setItem('civr.consent', JSON.stringify({{necessary:true,analytics:true,marketing:true,at:Date.now()}}))")
        await page.reload(); await page.wait_for_timeout(1500)
        try: await page.click('[data-testid="cookie-allow-all"]', timeout=1500)
        except Exception: pass
        await page.fill('[data-testid="auth-email-input"]', 'civr.bob@example.com'); await page.fill('[data-testid="auth-password-input"]', 'BobTest#2026')
        await page.click('[data-testid="auth-submit-button"]'); await page.wait_for_timeout(3500)
        await page.goto(URL + '/cloudivr/app/texting?add=1'); await page.wait_for_timeout(3000)

        async def grab_toast():
            t = await page.evaluate("()=>Array.from(document.querySelectorAll('[data-sonner-toast]')).map(e=>e.innerText).join(' | ')")
            if t: toasts.append(t)

        print('PHONE', phone)
        print('== SETUP ==\n', await txt(page, '[data-testid="texting-new"]'))
        await page.fill('[data-testid="texting-phone-input"]', phone)
        await page.click('[data-testid="texting-check-button"]'); await page.wait_for_timeout(2500)
        print('== CHECK ==\n', await txt(page, '[data-testid="texting-new"]'))
        await page.click('[data-testid="texting-pay-button"]'); await page.wait_for_timeout(1000); await grab_toast(); await page.wait_for_timeout(2500)
        panel = await txt(page, '[data-testid="texting-panel"]')
        print('== VERIFY PANEL ==\n', panel)
        print('cancel button:', await txt(page, '[data-testid="texting-cancel-button"]'))
        item = phone.replace('+', '')
        print('list item:', await txt(page, f'[data-testid="texting-item-{item}"]'))
        await page.click('[data-testid="texting-code-skip"]'); await page.wait_for_timeout(1000); await grab_toast(); await page.wait_for_timeout(2000)
        loa = await txt(page, '[data-testid="texting-loa"]')
        print('== LOA ==\n', loa)
        for k, v in {'name': 'Bob Prueba', 'business': 'TEST Biz', 'address': '1 Test St', 'city': 'Austin', 'state': 'TX', 'zip': '73301', 'carrier': 'AT&T', 'account': '999'}.items():
            if await page.locator(f'[data-testid="texting-holder-{k}"]').count():
                await page.fill(f'[data-testid="texting-holder-{k}"]', v)
        await page.fill('[data-testid="texting-loa-signature"]', 'Bob Prueba')
        await page.check('[data-testid="texting-consent-checkbox"]')
        print('== LOA filled (hints) ==\n', await txt(page, '[data-testid="texting-loa"]'))
        await page.click('[data-testid="texting-loa-submit"]'); await page.wait_for_timeout(1000); await grab_toast(); await page.wait_for_timeout(2500)
        bill = await txt(page, '[data-testid="texting-bill"]')
        print('== BILL ==\n', bill)
        print('panel status:', await txt(page, '[data-testid="texting-panel-status"]'))
        await page.screenshot(path=f'/app/.screenshots/bill_{LANG}.png')
        # bad file toast
        open('/tmp/bad.txt', 'w').write('x')
        await page.set_input_files('[data-testid="texting-bill-input"]', '/tmp/bad.txt'); await page.wait_for_timeout(800); await grab_toast()
        await page.set_input_files('[data-testid="texting-bill-input"]', '/tmp/bill.pdf'); await page.wait_for_timeout(500)
        await page.click('[data-testid="texting-documents-submit"]'); await page.wait_for_timeout(1000); await grab_toast(); await page.wait_for_timeout(2500)
        rev = await txt(page, '[data-testid="texting-panel"]')
        print('== REVIEW ==\n', rev)
        print('list item:', await txt(page, f'[data-testid="texting-item-{item}"]'))
        ov = await page.evaluate('document.documentElement.scrollWidth > window.innerWidth')
        print('horizontal overflow @390:', ov)
        await page.screenshot(path=f'/app/.screenshots/review_{LANG}.png')
        # cancel & refund
        others = await page.eval_on_selector_all('[data-testid^="texting-item-"]', 'els=>els.map(e=>[e.dataset.testid,e.innerText])')
        pend = [o for o in others if o[0] != f'texting-item-{item}' and re.search(r'Paso|Étape', o[1])]
        if await page.locator('[data-testid="texting-cancel-button"]').count() == 0 and pend:
            print('cancel test on pending', pend[0]); item = pend[0][0].replace('texting-item-', '')
            await page.click(f'[data-testid="{pend[0][0]}"]'); await page.wait_for_timeout(1500)
        await page.click('[data-testid="texting-cancel-button"]', timeout=5000); await page.wait_for_timeout(1200)
        await page.wait_for_timeout(1000); await grab_toast(); await page.wait_for_timeout(2000)
        print('after cancel list item:', await txt(page, f'[data-testid="texting-item-{item}"]'))
        print('== TOASTS ==')
        for t in toasts: print(' -', t)
        allt = '\n'.join([panel, loa, bill, rev] + toasts)
        print('== POSSIBLE ENGLISH LINES ==')
        for l in eng(allt): print(' !', l)
        body = await page.inner_text('body')
        print('monedero present:', 'monedero' in body.lower())
        await b.close()

asyncio.run(main())
