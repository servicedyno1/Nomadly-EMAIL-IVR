# AutoPromo (in-bot ads) — how it works after the 2026-06 rewrite

## Files
- `js/auto-promo.js` — scheduler (10:00 + 19:00 local × en/fr/zh/hi), per-user planning, sending, lift metric, resurrection scan.
- `js/promo-copy/index.js` — template renderer, theme→hub map, cross-sell map, inline keyboard, channel post.
- `js/promo-copy/{en,fr,zh,hi}.js` — copy per theme: `hooks[2]` (hero), `cross[2]` (cross-sell), `lines(p)[3]`, `price(p)`, `button`.
- `js/promo-prices.js` — live price snapshot (phone-config plans, PREMIUM_ANTIRED_* env, RATE_LEAD/RATE_CNAM, EV_TIER_*, PRICE_*_SUBSCRIPTION, DP_PRICE_* via config.js, DO catalogs for VPS/RDP floors).
- `js/assets/promo/<brand>/<theme>.jpg` — hero banners (brand = CHAT_BOT_BRAND slug; nomadly / smadav shipped).
- `js/tests/test_promo_pipeline_2026-06.js` — 58 checks. `scripts/promo_webhook_sim.sh` — drive the dev bot via webhook.

## Message shape (never change the order — coupon first is a product decision)
```
🎁 TODAY 10% OFF — code XXXX          (if a daily coupon exists)

📞 <b>Hook (sentence case)</b>
• benefit 1
• benefit 2
• benefit 3
💰 price line (from config)

Unsubscribe: /stoppromos
[ 📞 Open Cloud IVR → ]   ← callback promo_open:<hub> → synthetic /start open_<hub>
[ 🔕 Mute promos ]        ← callback promo_optout
```
Rules enforced by tests: ≤380 visible chars, ≤4 emoji, no ALL-CAPS words, no fake social proof, no "Type /start" in the body, brand words Anti-Red / Bulletproof / DMCA-ignored kept.

## Who gets what
1. Audience = nameOf users with lang match, not dead, active ≤30d, minus lifecycle-diet (24h cap, <72h old, balance wall).
2. `cadenceSlot(chatId, date)` → `'morning' | 'evening' | null`: every other day per user, slot flips weekly. `PROMO_CADENCE=daily` disables alternation (dev `/dev/promo-blast` uses `force:true`).
3. `buildProfiles()` → `{ owned:Set<theme>, browsed:theme }` from phoneNumbersOf / cpanelAccounts / domainsOf / vpsPlansOf / leadJobs / digitalOrders / marketplaceProducts + browseTracking.
4. `pickTheme()` → priority list = [browsed, ...CROSS_SELL[owned]] wins on 2 of every 3 sends; 3rd send = day-schedule theme; else rotation. Owned/disabled themes (VPS_ENABLED, HIDE_SMS_APP, EMAIL_BLAST_ON) are never picked.
5. One compose per (theme, mode) per blast: rotation index (promoTracker), AI hook+lines (hero only, gpt-4.1-mini JSON, sanitised, prices never from AI), banner if the brand folder has one.

## Admin
- `/ad` · `/ad <theme>` — channel post preview (URL button `t.me/<bot>?start=open_<hub>`), `/ad post [theme]` publishes to TELEGRAM_DOMAINS_SHOW_CHAT_ID, `/ad list`, `/ad bot <theme> [lang]` sends the exact in-bot ad to you.
- Stats per blast in `promoStats` (themes, reasons, cadenceSkipped, aiUsed, lift fields). Zero-lift alert unchanged.

## Gotchas
- Adding a theme: add to `THEMES` + `THEME_META` (emoji, hub) + copy in all 4 lang files + hub route in `_index.js` `/start open_` map. The test fails loudly if a hub is unrouted.
- Prices: never type a number into copy — add a key to `promo-prices.js` and reference `p.key`. Test [1] guards env ↔ snapshot.
- Banners contain no prices on purpose; regenerate wordmark-only if brand colours change.
