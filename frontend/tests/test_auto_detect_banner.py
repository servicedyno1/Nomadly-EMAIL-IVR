"""
End-to-end test for the Auto-Detect Language Banner on the panel login.

Scenarios:
  1. Browser in EN, no localStorage → banner does NOT show
  2. Browser in FR, no localStorage → banner shows in French; "Keep Français" persists
  3. Browser in ZH → banner shows; "Switch to English" flips i18n + persists 'en'
  4. Browser in HI but `hp.lang` already set → banner does NOT show (already chose)

Run: /opt/plugins-venv/bin/python3 frontend/tests/test_auto_detect_banner.py
"""
import sys
from playwright.sync_api import sync_playwright

URL = 'https://api-aggregator-5.preview.emergentagent.com/panel'
BANNER = '[data-testid="auto-detect-language-banner"]'
BTN_KEEP = '[data-testid="auto-detect-banner-keep"]'
BTN_SWITCH_EN = '[data-testid="auto-detect-banner-switch-en"]'
TITLE = '.panel-login-logo h1'
SUBMIT = '[data-testid="panel-login-submit"]'

failures = []


def check(name, cond, *, detail=''):
    if cond:
        print(f"  ✓ {name}")
    else:
        failures.append(name)
        print(f"  ✗ {name}{(': ' + detail) if detail else ''}")


def with_lang(playwright, locale):
    """Spawn a fresh browser with the given navigator.language."""
    browser = playwright.chromium.launch(headless=True)
    ctx = browser.new_context(
        viewport={'width': 1280, 'height': 720},
        locale=locale,
    )
    return browser, ctx


def main():
    with sync_playwright() as p:
        # ── Scenario 1: EN browser, no banner ──
        print("\nScenario 1: navigator.language=en-US — banner should NOT show")
        browser, ctx = with_lang(p, 'en-US')
        page = ctx.new_page()
        page.goto(URL, wait_until='domcontentloaded', timeout=20000)
        page.wait_for_selector('[data-testid="panel-login-card"]', timeout=10000)
        page.wait_for_timeout(800)  # banner is async after i18n detection
        check(
            'EN: banner is not visible',
            page.locator(BANNER).count() == 0,
        )
        browser.close()

        # ── Scenario 2: FR browser → banner shows in FR; Keep persists ──
        print("\nScenario 2: navigator.language=fr-FR — banner shows in French")
        browser, ctx = with_lang(p, 'fr-FR')
        page = ctx.new_page()
        page.goto(URL, wait_until='domcontentloaded', timeout=20000)
        page.wait_for_selector('[data-testid="panel-login-card"]', timeout=10000)
        page.wait_for_selector(BANNER, timeout=5000)
        check(
            'FR: banner visible',
            page.locator(BANNER).is_visible(),
        )
        # Banner copy should contain the FR translation of "detected"
        detected_text = page.locator('[data-testid="auto-detect-banner-detected"]').text_content().strip()
        check(
            'FR: banner detected text is in French',
            'détecté' in detected_text.lower() or 'navigateur est en' in detected_text.lower(),
            detail=f'got: {detected_text!r}'
        )
        # Title is in French
        title = page.locator(TITLE).text_content().strip()
        check(
            'FR: panel title rendered in French',
            'connectez' in title.lower() or 'votre' in title.lower(),
            detail=f'got: {title!r}'
        )
        # Click "Keep" — banner disappears, localStorage saves 'fr'
        page.click(BTN_KEEP)
        page.wait_for_timeout(400)
        check(
            'FR: banner dismissed after Keep click',
            page.locator(BANNER).count() == 0,
        )
        saved = page.evaluate("() => window.localStorage.getItem('hp.lang')")
        check(
            'FR: localStorage hp.lang=fr after Keep',
            saved == 'fr',
            detail=f'got: {saved!r}'
        )
        # Reload — banner stays gone (already chose)
        page.reload(wait_until='domcontentloaded')
        page.wait_for_selector('[data-testid="panel-login-card"]', timeout=10000)
        page.wait_for_timeout(800)
        check(
            'FR: banner does NOT reappear on reload',
            page.locator(BANNER).count() == 0,
        )
        browser.close()

        # ── Scenario 3: ZH browser → click "Switch to English" → flips to EN ──
        print("\nScenario 3: navigator.language=zh-CN — Switch to English flips locale")
        browser, ctx = with_lang(p, 'zh-CN')
        page = ctx.new_page()
        page.goto(URL, wait_until='domcontentloaded', timeout=20000)
        page.wait_for_selector('[data-testid="panel-login-card"]', timeout=10000)
        page.wait_for_selector(BANNER, timeout=5000)
        # Initial title should be Chinese
        title = page.locator(TITLE).text_content().strip()
        check(
            'ZH: initial panel title rendered in Chinese',
            '登录' in title or '托管' in title,
            detail=f'got: {title!r}'
        )
        # Click "Switch to English"
        page.click(BTN_SWITCH_EN)
        page.wait_for_timeout(500)
        title_after = page.locator(TITLE).text_content().strip()
        submit_after = page.locator(SUBMIT).text_content().strip()
        check(
            'ZH→EN: title flipped to English',
            'Sign in' in title_after,
            detail=f'got: {title_after!r}'
        )
        check(
            'ZH→EN: submit button flipped to English',
            'Sign In' in submit_after,
            detail=f'got: {submit_after!r}'
        )
        check(
            'ZH→EN: banner dismissed',
            page.locator(BANNER).count() == 0,
        )
        saved = page.evaluate("() => window.localStorage.getItem('hp.lang')")
        check(
            'ZH→EN: localStorage hp.lang=en',
            saved == 'en',
            detail=f'got: {saved!r}'
        )
        browser.close()

        # ── Scenario 4: HI browser but bannerDismissed pre-set → banner suppressed ──
        print("\nScenario 4: navigator.language=hi-IN but hp.lang.bannerDismissed=1 — no banner")
        browser, ctx = with_lang(p, 'hi-IN')
        page = ctx.new_page()
        page.goto(URL, wait_until='domcontentloaded', timeout=20000)
        page.evaluate("() => window.localStorage.setItem('hp.lang.bannerDismissed', '1')")
        page.reload(wait_until='domcontentloaded')
        page.wait_for_selector('[data-testid="panel-login-card"]', timeout=10000)
        page.wait_for_timeout(800)
        check(
            'HI: banner suppressed when bannerDismissed flag is set',
            page.locator(BANNER).count() == 0,
        )
        browser.close()

    if failures:
        print(f"\n{len(failures)} test(s) failed:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("\nAll auto-detect banner tests passed")


main()
