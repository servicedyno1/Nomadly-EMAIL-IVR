# CloudIVR — SEO & AI-assistant discoverability (2026-09)

**Goal:** make the CloudIVR web IVR (cloudivr.net) discoverable + citable by AI assistants
(ChatGPT/GPTBot, Claude/ClaudeBot, Perplexity, Google-Extended, CCBot…) and search engines.

## What was added
- **`js/cloudivr-web/seo.js`** — pure generators (no DB side effects):
  - `robotsTxt()` — explicit `Allow` groups for all major AI + search crawlers, `Disallow` private
    paths (`/app/`, `/api/`, `/cloudivr-web/`, `/reset-password`), `Sitemap:` + `Host:`.
  - `llmsTxt()` / `llmsFullTxt()` — the emerging **llms.txt** standard: short + full Markdown overview
    (features, how-it-works, pricing, FAQ). Pricing/countries pulled **live** from `numbers.catalog()`.
  - `sitemapXml()` — public pages (`/`, `/signup`, `/login`).
  - `headTags(path)` + `bodyNoscript()` + `injectIndex(html, path)` — per-path `<title>`/description/
    canonical/robots, Open Graph + Twitter cards, JSON-LD (`Organization`, `WebSite`,
    `SoftwareApplication` w/ `AggregateOffer` of live plan prices, `FAQPage`), and a crawlable
    `<noscript>` overview so JS-less AI crawlers read real content. `/app*` + reset pages → `noindex`.
- **`js/cloudivr-web/domain-guard.js`** — wired in: serves `/robots.txt`, `/sitemap.xml`, `/llms.txt`,
  `/llms-full.txt` on the CloudIVR apex, and the HTML path now uses `seo.injectIndex(raw, path)`
  (was a small title/desc swap). `brandHtml` + `appPathPrefix` exports preserved.
- **`frontend/public/civr/brand/og-cover.png`** — 1200×630 branded OG/Twitter share image
  (served at `/civr/brand/og-cover.png`, referenced by `og:image`).

## Scope / behaviour
- **Host-gated**: only fires for the CloudIVR domain (`CLOUDIVR_WEB_DOMAIN`, default `cloudivr.net`).
  Other brands (panel, bot-admin, preview) are untouched — verified (non-CloudIVR host falls through).
- Active automatically in production (cloudivr.net has `CLOUDIVR_WEB_ON=true` +
  `CLOUDIVR_WEB_DOMAIN`). **Off on this preview pod** (`CLOUDIVR_WEB_ON` unset) — that's why
  `/cloudivr-web/*` returns "Page not found" here; it does not affect the SEO code path.
- Optional env: `CLOUDIVR_CANONICAL_URL` (defaults to `https://<CLOUDIVR_WEB_DOMAIN>`).

## Verification (no services/.env changed)
- `node js/tests/test_cloudivr_domain_guard_2026-10.js` → 18/18 (unchanged behaviour).
- `node js/tests/test_cloudivr_seo_2026-09.js` → 8/8 (robots/sitemap/llms/head/JSON-LD/noindex/offers).
- Live HTTP via throwaway Express on :5999 with `Host: cloudivr.net` → correct content-types + injected
  head; non-CloudIVR host → 404 fallthrough.
- Content is accurate: Starter $50 / Pro $75 / Business $120, 17 countries, real overage rates, full FAQ.

## Not done (optional follow-ups)
- Client-side per-route meta (react-helmet) for the live SPA / shared-host `/cloudivr` — server
  injection already covers cloudivr.net initial HTML (what crawlers fetch).
- Submitting the sitemap to Google Search Console / Bing (owner action after deploy).
