# Bot journey audit — 2026-10-01 ("user couldn't select a plan")

## Production complaint
A Nomadly user trying to buy a plan could not make a selection and ended up in AI support.

## Root causes found (all reproduced in the sandbox, all fixed)
1. **Phone plan buttons were English-only in the lookup table** — `js/phone-config.js` `planByButton`
   mapped only `btn.*` (EN). FR/ZH/HI users tapping `⭐ Pro — $75/mois` got *"Veuillez sélectionner
   un forfait."* forever. Fix: populate `planByButton` from every `btnI18n` language.
   Test: `tests/phone-plan-buttons-i18n.test.js`.
2. **`/start` "Welcome back — resume?" loop** — `_index.js` showed the resume prompt but returned
   BEFORE resetting `action`, so the stale flow handler swallowed `✅ Complete My Order` with
   *"That option isn't available"*. `/start` → prompt → error → `/start` … infinite. Fix: reset
   `action`/`processingPayment` before sending the prompt.
3. **Shared reply_markup mutated by node-telegram-bot-api** — `_fixReplyMarkup()` stringifies
   `opts.reply_markup` in place; lang-dict option objects (`chooseSubscription`, `bc`, `o`, …) lost
   their keyboard object after the first send (log showed no keyboard, `resize_keyboard` injection
   skipped, `trans('o').reply_markup.keyboard` reads became `undefined`). Fix: `js/tg-opts.js`
   clones at the bot boundary (`wrapBotMethods`) + in `send()`/`sendAndReact()`.
   Test: `tests/tg-reply-markup-mutation.test.js`.
4. **Stale first-session intent buttons** (`📞 Phone Numbers / IVR`, `🛡️ Bulletproof Hosting`,
   `🌐 Domains`, `🛒 Digital Products`) were only routed while `action === firstSessionIntent`.
   Tapped later from the persisted keyboard: one went to AI support, one hit the menu reset, one
   got silence (reset cooldown). Fix: route those labels at base state too.
5. **`/start` debounce lied mid-flow** — a second `/start` within 3 s replied "You're already on
   the main menu" without resetting the flow. Fix: debounce only when `action` is none. Localized.

## Tooling (sandbox only — needs `TELEGRAM_API_BASE_URL=http://127.0.0.1:5099` + mock API)
- `node js/tests/mock_telegram_api.js &` — local stand-in for api.telegram.org.
- `[tg-out]` JSON trace line per bot send (dev only: `BOT_ENVIRONMENT=development` or `TG_OUT_TRACE=true`).
- `node scripts/journey_crawler.js <freshChatId> [depth=3] ["🇫🇷 French"]` — walks every reply/inline
  button (skips money/side-effect buttons), flags NO_REPLY / STRANDED / UNRECOGNIZED / AI_FALLBACK /
  INVALID_OPT / KB_LOST / NO_PROGRESS / JS_ERROR. Report → `test_reports/journey_crawl_<chatId>.json`.
- `node scripts/journey_scenarios.js <freshChatId> [en|fr]` — scripted purchase journeys incl. free text.
- `node scripts/sim_journey.js <chatId> "msg" …` — ad-hoc replay.

## Results after fixes
- Crawler depth 3: EN 273 screens / FR 274 screens → 0 issues.
- Scenarios: EN 8/8, FR 8/8.
