# PRD — Nomadly Cloud IVR + Telegram Bot

## 2026-10-27 (19:20Z) — Footer social icons (X + Telegram) — CODED ON PREVIEW, NOT VERIFIED, NOT DEPLOYED (session ended by owner)
- New `frontend/src/cloudivr/pages/landing/Social.js` (SocialLinks: X https://x.com/CloudIVR, Telegram https://t.me/CloudIVRNet — owner typed
  "t.me.CloudIVRNet", corrected), rendered under the footer CTAs in PricingFaq.js Footer (testids footer-social, footer-social-x, footer-social-telegram).
- seo.js Organization JSON-LD gets `sameAs` [X, Telegram]. Preview /cloudivr HTML showed no ld+json in the curl check (probably only injected on
  the cloudivr.net host); still needs checking. Next: screenshot footer at 1920/390, check sameAs on cloudivr.net after deploy, then deploy.

## 2026-10-27 (19:05Z) — Ads twice a week + campaign "Pick the campaign message" fix — DEPLOYED (workspace tarball, release 20261027T190021Z-95e9010, app-main-a :5000)
- Owner: "Promo ads not working / hosta + CloudIVR ads never ran". Prod RCA: AutoPromo IS running (e.g. 10-27 EN morning 170 delivered;
  web_hosta 11 + web_cloudivr 2 already sent via cross-sell since 4005cce went live 10:11Z). Owner (5590563715) got 29 ads, last 10-26 10:00;
  per-user cadence = every other day + fixed morning/evening slot → owner misses Thu-evening/Fri-morning web slots.
  Owner choice: "Show the new ads more often" → DAY_SCHEDULE Sun evening = web_hosta (was domains_shortener), Mon evening = web_cloudivr (was vps_rdp).
  Simulated schedule reach/week ~25% → ~50% each. test_web_promos 71/71; promo_pipeline 58/58 on prod env (preview lacks price envs → 4 env-only fails).
- fundmyllc@gmail.com (web 5000000000000006, Business, +18777553674): wrote a template script + Auto-fill but never pressed "Make AI voice" →
  library empty (0 ivrAudioFiles; the 12 ivrAudioStore files are voicemail copies) → POST /campaigns 400 invalid_audio x5 (nginx log).
  Fix: Campaigns.js Save makes the AI voice from the written script (chosen voice/speed via VoiceMaker choice/onChoice, else account default),
  blocks unfilled [Placeholders] with a clear error, button shows "Making AI voice…"; server message now "Pick a message from your audio library,
  or write a script and press “Make AI voice”." Verified on preview (Alice) end-to-end + live bundle.
- Same deploy carried: landing ID-check removal, Trust card removal, 20 AI agent languages (below). Live checks: /health healthy, "ID check" 0 on
  cloudivr.net, public catalog has no `verify`, AutoPromo 14 themes, TelnyxSig enforced. ⚠️ Save to GitHub (main) or the next CI deploy rolls back.

## 2026-10-27 (14:20Z) — Landing: ID-check mentions removed + AI agent 20 languages — TESTED (iteration_160 100% + design follow-ups fixed), NOT DEPLOYED
- Owner: remove ID-check indication on landing numbers, remove Trust card "Verified accounts, verified numbers", AI agent > 3 languages.
  Choices: ~20 major languages; FAQ "Which countries need an ID check…" also removed (no ID-check wording anywhere on the landing; buyers see it after paying, as before).
- Landing: Coverage cards = flag + name + types (chips + ID subtitle gone; flag stacks above the name on phones so names don't cut off); Trust = 5 cards
  (lg 3+2 layout); FAQ/in-app Help + seo.js objectionFaqs drop the ID-check Q (FAQPage now 11). Public catalog `countries[]` no longer has `verify`
  (phone-config still has it internally); snapshot regenerated.
- AI agent: new `js/ai-agent/languages.js` = 20 languages (en es fr pt de it nl ar hi zh ja ko ru tr pl he ro cs vi id) with name, booking locale and the
  fixed opening lines (AI disclosure, recording notice, first question, "one moment" filler) in each language; store/bridge/booking use it. Frontend
  `pages/ai/languages.js` (same codes) → form select (sorted by translated name) + agents list. Copy "20 languages" on landing facts/platform/menu,
  AI agents page header, seo FEATURES. FR/ES via `scripts/civr_i18n_ai_languages.py`.

## 2026-10-27 (10:10Z) — cloudivr.net landing page 2026 audit + Phase 1 upgrade — TESTED (iteration_159, all features pass; 3 follow-ups fixed), NOT DEPLOYED (owner reviews preview first)
- Approved plan (plan mode): hear-it audio sample, instant first paint, trust & compliance block, real proof strip, one payment story, plan comparison +
  usage-rate tables, use-case bento, compact cookie bar + mobile sticky CTA, 3 objection FAQs, structured data. Visual system unchanged (cream/ink, DM Sans).
- Hear it (hero): `pages/landing/HearIt.js` + `/civr/sample/sample-call.mp3` (240 KB, 30.2 s) + `landing/sampleCall.js` (segment + per-word timings).
  Produced by `node scripts/sample-call/make.js` with the platform's OWN voice engine (OpenAI TTS via APP_OPEN_API_KEY: nova = IVR greeting, marin = the AI
  agent's default voice, echo = caller, shimmer = front desk) + ffmpeg DTMF "1" (697+1209 Hz) and US ringback — scripted, NOT a captured live phone call
  (a live capture needs a human caller). Script: Northwind Dental menu → press 1 → AI agent books Tuesday 2:30 → handover to front desk. Transcript is
  data-no-translate (audio is English). Word timing = segment length spread by letter count.
- First paint: `landing/catalogSnapshot.js` (generated by `node scripts/civr_catalog_snapshot.js` — RE-RUN after plan/price/rate/country changes) is the
  fallback until /public/catalog answers (`data-catalog="snapshot"|"live"` on landing-page). kit.js CountUp renders the final value first and only counts
  up for elements that start below the fold (crawlers/reduced motion see real numbers, never 0).
- Proof strip (`landing/Proof.js`, inside Facts): GET `/api/cloudivr-web/public/stats` (`js/cloudivr-web/public-stats.js`, 24 h in-process cache,
  Cache-Control 1 h) = callsHandled (phoneLogs estimatedDocumentCount), campaignCalls (sum of bulkCallCampaigns.leads), numbersActive, countries.
  Floors: CLOUDIVR_PROOF_FLOOR_CALLS (default 1000) / CLOUDIVR_PROOF_FLOOR_NUMBERS (default 10) → below floor = null = not shown. PREVIEW backend/.env has
  both set to 0 (dev-only, so the strip is visible with 2/1/1/17); prod keeps defaults. Testimonial slot built (TESTIMONIALS = []) and hidden — no fake proof.
  "Uptime" counter NOT added (no real monitoring data).
- Trust & compliance (`landing/Trust.js`, between Platform and TryCall): consent responsibility, DNC on every campaign (bulk-call-service onDnc), AI agent
  rules (never claims human, never asks for cards/passwords/OTP, opt_out tool, transfer/take_message), recording notices, email + 2FA + carrier
  verification, own caller ID only; links /terms#use, #recordings, #privacy, /terms, cookie settings; "not legal advice" footnote.
- One payment story: `landing/Payments.js` = wallet + coins "Pay with" group, cards in a dimmed "Cards — Coming soon" group until catalog `cardPayments`
  (env CLOUDIVR_CARD_PAYMENTS=true) — pricing + footer. Fixed copy: hero price note, FAQ "How do I pay?", seo.js llms-full ("paid by card" removed),
  AuthPages NEXT_STEPS ("Pay by card, crypto or wallet" → "Pay with crypto or your wallet (cards coming soon)").
- Pricing: `landing/PlanTable.js` PlanCompare (rows from the Business plan's webFeatures, 9 shown → "Show all 24", Most popular on recommended, sticky first
  column + swipe hint on mobile) + UsageRates (outbound US/CA vs intl, AI agent, forwarding, overage min/SMS, AI summaries, extra numbers, top-up min).
  Catalog rates gained `outboundPerMinUsCa` (voice-service IVR_CALL_RATE 0.15) + `outboundPerMinIntl` (CALL_FORWARDING_RATE_MIN 0.50); countries gained
  `verify` (telnyx-regulatory countries) → Coverage cards show "Instant" (US CA PR CO) or "ID check" chips; subtitle "4 countries go live in about a minute".
- Use-case bento `landing/UseCases.js` (6 tiles → platform tab / #coverage / #pricing / signup). Objection FAQs (AI can't help / ID-check countries + timing
  "hours, up to 3 business days, full refund" from telnyx-regulatory copy / quiet hours honest answer) in PricingFaq faqItems (also in-app Help) AND in
  seo.js `objectionFaqs()` → FAQPage JSON-LD (12 questions). hreflang NOT added on purpose: the language switcher is localStorage-only (no per-language
  URLs), so hreflang would point every language at the same URL.
- Cookie bar `CookieBanner.js`: compact single line (Cookies: … · Manage · Deny · Allow all) → Manage opens the full panel (4 switches, details, back).
  `cookie-close` testid removed. Mobile sticky CTA `landing/StickyCta.js` (md:hidden; shows after the hero, hides over try-section/final-cta/footer;
  body[data-civr-sticky="1"] lifts the cookie bar + support chat FAB (`civr-visitor-fab`/`civr-visitor-panel` classes in SupportChat)).
- i18n: `scripts/civr_i18n_landing_2026.py` added 94 FR + 94 ES keys (all new landing strings, patterns for price/ID-check FAQ). Landing still English-first.
- Tests: testing agent iteration_159 (backend pytest backend/tests/test_civr_landing_2026_public.py 5/5; every UI flow pass on 1920 + 390), follow-ups fixed
  after: FR/ES gaps, transcript partial translation, signup card copy. js/tests/test_cloudivr_seo_2026-09.js 8/8.
- Deploy later = `scripts/deploy_workspace_to_droplet.sh app-main` (also carries the pending Telnyx VM-drop, bot web entry points, OG image, Google button
  fixes). After deploy: re-run `node scripts/civr_catalog_snapshot.js https://cloudivr.net` if prod plan data differs, then "Save to GitHub".
- Phase 2 backlog (plan): attributed testimonials + case study, fact-checked competitor strip, 60–90 s walkthrough video, FR/ES landing variants,
  "not ready yet" email capture. Phase 3: country auto-detect price, mic live AI demo, ROI calculator, live-map teaser, A/B headline tests.


## 2026-10-27 (09:20Z) — cloudivr.net share preview (logo card + "Reach out" text) + Google button flicker FIXED — TESTED (iteration_158 100%), NOT DEPLOYED
- Share preview: new 1200x630 JPEG card frontend/public/civr/brand/og-share.jpg (45 KB, parrot icon logo + CLOUDIVR wordmark + "Quick IVR & Bulk IVR campaigns" + cloudivr.net,
  centred so WhatsApp's square crop keeps the logo). Source scripts/promo-banners/cloudivr-share.html → `node scripts/promo-banners/render.js`.
  seo.js: OG_IMAGE → og-share.jpg (+ og:image:secure_url, og:image:type image/jpeg); home og:description + twitter:description = SHARE_DESC
  "Reach out: Quick IVR and Bulk IVR campaigns call your list, play your message, connect interested leads and collect codes." (meta description for Google unchanged).
  Old og-cover.png was 724 KB PNG (too big for WhatsApp). Telegram caches previews → after deploy send https://cloudivr.net to @WebpageBot to refresh.
- Google button: RCA = GoogleButton returned null until /auth/config answered, then GSI script loaded → button + OR divider popped in and pushed the form ~51 px.
  Fix: pages/auth/GoogleButton.js reserves the 40 px row + divider from first paint with a pixel-matched "Continue with Google" pill (#202124, 320x40, radius 20)
  that fades out when Google's iframe loads; AuthContext caches the public config in localStorage 'civr.authConfig' (loaded flag); hidden when no client id
  or the GSI script fails; seo.js preconnects + preloads https://accounts.google.com/gsi/client on /login and /signup only.
- Preview has no GOOGLE_OAUTH_CLIENT_ID (set temporarily for the test, removed again).


## 2026-10-27 (00:45Z) — Bot → CloudIVR web entry points + hosta.sh / cloudivr.net Telegram ads + admin alert on web sign-up — TESTED (iteration_157 60/60 + units), NOT DEPLOYED
- Nomadly-only gating: `web-access.js cloudivrUrl()` = https://<CLOUDIVR_WEB_DOMAIN> when CLOUDIVR_WEB_ON=true (only app-main has the domain); hosta.sh via WEBSITE_URL (app-main only).
  Other brands (Smadav/Proshop/Voodoo) show nothing new. Preview has neither key → hidden on preview (set both temporarily to test).
- Cloud IVR + SIP hub + "How it works" keyboards: top row "🌐 Use CloudIVR on the web" (FR/ZH/HI) → invite card + inline URL button https://cloudivr.net (action untouched).
  /start returning-user greeting + first-start welcome end with "📞 Cloud IVR on the web: cloudivr.net" (link, no preview).
- Two new auto-promo themes (promo-copy, 4 langs): `web_hosta` (index 12, Fri morning) + `web_cloudivr` (index 13, Thu evening); replaced Thu antired_hosting
  + Fri marketplace slots. URL buttons straight to the site (+ mute row), channel posts (/ad web_hosta|web_cloudivr, /ad post …) link the site, no bot coupon line
  (separate web accounts). Cross-sell: cloudphone → web_cloudivr; domains/hosting/vps → web_hosta. Deep links /start open_web_hosta|open_web_cloudivr → invite card.
- Banners with the REAL logos: js/assets/promo/nomadly/web_hosta.jpg (hosta.sh favicon tile from hosta.sh + wordmark) and web_cloudivr.jpg (parrot icon + CLOUDIVR
  wordmark + real dashboard shot). Source HTML + renderer: scripts/promo-banners/{hosta,cloudivr}.html + `node scripts/promo-banners/render.js` (puppeteer-core + /usr/bin/chromium).
- Admin alert: cloudivr-web/auth.js createAccount → notifyAdmin "🆕 New CloudIVR web sign-up" (email, escaped name, method Email+password/Google, country from
  cf-ipcountry when present, referred-by, web account id; "(preview)" on dry-run). Only on new accounts (not duplicate/login).
- Tests: js/tests/test_web_promos_signup_alert_2026-10.js 64/64, test_promo_pipeline 58/58, test_web_access 43/43, bot sandbox js/tests/bot_ui_web_promos_2026-10.js 60/60
  (mock Telegram :5099 — needs TELEGRAM_API_BASE_URL + WEBSITE_URL + CLOUDIVR_WEB_DOMAIN in backend/.env temporarily; all removed again).
- To check on prod after deploy: the "country:" line (preview ingress drops cf-ipcountry).
- 2026-10-27 01:00Z: hard NomadlyBot-only guard — web ads + CloudIVR web button/line also require CHAT_BOT_BRAND=Nomadly (web-access.isNomadly), `/ad list`/`/ad <theme>` hide web ads elsewhere,
  `/ad` default skips a disabled day theme. Prod check: only app-main has WEBSITE_URL/CLOUDIVR_WEB_DOMAIN (PROSHOP / Voodoo Land / Smadav have neither). test 69/69.
- 2026-10-27 01:10Z: hosta main-menu button renamed "🌐 Use on Web" → "🌐 Hosting/RDP/VPS on Web" (FR "🌐 Hébergement/RDP/VPS sur le Web", ZH "🌐 网页版 主机/RDP/VPS",
  HI "🌐 वेब पर होस्टिंग/RDP/VPS"); old labels still handled (LEGACY_LABELS); hosta button + welcome line now also NomadlyBot-only (isNomadly). test_web_access 48/48.


## 2026-10-27 (00:12Z) — Bulk IVR voicemail drop FIXED (greeting_end AMD) + cap/billing + "messages left" visibility — REAL CALL PASS, DEPLOYED
- RCA (prod 10-22→26): AMD 'detect_beep' → Telnyx sent NO call.machine.* webhooks → 0 of 749 voicemail-drop leads got a message; calls hit the 60 s cap (61 s billed as 2 min).
- voice-service.js: voicemail-drop campaigns dial with AMD `greeting_end` (env BULK_VM_AMD_MODE overrides); call.machine.greeting.ended WITHOUT a machine result
  (or after not_sure) stops the prompt and plays the clip at once (never when AMD said human / a key was pressed); beep-wait fallback 30 s.
  Per-call cap (BULK_VM_MAX_CALL_SEC 60) now fires 3 s early (BULK_VM_CAP_MARGIN_SEC) so prompt-only calls bill 1 min; exempt phases voicemail_wait/voicemail_playing
  (+ transferring/bridged) and the cap timer is cleared when the clip starts → a started message always plays to the end (safety stop VM_MAX_PLAY_MS 180 s).
  Billing = real time used (per started minute) — a 78 s voicemail call bills 2 min.
- Visibility: campaign detail stats Voicemail + Messages left, lead pill "message left", campaign list/Live "N messages left", "Voicemail drop: <clip>" line,
  CSV "Voicemail Left" column (bot + web), campaign-done email "Messages left" (EN/FR/ES), form hint updated.
- Harness js/tests/test_bulk_telnyx_2026-10.js 56/56 (new P5-14..21: greeting.ended w/o machine, human not dropped, not_sure, cap skips playing clips, cap still ends prompt-only, billing); edge 17/17.
- REAL CALL (preview, real Telnyx) 2026-10-27 00:07Z → owner +13025141000: answered 27.2 → machine 29.8 → greeting.ended 31.6 → clip 31.9 → full 52.2 s played →
  app hung up 25.3 (58 s, 1 min $0.15; old cap point 24.2 passed). Report test_reports/real_vm_drop_test_2026-10-27.json. Temp caller +18778570205 removed, DRY_RUN restored.
- DEPLOYED workspace → release 20261027T001111Z-24a45fd on :5100 (app-main-b), WS_DEPLOY_EXIT=0, health 200, 0 live calls at flip. No BULK_VM_* overrides on prod.
- ⚠️ Owner must "Save to GitHub" (main) or the next CI deploy rolls this back. Owner to listen to the test voicemail (first words → "Thank you, and goodbye.").
- Note: greeting_end decides "greeting over" on silence/beep; a mailbox greeting with a long pause could start the clip a little early (watch real campaign results).


## 2026-10-26 (22:52Z) — PROD ops: replacement RDP for @Loaded4 (911434986) — DONE + verified
- Old: vpsPlansOf rdp-1aef405b (Pro pro-1m, ws2022, New York nyc3→nyc2, paid $112 TXN-20261014-F5411, Oct 14 → Nov 14 14:34:53Z);
  DO droplet 609043954 deleted outside the bot 2026-10-25 (reconcileVanished → DELETED/destroyed). Owner: same config, same end date,
  bot alert with credentials as a normal order, public group post kept.
- New: `POST /admin/comp-vps` (no wallet debit, comp:true, compReason `replace-rdp-1aef405b-droplet-deleted-2026-10-25`) →
  rdp-32b659b5-2848-480e-b475-97884f88f3e2 "nomadly-kmnmhg", 142.93.205.104, nyc1 (same city), s-4vcpu-8gb-amd, golden ws2022,
  active in 111 s, password_confirmed, 3389 open. Bot DM "RDP [nomadly-kmnmhg] is active!" + credentials, TXN-20261026-BC3C0 ($0 vps).
- `js/ops/rdp_replace_finalize.js` set vpsPlansOf.end_time + doRdpServers.expires_at = 2026-11-14T14:34:53.584Z (start_time = Oct 14),
  autoRenewable false, links replacesInstanceId ↔ replacedBy. Inspect: `js/ops/rdp_replace_inspect.js <user>`. Request body
  js/ops/rdp_replace_loaded4_2026-10-26.json; logs /opt/nomadly/logs/rdp_replace_loaded4_2026-10-26.{json,log}. DO cost ~$35 to Nov 14.


## 2026-10-26 (22:45Z) — PROD ops: +$20 wallet credit for iammills404@gmail.com — DONE + verified
- Web account 5000000000000007 ("La"): wallet $0.00 → $20.00. Txn `admin-credit-5000000000000007-support-20-2026-10-26`
  (type admin-credit → "Credit from CloudIVR" in wallet history) + in-app Inbox notice (owner choice). Re-run says "already credited".
- Script `scripts/ops/civr_wallet_credit.js <email> <amount> <tag> [--notify] [--go]` (dry-run default, idempotent per tag, max $500);
  copy at droplet /root/civr_wallet_credit.js, log /opt/nomadly/logs/civr_wallet_credit_2026-10-26.log.
- Noticed: live app-main release is 20261026T223808Z-87d5de2 = workspace HEAD → the clean landing page + language menu fix are already live (CI deploy).


## 2026-10-26 (22:40Z) — Language switcher fix (all 6 places) — SELF-TESTED, NOT DEPLOYED
- Owner: tapping "English" on the landing page didn't drop the other languages down. The switcher was an invisible native <select>
  over a pill, and some browsers/webviews never open it. `i18n/index.js` LangSwitcher is now a real menu (Radix DropdownMenu, modal=false,
  tones landing/app): trigger `data-testid={testid}`, menu `{testid}-menu`, items `{testid}-option-{en|fr|es}` (no more select_option in tests).
- Same component everywhere → fixed on landing nav, /sip nav, login/sign-up (desktop + mobile), app top bar, app mobile "More" sheet.
  Verified: opens, picks, closes on pick/Escape/outside click, menu flips up above the mobile More sheet. No other hidden-select pattern in the app.


## 2026-10-26 (22:35Z) — Landing page redesigned CLEAN (pure white + near-black ink, no purple, no checker grid) — TESTED (iteration_155), NOT DEPLOYED (owner reviews in preview first)
- Owner rejected the deep-purple cm.com hero ("we need our landing page as clean as this. we don't need the checkers or deep purple color").
  Choices: pure white hero · near-black ink buttons/highlights · product tabs with REAL dashboard screenshots · review before deploy.
- Hero.js: centered white hero (eyebrow pill w/ live dot, H1 with light-grey underline mark, ink + outline pills, trust list). 3D scene removed
  (Hero3D.js, PhoneMock.js, MockupsMore.js deleted). HeroTabs.js: Dashboard / Keypad menus / Campaigns / Live map tabs, auto-advance 7s,
  arrow keys move focus, light browser frame + url pill, images `/civr/shots/app-{overview,ivr,campaigns,map}.webp`.
- Screenshots: `node scripts/capture_landing_shots.js <previewUrl> /tmp/shots` (SHOT_NUMBER=<Alice business number>, run
  seed_civr_live_demo.js first) — logs in as Alice, hides preview banners/badges/chat, swaps numbers to +1415555xxxx and email to maya@northwind.co.
- Ink restyle: cloudivr.css landing tokens (--l-accent = ink, .civr-l-pill-ink/-outline, white .civr-l-navbar, .civr-l-frame), Nav (white,
  light featured cards), Platform/Sections/PricingFaq (final CTA light grey box, light footer), TryCall/TryLive/EmailGate, PlanFeatures cream tone,
  CookieBanner (ink buttons), SupportChat visitor accents neutral, LangSwitcher light options. FR/ES strings added for new tab labels/captions.
- Side effect: /cloudivr/sip shares .civr-l-btn → its buttons are now ink pills; its hero still has the old grid + purple highlight (out of scope).
- design_guidelines.json rewritten for the clean ink aesthetic.


## 2026-10-26 (21:40Z) — CloudIVR Live page + call feed + top areas + repeat/daily limit + DNC for every campaign — TESTED (iteration_154 + harness 15/15), DEPLOYED
- Owner shared a "Dynamo RVM" operations screenshot and picked: Live calls page (new "Live" menu item, green dot while calling),
  live call feed per campaign (Waiting → Ringing → Talking → Done strip), top areas (state/province from area code, country from calling code),
  repeat campaigns (daily/weekly) + daily call limit, do-not-call list applied to EVERY campaign (Bulk IVR + AI, web + Telegram bot).
- Backend: `js/cloudivr-web/campaign-live.js` (GET /campaigns/live, liveView/feedOf/areasOf), `js/cloudivr-web/areas.js`, `js/campaign-schedule.js`
  (nextRunAt DST-safe in owner tz, nextRunDoc, reserveDailySlot atomic, refundDailySlot). bulk-call-service: repeat series (seriesId, runNumber,
  autoRun, nextRunId — the launch of a run creates the next one; a due run waits while the previous run is still calling), stopRepeat,
  dailyLimit (dailyCount {day,n}, waitingForDailyLimit, recheck ≤10 min, stale-recovery exempt), DNC check for all campaigns, and
  **dryRun campaigns never dial** (fireNextBatch guard). calls.js: runPlan validation, POST /campaigns/:id/stop-repeat, detail adds live/feed/areas/nextRun.
  /ai-dnc POST takes several numbers; dashboard has liveCampaigns.
- Frontend: pages/Live.js, pages/campaign/LiveParts.js + DetailLive.js, pages/DoNotCall.js (/app/do-not-call), campaign form Repeat + Daily call limit,
  row pills, "Watch live" button, help articles, FR/ES (scripts/civr_i18n_live.py).
- Preview demo data: `node scripts/seed_civr_live_demo.js` (Alice; `--clean` removes). Harness: js/tests/test_live_repeat_2026-10.js.
- DEPLOYED via workspace script → release 20261026T214006Z-b881d29 on :5100, WS_DEPLOY_EXIT=0, health 200, /app/live + /app/do-not-call 200, API 401 unauthenticated.
- ⚠️ Owner must "Save to GitHub" (main) or the next CI deploy rolls this release back.
- Backlog ideas: add-to-DNC button on feed rows; repeat runs re-reading a saved contact list; city-level area names.

## 2026-10-26 (21:00Z) — Contacts tab + smart Excel/CSV import (web + bot) + 60s voicemail-drop cap + campaign rename — TESTED (iteration_153), DEPLOYED
- DEPLOYED via scripts/deploy_workspace_to_droplet.sh app-main → release 20261026T205955Z-cd42dc5 on :5100 (app-main-b), WS_DEPLOY_EXIT=0,
  health 200, cloudivr.net / /login /sip /terms /app/contacts 200, /api/cloudivr-web/contacts 401 unauthenticated (expected).
- ⚠️ Owner must "Save to GitHub" (main) or the next CI deploy rolls this release back.

## 2026-10-26 (night, 19:50Z) — CloudIVR web: crypto button spill + responsive pass (phone → 2560) — TESTED (iteration_151/152), deploying
- Owner bug: Billing tab → Upgrade → "Pay with crypto" spilled out of the card (1024–1440). RCA: `.civr-btn` had
  `white-space: nowrap` above 640px, so in UpgradePay's `grid sm:grid-cols-2` the coin select + nowrap button were wider
  than the column. Fixes: UpgradePay = flex-wrap row (wallet flex-[1_1_15rem], coin+crypto flex-[1_1_16rem], 44px);
  BillingTab = left column stack (Renewal/Downgrade/Extra) + Upgrade right, `items-start` (no stretched empty Renewal).
- Global (cloudivr.css): `.civr-btn` wraps its label at every width (min-height 42 / sm 36, max-width 100%, svg
  shrink-0); `.civr-card` min-width 0 + overflow-wrap break-word. PageHeader actions `md:shrink-0` (no 2-line header
  buttons at tablet), Help side cards below articles until xl, Buy search form `sm:grid-cols-2 xl:grid-cols-4`, wallet
  balance `text-4xl xl:text-5xl nowrap`, wallet tables in overflow-x-auto + nowrap dates.
- Phone top bar: px-3, logo text sr-only below 380px (Wordmark `textClass`) → no cut-off phone button at 360.
- Large monitors: app <main> max-w 1280 → 1440 (≥1600) → 1640 (≥1800) → 1880 (≥2300); Numbers + Buy results 4 cols ≥1800;
  Settings grid widens. Landing/SIP marketing pages unchanged.
- Verified: overflow audit 29 pages × 6–10 widths = 0 spills / 0 h-scroll (testing agent helper /app/tests/overflow_audit.js).
- Owner pressed Save to GitHub at 19:18 (origin/main f84a101c, CI deployed it) → GitHub and server in sync; this release
  (188bc1c, superset) deployed via workspace script — owner should Save to GitHub again afterwards.


## 2026-10-26 (night, 19:13Z) — PROD ops: Business gift numbers for 2 web accounts — DONE + verified
- Owner: upgrade iammills404@gmail.com (web id 5000000000000007) + fundmyllc@gmail.com (5000000000000006) to Business, a US
  toll-free number each "as if they ordered it", plan expires after 1 week, +$30 wallet credit, notify in their inbox.
  Choices: free gift (no wallet debit), real Telnyx purchase, auto-renew OFF, in-app Inbox notice only (no email).
- Script `scripts/ops/civr_gift_number.js` (copy at droplet /root/civr_gift_number.js, log /opt/nomadly/logs/civr_gift_2026-10-26.log):
  same records as numbers.js purchaseLocked but $0 (phoneTransactions action purchase, amount 0, paymentMethod gift,
  gift tag `business-week-2026-10-26`), no referral payout (both referred by 5000000000000002 — first-purchase reward
  left for a real purchase), "number live" email pre-marked in webEmailLog, transactions `admin-credit` $30
  (`gift-credit-<id>-<tag>`), 2 webNotifications (billing + wallet). Idempotent.
- Numbers: +18334120472 (iammills404, SIP cvs778p29j) and +18777553674 (fundmyllc, SIP cv5thamw4q). Telnyx active, on the
  Call Control App, messaging profile set. Expire 2026-11-02 ~19:13Z, autoRenew false → normal pause/hold after that.
  Telnyx cost $1 upfront + $1/mo each (balance 11.55 → 9.12).
- Code: web wallet history now labels `admin-credit` rows "Credit from CloudIVR" (js/cloudivr-web/wallet.js). Redeployed
  workspace → release 20261026T191309Z-e9324ac (restart loaded 21 short SIP logins incl. the 2 new ones).
  ⚠️ Still needs owner "Save to GitHub" or the next CI deploy reverts the workspace releases.
- Seen in passing: fundmyllc's inbox has an older bot notice "Free IVR Trial Call Complete! … that's Nomadly" (bot brand
  name in a CloudIVR inbox) — not changed.

## 2026-10-26 (night) — CloudIVR web E2E pass + anomaly fixes — TESTED (iteration_150: backend 25/25 + 19/19, frontend all flows), DEPLOYED to droplet app-main
- Owner: "test the cloudIVR end to end and fix any anomalies or bugs" → scope web app only, deploy right after testing.
- Legacy backend/tests/test_cloudivr_*.py broad run (139 F / 91 E) = STALE fixtures (hardcoded numbers/agent IDs/coupon dates/tmp seed
  scripts from older pods) — not product bugs. Current-pod suites: test_cloudivr_e2e_iter150.py + test_cloudivr_flows_iter150b.py
  (run cleanup_iter150b.py after).
- Fixes: /cloudivr/help → redirect to /app/help (SSR noindex); text-call header "Outgoing call from {0}" (+FR/ES); landing "Debit"
  chip translatable (brand chips stay data-no-translate); ES "AI" → "IA" everywhere (89 strings); help kbd chip no-wrap; <option>
  value props (Wallet, Campaigns); Tailwind ambiguous duration-[1400ms] → [transition-duration:1400ms].
- DEPLOYED 2026-10-26 19:00Z via scripts/deploy_workspace_to_droplet.sh app-main → release 20261026T185940Z-290f000 on :5000
  (app-main-a), health OK, cloudivr.net /, /sip, /login, /terms, /help all 200. Includes the SIP funnel (/sip).
  ⚠️ Owner must "Save to GitHub" (main) or the next CI deploy rebuilds origin/main a54926f2 and rolls this back.
- Prod finding (not changed): CLOUDIVR_SUPPORT_LINK is NOT set in prod app-main backend.env → every "Message support" button on
  cloudivr.net is hidden. Owner to supply the real CloudIVR support Telegram link.
- Backlog: dry-run campaign start keeps "Start calling" enabled (preview-only); TTS uses real credits on preview; private mode
  doesn't hide top-bar balance; Quick IVR shows VoiceMaker + "Read out with" pickers (intended alt paths).

## 2026-10-26 (eve) — CloudIVR SIP sales funnel at cloudivr.net/sip — TESTED (iteration_147/148/149, frontend 100%, SEO 5/5), NOT deployed
- Owner: "https://sip.cloudivr.net/ is not displaying anything — turn this page into a sales funnel". RCA: sip.cloudivr.net is
  the SIP REGISTRATION host (A → Telnyx 192.76.120.10 = sip.telnyx.com; js/phone-config.js WEB_SIP_DOMAIN) — every customer
  softphone/desk phone uses it, so it can never serve a web page without breaking calling. NOT changed. Owner skipped the
  follow-up → recommended: funnel lives at cloudivr.net/sip; main CTA = pick plan → /signup?plan=<id> → /app/buy?plan=<id>;
  sections = works-with-your-app, plan comparison, FAQ (no support-chat button).
- Frontend: pages/SipFunnel.js (nav, hash-landing + scroll-to-top, mobile sticky CTA) + pages/sip/{Hero,Sections,Plans,shared}.js
  (animated softphone mock, benefits, Zoiper/MicroSIP/Linphone/desk phones + connection card w/ Copy + "why it doesn't open in
  a browser" note, 3 steps, live-catalog plan cards — Pro "Best for SIP", Starter "No SIP" — + "Compare every feature" table,
  9 SIP FAQs, final CTA). Route `sip` in CloudIvrApp.js, PageTitle 'SIP phone numbers', landing Footer link "SIP & softphones"
  (footer-link-sip), `useStart` exported from landing/PricingFaq.js. FR/ES: +89 keys each via scripts/civr_i18n_sip_page.py.
- Server SEO (js/cloudivr-web/seo.js): /sip title/description/canonical, SIP FAQPage JSON-LD (`/sip#faq`), sitemap + llms.txt.
  Tests: js/tests/test_cloudivr_sip_page_seo_2026-10.js (5/5), backend/tests/test_cloudivr_sip_funnel_catalog.py (testing agent).
- Goes live on cloudivr.net after the owner taps "Save to GitHub" (main → droplet deploy workflow).


## 2026-10-26 (pm) — CloudIVR upgrade locks + plan text + bold landing copy + 14 emails — BUILT on preview, testing in progress, NOT deployed
- Plan gating (bot + web): Pro now has the Keypad menu (IVR) + key analytics; Quick IVR scheduling, saved presets, one saved
  voice, Text Triggers and text calls (deaf / hard-of-hearing) are Business-only (`phone-config.js` planFeatureAccess:
  browserRing/ivrSchedule/ivrPresets/consistentVoice keys). Locked features stay visible: `<PlanLock>` / `LockedNote` /
  `showUpgrade()` (frontend `Upgrade.js`) open a short "X is on the Business plan" pop-up → upgrade the number or buy one.
- Plan cards: "Everything in Starter, plus:" / "Everything in Pro, plus:" (`PlanFeatures.js` with `plans`). Landing copy
  rewritten bold / sales-driven. In-app text colours lifted (`cloudivr.css`). Frontend ESLint config repaired
  (`frontend/eslint.config.js`, run `cd frontend && npx eslint src`). Fixed landing crash (PricingFaq PlanCard used an
  undefined `catalog`).
- Emails (`js/cloudivr-web/emails.js` engine, `email-templates.js`, `email-copy.js` EN/FR/ES, `email-layout.js`): welcome,
  number live, renewal receipt (renew/restore/auto_renew), plan upgrade, renewal reminder (3 days; auto-ok / top-up needed /
  auto-renew off), renewal failed (grace), number paused, top-up received, low balance (user amount, default $10), wallet
  empty (< $0.50), campaign report, new voicemail, missed calls (grouped per number), weekly summary (Mondays 08:00 UTC via
  node-schedule). A 1-minute scanner reads accounts / transactions / phoneTransactions / bulkCallCampaigns / phoneLogs /
  number states / wallet levels; webEmailLog `_id` = one key per event (never twice). First run sets a watermark
  (webEmailState.scanner) so old records never email. Language = webPrefs.lang. Optional emails (weekly, campaign reports,
  voicemail, missed calls) have Settings switches + signed one-click stop link (GET asks, POST stops; List-Unsubscribe
  headers). Receipts / renewals / wallet alerts always send. Links: WEB_APP_URL or https://CLOUDIVR_WEB_DOMAIN.
- Settings → "Email notifications" card (`pages/settings/EmailPrefs.js`, `#emails`): switches, low-balance amount, example
  picker → Open preview (`/emails/preview/:type?lang=`) and "Email me a test" (`/emails/test`, 10/hour), recent emails
  (`/emails/log`). Admin: POST `/admin/emails/weekly` runs the weekly summary now.
- Preview (WEB_CLOUDIVR_DRY_RUN=true): emails are RECORDED in webEmailLog with their HTML, NOT sent (WEB_EMAILS_LIVE=true
  sends for real). Added WEB_APP_URL=<preview URL> to dev backend/.env. Node backend has NO hot reload:
  `sudo supervisorctl restart nodejs` after js/ changes.
- Tests: `node js/tests/test_cloudivr_emails_2026-10.js` (38/38).

## 2026-10-26 — CloudIVR web Quick IVR free call + OTP code collection + cards "Coming soon" + Terms — TESTED (iteration_142: backend 20/20, frontend all flows), NOT deployed
- Built (previous fork): free Quick IVR call for accounts with no number (`pages/quick/Trial.js`, `/calls/trial`), OTP code collection with
  Accept / Decline / Hang up on the Quick IVR page and in the Inbox (`pages/quick/Otp.js`, `/calls/otp/:ccid`, preview = simulated `sim-` calls),
  plan gating like the bot (Starter: no Quick IVR; Pro: OTP, no custom messages / redial; Business: all), Terms page (`/cloudivr/terms`),
  landing combined Quick & Bulk IVR card, payments show cards + crypto with cards "Coming soon" (landing, wallet, checkout).
- This round: OTP Inbox items link to /app/quick-call ("Open Quick IVR call"); each code try keeps its own Inbox item (owner choice) but only the
  newest item per call shows the live panel (older ones say "An earlier try"); free-call subtitle/title fixed; overview trial card mentions codes;
  Redial only on rows made from a Business number; Pro locked notes de-duplicated; `/calls/otp` no longer returns chatId/at; Terms headings
  translate (number + title split) and open scrolled to top; failed filter load no longer leaves the old list under the error (useApi);
  OTP Inbox text + new strings translated FR/ES; FR grammar fixes.
- Verified: Cmd/K palette, number quick switches persist, Inbox SMS inline reply, Inbox filter placeholders, 390px no overflow.
- Seeded on this pod: Alice Pro `+13313039077` + Starter `+13313039088` (copies). Tests: `backend/tests/test_cloudivr_quick_otp_trial.py`,
  `backend/tests/test_cloudivr_iter142_otp_inbox_gating.py`.
- Backlog: P1 bot-side OTP text localisation for real calls (bot sends English); P2 fix ESLint config (`no-unassigned-vars` key error);
  P2 Phase 3 (accessibility, tokens). Owner must "Save to GitHub" before any deploy.


## 2026-10-25 (late) — CloudIVR landing redesign + app UI fixes (Phase 1) — TESTED (iteration_140, frontend 100%), NOT deployed (owner reviews preview first)
- Landing is now light (white/slate, indigo #6366f1/#4f46e5 accent, green parrot + green "IVR" wordmark kept). AI mock-up images (had
  garbled text) replaced by coded product mocks in `pages/landing/Mockups.js` (AppMock in hero, IvrMock / CampaignMock / AiMock in features).
  All sections kept; duplicate country marquee removed. Final CTA = rounded dark panel. Email gate modal light.
- Signed-in app stays DARK (owner choice). Fixes: white text on indigo badges (was dark-green text), success statuses green (`civr-pill-ok`),
  one icon colour on dashboard stats, dashboard "Your numbers" + "Quick actions" side by side, sidebar "Support" group, Buy step labels
  1/2/3, number tabs grouped with dividers (all 14 fit at desktop), mobile unread badge indigo.
- Preview dev flags appended to backend/.env: CLOUDIVR_WEB_ON, WEB_CLOUDIVR_DRY_RUN, WEB_TRYCALL_LIVE=false, TWILIO_ENABLED=false.
- Next: Phase 2 (remaining app screens: campaigns, inbox, wallet, audio, logs + empty/loading/error states), Phase 3 (accessibility,
  tokens). Owner must "Save to GitHub" before any deploy.


## 2026-06 — Paid plans / subscription & expiry audit — REPORTED (no code changed), awaiting owner pick
- 17 findings (5 high, 8 medium, 4 low). Top: VPS auto-renew works only once (_autoRenewAttempted never reset), CloudIVR SMS double-counted, phone scheduler overwrites whole val, wrong upgrade-credit date field, membership re-buy wipes remaining days.
- Full report: **memory/PLAN_EXPIRY_AUDIT_2026-06.md**

## 2026-10-24 (later) — Bot vs web gap audit — ✅ ALL 21 DONE (iteration_118/119, confirmed iteration_122/123; heading corrected 2026-10-25)
- 21 bot features missing on web (most already supported by the shared call engine → UI + route work only). Top: OTP collection,
  per-key outbound menu, script templates/type-a-script, campaign CSV report, "what callers get" routing summary, inbound IVR templates.
- Full table + suggested order: **memory/CLOUDIVR_BOT_WEB_GAP_AUDIT_2026-10-24.md**.

## 2026-10-24 — CloudIVR: 6 Onoff-style features — BACKEND DONE (31/31 unit), FRONTEND BUILT (untested — owner paused testing), NOT pushed/deployed
- Owner picks: Pro default plan (DONE), On/off hours, Call notes, Call me first (per-call switch on dialer), Voicemail transcription
  (owner's own OpenAI key APP_OPEN_API_KEY), Voicemail greeting language (EN/FR/PT/AR), Private mode (tap again to unhide, no PIN).
- Full handoff, API contract and UI TODO list: **memory/CLOUDIVR_FEATURES_PROGRESS_2026-10-24.md**.
- Owner asked to push to main with a pasted GitHub token → not done (use Save to GitHub; revoke the token). main = live server; voice-service.js changed.

## 2026-10-23 (night) — CloudIVR Telnyx-style redesign + free test call + crypto checkout — TESTED (iteration_116/117, 16/16 pytest) — LIVE on https://cloudivr.net 2026-10-23 13:57Z (release 20261023T135709Z-54b98d4)
- Landing (`pages/Landing.js` + `pages/landing/{Hero,Hero3D,Sections,PricingFaq,TryCall,TryLive,EmailGate,tryApi,kit}.js`): black/cream
  Telnyx-style sections, bright green accent, live R3F 3D hero. `Hero3D.js` is written with React.createElement (NO JSX) because the dev
  visual-edits babel plugin injects <span>/x-* props into JSX → R3F errors + CRA overlay blocking clicks.
- Free test call (`js/cloudivr-web/trycall.js`, public `/public/try/*`): email OTP (6 digits, 10 min, 5 tries), 1 call per email, 3/day per
  device or network, 1 call per destination per 30 days, number must start with + or 00, 60 s cap, "we call you" demo menu (1/2/3) or browser
  SIP line (single-use test credential locked to the entered number, never billed). Unanswered call → `no_answer` (email + number freed, still
  counts toward the daily limit) with a "Try again" panel. REAL call verified 2026-10-23 to owner +13025141000: answered, key 3, normal hangup.
- Visitor IP (`auth.js clientIp`): hop left of the right-most Cloudflare edge in X-Forwarded-For (CF-Connecting-IP if that hop was dropped),
  else right-most public hop — spoofed first values ignored (also hardens login/register/forgot lockouts).
- ID check hidden until after payment (no "ID check" on landing/buy/country select). Web verifications are `hold: true`: never expire,
  never auto-refund; carrier rejection → `rejected_on_hold` + new verification session (`holdTelnyxPending` in _index.js).
- Checkout (`orders.js`, `pages/buy/{Checkout,OrderStatus}.js`): wallet or crypto for the exact price, auto-renew ON by default (toggle).
  Crypto order (`webNumberOrders`) settles when the DynoPay credit lands (30 s poll + on view); taken number → similar one (same country/type/
  area code, never dearer; cheaper → difference stays in wallet) + on-screen notice + email + admin alert. Underpaid → finish after top-up.
  Orders routes are mounted BEFORE numbers routes (`/numbers/orders` was shadowed by `/numbers/:phone`). Number purchases take a per-number
  lock (`webNumberLocks`, TTL 10 min); held numbers are filtered out of search/similar; buying a held number → 409.
- Sign-out → landing page. Preview flags: `WEB_CLOUDIVR_DRY_RUN=true`; `WEB_TRYCALL_LIVE=false` (set true to place real demo calls + email
  real codes on preview). Preview crypto checkout returns REAL DynoPay addresses (WEB_DYNO_PAY_API_KEY set) — never send funds; use simulate.
- Twilio: owner says it is managed on the Nomadly side — no change here. Admin balance overview deferred.
- 13:49Z a GitHub CI deploy rebuilt stale WITH-WEBIVR `2d3211d` → cloudivr.net showed the URL shortener; rolled back, then workspace deploy +
  `CLOUDIVR_WEB_ON=true` added to prod backend.env (flag was missing). ⚠️ Server now follows **main** (14:07Z) — owner must Save to GitHub → main or the next CI deploy reverts it.
- Tests: `backend/tests/test_cloudivr_trycall_orders.py` (16). Next: GOOGLE_OAUTH_CLIENT_ID on prod;
  Google Console JS origins (cloudivr.net, www.cloudivr.net, preview hosts).

## 2026-10-23 (eve) — CloudIVR UI/UX audit → ALL 15 fixes — TESTED (iteration_115, 100%) & LIVE on https://cloudivr.net
- Audit (5-sec, Fitts, Z/F, 8-pt, Gestalt, narrative arc) presented first; owner: "FIX ALL END TO END".
- Landing (`pages/Landing.js` + `pages/landing/{Sections,PricingFaq}.js`): one CTA label "Get your number", microcopy
  "Free to sign up · Numbers from $50/month · No contracts", fake "Network online" pulse removed, How it works (3 steps),
  feature cards with plan badges derived from catalog `access` (IVR builder = Business only), Why CloudIVR + 17-country
  coverage grid (Instant vs ID check), pricing whole dollars + minutes/SMS + extra-usage rates, 7-item FAQ, final CTA,
  footer (support link). Only "CloudIVR" brand on customer pages. `/public/catalog` now also returns coins, minTopup, supportLink.
- Auth: mobile logo + Home link, show/hide password, `?plan=` carried signup/login → `/app/buy?plan=`, "what happens next".
- App: grouped sidebar (Numbers/Calling/Account) + support link, phone bottom tab bar + More menu (`MobileNav.js`, `nav.js`),
  44px targets, preview banner inside content column, centered content, topbar "Add funds".
- Dashboard: first-run Get-started checklist (no zero-stat wall); existing users get "Your numbers" + next renewal +
  low-balance warning. Buy: top-up detour keeps number+plan (sessionStorage `civr.buyResume`, `/app/wallet?need=&for=` → `?resume=1`).
  Wallet: amount prefilled with shortfall, polls every 20 s while a deposit is open, "Check now".
- Contrast: all #555/#666/#777 text lifted (#8a8a8a/#9a9a9a), --c-muted #8a8a8a; off-grid 20/28/36px spacing → 8-pt.
- domain-guard serves the index with CloudIVR <title>/description/og tags (was "Hosting Panel"); test 18/18.
- Deployed via `scripts/deploy_workspace_to_droplet.sh app-main` → release 20261023T115939Z-1b31835 (:5100 app-main-b).
  ⚠️ Owner must "Save to GitHub" (WITH-WEBIVR) or the next CI deploy rebuilds the old UI.
- LESSON: search_replace sometimes reports "failed" but HAS applied (twice) — verify with git diff; patch via python asserts.
- ✅ WEB_DYNO_PAY_API_KEY saved via secure card (2026-10-23 12:05Z). Preview: real DynoPay USDT-TRC20 address created for a $10
  test top-up (no funds sent; preview needs `supervisorctl restart nodejs` after .env changes). Droplet: appended to
  /opt/nomadly/shared/app-main/backend.env (backup `.bak.webdyno.20261023T120712Z`), app-main-b restarted at 0 live calls → healthy.
  Next: owner makes one real $10 deposit on cloudivr.net to confirm the credit lands; add GOOGLE_OAUTH_CLIENT_ID for Google sign-in.

## 2026-10-23 (late) — CloudIVR web app built end-to-end on PREVIEW — TESTED (iteration_113: backend 24/24, frontend all flows), awaiting user confirmation
- Web app at `/cloudivr` (landing, sign up/in, forgot/reset) + `/cloudivr/app/*`: overview, my numbers, buy (17 Telnyx countries,
  Twilio never shown), number tabs (overview, forwarding, IVR builder w/ sub-menu + 30-day key analytics, voicemail, SMS,
  SIP, recording, logs, billing: renew/auto-renew/upgrade/delete), verification wizard, audio library (upload + TTS),
  Quick IVR call, campaigns (estimate, schedule picker, start/pause/resume/cancel, live stats), wallet (DynoPay crypto, QR),
  inbox, settings, browser phone dock. API `/api/cloudivr-web/*` (js/cloudivr-web/, mounted in _index.js).
- Fixes in this pass: googleSub unique index broke sign-up (now partial index); phone monitor skipped dry-run numbers
  (were flagged "suspended"); `provider` removed from web API; per-email login lockout (XFF spoof-proof); early renewal keeps usage.
- DynoPay web key: `WEB_DYNO_PAY_API_KEY` (own key for web top-ups, passed via `getDynopayCryptoAddress(..., keyOverride)`);
  until it is set, preview returns a clearly labelled PREVIEW placeholder address. Google button hidden until `GOOGLE_OAUTH_CLIENT_ID`.
- Preview `WEB_CLOUDIVR_DRY_RUN=true` = MOCKED number purchase/release, SIP creds, dialing, verification submit. Not deployed to production (owner: keep on preview).
- Frontend dep pin: `webpack-dev-server` resolution `~5.2.1` (>=5.2.1 pulled 6.x which needs Node 22 and broke the dev server).
- Tests: `backend/tests/test_cloudivr_web.py` (run with REACT_APP_BACKEND_URL exported), `scripts/cloudivr_web_smoke.sh`.
- Next: owner adds WEB_DYNO_PAY_API_KEY + GOOGLE_OAUTH_CLIENT_ID → verify a real $10 deposit + Google sign-in; then custom domain + production rollout (dry-run OFF).

## 2026-10-23 (pm) — Bulk cancel stops billing · carrier name hidden · CloudIVR web handoff
- Bulk IVR Cancel now hangs up live calls still playing the message (transferred calls keep going). RCA + refund
  ($1.95 to 8666352410, done + notified): memory/BULK_CANCEL_BILLING_RCA_2026-10-23.md. Tests 10/10 + 32/32 + 48/48 + 17/17.
- "telnyx" no longer shown in support escalations / admin alerts (`networkLabel` → "Speechcue").
- CloudIVR web app: backend modules in `js/cloudivr-web/` (NOT mounted, inert), frontend not started.
  Full handoff + next steps: **memory/CLOUDIVR_WEB_PROGRESS_2026-10-23.md**.

## 2026-10-23 — Bulk IVR: Pause/Resume/Cancel + My Campaigns, international pricing, voicemail drop (Telnyx) — TESTED (sandbox), awaiting user confirmation
- Controls: inline ⏸ Pause / ▶️ Resume / ❌ Cancel (+ 📊 Status) on Campaign Started, wallet-pause and status messages;
  `📋 My Campaigns` (en/fr/zh/hi) in Cloud IVR menu + running screen. Callbacks `bulk_view|pause|resume|cancel|cancelyes:<id>`
  owner-only. Resume checks the wallet against the next lead's rate. Cancel marks pending leads notCalled; calls in progress
  finish + bill; the final report ("Campaign Cancelled", localized) is sent once after they settle (`reportPending`).
  Wallet pause only while a lead is still pending; a campaign whose last call drained the wallet completes normally.
- Pricing: per-lead `getIvrCallRate` (US/CA $0.15, intl $0.50, high-cost higher); preview/upload/start show US/CA vs
  international split; blocked (satellite/premium) numbers are left out of the estimate and flagged.
- Voicemail drop: setup step after concurrency (Telnyx only) — 📵 Hang up or an Audio Library clip (duplicate names get #2).
  Dials with AMD `detect_beep`; machine → gather_stop → wait for `call.machine.greeting.ended` (fallback BULK_VM_BEEP_WAIT_MS,
  default 20 s) → play clip → hang up; clip failure → hang up. Report/progress show "message left" (📩 count).
- Files: js/bulk-call-service.js, js/voice-service.js, js/telnyx-service.js (gatherStop), js/_index.js, js/phone-config.js, js/lang/*.js.
- Tests: test_bulk_telnyx_2026-10 48/48, test_bulk_controls_edge_2026-10 32/32 (new), bot_ui_bulk_ivr_2026-10 59/59 (new, mock
  Telegram), test_bulk_telnyx_edge 17/17, bulkivr_wallet 10/10, twilio_switch 43/43, provider_suspended 7/8 (REQ-69 baseline),
  i18n coverage + parity 79/79; iteration_106 + iteration_107. No real calls placed.
- PROD 2026-10-22 08:42Z: TWILIO_ENABLED=false added to all 4 droplet brand envs (app-main/app-wl/app-voodoo/app-proshop,
  backups `.bak.twilio-off.20261022T084243Z`); inert until the new code deploys. WhiteLabel sync dry-run clean.
- LIVE 2026-10-22 ~08:51–08:54Z — DIRECT DROPLET DEPLOY (no GitHub push; user can't use Save to GitHub): git-archive
  tarballs → new release trees via `js/ops/droplet_direct_release_2026-10.sh` (node_modules + frontend build reused,
  user-audio/audio_cache carried over, RELEASE `patched=direct deploy…`) → activated with a copy of deploy.sh
  (`/root/deploy_activate.sh` = rollback path + drain, notify "🚀 direct deploy"). Releases: app-main 20261022T085035Z-e4788da
  (main e4788daf, :5000 app-main-a), app-wl/voodoo/proshop 2026102208525x-ddde6d6 (WhiteLabel sync commit ddde6d69 built
  locally by sync_whitelabel.py --dry-run, parent 8f26507d). All 4: /health healthy, public 200, isTwilioEnabled=false,
  0 restarts, recovery "no running campaigns". WL tree also passed bulk suites 48/48 + 32/32 locally.
- ✅ 2026-10-22 09:05Z owner pushed from the droplet (`/root/nomadly-push`): origin/main = d348083b; Sync main → WhiteLabel
  pushed 59505e0c; CI redeployed all 4 from GitHub (app-main d348083b :5100, wl/voodoo/proshop 59505e0c) — healthy,
  public 200, isTwilioEnabled=false, no `patched=` lines. GitHub and server are in sync again.
  Rollback per app: `bash /opt/nomadly/deploy.sh <app> rollback` (previous releases kept).
- Known noise (pre-existing): app-main PhoneMonitor logs AUTH_FAILED for every suspended Twilio sub-account at boot.
- 2026-10-22 ~09:40Z Round-2 migration: 7 more paid numbers (Nomadly 6 / Voodoo 1) moved to new numbers, apology
  messages sent (no carrier names), 6 round-1 users got an apology follow-up; verify 143/143. Telnyx balance $9.33.
  Details: memory/TWILIO_TO_TELNYX_MIGRATION_2026-10-22.md (Round 2).
- User pasted a GitHub PAT in chat — advised to revoke (agent does not push).
- Ready-to-push copy prepared on the droplet: `/root/nomadly-push` (main = local workspace HEAD, clean fast-forward over
  origin/main b4d62d5, uses the droplet's stored git credentials). Owner runs `cd /root/nomadly-push && git push origin main`
  → CI redeploys app-main (same code) + Sync main → WhiteLabel redeploys wl/voodoo/proshop.

## 2026-10-16 — SIP "503" low-balance UX: never-silent alert + top-up re-enable confirmation + threshold retune (ALL 4 bots) — LIVE
- RCA (Nomadly @pirate_script 1005284399): number +18445716353 & SIP cred healthy; Zoiper "503" was a correct LOW BALANCE
  LOCK at $0.18. Gaps fixed: (A) low-balance alerts no longer silently dropped when a translation is missing (English
  fallback on all paths); (B) thresholds now CALL_LOW_BALANCE_TRIGGER=1 / CALL_LOW_BALANCE_RESUME=5 / BULK_CALL_MIN_WALLET=20
  on all 4 brands (were default 20 / 50); (C) addFundsTo sends "✅ Outbound calling re-enabled" when a top-up unlocks a
  previously-locked user. Hot-patched+reloaded all 4 live bots; verified. Detail: memory/SIP_LOWBALANCE_ALERT_2026-10-16.md.
  PENDING: owner "Save to GitHub" to persist js/voice-service.js + js/_index.js.


## 2026-10-16 — PROSHOP white-label (4th brand, app-proshop) — LIVE (public, certs OK)
- @ProshopHQ_bot · panel.proshophost.xyz (panel+landing) · proshopivr.xyz (/call, webhooks, /sales) · sip.proshopivr.xyz.
  Own Mongo (Railway) / Dynopay / bot; shared Nomadly Telnyx account with own SIP/CCA/MP; support+channel @proshopHQ; phone ON; reseller shown.
- Domains via OpenProvider, auto-renew OFF. Full record: memory/PROSHOP_SETUP_2026-10-16.md
- 2026-10-16: PROSHOP BotFather avatar 640×640 (`js/assets/brand/proshop/icon.png`, public https://panel.proshophost.xyz/brand/icon.png); full rebuild runbook `memory/ECOSYSTEM_REBUILD_RUNBOOK.md`.
- Sales dashboard password Nomadly123@ (owner standard). PENDING: owner /start @ProshopHQ_bot;
  owner "Save to GitHub" (ships deploy-proshop CI job + brand assets/APK via WhiteLabel sync).

## 2026-10-16 — SMADAV .it swap DONE · IVR TTS hardening LIVE · license alert 100 · OP emails → hosta1@proton.me
- Setup: vault (`scripts/vault.sh`, pass from owner) already matched dev .env; droplet SSH key from `DROPLET_SSH_KEY_B64`.
- SMADAV 73sandoresworld.it → 72sandoresworld.it (OP 30422145, CF 0e19f39f…, cPanel nsan2e0c). OWNER ACTION: click the .it
  verification email in hosta1@proton.me. See memory/SMADAV_IT_DOMAIN_SWAP_2026-10-16.md.
- IVR "Audio generation failed": root cause = EdenAI credits (HTTP 402) — not recurring now (16/16 OK), balance $7.58.
  Fix B live on all 3 bots: direct OpenAI TTS fallback on 401/402/403, EdenAI error-body logs, EdenAI credit monitor
  (warn $5 / crit $2) + live 402 admin alert, friendly copy (no raw errors) + Bulk IVR Upload New Audio button.
  Tests: js/tests/test_tts_billing_fallback_2026-10.js 39/0; real-API forced-invalid-key run OK.
- cPanel license alerts: WHM_LICENSE_LIMIT=100 set on all 3 bots (was unset → default 30). Live: accounts=28/100.
- 180 OP contact handles moved off cloakhost@tutamail.com → hosta1@proton.me.
- Origin CA: 24 stuck Flexible domains backfilled to Origin CA + Full; enforcer self-heal live (guarded to live hosted domains). Cause was provisioning race, not the missing key.
- NEEDS "Save to GitHub" so auto-deploys keep the hot-patched code.

## 2026-10-15b — cPanel license cleanup: deleted 1 empty account + proactive 27/30 safeguard
- Request: "which cPanel account has no uploaded content — delete it, license almost full". License cap = 30 accounts
  (whmapi1 get_current_users_count / cpanel.lisc maxusers:30); disk is fine (21G/119G). So it's the ACCOUNT-COUNT limit.
- Audit (new js/ops/whm_empty_accounts_audit_2026-10.sh — run as root on WHM; walks ALL docroots incl. addon/sub domains,
  ignores cgi-bin/.well-known/.htaccess/.user.ini/.antired-challenge.php/error_log + the Anti-Red index.php wrapper):
  ONLY nbayftest / testingbays.sbs was empty (0 user files across 5 addon docroots, 0 db, 0 mail) — the owner's test acct
  (chatId 5590563715). listaccts "0M" is misleading: luxe6b41 & gogo2a5c show 0M but DO have content — NOT deleted.
- Deleted nbayftest via js/ops/whm_delete_account_2026-10.js (same /removeacct API the bot uses, CF-tunnel headers) →
  result=1, confirmed gone, WHM now 28/30; cpanelAccounts row set deleted+terminatedOnWhm (self-heal sweep won't retry).
- Safeguard: js/whm-disk-monitor.js (6-hourly, already wired) warned only at a dead hardcoded 150 (never reachable under a
  30 license). Now license-aware: licenseStats() warns at WHM_LICENSE_WARN_AT (default limit-3 = 27), separate "near" vs
  "at limit" admin DM with its own 24h dedupe. Runs per bot process → each brand admin (Nomadly/Smadav/Voodoo, shared WHM)
  gets the alert. Daily digest (js/whm-account-digest.js) already warned at 27 too; this makes it proactive between digests.
  Tests: js/tests/test_whm_license_guard_2026-10.js 15/0.
- Deploy: hot-patched the LIVE releases (app-main bd01a02, app-wl/app-voodoo be8ee8d — the platform rebuilt these from git
  at 07:44Z, and they already contain the earlier web-access/RDP/log-redact/password-truth work → Save-to-GitHub worked),
  .bak.<ts> + RELEASE patched=, blue/green → -b slots healthy. NEEDS "Save to GitHub" to persist the monitor change.
- Ops (read-only unless --apply): whm_empty_accounts_audit_2026-10.sh, whm_delete_account_2026-10.js, whm_account_audit.js.

## 2026-10-15 — "🌐 Use on Web" (hosta.sh) + Show Password truth for DO RDP — TESTED (iteration_95 100%) & LIVE on Nomadly
- Web access (Nomadly only; owner: just invite, no mention of separate accounts; button on TOP row): new js/web-access.js driven by
  `WEBSITE_URL` (set ONLY in /opt/nomadly/shared/app-main/backend.env + /app/backend/.env = https://hosta.sh; Smadav/Voodoo unset →
  nothing shown). Main keyboard (lang/{en,fr,zh,hi}.js) gets a localized "🌐 Use on Web" first row → reply with an inline
  "🌐 Open hosta.sh" URL button (_index.js handler before the Settings-menu block). First-start welcome (showFirstSessionIntent)
  ends with "🌐 Prefer the web? Use hosta.sh" (link, no preview). Tests: js/tests/test_web_access_2026-10.js 43/0.
  NOTE: hosta.sh is a separate app (/opt/hosta, DB "nameword", own accounts + wallet, buys via ONE reseller key) — bot balances
  and services are not visible there.
- Show Password (DO RDP): prod audit (js/ops/rdp_password_audit_2026-10.js, hashes only) → all 3 active RDPs stored == applied.
  Gaps closed in js/digitalocean-rdp-service.js: `<id>:boot` secret = create-time (user-data) password (createInstance; older
  never-reset/reinstalled servers backfilled at reinstall); reinstall records `reinstall_password_cmd`; rdp_ready while it is
  pending → `boot_password_applied_at`; agent reports it FAILED → server + plan secrets reverted to the boot password (+ admin
  alert); `passwordStatus()` = confirmed | applying | boot (agent silent >10 min) | failed | unknown. Bot revealVpsPassword:
  failed → new vp.revealPasswordNotApplied (no wrong password shown), boot → shows the working one, notes per state in 4 languages.
  Tests: js/tests/test_rdp_password_truth_2026-10.js 40/0 + all RDP/reseller/redaction regressions green.
- Deploy: hot-patched app-main release 20261014T221827Z-22e5de2 (.bak.20261015T072808Z / T074038Z, RELEASE patched=), blue/green →
  app-main-b :5100 healthy. Smadav/Voodoo untouched (inert there). NEEDS "Save to GitHub".
- Observed (pre-existing, not touched): app-main error log has thousands/day of `checkDomainPriceOnline ... 401 Unauthenticated user`
  since ≥ 2026-10-10; Contabo auth circuit `invalid_client`.

## 2026-10-14i — Health-check + AutoPromo fixes actually LIVE; 4 DO-RDP lifecycle bugs fixed — TESTED (iteration_93 111/111, iteration_94 223/223) & LIVE on all 3 bots
- Found: the 20:24Z hot-patch of js/hosting-health-check.js (WHM via CF tunnel → no more false "No user content found") + js/auto-promo.js
  (zeroLiftVerdict → no more false "Zero-lift blast") was on disk but the bots had been running since 18:50Z → reactivated all 3 (blue/green).
- (a) Early power-off: doRdpServers.expires_at = activation+30d vs vpsPlansOf.end_time = +1 calendar month. `processExpiries` Sweep-1 now
  skips a box whose plan end_time is still in the future and syncs expires_at := end_time. Data: 1aef405b → Nov 14, e92d1b57 (null) → Oct 27.
- (b) Passwords in PM2 logs: `send()` logged full credential replies. js/log-redact.js `redactSecrets()` (in the console shim) masks the
  <code>/<pre>/<tg-spoiler> value or key=value AFTER a credential label (Password/Mot de passe/密码/पासवर्ड/PIN/पिन/SIP Pass/api key/secret).
  112 old log lines scrubbed in /root/.pm2/logs (js/ops/pm2_log_secret_scrub_2026-10.js, same inode → PM2 keeps writing).
- (c) Box deleted outside the bot: new `reconcileVanished()` (Sweep-0, hourly): droplet 404 twice → doRdpServers destroyed
  (droplet_gone_external), vpsPlansOf DELETED, reseller rdp.deleted, admin alert "refund or replace". Data: @morganfreebandzz 60811b81
  (droplet 605654801 destroyed 2026-10-05 12:59Z — not by our code; owner refunded $156 TXN-20261014-1E0PI) → destroyed/DELETED.
- (d) Grace destroy loop: reseller-API records keep the RDP id in `instanceId` (vpsId = bare uuid → Vultr 401). deleteVPSinstance +
  rdp-grace-lifecycle `instanceIdOf()` = contaboInstanceId || instanceId || vpsId (+ `rdp-` prefix for provider digitalocean-rdp); after 10
  failures the destroy backs off to once/6h (lastDeleteAttemptAt). Data: 227de9e3 (583 attempts) → CANCELLED. Loop gone after 21:10Z.
- Mirror/webhook lookups in digitalocean-rdp-service also match `instanceId` (reseller RDP grace now mirrors correctly).
- Tests: js/tests/test_rdp_lifecycle_fixes_2026-10.js 52/0 + grace 73/0, log-redact 25/0, reseller grace 40/0, gone-reconcile 31/0.
- Deploy: hot-patched releases main 20261014T184959Z-e87c43a / wl + voodoo 20261014T18xxxxZ-a9f0a27 (`.bak.<ts>`, RELEASE patched=),
  same-release blue/green → app-main-b :5100, app-wl-b :5101, app-voodoo-b :5103, /health healthy. NEEDS "Save to GitHub".
- Ops scripts: js/ops/rdp_lifecycle_audit_2026-10.js (read-only), js/ops/rdp_lifecycle_datafix_2026-10.js (dry-run / --apply).

## 2026-10-14h — Voodoo Land: 💼 Reseller button hidden (prod env only)
- `/opt/nomadly/shared/app-voodoo/backend.env`: `HIDE_BECOME_RESELLER=true` (backup `backend.env.bak.hidereseller.<ts>`), `pm2 restart app-voodoo-a` at 0 calls → healthy, webhooks flowing. Hides the button in the ➕ More menu (`_index.js` `user.more` handler) and the legacy config.js main row. Nomadly/Smadav unchanged (false).

## 2026-10-14g — Sales & Profit dashboard UX overhaul (Smadav + Voodoo) — TESTED (iteration_90 100%) & LIVE, saved to WhiteLabel 401efdb2
- Audit (Hick's Law, Gestalt, 8-pt grid, core loop) presented first; user approved fixing all 8 findings. Nomadly has NO sales dashboard (user chose to leave it).
- `frontend/src/pages/SalesDashboard.js` exists ONLY on the WhiteLabel branch (BRAND_PATTERNS in scripts/sync_whitelabel.py) → backup copy `/app/memory/wl/SalesDashboard.js`.
- Changes: 4 tabs (Overview · Trends · Breakdown · Records, URL hash deep-links) + sticky header with tabs and range (desktop segmented, <lg native select) + mobile bottom tab bar; Overview shows only 4 KPI cards, then headed "Users & conversion" / "Wallet flow" stat grids; 12px minimum text, muted text #A1A1AA/#D4D4D8 (no #71717A/#3F3F46); 8px spacing grid (p-4 sm:p-6 cards); 44px phone tap targets; weekly loss bars striped + legend; negatives shown as "−$" + icon + sr-only; labelled inputs/selects, aria-pressed/selected/expanded; shared SearchField/SelectField/Pager; client-side "Export summary" CSV + server transactions CSV; funnel shows "+N bought with promo credit only" instead of >100%.
- Prod: built per-brand bundles locally from the live release trees + exact REACT_APP env (fe_env sha matched), swapped `frontend/build` in the active app-wl / app-voodoo releases (old kept as `build.prev-dash-<ts>`, no restart), src overlaid, `patched=` line in RELEASE. Pushed single-file commit 401efdb2 to WhiteLabel with `[skip ci]` (no redeploy).

## 2026-10-14f — Marketplace escrow → SafeDeal (Lockbay removed) + Reseller 50/50 with in-page AI support — TESTED (iteration_88 100%, 89 checks) & LIVE on all 3 bots (hot-patch #3)
- Reseller: copy 65/35 → **50/50** (en/fr/hi/zh, config.js, AI KB). Tapping 💼 Reseller now opens an AI support session (action supportChat, /done + 🏠 Main Menu keyboard), seeds AI history via new `ai-support.addSupportContext()`, admin gets "💼 Reseller enquiry" alert + SLA nudge.
- Escrow: new `js/mp-safedeal.js` (`SAFEDEAL_START_URL=https://safedeal.sh/#sd-start`, `sendSafeDealSteps`, `sendSafeDealLinkNote`). Buyer gets "I'm buying → tap-to-copy title/price → Share a link → paste here" steps; seller gets "wait for link → accept → deliver only after Funded" (+ "I'm selling" backup); each in their OWN language; fee hint 5% (min $10, buyer default). Out-of-range price → note, escrow not started.
- Marketplace price range now **$30–$3,000** (`MIN_PRICE/MAX_PRICE`, `isEscrowPriceOk`). Scam regex: safedeal.sh links stripped before scanning; `lockbay`, `@*escrow*`, `t.me/*escrow`, "escrow bot" flagged; "send me the link" no longer flagged. AI moderation ignores SafeDeal links.
- UX fixes: "Start Escrow" from product card now puts buyer INTO the chat (they can paste the link) and notifies the seller like Chat with Seller (`_mpNotifySeller` helper; unpaid seller gets locked alert, no steps). Marketplace header uses brand (no more "NOMADLY MARKETPLACE" on Smadav/Voodoo). Relay adds a "That's a SafeDeal escrow invite" note to the receiver.
- Tests: `js/tests/test_safedeal_reseller_2026-10.js` 46/46 (also on WL trees); testing agent live mock-Telegram run (`js/tests/live_safedeal_reseller_integration_2026-01.js`). `test_marketplace_gate_wiring.js` 3 pre-existing stale failures (unchanged).
- Prod: `git diff 1ed8ca5e` patch applied cleanly to app-main/app-wl/app-voodoo release trees, backups `/opt/nomadly/logs/*-sd-backup-20261014T1420*.tgz`, restarted active `-b` slots at 0 calls → healthy. Nomadly has 2 active listings under $30 (they'll get the out-of-range note at escrow time).


## 2026-10-14e — Plan comparison table + panel expiry banner + bot `/start renew` — TESTED (iteration_87 100%) & LIVE on all 3 brands (hot-patch #2)
- User saved to GitHub at 12:52 (commit 4cf61e85) → CI redeployed all 3 with the landing/panel rebuild + `/brand/` passthrough (real logos now live on Nomadly/Smadav too).
- `/api/store/plans` now has `mysql` (from whm-service PLAN_MYSQL_LIMITS: 2/5/unlimited), `captcha`, `geo` per plan. FAQ 6 corrected (weekly has 2 DBs).
- Storefront `components/store/PlanCompare.js`: "Compare plans" table under the plan cards (11 rows, Golden column highlighted, Buy buttons → GuestBuyModal), sticky feature column + sideways scroll on phones.
- Panel Overview `ExpiryBanner`: shows at ≤3 days (amber; "less than a day" / "1 day" / "N days" plurals) and red when expired; text changes with auto-renew on/off; "Renew now" → `https://t.me/<brand bot>?start=renew`. Quick action "Renew or upgrade" uses the same link.
- Bot `_index.js`: `/start renew` deep link → My Hosting Plans (same handler as `/start pinreset`), also in the onboarding /start condition.
- Prod hot-patch (pending "Save to GitHub"): rebuilt each brand's frontend from its live tree + REACT_APP env, swapped build (`build.prev-20261014T1306*`), copied src + `js/_index.js` (WL: targeted patch) + `js/store-routes.js`, restarted `app-*-a` slots at 0 calls → healthy. Backups `/opt/nomadly/logs/*-hp2-backup-20261014T1306*.tgz`.


## 2026-10-14d — Storefront sales landing + HostPanel shell rebuild — TESTED (iteration_86 100%) & LIVE on all 3 brands (hot-patch)
- User asks: "fix all end to end" UX audit (5-sec test, Fitts CTA, Z-pattern, 8pt, Gestalt, H1/H2/H3, Hook→Problem/Solution→Proof→FAQ→CTA, 390px). Choices: NO made-up numbers (non-numeric trust only), LIGHT default + toggle, deploy all brands.
- Storefront (`pages/Storefront.js` + `components/store/{LandingSections,HeroVisual,StoreFooter}.js`, `store-landing.css`): header nav + Sign in, hero (H1, sub, explainer, big coral CTA → #plans, cheapest-plan microcopy, animated brand-neutral "link status" visual), trust bar, standard-vs-Anti-Red compare, 3 steps, pricing (same testids, GuestBuyModal/CryptoPayBox untouched), proof + free-replacement card (support link), sign-in section (no autofocus), 7-item FAQ, final CTA band, footer (support, bot, "Store online"). Removed "99.9% uptime" claim. Decorative tints use `--brand-accent`.
- Panel (`PanelDashboard.js`, `components/panel/PanelOverview.js`, `panel-v3.css`): new default **Overview** tab (welcome H1, status/plan/expiry/domains cards, 6 quick actions), breadcrumb page-head + description on every other tab, sticky scrollable tab bar with labels + right fade, one-row mobile header (icon-only buy/logout). SiteStatusCard/Overview date fallback for odd locale tags.
- `useTheme`: light unless user chose dark. `/api/store/config` now returns `supportHandle` + `supportLink` (from `SUPPORT_HANDLE`).
- i18n: `store.lp.*`, `dashboard.{titles,descs,ov,buyMore}` in en/fr/hi/zh (`scripts/i18n_landing_2026.py`); parity tests green.
- **Prod deploy (hot-patch, pending "Save to GitHub")**: built each brand's frontend locally from its live release tree + its REACT_APP_* env, swapped `frontend/build` (old kept as `build.prev-20261014T122850Z`), overlaid src, patched `js/store-routes.js` /config, restarted active slots (0 calls) → all healthy; `patched=` line in each RELEASE; backups in `/opt/nomadly/logs/*-backup-20261014T122850Z*`. Verified live: panel.2.hostbay.io (Nomadly), 1.panel.smadavhost.com (Smadav @smadavv), panel.voodoohost.xyz (Voodoo @Voodoo_land).
- Known: Nomadly/Smadav prod releases lack the `/brand/` passthrough → letter fallback mark until GitHub save + CI deploy. Fallback mark now brand-accent (workspace only, ships on next deploy).


## 2026-10-14c — RDP golden auto-copy, real per-city ETAs, copy-first RDP reinstall, bot Linux "Reinstall OS" — CODE DONE & TESTED (preview; user deploys)
- **Golden auto-copy** (`digitalocean-rdp-service.js goldenBuildSites/ensureGoldenAtBuildSites`, prod only via `sizeCatalog.onRefresh`, off with `DO_RDP_GOLDEN_AUTOCOPY=false`): every Windows image kept in every datacenter an order of a sold city can be built in (today: copies to nyc1 + nyc2 → New York ~3 min instead of ~45). In-flight map, 6 h back-off + admin alert on failed copy. ~$2/month per extra datacenter.
- **Real ETAs (reseller)**: `deploy_eta_minutes` (GET /rdp/availability), `eta_minutes_by_region` (GET /rdp/os-options), `eta_minutes_in_region`/`fast_deploy_in_region` (GET /rdp/plans), POST /rdp `eta_seconds` from city+edition, corrected after create.
- **RDP reinstall, image not in the droplet's datacenter**: queued (`pending_reinstall`), server untouched, image copied, then rebuild automatically; bot DM with the new password when it starts / "nothing changed" if the copy fails; reseller 202 `copying_image` + webhooks `rdp.reinstall_started` / `rdp.reinstall_failed`; resumed after restart, claimed once. Edition picker shows per-server ETA (`reinstallOptions`).
- **Bot Linux "🔄 Reinstall OS"** (DigitalOcean only, `js/vps-linux-reinstall.js`): live DO image list (SSH-key-only images hidden on key-less servers), rebuild with image only, then the stored current root password is re-applied over SSH after cloud-init; login shown again when ready (or Show Password hint + admin alert). 4 languages.
- Tests: `js/tests/test_reinstall_eta_golden_copy_2026-10.js` 59/0; all regressions green; testing agent iteration_84 100%.
- **API doc audit (2026-10-14d)**: webhook `events` samples now rendered from `reseller-webhooks.EVENTS` (same filter as the API → never drift; added missing hosting/shortener.flagged), Safe Browsing `*.flagged` events described, GET /rdp/:id `provisioning.reinstall_queued`, POST /vps/:id/ssh-keys alias, VPS/RDP error codes added to the errors table; asserted in the reinstall suite (61/0).
- Backlog: poll the real DO copy progress for the queued-reinstall ETA (now a fixed ~20 min); Linux reinstall for legacy Contabo/OVH (not requested).

## 2026-10-14b — Late RDP refunds, re-checked renewals, stock alerts, preview isolation, live Linux OS list + SSH-key images, fresher stock — CODE DONE & TESTED (preview only; user deploys)
- **Late RDP failures** (`js/rdp-order-failure.js`, `digitalocean-rdp-service.js handleFailedOrder/reconcileOrders`, `_index.js handleRdpOrderFailed`): a paid bot RDP whose build fails after the purchase flow → ONE wallet refund (paidUsd, coupon-aware), droplet removed, customer DM (amount + short reason + 🌍 Try another city `rdpcity`), admin notice. Atomic `lateFailure` claim; purchase flow owns failures while `provisioning` <30 min; 10-min sweep (prod) fails stuck builds after 3 h. Reseller orders refunded by the reseller worker; comp/reinstall/legacy never refunded.
- **RDP renewal re-checked every renewal** (`renewalPrice`): live AMD quote in the server's city (base…+15%); **no AMD stock in the city → normal plan price** (`price_source: base_no_stock`, owner decision). Bot auto-renew/reminder/manual renew + reseller `POST /rdp/:id/renew` (`renewal_pricing`, dry_run quote).
- **Stock alerts**: bot "🔔 Notify me when it's back" (`stk:`), Mongo `doStockAlerts`, sent once, quiet expiry 14 days (`js/do-stock-alerts.js`); reseller webhooks `rdp.back_in_stock` / `vps.back_in_stock` to every account with a webhook URL, once per city+plan per restoration (`reseller-webhooks.broadcast`, from `do-stock-watch` hash-swap winner).
- **Preview isolation** (`reseller-api.js`): jobs tagged `env` (preview|production; untagged = production); workers claim only their env; worker OFF when `SKIP_WEBHOOK_SYNC=true` unless `RESELLER_PROVISION_WORKER=true`.
- **Live Linux OS list** (`do-size-catalog.getImages` hourly + persisted; `digitalocean-service.listImages`): DO's own distribution list (Ubuntu 26.04/24.04/22.04, Debian 13, Alma 10/9/8, Rocky 10/9/8, CentOS Stream 10/9, Fedora 44/43); retired Debian 12 / Fedora 42 gone; GPU images excluded; default Ubuntu 24.04. `requires_ssh_key` for Fedora/CentOS/AlmaLinux/Rocky → `POST /vps` without ssh_keys = 400 `ssh_key_required` (nothing charged); reinstall to such OS on a key-less server = 400 (before confirm). Bot always attaches a managed key → unaffected.
- **Stock accuracy** (user saw NYC AMD on DO): verified live — DO sells AMD in nyc1+nyc2, NOT nyc3 → we report New York in stock, built in nyc1; Toronto has no AMD. New: `ensureFresh` (catalogue ≤ ~2 min old before every stock answer/quote/charge, bot + API; `?refresh=true`), `GET /rdp/availability` `datacenters:[{datacenter, plans_in_stock}]`, `catalog.age_seconds`, honest RDP fast-deploy ETA (golden image must be in the BUILD datacenter → New York is ~45 min until the golden image is transferred to nyc1; transfer starts on the first order).
- Docs `/apidoc`: Stock guide (+ "Linux images & SSH keys" card), OS endpoints, errors `ssh_key_required`/`out_of_stock`, What's new.
- Tests: `js/tests/test_late_refund_stock_alerts_2026-10.js` 99/0; regressions all green (stock 80, nvme 16, plan-change 28, golden 93, phase1 20, phase4 40, checkout 60, discount 15, grace-destroy 73, dup-guard 10, vps-terms 27, vps-gone 31, api-grace 40; jest 86/86); testing agent iteration_83 100%.
- **PENDING (user):** Save to GitHub → deploy. Backlog: proactively transfer RDP golden images to fallback datacenters (nyc1/nyc2) so New York RDP is ~3 min again; optional bot hint for SSH-key-only OS.

## 2026-10-14 — DO RDP/VPS live stock: AMD-only RDP, same-city fallback, pre-payment out-of-stock gate, refund-safe reseller lifecycle — CODE DONE & TESTED (local only; user deploys)
- Incident: prod RDP order in nyc3 failed with DO 422 (static `s-4vcpu-8gb-intel` not sold there). RCA: `memory/RDP_NYC3_SIZE_UNAVAILABLE_RCA_2026-10-14.md`.
- **RDP = Premium AMD only** (owner decision): Intel + Basic-regular sizes removed everywhere, never a fallback. Live DO catalogue `js/do-size-catalog.js` (GET /v2/sizes + /v2/regions every 15 min, Mongo `doSizeCatalog` last-good copy, 422 "refused" marks 30 min). Spec match (vCPU, RAM, disk ≥ plan), requested DC first then same-city DCs (nyc3→nyc1/nyc2), same-spec AMD size up to +15% DO cost allowed and PASSED ON in the quoted price (`regionSurcharge`/`surcharge_usd`); build never exceeds the quoted `maxDoCost`.
- **VPS**: same exact size in a same-city DC, else out of stock (never another CPU type).
- **Bot**: stock gate before the payment screen and again before wallet debit → `vpsOutOfStock` screen (`vp.planOutOfStock`, 4 langs, "not charged" + cities with stock). RDP notices never say "VPS" (`asKind`/`isRdpRecord`).
- **Reseller API**: `GET /rdp/availability`; `/rdp/plans` lists sold-out plans (`in_stock:false`); POST 409 `out_of_stock` + `available_regions`, nothing charged. Jobs stay `awaiting_provider`/provisioning until the server is up with an IP → `rdp.provisioned`; failure/timeout → cancel + refund + `*.provision_failed` (`reason_code`, `refunded:true`). Jobs carry `buildHost` so only the host that built them judges them (preview pod shares the prod jobs collection).
- **Admin alerts**: `js/do-stock-watch.js` (out of stock / back in stock / catalogue unreachable; one pod only). Docs: `/apidoc` updated + changelog entry.
- Tests: new `js/tests/test_do_stock_amd_fallback_2026-10.js` 80/80; regressions golden 93, plan-change 28, checkout-math 60, grace 40 (converted to in-process), vps-gone 31, nvme 16, discount 15, vps-terms 27, dup-guard 10 — all green; testing agent iteration_82 100%. ~25 other suites fail identically on untouched HEAD (pre-existing, unrelated).
- Known gaps listed here were CLOSED in 2026-10-14b (late refunds, renewal re-check, preview job isolation).
- **PENDING (user):** Save to GitHub → deploy.


## 2026-10-13b — BulkSMS ENABLED in production (both bots) + v2.8.0 notice to all users — DONE (live); 1 follow-up deploy pending
- User redeployed both bots (app-main 9904415 @16:50Z, app-wl 78b2948 @16:54Z) → both serve their own 2.8.0 APK (`/sms-app/download/info`: Nomadly SMS @NomadlyBot / Smadav SMS @smadavv_bot).
- PROD env (backups `backend.env.bak.smsapp.20261013T165316Z`): `HIDE_SMS_APP=false` on app-main + app-wl (BulkSMS menu + BulkSMS promo themes back). app-wl `CF_DISCOVERY_SYNC=true` again (backup `.bak.cfsync-on.*`); new brand-keyed code logged "already in sync for brand=smadav"; Worker still v2 (nomadly 2.speechcue.com / smadav 1.smadavspeech.com).
- Smadav: v2.8.0 notice broadcast to ALL users (job bcast_1791910507356_79dwz8: 201 targeted, 174 delivered, 27 dead).
- Nomadly: app-main booted the new code BEFORE the env flip (HIDE_SMS_APP was still true) → notice went only to the 38 app users (34 delivered). Code now supports a scope upgrade: `appAnnouncements.sms_app_version {scope:'app-users', notifiedIds}` → when BulkSMS is visible the next boot broadcasts to everyone else (`sendMessageToAllUsers(..., {excludeIds})`). Prod Nomadly doc PATCHED to scope 'app-users' + the 38 ids → **the next app-main deploy sends the notice to the other ~930 Nomadly users** (no duplicates). Docs without `scope` = legacy all-user broadcast → skipped.
- Notice copy reworked for all users (what the app does, where BulkSMS is in the menu, "already have the app? uninstall old first", direct link, brand bot handle resolved after getMe; brands.json fallback for the bot handle).
- Tests: `js/tests/test_sms_app_announcement_scope_2026-10.js` 8/8 (isolated DB, stub bot), `test_sms_app_brand_resolution_2026-10.js` 25/25.
- **PENDING (user):** Save to GitHub → redeploy app-main (and app-wl) to ship the scope-upgrade + new copy; then the Nomadly all-users notice goes out automatically.

## 2026-10-13 — BulkSMS app RCA + per-brand APKs (Nomadly / Smadav) + web white-label — DONE (prod hotfix LIVE; code awaiting Save-to-GitHub → redeploy)
- **Root cause (confirmed live):** the shared Cloudflare discovery Worker `nomadly-api-config.nomadly-cfg.workers.dev` (baked into every APK) served ONE `apiBase` and BOTH prod bots overwrote it on every restart (`CF_DISCOVERY_SYNC=true` on app-main and app-wl). Last write 2026-10-13 16:15Z by app-wl → every Nomadly APK was talking to Smadav's server (1.smadavspeech.com) → "invalid code / stuck on login / campaigns never arrive". Both bots also served the same Nomadly-branded 2.7.5 APK.
- **PROD HOTFIX (done, verified):** Worker re-pushed brand-keyed v2 `{apiBase: 2.speechcue.com (pre-2.8 APKs), brands:{nomadly: 2.speechcue.com, smadav: 1.smadavspeech.com}}` (source in `ops/nomadly-api-config-worker.js`); app-wl `/opt/nomadly/shared/app-wl/backend.env` `CF_DISCOVERY_SYNC=false` (backup `.bak.cfsync.20261013T163411Z`), `pm2 reload app-wl-a`, healthy, log shows sync disabled. app-main old code sees apiBase == its URL → no-op.
- **APK 2.8.0 (both brands, `scripts/build_apk.sh [nomadly|smadav]`):** `sms-app/www/js/api.js` now uses the brand's baked server FIRST (probe `GET /sms-app/config`), Cloudflare discovery only as a backup reading `brands[slug]` (smadav never falls to Nomadly); failures not memoised. Builds `static/{nomadly,smadav}-sms.apk` (+ `.json` manifest incl. apiBase), distinct appIds com.nomadly.sms / com.smadav.sms. Build script stage 8 now really restores Nomadly sources (old `git checkout` silently failed on untracked brand.js).
- **Server:** `cloudflare-discovery-sync.js` merges only its own brand key and never PUTs blind (skips when the current payload can't be read). `sms-app-service.js` version notice: once per version per bot DB; with `HIDE_SMS_APP=true` goes ONLY to SMS-app users (loginCountOf app logins + campaign owners), includes the direct brand download link; Smadav copy tells users to uninstall the old "Nomadly SMS" app.
- **Web white-label:** `useBrand()` (/api/store/config + /api/brand/{mark,wordmark}.png per CHAT_BOT_BRAND) in Storefront/PanelLogin/PanelDashboard (header was hardcoded "Nomadly Hosting" → `{brand} Hosting` + BrandMark), DomainList + GeoManager bot links; no "HostBay" left on customer pages. Panel: raw `<!DOCTYPE html>` cPanel-auth error → friendly `errors.cpanelAuthIssue` (4 langs).
- **SESSION_SECRET warning:** `cpanel-auth.js` / `cpanel-migration.js` self-load `backend/.env` when required standalone (prod already had the secret; warning came from scripts/tests).
- Tests: `js/tests/test_sms_app_brand_resolution_2026-10.js` 25/25; testing agent iteration_81 backend+frontend 100%.
- **NEXT (user):** Save to GitHub → redeploy app-main + app-wl. After redeploy each bot sends the 2.8.0 notice to its app users. Optional later: re-enable `CF_DISCOVERY_SYNC=true` on app-wl (new code is brand-safe).

## 2026-06 — DigitalOcean VPS/RDP grace capped to 2 days + manual domain renewal (POST /domains/:domain/renew) — CODE DONE & self-tested (sandbox; awaiting Save-to-GitHub → redeploy)
User asks: (1) make the DO VPS/RDP lifecycle match the docs but CAP the grace period to 2 days (48h), reflected via the reseller API, webhooks and /apidoc; (2) wire the missing manual on-demand domain renewal path so expired / soon-to-expire domains can be renewed without waiting for the 7-day auto-renew sweep. Provider scope narrowed by user to DigitalOcean only (`digitalocean` VPS + `digitalocean-rdp`).
- **Grace cap = 2 days / 48h** (`js/rdp-grace-lifecycle.js`): `GRACE_DAYS = Number(RDP_GRACE_DAYS || 2)`; shared DI state machine drives BOTH DO Linux VPS and DO Windows RDP (caller passes `product:'vps'|'rdp'` + per-product msgKeys). `grace_until = end_time + 2d`; power OFF at grace entry; final reminder 24h before deadline; DESTROY at deadline; a renewal clears grace + powers the box back on. Emits `<product>.grace_start` (payload: expired_at, delete_at, grace_hours:48) and `<product>.deleted`.
- **Scheduler** (`js/_index.js` Phase 2-DO ~37404): `_isGraceManaged = _isDoRdp || _isDoVps`; DO VPS+RDP are excluded from the old immediate 0-grace destroy (Phase 2/3) and routed through the shared 2-day grace pass (`VPS_GRACE_DAYS`/`rdpGrace.GRACE_DAYS` both default 2). Phase-1 suppression fix: the "don't double-emit a grace_start" guard now checks `!_isGraceManaged(vpsPlan)` (previously only `!_isDoVps`), so DO-RDP no longer emits a wrong `vps.grace_start` before the correct `rdp.grace_start`. powerOff → `provider.stopInstance` (DO power_off), destroy → `deleteVPSinstance`.
- **RDP service** (`js/digitalocean-rdp-service.js`): `graceDays` default 2; safety-net sweep `processExpiries()` powers expired servers into the 2-day grace and emits `rdp.grace_start` with `grace_hours: graceDays*24` (=48).
- **Manual domain renewal** (`js/reseller-api.js` ~2717): `POST /domains/:domain/renew {years?:1..10, dry_run?}` — OpenProvider-only (others 501 `not_supported`), owner-scoped (404 if not yours), price via `opService.getRenewPrice`×years, wallet-billed via `billedProvision` (402 insufficient / 502 pricing_failed / 502 provisioning_failed+refund), calls `opService.renewDomain`, extends `domainsOf.expiresAt`, increments renewalCount, emits `domain.renewed`. `dry_run:true` returns price + balance with zero charge. Works before expiry AND inside the registrar recovery window.
- **Docs + i18n**: `/apidoc` scrubbed of all stale 72h/3-day DO VPS/RDP grace wording (now 2-day/48h) and the stale "live domain renewal not yet wired / 501 not_implemented" error-row rewritten (on-demand renewal is OpenProvider-only → `not_supported`); domain-renew endpoint + `years` param documented. Locale grace strings reworded to 2-day in all 4 langs; Hindi+Chinese gained the missing `vpsGraceStart/vpsGraceReminder/vpsDeletedAfterGrace` keys (parity with en/fr).
- **Testing (safe, no prod touch — this pod's reseller API is LIVE against the PROD reseller DB so live HTTP renew tests are unsafe)**: grace state-machine suite `js/tests/test_rdp_grace_destroy_2026-06.js` 73/73; VPS-product path inline check (GRACE_DAYS=2, 48h window, `vps.grace_start` w/ grace_hours:48 + expired_at/delete_at, `vps.deleted`, `t.vpsGraceStart/t.vpsDeletedAfterGrace` msgKeys) all OK; new DI harness `js/tests/test_domain_renew_route_2026-06.js` 22/22 mounts the REAL reseller router against an ISOLATED local test DB with a stubbed OpenProvider (401/400/404/501, dry-run pricing + years clamp 1..10, live charge+expiry-extension+order record, 402 insufficient, 502 pricing_failed); 24/24 VPS/RDP grace locale strings render with no stale 3-day/72h wording; live `/apidoc` HTTP 200 with 0 not_implemented / 0 72h-3day refs; reseller health = ok.
- Files: `js/rdp-grace-lifecycle.js`, `js/_index.js`, `js/digitalocean-rdp-service.js`, `js/reseller-api.js`, `js/reseller-webhooks.js`, `js/apidoc-page.js`, `js/lang/{en,fr,hi,zh}.js`. Tests: `js/tests/test_domain_renew_route_2026-06.js` (new), `js/tests/test_rdp_grace_destroy_2026-06.js`.
- ⚠️ Sandbox-only — needs "Save to GitHub" + redeploy (app-main/app-wl). Live end-to-end (real DO power-off/destroy, real OpenProvider renew) only exercisable on a production pod. Unrelated operational note: `/apidoc` render still logs `SESSION_SECRET not set` (cPanel password encryption uses a random key across restarts) — not touched here.


## 2026-06 — Anti-Red "Security Check" loop fix + SecurityPanel CF state + Geo parse + reseller Geo doc — CODE DONE (sandbox; awaiting Save-to-GitHub → redeploy + Worker push)
User tasks: (1) make the reseller API doc clearly say Geo is Golden-only; (2) fix all handoff issues (P0 Security-Check loop on bylinebank.capital, P1 SecurityPanel CF state, P2 GeoManager parse, P2 captcha dual source of truth).
- **P0 — endless "Security Check" (CF Worker PoI loop)** `js/anti-red-service.js` (worker template): the proof-of-interaction nonce was `HMAC(secret,"poi_"+visitorIP+"_"+minute)` and `/__ar_verify` also hard-gated the client-supplied timestamp `t` to ±60s. Real humans looped forever whenever their IP changed between page-load and click (mobile carrier NAT, IPv4↔IPv6 Happy-Eyeballs, VPN) OR their device clock was off >60s. FIX: nonce is now bound ONLY to a server-side minute window (`hmac('poi_'+poiMinute)`, IP-independent); `/__ar_verify` ignores the client `t`, computes the window from OUR clock, and accepts the last 5 one-minute windows. Scanners still blocked (they don't load+click). Proven: Node Web-Crypto unit test — IP-change PASS, 3-min-late click PASS, 7-min stale REJECT, forged/missing REJECT. Worker script still `node --check` clean; `test_antired_p0_p1_improvements` 22/22, stealth 1/1, scanner-redirect 1/1.
- **P1 — SecurityPanel JS-Challenge badge wrong on CF domains** `/security/status` (cpanel-routes.js) + `SecurityPanel.js`: `jsChallenge` was read from `isJSChallengeEnabled()` (origin `.antired-challenge.php`), but on CF domains that file holds the IP-fix (confirmed in Railway logs: "CF IP Fix deployed … replaces JS challenge"), so the badge showed Inactive while the Worker captcha was live, and toggling rewrote the PHP challenge and fought the heartbeat. FIX: status now returns `domain` + `hasCloudflare` and, for CF domains, derives `jsChallenge` from `(cfWorkerActive && !visitorCaptchaOff)`; the Security-tab toggle now drives `/security/captcha/toggle` (same worker path as the Domains tab) on CF domains and only uses the PHP toggle for non-CF/origin domains.
- **P2 — GeoManager shows "0 countries"** `GeoManager.js parseExpression`: regex only matched legacy `ip.geoip.country eq "US"`. `cf-service.createGeoRule` now writes `(ip.geoip.country in {"US" "GB"})` / allow `(not (…))`. FIX: `isAllow` = `/\bnot\b/`, codes = every quoted alpha-2 — handles BOTH forms + allow/block. Unit-tested 5/5.
- **P2 — captcha dual source of truth** (`val.visitorCaptchaOff` in Mongo + `bypass:{domain}` in CF KV): consolidated into a single writer. `setDomainChallengeBypass(domain, bypass, db)` now writes the KV key AND mirrors the Mongo flag together; the 3 panel/reseller toggle handlers (js-challenge, captcha, reseller visitor-captcha) delegate to it (no more separate inline Mongo writes) so edge + DB can't drift.
- **Doc** `js/apidoc-page.js`: the `/hosting/:user/geo` entry now states "GOLDEN PLAN ONLY — list, create and delete all … return 403 gold_only on any other plan" + documents the rule expression forms. (/apidoc already gold-gated the routes via `goldBlocked`; this makes the doc explicit.) /apidoc HTTP 200 verified.
- **Live-log finding**: the Railway service `Nomadly-EMAIL-IVR` (zippy-radiance) is DORMANT — newest log 2026-09-28T17:02Z; current production runs on the DigitalOcean droplet (PM2). The Security-Check loop is an EDGE-only phenomenon (CF Worker /__ar_verify), so it never appears in origin (Railway/droplet) logs by design — confirmation needs CF Worker `wrangler tail` or a live click-flow against the domain. Railway history did confirm the architecture (antired-challenge worker; CF IP-fix replacing the JS challenge on CF domains → validates the P1 root cause).
- **Test guards refreshed to the new single-source-of-truth architecture (now fully green)**: the bot (`_index.js`) and the panel `/security/captcha/status` read captcha on/off via `resolveDomainCfState(...).isOff` (anti-red-service.js:2499 OR-checks `visitorCaptchaOff` + legacy `antiRedOff`), so the old inline-expression guards were stale. Updated `tests/test_captcha_status_endpoint.js` A1-A3 (assert the route delegates to `resolveDomainCfState` + the helper OR-checks both flags) and `tests/test_visitor_captcha_hardening.js` B.7a/B.7b likewise; C.1/C.3 already updated for the single-writer. Result: status endpoint 18/0, hardening 50/0, captcha-toggle-addon 6/6, worker suites all pass.
- **Single source of truth ≠ single endpoint** (clarified in `/apidoc`): the per-domain Visitor Captcha toggle (`POST /security/visitor-captcha`), the primary-domain JS-Challenge toggle (`POST /security/js-challenge`), the HostPanel and the Telegram bot all control the SAME Worker-served "verify your browser" challenge and now flow through ONE writer (`setDomainChallengeBypass`), which writes the Cloudflare KV `bypass:{domain}` key and the Mongo `visitorCaptchaOff` flag together in lockstep. The two reseller-API endpoint docs now state this explicitly so integrators know the surfaces never drift.
- Files: `js/anti-red-service.js`, `js/cpanel-routes.js`, `js/reseller-hosting-mgmt.js`, `js/apidoc-page.js`, `frontend/src/components/panel/GeoManager.js`, `frontend/src/components/panel/SecurityPanel.js`, `tests/test_visitor_captcha_hardening.js`. ⚠️ Sandbox-only — needs "Save to GitHub" + redeploy; the Worker PoI fix also needs the hardened worker PUSHED to Cloudflare (next `deploySharedWorkerRoute` / startup upgrade on a production pod) to reach bylinebank.capital.



## 2026-06 — Bot UX structural pass (menu IA, Membership rename, VPS affordability, shortener) — DONE (sandbox; awaiting Save-to-GitHub → redeploy)
The 4 deferred structural items from the ease-of-use audit, implemented across all 4 languages and verified via mock-Telegram sandbox + regression crawl (91 screens, 0 issues, 0 duplicate menus) + unit suites (checkout 143/143, nav-escape 109/0, kb/i18n 21/21, untranslated clean). Env restored, 44 sandbox docs cleaned.
- **Main menu simplified** (`js/lang/{en,fr,hi,zh}.js`): grouped into clear sections and trimmed from ~18 top-level buttons to 7 rows of two + a new **➕ More**. Rows now: Cloud IVR | Hosting · Domains | VPS · BulkSMS | SMS Leads · Digital Products | Marketplace · URL Shortener | Virtual Card · Wallet | Membership · Settings | Support · More. Secondary services (Email Validation, Refer & Earn, Reseller, Join Channel, Email Blast) moved into the **➕ More** submenu (new handler in `js/_index.js`; `more` key added to each lang's `user` dict and to `menuEscapeLabels`). All handlers match by label, so routing is unchanged; conditionals (VPS_ENABLED, HIDE_SMS_APP, HIDE_BECOME_RESELLER, EMAIL_BLAST_ON) preserved.
- **Legacy "⚡ Upgrade Plan" renamed → "⭐ Membership"** (`buyPlan` in all 4 langs + all copy literals in en.js and the 4-lang expiry reminders in `js/_index.js`). The hosting-specific `⬆️ Upgrade Plan` (`upgradeHostingPlan`) is deliberately untouched. `message === user.buyPlan` handlers unaffected (match by variable). Verified: tapping ⭐ Membership opens Daily/Weekly/Monthly as before.
- **📋 My Plans** (`planNotSubscriped` copy, all 4 langs): the empty-state message now explains what will appear (Hosting, Cloud IVR, VPS, Membership) instead of a bare "not subscribed". Confirmed the aggregator (`_index.js:~34167`) already lists owned Hosting/IVR/VPS/bundle — seeded a phone number and verified My Plans shows it (so the audit's "says not subscribed while owning a number" is not reproducible with current code).
- **VPS wallet shortfall surfaced earlier** (`_index.js` askVpsConfig handler): the plan-list screen already shows a wallet-vs-price affordability footer; added a reinforcing heads-up the moment a plan is selected ("…you'll top up $X at checkout") for under-funded users, before the coupon/OS/SSH steps. All 4 langs.
- **Custom Domain Shortener** (`_index.js` `choose-url-to-shorten`): now checks branded-domain availability BEFORE asking for the URL. No-domain users get an upfront explanation + buttons (🌐 Bulletproof Domains · 🔗 URL Shortener · 🏠 Main Menu) instead of typing a URL then hitting a "buy a domain" dead-end. Domain owners keep the normal URL-first flow (verified). The shortener domain list is purchase-gated (`getPurchasedDomains` reads `domainsOf`, written only on successful registration) + shared admin pool — no searched-domain state leak reproducible.


## 2026-06 — Bot UX ease-of-use pass ("is the bot understandable end-to-end?") — DONE (sandbox; awaiting Save-to-GitHub → redeploy)
Acting on the end-to-end UX audit. All fixes verified via local mock-Telegram sandbox (js/tests/mock_telegram_api.js on :5099) + journey crawl (0 issues, 0 duplicates) + unit suites (checkout 143/143, kb-i18n 8/8, i18n 13/13, nav-escape 109/0, ai-support). Env restored (TELEGRAM_API_BASE_URL removed), 75 sandbox chats cleaned.
- **Natural-language intent routing** (`js/_index.js` master fallback, base-state only): typing "i want to buy a domain" / "buy vps" / "deposit" etc. now points to the exact main-menu button (all 4 langs) instead of the generic "that option isn't available". Questions still route to the existing cold-start AI (which answers + shows quick-action buttons); statements hit the new guide. Never fires mid-flow (so domain names / amounts aren't hijacked).
- **AI run-on formatting FIXED (root cause)**: `js/sanitize-provider.js sanitizeUserText` did `.replace(/\s{2,}/g,' ')` which collapsed ALL whitespace incl. newlines → every AI list/paragraph rendered as one run-on line. Now collapses only spaces/tabs, trims around newlines, caps blank lines at one. Provider-name stripping unchanged (verified). Also added a prompt rule (`js/ai-support.js`) to put each list item on its own line.
- **Support "dead-end" FIXED**: AI-support keyboards + the 💬 Support entry now show `[/done, 🏠 Main Menu]` (was `/done`-only). `/help|/start|/menu|/home|/orderhistory|/orders` and 🏠 Main Menu now ESCAPE support mode (previously swallowed by the hour-long recent-session AI). `/help` escape verified.
- **Marketplace duplicate "🏠 Main Menu" FIXED (systemic)**: `js/lang/en.js kOf` didn't recognise the literal `↩️ Back` (handlers use ↩️, but `t.backButton`='⬅️ Back'), so it auto-appended `['🏠 Main Menu','Cancel']` on top of a handler-supplied `['↩️ Back','🏠 Main Menu']`. Fix: if the list ALREADY contains '🏠 Main Menu', append nothing. All other kOf branches preserved (verified all 5 cases).
- **Payment-label clarity**: hosting/domain/leads/bundle checkout (`js/hosting-checkout-ux.js walletSummary`) now shows a legend when short — "💵 Deposit tops up your wallet, then pays. ₿ Crypto pays the full amount directly." Digital-products + virtual-card order summaries got a concise always-accurate equivalent.
- **Copy consistency / stale labels**: `/help` (host_5) refreshed to the full current product set (Cloud IVR, VPS/RDP, Marketplace, Virtual Card, BulkSMS…); "Get Support" → "Support" everywhere (the button is literally `💬 Support`); `joinChannel` bare "Please Join Channel <link>" → contextual message; domain-shortener prompt reworded + wrong "🔧 Manage Domains" → "📂 My Domain Names"; Virtual-card `vps_49` escaped `you\'d` → `you'd`; Toll-Free label `🆓` → `📞` (toll-free isn't free to buy) in all 4 langs (phone-config.js).
- Files: `js/_index.js`, `js/lang/en.js`, `js/phone-config.js`, `js/ai-support.js`, `js/hosting-checkout-ux.js`, `js/sanitize-provider.js`. Test driver: `scripts/ux_test_2026-06.js`.
- DEFERRED (need a product decision, noted as next steps): main-menu IA (18 buttons) simplification/grouping; rename/clarify the legacy `⚡ Upgrade Plan` + `📋 My Plans` ownership confusion; bring the VPS wallet-shortfall forward (currently many steps before affordability); URL-shortener state-leak (shows a searched-but-unpurchased domain).



## 2026-06-?? — Reseller weekly→monthly upgrade audit + MAXADDON drift fix (changePackage) — CODE DONE (sandbox), 1 live account repaired
- AUDIT (user ask: "did a recent weekly hosting upgrade apply at WHM + reseller DB?"): the one recent weekly→monthly API upgrade = `nameaf15` (namewords.sbs, chatId 5590563715), 2026-10-11 12:02, Premium Anti-Red (1-Week)→Premium HostPanel (1-Month), charged $45.12, credit $29.88. Reseller DB (cpanelAccounts) correct: plan, renewalPriceUsd 75, termMonths 1, fresh 30d expiry 2026-11-10, planChangeHistory `completed` via:api, order `provisioned`. WHM correct: package=Premium-Anti-Red-HostPanel-1-Month, MAXSQL=5. ⇒ DB↔WHM match ✅.
- BUG found: `nameaf15` had WHM `maxaddons=unlimited` (should be 5). Root cause: all 3 WHM packages are defined MAXADDON=unlimited; the system enforces caps via PER-ACCOUNT overrides set in `createAccount` (14/15 Premium-Monthly accts correctly =5). `whm-service.changePackage` only re-applied MAXSQL after `/changepackage`, NOT MAXADDON — so WHM's package-template reset left the upgraded account unlimited. Only `nameaf15` (the sole upgraded-via-changePackage acct) drifted.
- FIX (`js/whm-service.js changePackage`): after `/changepackage`, one `/modifyacct` now re-applies BOTH MAXSQL and MAXADDON from PLAN_MYSQL_LIMITS/PLAN_ADDON_LIMITS (Weekly 2/1, Premium 5/5, Golden unlimited/unlimited), mirroring createAccount. Test `js/tests/test_whm_changepackage_maxaddon_2026-06.js` 7/7 (stubbed axios, per-tier).
- LIVE REPAIR (prod WHM, done now): `js/ops/whm_repair_nameaf15_maxaddon_2026-06.js` → modifyacct MAXADDON=5 on nameaf15, verified maxaddons=5. Ops read-only scripts: `verify_weekly_upgrade_2026-06.js`, `whm_pkg_addon_inspect_2026-06.js`.
- ⚠️ Code change is SANDBOX-ONLY — needs "Save to GitHub" + redeploy (app-main/app-wl) so future upgrades enforce MAXADDON. The nameaf15 account repair is already live on prod WHM.


## 2026-10-10f — Hosting capabilities audit (WordPress / PHP / static JS apps / Node.js) — DOCUMENTED, nothing changed
- Full details + roadmap: /app/memory/HOSTING_CAPABILITIES_2026-10.md (read it before promising stack support to customers/resellers).
- YES: HTML5/static + PHP 8.2/8.3 (all plans). PARTIAL: WordPress (manual install, monthly plans only; Weekly has 0 DBs) and React/Vite/Vue/Next static exports. NO: Node.js server apps (no Node/Passenger, no shell).
- Known gap: anti-red deployHtaccess overwrites public_html/.htaccess → drops WordPress permalinks + SPA fallback rules on every redeploy.
- BACKLOG (in order): P1 preserve user/WordPress/SPA .htaccess blocks → P2 one-click WordPress in HostPanel → P3 Node.js app hosting (EA4 ea-nodejs + Passenger + HostPanel tab).
- 2026-10-10: reseller (hosta.sh) feature requests documented in /app/memory/RESELLER_FEATURE_REQUESTS_2026-10-10.md. ONE merged priority list = /app/memory/ROADMAP.md (source of truth for "what next").


## 2026-10-10c — Renewal Price Check on bot upgrade confirm screens — DONE (sandbox; awaiting Save-to-GitHub → auto-deploy)
- Hosting "Confirm Upgrade" screen (a.confirmUpgradeHosting) now shows "🔁 Renews at: $X every 30 days (auto-renew on)" + "📅 Next renewal: <today+30d> — a new 30-day term starts today", using the SAME getPlanPrice(selected.name) + 30-day term the pay step saves. Whole screen translated en/fr/hi/zh (new t.upgradeConfirm* keys; reuses walletBalanceLabel, renewModalConfirmHint/Insufficient/PayButton). Localized dates (UTC).
- Upgrade success message adds "Renews at: $X every 30 days" (message itself still English-only).
- VPS/RDP vp.doPlanSummary(…, end) shows "Next renewal: $X on <term end>" in all 4 langs (info.doPlanTermEndsAt saved from planOptions().term_ends_at; no date → price only).
- BUG FIX found on the way: hosting RENEW + UPGRADE pay handlers matched startsWith('💵 Pay') → hi ('💵 $X USD भुगतान करें') / zh ('💵 支付 $X USD') pay taps were ignored. Now startsWith('💵') (Deposit is '➕💵…', not matched).
- Tests: js/tests/test_upgrade_renewal_preview_2026-10.js 33/33; regressions 23/23, 17/17, 28/28, i18n pass; testing agent iteration_73 100%; E2E via mock Telegram (en/hi/zh confirm screens, hi/zh pay taps recognised, Deposit not treated as Pay).
- LESSON: never run parallel search_replace edits on the SAME file — it truncated _index.js to 73 lines (restored via git checkout).

## 2026-10-10d — Translated hosting upgrade receipt + upgrade failure messages — DONE (sandbox; awaiting Save-to-GitHub → auto-deploy)
- "Plan Upgraded Successfully" receipt fully translated en/fr/hi/zh (new t.upgradeSuccessTitle/OldPlan/NewPlan/NewExpiry/Footer; reuses domainLabel, chargedLabel, remainingBalanceLabel, upgradeConfirmListPrice/Credit/RenewsAt). Localized expiry date (UTC); footer per plan key (Golden = unlimited domains, Premium = up to 5 addon domains).
- Upgrade failures translated: t.upgradeFailTerminated (now also states the refund + points to the real localized hosting menu button), t.upgradeFailReactivate, t.upgradeFailServer (raw WHM reason kept in italics). They name the real localized Support button (user.getSupport) instead of the non-existent "💬 Get Support".
- hi remainingBalanceLabel fixed: 'शेष शेष राशि:' → 'शेष बैलेंस:' (also used by the renew receipt).
- Verified E2E (mock Telegram + local stub WHM, throwaway chats, cleaned up): fr weekly→Golden $100 charged once, renewalPriceUsd 100, expiry +30d; hi Premium→Golden $62.50 w/ credit; zh terminated → refunded; en unsuspend fail → refunded; fr server rejected → refunded. Suite now 54/54; i18n coverage pass.
- Still English: the RENEW flow's "terminated" message (_index.js ~17064) and the plan-details view dates (en-US).

## 2026-10-10e — P0 RCA: hosting teardown deleted a LIVE account's DNS (namewords.sbs / name65fb) — FIXED in code; prod restored
- See /app/memory/RCA_namewords_dns_teardown_2026-10-10.md. Root cause: all 12 teardown sites deleted worker routes + web DNS by domain name. Reseller DELETE of a failed duplicate (nameb594) wiped name65fb's tunnel CNAMEs on 2026-10-08 12:29:50.
- PROD: CNAMEs restored + verified; audit of all live accounts (Nomadly 14, WL 12) found 0 others affected.
- Code: js/hosting-dns-teardown.js teardownHostingDomain (skip when another live account (not deleted / not failed / not terminatedOnWhm) uses the domain as primary or addon; excludeId only for whole-account teardowns); js/hosting-dns-repair.js; POST /hosting/:user/dns/repair (dry_run supported); anti-red/deploy returns `dns`; DELETE returns `cloudflare_cleanup[]`; addon unlink returns cloudflare_skipped; findOwnedAccountByDomain skips failed records; suspend sets suspendedAt/By/Reason; plan-change history legacy = !billing; API docs updated.
- PENDING after deploy: delete failed name1d6a + name303c on prod through the guarded path, then re-verify namewords.sbs DNS. → CLOSED 2026-10-10: deployed; the reseller deleted both (cloudflare_cleanup = kept_in_use_by_another_account); apex + www still resolve.


## 2026-10-10b — Plan Change History API + bot hosting-upgrade renewal-price fix + admin repair — DONE (sandbox; awaiting Save-to-GitHub + redeploy)
- Reseller API: GET /plan-changes (account-wide; filters product=hosting|vps|rdp (comma list), since, until, status=completed|failed|running, via=api|bot; limit 1-200 + opaque cursor; total/has_more/next_cursor) + per-item GET /hosting/:user/plan-changes, /vps/:id/plan-changes, /rdp/:id/plan-changes. Owner-scoped (chatId), deleted/terminated resources included. Builder: js/plan-change-history.js.
- Recording: VPS/RDP engine now pushes FAILED (refunded) attempts to planChangeHistory too (status, reason, refund_usd) and richer completed entries (names, renewal price, started_at). Hosting API entries get id/status/renewal_price_usd. Bot hosting upgrades now push a full entry (via 'bot', billing 'new_term', loyalty_credit_usd). Legacy data (hosting upgradedAt/downgradedAt, VPS last failed planChange) → legacy:true best-effort entries.
- BUG FIX (user-approved): bot hosting upgrade never updated price-locked renewalPriceUsd → upgraded accounts renewed at the OLD price (weekly $30 → Golden renewed at $30; Premium $75 → Golden at $75). Now sets renewalPriceUsd = getPlanPrice(new plan) + planChangedAt; debit result checked (overdraft-safe).
- ADMIN REPAIR (run ONCE on PROD after deploy): GET /api/admin/hosting-renewal-price-repair?key=<SESSION_SECRET[0:16]> = preview (affected list + total $ difference per renewal); POST same URL + &apply=true (optional body {"usernames":[…]}) = apply. Criteria: upgradedAt set, last upgrade not stamped with planChangedAt (i.e. old bot path), not repaired since, numeric renewalPriceUsd ≠ current plan list price, not deleted/terminated. Compare-and-set, idempotent, admin Telegram summary on apply. Module js/hosting-renewal-price-repair.js. Does NOT refund/charge past renewals.
  - ✅ RAN ON PROD 2026-10-10 (droplet, release 81e65a2): Nomadly (app-main :5100, DB test) 1 affected → ntes392b (testingpagebig.com, chat 6430808218, Premium 1-Week → Golden 30 Days) renewalPriceUsd $30 → $100 applied; re-preview = 0. SMADAV (app-wl :5001, DB smadav) = 0 affected. Note: key must be URL-encoded (curl -G --data-urlencode) — SESSION_SECRET contains URL-special chars. DONE, do not re-run.

- Docs: /apidoc new "Plan Change History" group (#plan-history) + per-item endpoints + "Plan-change history" card in the Plan changes guide.
- Tests: js/tests/test_plan_change_history_2026-10.js (17/17); regressions 23/23, 28/28, i18n pass; testing agent iteration_72: 100%.


## 2026-10-10 — Plan-change rules (hosting / VPS / RDP) + weekly renew cap + race fixes + API docs — DONE (sandbox; awaiting Save-to-GitHub + redeploy)
- Hosting (reseller API): Premium Monthly ↔ Golden Monthly = resources only (upgrade pro-rata (new−old)×days/30, downgrade $0 no refund, expiry NEVER moves). Weekly → Premium/Golden Monthly = monthly price − unused weekly credit (account's locked weekly price × days left / 7) + FRESH 30-day term (billing "new_term"; legacy stacked-weekly safety net: credit > monthly → $0 + credit converted to days ≥ 30). Monthly → Weekly NEVER (hidden from plan-options; POST → 409 weekly_downgrade_not_allowed). Bot hosting upgrade left as-is (upgrade-only, no Golden→Premium) per user.
- Weekly renewals (API + Telegram bot): ONE week at a time (periods>1 → 400 weekly_single_period_only) and only once ≤ 7 days left (→ 409 weekly_renew_too_early + renew_available_at). GET /hosting/:user, GET /hosting, GET /renewals expose renewable:false + renew_available_at. Monthly plans can still prepay up to 12 periods.
- VPS/RDP: in-place DigitalOcean resize on the SAME droplet (id/IP/data kept) — expiry AND term length never change; renewal price = new plan's price for the same term (RDP 1/2/3-month bundle, discount kept); upgrade charge uses 1-month list prices × days/30 (user confirmed). NEW: needs ≥ 1 h left in term (409 term_ending_soon).
- Race fixes: hosting plan-change atomic lock (cpanelAccounts.planChangeLock, 10-min stale takeover, re-quote on locked doc); API + bot hosting renew compare-and-set on {expiryDate, plan} (loser refunded / debit reversed); bot renew now checks the overdraft-safe debit result; hosting scheduler skips locked/changed accounts; VPS auto-renew query skips planChange running/reconciling.
- New webhook: hosting.plan_changed (API path). /apidoc: new "Plan changes" guide (#plan-changes, live prices, worked examples, error table, integration flow, webhook payloads) + updated endpoint docs/error table.
- Files: js/hosting-plan-change.js, js/reseller-api.js, js/reseller-webhooks.js, js/hosting-scheduler.js, js/do-plan-change.js, js/_index.js, js/lang/{en,fr,hi,zh}.js, js/apidoc-page.js. Tests: js/tests/test_hosting_plan_rules_2026-10.js (23/23), js/tests/test_do_plan_change_2026-10.js (28/28), i18n coverage pass; testing agent iteration_71: 100%.
- Known pre-existing failing suites (user: do NOT fix): test_reseller_api_grace_2026-06 (live smoke w/ hardcoded key + old-pod fixtures), test_cancellation_flows (provider default → OVH + shared fake collection), test_reseller_site_status_2026-06 (assumes SKIP_WEBHOOK_SYNC toggles dry-run).
- ⚠️ Sandbox note: vault sets RESELLER_API_LIVE=true → this pod's reseller API is LIVE against real DO/WHM (harmless while local DB has no API keys).


## 2026-10-08 — OPS: OpenProvider registrant / service email cloakhost@tutamail.com → gidineter@gmail.com (PROD, both bots) — DONE & verified
- Why: @ricodeljalisco's ccTLD domain (nationalbcverifservicesonetimelink.ch) was orphaned at OpenProvider (code 320, not in account) because the registrant/service email cloakhost@tutamail.com was unmonitored, so registry contact-validation never completed. Monitored gidineter@gmail.com now used so future .ch/.it/… validations pass.
- Code (sandbox, awaiting Save-to-GitHub + redeploy): `js/op-service.js` SERVICE_EMAIL default → gidineter@gmail.com (no cloakhost literal, SERVICE_EMAIL exported); test `js/tests/test_op_service_email.js` 3/3.
- Env (source of truth): sandbox `backend/.env` NOMADLY_SERVICE_EMAIL + SINGAPORE_ADMIN_EMAIL = gidineter; vault `memory/nomadly.vault.enc` re-locked (0 cloakhost).
- Production (DO droplet 146.190.238.190): replaced both vars in `/opt/nomadly/shared/{app-main,app-wl}/backend.env` (backups `.bak.cloakhost.20261008T200337Z`), zero-downtime blue/green reactivation of the current release per app (app-main-a:5000, app-wl-b:5101), both /health 200, dotenv confirms gidineter on both apps. The hardcoded `|| 'cloakhost...'` fallback still exists in the deployed op-service.js but is now dead (env overrides); removed on next redeploy.

## 2026-10-07 — DigitalOcean NVMe VPS plans (Premium AMD + Intel) + live stock filter — DONE
- User asked if reseller VPS on DO is SSD-only (yes, it was). User choices: add BOTH Premium AMD + Intel, ALL available sizes, same 200% markup (×3); Telegram bot ALSO gets an NVMe/SSD choice; out-of-stock plans HIDDEN using DO live availability refreshed hourly.
- `digitalocean-service.js`: `PRODUCT_CATALOG_NVME` = 24 plans (9 `s-*-amd` + 15 `s-*-intel`, incl. Intel extra-disk sizes), name `NVMe <AMD|Intel> <c>vCPU/<r>GB/<d>GB`, diskType `nvme`, `do_size_slug`, tier = price order. Regular 6 `s-*` SSD plans unchanged. Prices EU: $21 … $576/mo.
- Live stock: `refreshSizeAvailability()` (GET /v2/sizes, on load + every 1h, skipped when NODE_ENV=test; logs price drift), `isProductAvailable()`, `listProducts(region, isWin, 'ssd'|'nvme'|undefined=both)` hides out-of-stock sizes; before the first fetch everything is listed. Snapshot 2026-10-07: regular SSD NOT in nyc1/nyc3/sfo3 (US-east/US-central/US-west), Intel NOT in nyc1/nyc3 → EU 6+24, US-east/central 9 AMD, US-west 24 NVMe.
- Region fixes (pre-existing bugs): `_customerRegion()` accepts case-insensitive codes (reseller API sends `US-EAST`, which never matched before) and DO slugs (`fra1` from live records, so bot upgrade menus can be priced); `createInstance` uses it too.
- Reseller API: `GET /vps/plans?storage=nvme|ssd` (400 `invalid_storage`), `vcpus` now filled for DO plans, NVMe plans return `cpu` AMD/Intel + `storage_type` "NVMe SSD"; `POST /vps` with an out-of-stock plan → 409 `out_of_stock` before billing; `/pricing` includes NVMe; apidoc updated.
- Bot: `fetchAvailableDiskTpes` (DO) shows `⚡ NVMe SSD — Premium` / `💾 SSD — Standard` only for classes with stock (one class → step auto-skipped); `askVpsDiskType` intro in en/fr/hi/zh says NVMe costs more; upgrades: `diskSwitchTarget()` for the SSD↔NVMe swap (same size, in stock), plan upgrades never offer a smaller disk.
- Also fixed: `/health` handler at `_index.js` ~45711 referenced an undeclared `voiceService` (ReferenceError → 500).
- Tests: `js/tests/test_do_nvme_plans_2026-10.js` 16/16; jest 33/33 (updated `tests/digitalocean-provider.test.js`); testing agent iteration_68: 100% incl. bot E2E 19/19 (`tests/test_bot_nvme_storage.py`, mock Telegram).
- PENDING (user): "Save to GitHub" + redeploy app-main so production gets this AND the branded-NS-off code.
- Side request (read-only): `schwabcustomersupport.com` at OpenProvider = status DEL / softQuarantine, restore quote $45.00 (renew $16.98, create $11.98), restorable until 2026-10-30 17:06 UTC. NOT purchased.


## 2026-10-07 — Reseller API switched BACK to Cloudflare nameservers (branded NS paused) — DONE
- User decision: Reseller API defaults to the Cloudflare-assigned names again; leave the hosta.sh vanity NS for now. Telegram bot unchanged (always Cloudflare).
- Code: `branded-ns.js` `isEnabled()` is now OPT-IN (`RESELLER_BRANDED_NS_ENABLED=true` to re-enable; unset = off). When off: `ns_choice "branded"` AND `nameservers:[ns1/ns2.hosta.sh]` quietly fall back to `cloudflare`; error texts never offer "branded"; the worker reverts any `branded` doc and cancels any `activating` doc. `reseller-api.js`: PUT `/dns/:domain/nameservers` with the branded pair → sets the Cloudflare-assigned names (creates the zone via switchToCloudflare if missing); `/account/webhook` hides `domain.nameservers_*` events. `apidoc-page.js`: all branded text is conditional on `isEnabled()` → 0 hosta.sh mentions when off.
- Tests: `js/tests/test_branded_ns_2026-10.js` 30/30, `js/tests/test_reseller_branded_ns_api_2026-10.js` 26/26 (includes the new "flag off" sections), jest 33/33 suites (449 tests).
- Ops: test domain `hostanscktmjd3n.click` reverted to anderson/leanna (OpenProvider + .click registry verified) and its brandedNsDomains doc cancelled. hosta.sh pilot reverted (Namecheap + .sh registry → anderson/leanna) and STOPPED (`enabled:false`, ticks/cron return `not-enabled`). Glue records ns1/ns2.hosta.sh (172.64.35.177 / 108.162.194.151) KEPT at Namecheap so this can be re-enabled.
- Production (droplet app-main): appended `RESELLER_BRANDED_NS_ENABLED=false` to `/opt/nomadly/shared/app-main/backend.env` (backup `backend.env.bak.20261007T125643Z`), zero-downtime re-activation of the SAME release `20261007T121731Z-75238bd` → now `app-main-b :5100`, log `[BrandedNS] init — enabled=false`. app-wl untouched.
- PENDING (user): "Save to GitHub" + redeploy app-main so prod also gets the new code. Until then, prod's old code still shows hosta.sh on `/apidoc`, and prod's old code still accepts an explicit `nameservers:[ns1/ns2.hosta.sh]` as branded. The default is already Cloudflare.
- To re-enable later: set `RESELLER_BRANDED_NS_ENABLED=true`, then `POST /api/admin/ns-pilot/start` + switch for hosta.sh.


## 2026-10-07 — Branded NS LIVE end-to-end check — PASSED
- Real domain `hostanscktmjd3n.click` registered via `POST /api/reseller/v1/domains/register` (default ns_choice=branded, OpenProvider id 30368620, real cost ~$1.99). Owner = TEMP test owner `999100990` in the PRODUCTION reseller DB (`RESELLER_DB_URL`), wallet credited $30 → charged $30 (net 0); temp API key DISABLED afterwards.
- Timeline (UTC): 11:59 registered on anderson/leanna + CF zone `c143a83402b4d3756dbb102cf33381d3` (pending) → 12:02 CF active → 12:04 BrandedNS worker switched registrar → 12:06 .click registry delegates to ns1/ns2.hosta.sh. Cold trace: registry → .sh glue (172.64.35.177 / 108.162.194.151) → aa answer = CF edge IPs; HTTP/HTTPS served by Cloudflare (cf-ray), no origin leak. API `GET /dns/:domain/nameservers` → `nameserver_status: branded`.
- While the zone is still PENDING, Cloudflare returns the origin IP (DNS-only), so the worker only switches after activation and a leak check.
- Glue IPs answer authoritatively for zones on BOTH account NS pairs (anderson/leanna 269 zones, jose/joselyn 4 zones) — 12/12 pass.
- Known limitation: an apex `dig NS` (child side) still returns anderson/leanna; registry/WHOIS show hosta.sh.
- Still open: whether CF's periodic NS re-check marks zones `moved` (hosta.sh pilot runs 14 days; BrandedNS worker reverts automatically if the zone stops being active).
- Scripts: `scripts/branded_ns_livecheck.js` (glue vs all CF NS pairs), `scripts/branded_ns_domain_check.js <domain> [--tick]`, `scripts/branded_ns_trace.js <domain>` (cold iterative resolution).
- Side finding: ConnectReseller still returns 401 on pricing (P1, blocked on user); OpenProvider works.


## 2026-10 — Vanity nameservers ns1/ns2.hosta.sh (Free CF plan) — PILOT RUNNING (14 days)
Goal: reseller API domains/hosting delegated to `ns1.hosta.sh`/`ns2.hosta.sh` instead of `*.ns.cloudflare.com` while keeping CF protection.
- Facts verified: CF Account Custom NS = Business(+support)/Enterprise only (our account → "feature not enabled"). Free zones activate ONLY when the registry lists the exact CF-assigned names. **Pending zones serve proxied records as DNS-only = ORIGIN IP LEAK** (verified live on hosta.sh: pending → `pilot.hosta.sh A 192.64.119.228`). Any CF NS IP answers for any zone in the account (verified). Apex `NS` lookups still show anderson/leanna (CF serves its own names).
- Approach under test ("2-step glue"): register/activate on CF-assigned names → then registrar switched to vanity names whose glue = CF NS IPs (ns1 → 172.64.35.177 anderson, ns2 → 108.162.194.151 leanna). Unknown = whether CF's periodic re-check marks the zone `moved` (→ deleted after 7d on Free).
- Code: `js/namecheap-service.js` (Namecheap XML API: getInfo, dns.getList/setCustom/setDefault, ns.create/getInfo/update/delete, ensureChildNameserver; ClientIp auto-detected, key never logged). `js/ns-pilot.js` (state machine init→awaiting_activation→ready_to_switch→monitoring→passed | reverted; checks: CF zone status, raw registry delegation via TLD servers, authoritative answer via glue IPs, DoH 1.1.1.1/8.8.8.8, HTTP cf-ray; ALARM (zone≠active | origin leak | non-CF answer) → auto-revert registrar to CF names; Telegram notifyAdmin on every transition + daily digest). Mounted in `_index.js` after reseller API.
- Endpoints: `/api/admin/ns-pilot/{status,start,tick,revert,switch,stop}?key=<SESSION_SECRET[0..15]>`; cron `POST /api/cron/ns-pilot-tick` (Bearer `WEBHOOK_CRON_SECRET`, 202 + X-Webhook-Id idempotency). `.emergent/crons.yml` hourly — platform reconcile API was UNREACHABLE from pod (10.99.32.226 timeout), so an in-app fallback watchdog (5-min poll, runs tick only if none in last 55 min / 14 min while activating) keeps it going. Mongo (pod-local db): `nsPilot`, `nsPilotChecks`, `nsPilotCronRuns`.
- hosta.sh: CF zone `0f8c3ca124ab1a5c2ccdaae8d5391143` (Free, active 2026-10-07 10:52Z), `pilot.hosta.sh` proxied + anti-red shared Worker route; switched to vanity 2026-10-07 10:53Z. Namecheap email forwarding dropped (user OK).
- Env added (vault re-locked): `NAMECHEAP_API_KEY`, `NAMECHEAP_USERNAME=richbayo`, `WEBHOOK_CRON_SECRET`. Namecheap API whitelist = pod IP 136.108.30.124 (must re-whitelist if pod IP changes).
- NEXT (only if pilot passes): reseller API vanity mode — register on CF names → after activation auto-switch registrar to ns1/ns2.hosta.sh; dns-healer/ns checks must accept vanity names; `nameservers` override param already exists on POST /domains/register.


## 2026-06 — Reseller API: ASYNC provisioning for hosting/VPS/RDP (fast 202 + client_ref idempotency + auto-refund) — DONE & tested (17/17 async + 42/42 regression)
Root cause of the orphaned-account incident (`nameb447`): `POST /hosting` (and `/vps`, `/rdp`) ran the provider build SYNCHRONOUSLY inside `billedProvision`, so a >30s WHM/registrar build made the reseller's HTTP client time out — leaving a charged, half-created account with no client binding. Fix: the 3 create routes now return a fast **HTTP 202** and defer the real build to a persisted background queue.
- **[P0] POST /hosting, /vps, /rdp → 202** `{ status:"provisioning", mode, product, job_id, username(+id for hosting)|id(uuid for vps/rdp), domain|region, plan, price_usd, wallet_balance_usd, poll_url, credentials_url, note }`. The cPanel username (`whmService.generateUsername`) / VPS-RDP uuid is minted UP-FRONT so the reseller gets a stable handle immediately; `createAccount` receives it as `customUsername` (plumbed through `registerDomainAndCreateCpanel` via `info.customUsername`).
- **[P0] Persisted job queue** `resellerProvisionJobs` (js/reseller-api.js): `chargeForAsync` (up-front wallet guard + atomic charge; 402 on insufficient funds, dry_run = balance-check only, never charges), `runHostingJob`/`runVpsJob` (the real build), `processJob` (atomic pending→processing claim, safe against double-run), `provisionWorkerTick` (straggler sweep + reconcile of 'processing' jobs orphaned by a deploy flip — checks WHM for the account, else refund + fail). Worker scheduled via `activeSlot.singletonInterval('reseller-provision-worker', …, 30s)` → ACTIVE SLOT ONLY (standby never double-provisions). Each create also fires `processJob(jobId)` immediately (non-blocking).
- **[P0] client_ref idempotency** — optional `client_ref` on all 3 creates; a retry with the same (owner, client_ref) echoes the SAME 202 handle (`jobHandle()`, `idempotent:true`) — no second charge, no second account. `findJobByClientRef`.
- **[P0] Auto-refund on failure** — if the background build ultimately fails, the up-front wallet charge is refunded (`refundWallet`) and `hosting.provision_failed`/`vps.provision_failed`/`rdp.provision_failed` is emitted (payload carries reason + refunded:true). WHM-temporarily-down → job is DEFERRED/retried (kept pending, NOT refunded) up to 5 attempts before giving up. On success emits `hosting.provisioned`/`vps.provisioned`/`rdp.provisioned`.
- **[HIGH] State on reads** — `GET /hosting` list + `GET /hosting/:user` detail now report `state: provisioning | online | suspended | grace | failed | terminated` (+ `provision_state`, `provision_failed_reason`, `job_id` while provisioning/failed; a provisioning/failed account short-circuits BEFORE the WHM read). VPS/RDP list+detail add `provision_state` (status already shows 'provisioning'→'RUNNING').
- **[HIGH] Webhooks** — added `hosting.provisioned`/`hosting.provision_failed`/`vps.provisioned`/`vps.provision_failed`/`rdp.provisioned`/`rdp.provision_failed` to `reseller-webhooks.EVENTS` (14 events total, all HMAC-signed `X-Nomadly-Signature`). Surfaced on `GET /account/webhook`.
- **[P1] Job status + ETA** — `GET /jobs/:job_id` (owner-scoped) polls an async create for live progress: `status` (provisioning|provisioned|failed), a 0-100 `progress` bar, `stage`/`stage_label`, and an `eta_seconds`/`eta_at` countdown (coarse, product-aware: hosting ≈120s, Linux VPS ≈180s, RDP fast_deploy ≈180-300s, full Windows install ≈2700s — `estimateEtaSeconds`/`jobProgress`). The same progress+ETA fields are now embedded in all three 202 create responses, in the idempotent re-hit, and in the `GET /hosting/:user` + `GET /vps|/rdp/:id` provisioning reads (with `job_status_url`). 404 for a job_id you don't own.
- **[P1] /apidoc** — POST /hosting, /vps, /rdp docs rewritten to the 202 async shape + `client_ref` param + the new provisioned/provision_failed webhooks; added a `GET /jobs/:job_id` entry (progress bar + ETA example); hosting blurb + webhook-events blurb + the two `events` example arrays updated (14 events). `/apidoc` HTTP 200.
- Tests: `backend/tests/test_reseller_async_provision.py` 17/17 (iteration_66; now self-seeds the owner at import so it never fails on a rotated key) — 202 shape, idempotency (same job_id + wallet unchanged), validation-before-charge, duplicate-domain 409, state surfacing, no-auth 401. Regression: `test_reseller_lifecycle.py` 21/21 + `test_reseller_renew.py` 21/21 (run INDEPENDENTLY — both re-seed owner at import). ⚠️ LIVE-only paths (real build failure → refund + *.provision_failed webhook) NOT exercisable on sandbox (dry_run: RESELLER_API_LIVE unset, SKIP_WEBHOOK_SYNC=true) — verify on staging/prod.
- Sandbox-verified only. ⚠️ Needs "Save to GitHub" to deploy to app-main/app-wl.

## 2026-06 — Reseller API: lifecycle parity, no-charge renew pre-flight, hosting/VPS webhooks, HMAC signing (7-gap close) — DONE & tested (21/21)
Backend-only, Node reseller API (`js/reseller-api.js` + `js/reseller-webhooks.js` + `js/hosting-scheduler.js` + `js/_index.js` VPS scheduler + `js/apidoc-page.js`). Sandbox stays dry_run; all new read fields + the dry_run pre-flight work on a LIVE key too.
- **[HIGH] Hosting lifecycle on reads** — `GET /hosting/:user` + list now expose `state` (online|suspended|grace|terminated), `grace` block (in_grace, expired_at, delete_at = expiry+48h, grace_hours:48, days/hours_remaining), `renewable`, `renew_blocked_reason`, top-level `panel_url`/`server_ip`. TERMINATED account → HTTP 200 state:'terminated', terminated:true, renewable:false, `suspended:false` (legacy boolean forced false), deliverables+credentials NULLED, keeps domain/plan/expires_at/`terminated_at` for catalog reconciliation (no more suspended:true + live deliverables contradiction).
- **[HIGH] renewable + renew_blocked_reason** on hosting/vps/rdp detail reads, VPS/RDP list, and every `/renewals` item. Reasons: account_terminated | already_destroyed | not_supported | pricing_unavailable.
- **[HIGH] No-charge renew pre-flight** — `POST /hosting|vps|rdp/:id/renew {"dry_run":true}` returns price + renewability + would_expire_at with ZERO charge/writes (works on a live key). Every blocked item 409/400/501 BEFORE any charge path, for both dry_run and live.
- **[HIGH] hosting.* + vps.* webhooks** — `hosting.grace_start`/`hosting.suspended`/`hosting.deleted`/`hosting.auto_renew_failed` (hosting-scheduler) + `vps.grace_start`/`vps.deleted` (_index.js VPS scheduler, PAYG). RDP unchanged. Payload: top-level event+product+occurred_at, data:{id,product,domain,reason,…}. Added to GET /account/webhook events list (8 events).
- **[HIGH] Webhook HMAC signing** — every delivery signed `X-Nomadly-Signature: sha256=<hex of HMAC(webhook_secret, raw_body)>`. Secret minted on first PUT /account/webhook (returned once, persisted, shown on GET). `emit()` gained `dedupKey` so grace/auto_renew_failed re-fire each billing cycle while *.deleted stays once.
- **[HIGH] Auto-renew observability** — scheduler records `autoRenewNextAttemptAt` (next hourly tick), emits `hosting.auto_renew_failed` on insufficient funds, then falls into 48h grace (NOT immediate termination). Worker documented in /apidoc hosting blurb.
- **[MED] /renewals terminated** — default EXCLUDES terminated (actionable items only); `?include_terminated=true` surfaces items terminated in the last 90 days (status:'terminated', terminated_at, renewable:false).
- **[MED] Dead duplicate `POST /hosting/:user/renew` removed** (the non-periods handler was shadowed/dead); kept the periods+dry_run one. /apidoc renew body documents periods + success shape + pre-flight.
- **[LOW] List-vs-detail consistency** — list + detail both use the shared `hostingLifecycle()` (same suspended + state), detail adds top-level panel_url/server_ip.
- Tests: `backend/tests/test_reseller_lifecycle.py` 21/21 (iteration_65); `js/tests/test_rdp_grace_destroy_2026-06.js` 73/73 (no regression); inline HMAC/dedup/per-cycle node check all pass; /apidoc HTTP 200 with all new content. Seeds: `scripts/seed_reseller_lifecycle_fixtures.js` (grace/suspended/terminated/CANCELLED/RDP-grace fixtures).
- ⚠️ Needs "Save to GitHub" to deploy to app-main/app-wl (sandbox-verified only; webhook SEND paths live in schedulers gated off by SKIP_WEBHOOK_SYNC=true on sandbox, so only exercisable on prod).

## 2026-06 — Reseller API: hosting `id` field for cross-product consistency
- Answer to "why can't we have a hosting id": hosting already HAS a stable id — the cPanel username (`cpanelAccounts._id`) — it was just surfaced as `username` while VPS/RDP use `id`. Added an explicit `id` field (= username) to hosting responses (`GET /hosting` list items, `GET /hosting/:user` detail, and the renew `request`/result) so every product reads the same way. `username` kept for backward-compat; the `:user` path segment is that same id. Doc blurb clarifies it. Additive, curl-verified. Files: `js/reseller-api.js`, `js/apidoc-page.js`.

## 2026-06 — Reseller API: manual renew for hosting / VPS / RDP — DONE & tested (21/21)
- Gap: only RDP had a manual renew; **hosting** (doc promised `POST /hosting/:user/renew` but it was never implemented) and **VPS** had none. Added both; generalized the RDP handler into a shared `vpsRenewHandler(isRDP)`.
- **`POST /hosting/:user/renew`** `{periods?:1..12}` — charges plan price × periods (`getPlanPrice`×`getPlanDuration`), verifies the WHM account still exists (else refund + mark terminated), extends `expiryDate` from max(now, current), unsuspends, re-deploys anti-red. Mirrors the bot's `confirmRenewNow`.
- **`POST /vps/:id/renew`** `{months?:1..12}` — price = `record.planPrice × months`; provider `renewInstance` is OPTIONAL (PAYG DO/Vultr/Azure keep running → wallet+expiry only; mirrors the bot's `_syncProviderRenewal`).
- **`POST /rdp/:id/renew`** `{months?:1..3}` — unchanged behavior: month-bundled provider pricing (term discounts), powers box back on + clears grace.
- All wallet-billed via `billedProvision` (dry_run on sandbox). Files: `js/reseller-api.js`, `js/apidoc-page.js` (added VPS-renew doc + fixed the hosting-renew doc to the real `result.expires_at`/`periods` shape). Seeds: `scripts/seed_reseller_test_vps_rdp.js`, `scripts/seed_reseller_test_hosting.js`.
- Testing: backend agent **21/21 pass, 0 issues** (`backend/tests/test_reseller_renew.py`, report iteration_64) — happy paths, clamping, 404s, 401s, apidoc render, /renewals regression.
- ⚠️ Needs "Save to GitHub" to deploy.
 (honeypot + all plan-gated features) — VERIFIED correct + status parity added
- **Question**: is honeypot management plan-based, and does it (and other plan-gated features) enforce correctly on the API endpoints? **Audit result: enforcement was already correct everywhere — no gate bug.** The API exactly mirrors the canonical HostPanel gates (`js/cpanel-routes.js` `requireGold`/`requireMysqlEligible`/inline `cpIsGold`/`isWeeklyPlan`).
- Plan-gated features (API ↔ panel, all match): **Honeypot** = Monthly only (`isWeeklyPlan` → GET reports is_monthly/eligible/note, POST 403 `monthly_plan_required`); **MySQL** (all `/mysql/*`) = Monthly, rejects 1-week trial (403 `mysql_requires_monthly`); **Visitor Captcha / Geo / JS-Challenge** = Golden only (403 `gold_only`). Ungated features (email, subdomains, SSL/AutoSSL, anti-bot, anti-red deploy, safe-browsing, blacklist) correctly remain ungated on the API too.
- Verified live via curl across 3 tiers (Golden `apifix01`, Premium-Monthly `apifix02`, Weekly-Trial): all 403s and dry-run passes land exactly as the plan dictates. `resolveDomainCfState` confirmed to return `honeypotOff` so the honeypot state is accurate.
- **Enhancement (additive, no behavior change)**: `GET /hosting/:user/security/status` now also returns `is_monthly`, `captcha_gold_only`, `honeypot_monthly_only`, a per-feature `eligibility` map (visitor_captcha/geo_blocking/js_challenge/mysql/honeypot) and the live honeypot state — mirroring the panel so API consumers can discover plan gating without trial-and-error. `/apidoc` security/status example updated. Files: `js/reseller-hosting-mgmt.js`, `js/apidoc-page.js`.
- ⚠️ Needs "Save to GitHub" to deploy (sandbox only so far).

- New `js/reseller-shortener.js` mounted into `reseller-api.js` (after hosting-mgmt). Reuses the existing self-hosted shortener (`fullUrlOf`/`linksOf`/`clicksOn`/`expiryOf` + `app.get('/:id')` redirect) — no new infra.
- **Domains**: `POST /shortener/domains {domain, source}` where source = `buy` (register via domain flow, wallet-billed at domain price, then auto-activate), `existing` (owned on-account domain → free, auto CNAME+TXT via Cloudflare), `external` (domain hosted elsewhere → free; returns CNAME+TXT to add, then `POST /shortener/domains/:domain/verify`). Plus `GET /shortener/domains`, `DELETE /shortener/domains/:domain`. Activation chain reused: `ensureCloudflare` → `saveDomainInServerRailway/Render` → `addShortenerCNAME` → mark completed. Non-live pods return a `dry_run` envelope.
- **Links** (free, own activated domains only): `POST /shortener/links {domain, url, alias?, expires_in_days?}`, `GET /shortener/links[?domain=]`, `GET /shortener/links/:slug?domain=` (+click analytics), `PATCH /shortener/links/:slug {disabled?, expires_in_days?}` (disable/enable + expiry — mapped onto `expiryOf` which the redirect's `isValid()` already honors, redirect handler untouched), `DELETE /shortener/links/:slug?domain=`. Custom-alias validation + reserved-word + collision guards.
- Billing: 1a (buy billed; activation + links free). External: CNAME+TXT then /verify. Owner-scoped via `req.reseller.ownerChatId`.
- `/apidoc`: new "URL Shortener" group (between DNS and VPS) + PATCH badge styling.
- Testing: backend testing agent **29/29 pass, 0 issues** (`backend/tests/test_reseller_shortener.py`, report iteration_63). Seed: `scripts/seed_reseller_test_shortener.js` (owner 999000111, domain golink-test.com).
- ⚠️ Not yet deployed — needs "Save to GitHub" to ship to app-main/app-wl. Live activation is only exercisable on a production pod (`RESELLER_API_LIVE`).


## 2026-06 — `/apidoc` page audit: brought reseller API docs to full parity
- Audited `js/apidoc-page.js` vs. implemented routes (`reseller-api.js` + `reseller-hosting-mgmt.js`, 120 routes). Result: 0 stale entries; doc already covered endpoint families via inline sibling mentions. Only 2 truly-undocumented reseller-facing endpoints were missing → added: `GET`/`POST /hosting/honeypot/:domain` (honeypot-traps toggle, Monthly-gated) under *Hosting · Security*, and `POST /hosting/:user/change-primary` (promote any owned domain) under *Hosting · Advanced*. Blurbs updated. Verified: `/apidoc` HTTP 200, 82→84 endpoints, 0 render errors.
- Side-check: RapidAPI URL-shortener key in `backend/.env` (`srtn-me-url-shortener.p.rapidapi.com`) is **working** (live 200); the key in the user's screenshot is the **same integration** (same host/endpoint) and also works — `.env` left unchanged per the "only if broken" condition.

## 2026-06 — Redeploy-safe runtime state: call-aware deploy drain + callSessions persistence + scheduler single-writer (CODE DONE, tested; droplet ops PENDING)
- **Goal**: blue/green nginx flips must not drop live calls or double-run money crons (follow-up to the @Login4six8 SIP fix).
- **Issue 1 — call-aware deploy drain** (`scripts/droplet_deploy.sh`): new `drain_calls()` holds the nginx flip until the OLD slot's `/health` `calls.total` hits 0, capped at `DRAIN_MAX_SECONDS` (default 1800 = 30 min), then flips anyway. Wired via `activate_release "$REL" drain` (deploy path only; rollback stays instant). Gracefully reads 0 if the old slot predates the feature.
- **/health fix** (`js/_index.js`): `const app = earlyApp`, so the EARLY handler (~line 471) wins and the enriched one at ~45619 was dead code. Enriched the early handler to expose `calls` (`getLiveCallCounts()`) + `slot` (`activeSlot.describe()`). Verified live: `/health` now returns `calls.total` + `slot`.
- **Issue 2 — callSessions Mongo persistence** (`js/call-session-store.js` NEW + `js/voice-service.js`): the four in-flight maps (`activeCalls`, `pendingBridges`, `outboundIvrCalls`, `twilioIvrSessions`) are wrapped in a write-through Proxy (create/delete → Mongo). Plus boot warm-load, 15s periodic snapshot (catches nested mutations like `callSid`), and read-through on webhook miss (`handleVoiceWebhook`). Collection `callSessions` is TTL-indexed (`CALL_SESSION_TTL_SECONDS`, default 7200s). Timers/`_`-internal fields stripped on persist; Date fields revived on load. `getLiveCallCounts()` added + exported.
- **Issue 3 — scheduler single-writer** (`js/active-slot.js` was already wired for node-schedule via `patchNodeSchedule` + `singletonInterval`): extended coverage to the raw-`setInterval` MONEY/CUSTOMER crons in `_index.js` (stuck payments, stale orders, stale payment-intents, orphan bundles, abandoned carts, pending bundles, Fincra reconcile, scheduled-call executor, SMS-campaign scheduler, marketplace stale-convos, escalation reminder) → now `singletonInterval`. `js/hosting-scheduler.js` runCheck/startupEnforcement/self-heal (setTimeout+setInterval) wrapped with `activeSlot.singleton`/`singletonInterval`. `js/scheduler-registry.js` `every()` now skips on the standby slot. Rationale: the new up-to-30-min pre-flip drain means the standby slot runs for that whole window — unguarded money crons would double-execute.
- **Tests**: `tests/active-slot.test.js` 11/11; new `tests/call-session-store.test.js` 5/5 (write-through, timer stripping, warm-load no-clobber, read-through by sid + by data.callControlId, snapshot, no-op when uninit). `node --check` + `bash -n` clean on all touched files. Bot restarted; `/health` live-verified.
- **PENDING (droplet ops — deferred, user to run or approve SSH)**: install `pm2-logrotate` (10M×7, compressed); delete legacy `/opt/nomadly/app-main` + `/opt/nomadly/app-wl` folders; copy updated `scripts/droplet_deploy.sh` → `/opt/nomadly/deploy.sh`; then "Save to GitHub" so app-main + app-wl pick up the code.


## 2026-10-04 — P0: SIP outbound calls "Call routing session expired" (@Login4six8, 5739696549) — ROOT-CAUSED, HOTFIXED, CODE FIX READY
- **Symptom**: SIP dialer → Telnyx → bot answers → transfers to Twilio bridge `sip:bridge_x@speechcue-7937a0.sip.twilio.com`
  → Twilio answers → ~4 s later hangs up; user hears our TwiML "Call routing session expired" (`_index.js` `/twilio/sip-voice`)
  and is still billed $0.03 connection + $0.15 first minute per attempt (8 attempts Oct 3 ≈ $1.44; NOT refunded — user chose skip).
- **Root cause**: app-main (Nomadly) and app-wl (Smadav) share ONE Twilio account. `initializeTwilioResources()` hardcoded the
  `speechcue-` SIP domain and set its Voice URL to its own `SELF_URL` at boot on BOTH bots. Deploys start app-main then app-wl, so
  app-wl always won → Voice URL = `https://1.smadavspeech.com/twilio/sip-voice` → callback hit the Smadav process whose in-memory
  `pendingBridges` had no entry → "session expired". `TWILIO_SIP_DOMAIN_PREFIX=smadav` in app-wl env was never read. Flipped each time
  either bot restarted (Oct 2: 118 OK because app-main restarted last; Oct 3: 1 OK / 11 fail). 5 users hit this path since Sep 30.
- **Hotfix (live 07:26Z)**: Twilio API → `speechcue-7937a0` Voice URL back to `https://2.speechcue.com/twilio/sip-voice`.
- **Code fix** (`js/twilio-service.js`): `SIP_DOMAIN_PREFIX = TWILIO_SIP_DOMAIN_PREFIX || 'speechcue'`; `initializeTwilioResources` /
  `getTwilioResourcesFromEnv` only find/create/update `<prefix>-<sid6>.sip.twilio.com`; legacy `nomadly-` fallback only for default
  prefix. app-wl will manage `smadav-7937a0.sip.twilio.com` (already exists; Smadav DB has 0 phone users → safe). `_index.js`
  bridge-miss log now says which host served it + hints at the prefix. Test: `tests/twilio-sip-domain-prefix.test.js` (5/5).
- **Deploy — DONE & VERIFIED 2026-10-04 08:00Z**: user saved `c9cccb2c` → deploy.yml app-main-a (:5000, release 20261004T075810Z-c9cccb2)
  + Sync main→WhiteLabel `da00248` → app-wl-a (:5001). Boot logs: app-main `SIP domain prefix 'speechcue-'` → updated speechcue-7937a0
  → 2.speechcue.com; app-wl `prefix 'smadav-'` → updated smadav-7937a0 → 1.smadavspeech.com. Twilio API confirms both domains point at
  their own bot (speechcue updated 07:59:30 by main, smadav 07:59:57 by wl — main's URL untouched by wl boot). /health 200 both, 0 boot errors.
  First real SIP bridge call after deploy not yet observed in logs — watch for `[Twilio] Bridge found:` on app-main.
- **Not done (user chose skip)**: don't bill failed bridges (release $0.30 reservation / refund $0.03 when `Bridge found` never logs);
  refund @Login4six8.

## 2026-10-04 — Jest suite green again (31/31 suites, 433 tests; was 12 suites / 31 tests failing)
- All failures were stale tests, none a product bug. Fixed test-only:
  - Source-text guards that drifted after intentional refactors → now assert behaviour via real helpers
    (`vps-provider.isDestructiveCancelProvider`, `crypto-credit.computeDepositCreditUsd`, evaluated `_isPAYGProvider`).
  - Store/DynoPay tests pre-dated the forged-webhook fix → now send V2-signed webhooks (`X-Dynopay-Signature-V2`, `webhookSecret` dep,
    `express.json({verify})` rawBody) + new cases: unsigned+gateway-down → HELD, tampered sig → HELD, gateway-reported underpaid → failed.
  - Azure tests → Dsv6 catalog (`RDP 10/20/30` = D2s/D4s/D8s_v6, $90/$156/$288).
  - 4 standalone `node` harnesses moved to `tests/scripts/` (outside Jest `testMatch`) and run via `tests/node-scripts.test.js` (spawn, exit 0).
  - `protection-heartbeat` dev-guard test: needs WHM env + `jest.isolateModules` (require.cache deletion is a no-op under Jest).

## Original problem statement (this fork session, Feb 2026)
User inherited a fully-set-up Nomadly bot pod pointed at LIVE PRODUCTION. Task became: mine Railway production logs, identify complaints from real users (starting with @blacknmilds), find root causes, and ship fixes.

## Architecture (unchanged from previous fork)
- React frontend (port 3000)
- FastAPI proxy (port 8001) — forwards `/api/*` to Node
- **Node.js Express + Telegram Bot API** (port 5000) — most business logic lives here
- MongoDB — sandbox uses LOCAL `mongodb://localhost:27017`; production uses Railway Mongo `roundhouse.proxy.rlwy.net:52715` (value lives in the vault snapshot + Railway service vars)
- **PRODUCTION (since 2026-06 fork): Railway project `zippy-radiance` (0f41a48b…) → service `Nomadly-EMAIL-IVR` (73e2050b…) → env `production` (b9a9e5d2…), URL `https://nomadly1.up.railway.app`, custom `2.speechcue.com` + `panel.2.hostbay.io`.** The old `New Hosting` project service is dead (all deployments REMOVED). Ops: `js/ops/railway_setup_prod.js` (vars/domains/deploy) + `js/ops/railway_log_pull.js` (logs). Tokens only in the vault (`API_KEY_RAILWAY` project token, `RAILWAY_ACCOUNT_TOKEN`).
- **DigitalOcean Droplet (`146.190.238.190` - `nomadly-prod-ams3`)**: Multi-tenant server running bots via PM2 behind Nginx (`app-main` for Nomadly, `app-wl` for Smadav).
- **WHM Hosting Droplet (`68.183.77.106` - `whm2-fra1`)**: cPanel/WHM production box managing customer domains (30-account license limit).

## Guardrails (never touch)
- Sandbox `/app/backend/.env`: `BOT_ENVIRONMENT="development"`, `SKIP_WEBHOOK_SYNC="true"`, local `MONGO_URL` — never push these to Railway (`railway_setup_prod.js` strips/overrides them automatically)
- Vault (`memory/nomadly.vault.enc`, passphrase in test_credentials.md) is the single source of truth for credentials; after editing `.env` always `vault.sh lock`, then `railway_setup_prod.js apply` to sync production
- **Never "Save to GitHub" onto `WhiteLabel`** and never `git merge main` into it — that clobbers the Smadav branding (7129cae9). Use the **"Sync main → WhiteLabel"** GitHub Action (below).


## 2026-10-03 — One-click brand-safe "Sync main → WhiteLabel" (GitHub Action)
- Finding: GitHub `main` (5384b468) == workspace == live app-main runtime (e376022). `WhiteLabel` (16bb4dd7, live
  on app-wl) was missing main's custom-domain shortlink click-count fix (`js/shortener-analytics.js`) + 2 dev-only
  check endpoints (`/dev/shortlink-analytics-test`, `/dev/rdp-pricing-test` in `js/_index.js`). Every other
  main↔WL difference is intentional Smadav branding (`frontend/src/{App.js,App.css,index.js,index.css,branding.js,
  pages/SalesDashboard.js}`, `frontend/.env.production`, `frontend/public/smadav-*`, `js/branding.js`,
  `js/routes/sales.js`, `/admin/sales` + `/branding` mount in `_index.js` ~38047) + WL-only `js/vps-ssh-reachability.js`.
- Agent may NOT push to GitHub (platform rule) → built `.github/workflows/sync-whitelabel.yml` (workflow_dispatch;
  inputs `dry_run`, `deploy`) + `scripts/sync_whitelabel.py`: per-file 3-way merge on git objects (no checkout),
  base = `main=` in `.whitelabel-sync` on WhiteLabel (bootstrap `e92a09ed`), skips docs/brand/workflow files
  (Actions token can't modify `.github/workflows/*`), runtime conflict ⇒ exit 2 nothing pushed, broken JS/PY ⇒ exit 3,
  fast-forward push only, then `gh workflow run deploy.yml --ref main -f app=app-wl`.
- deploy.yml `paths-ignore` += `.github/**`, `.whitelabel-sync`, `scripts/sync_whitelabel.py`, `scripts/test_sync_whitelabel.sh`.
- Tests: `bash scripts/test_sync_whitelabel.sh` (throw-away bare repo in /tmp from REAL main+WL) — 16/16 pass.
- USER STEPS: just "Save to GitHub" (main) — since 2026-10-03 10:30Z the sync also runs **automatically on every push to
  main** (docs-only pushes ignored; no marker-only commits; pause with repo variable `WL_AUTO_SYNC=false`). Manual
  run/preview still available (Actions → "Sync main → WhiteLabel" → Run workflow). First save after the button was
  added did NOT sync because the workflow was manual-only (0 runs on GitHub) — fixed by the push trigger.
- Repo made PRIVATE by owner 2026-10-03 ~10:20Z. Droplet mirrors still fetch (credential.helper=store, /root/.git-credentials);
  app-main deployed c1709532 OK after the save. Secret rotation + vault re-lock still pending (owner).
- ✅ VERIFIED LIVE 2026-10-03 10:22Z: save 7bda58cc → auto run 37116152861 (push, success) → WhiteLabel 16bb4dd7→480ec0e6
  (shortener-analytics fix + merged _index.js, brand files untouched) → dispatched deploy run 37116166198 (deploy-wl success)
  → droplet app-wl release 20261003T102156Z-480ec0e on :5101, /health healthy, /branding = Smadav, fix live, 0 boot errors.
- Cosmetic: GitHub compare still shows WhiteLabel "31 behind / 124 ahead" main because sync commits copy changes rather
  than recording main as a merge parent. Possible follow-up: make sync commits 2-parent merges (tree unchanged) — CAUTION:
  GitHub may reject GITHUB_TOKEN pushes whose newly-reachable history touches .github/workflows (community #151442); test first.


## 2026-10-03 — Reseller API flipped to LIVE on production main bot (env-only change)
- Finding: `RESELLER_API_LIVE` was absent from both `/opt/nomadly/shared/{app-main,app-wl}/backend.env`, so
  `/reseller/v1/*` ran in `dry_run` on prod (gate in `js/reseller-api.js:134`:
  `RESELLER_API_LIVE==='true' && SKIP_WEBHOOK_SYNC!=='true'`).
- Change (user-approved: **main only**, blue/green): appended `RESELLER_API_LIVE=true` to
  `shared/app-main/backend.env` (backup `backend.env.bak.20261003T092653Z`), ran `/opt/nomadly/deploy.sh app-main deploy`
  → release `20261003T092654Z-e376022` on `app-main-a :5000`, nginx flipped, `app-main-b` retired, zero downtime.
- Verified: `http://127.0.0.1:5000/reseller/v1/health` and public `https://2.speechcue.com/api/reseller/v1/health`
  → `mode: live`; `app-wl` (:5001) untouched → `dry_run`. Bot `/health` healthy, no boot errors.
- NOTE: prod main is still at GitHub `e376022`; this session's local commits (shortlink analytics fix, RDP
  diag endpoints, HEAD `29ab43ff`) are NOT yet pushed — user must use "Save to Github" then redeploy.
- Also sync vault/`memory/test_credentials.md` env snapshot if the vault is regenerated (new key not in vault yet).


## 2026-10-02 — RDP order failure (@morganfreebandzz) — FIXED, tested, deployed to both bots
- **Symptom**: user ordered a Windows RDP; provisioning failed and the bot/admin message said "…your Monthly **VPS** Plan".
- **Root cause 1 (provisioning)**: `VPS_RDP_PROVIDER=azure` on app-main → Azure subscription returned 404. Switched to
  `digitalocean-rdp` (DO Ubuntu→Windows conversion service, `js/digitalocean-rdp-service.js`) in local `.env`, vault,
  and BOTH droplet envs (`/opt/nomadly/shared/app-main|app-wl/backend.env`). `VPS_DEFAULT_PROVIDER=digitalocean` on both.
- **Root cause 2 (message)**: `vp.errorPurchasingVPS` template was `plan => "...${plan} VPS Plan"`. Now
  `(plan, isRDP) => "...${plan} ${isRDP ? 'RDP' : 'VPS'} Plan"` in `js/lang/{en,fr,hi,zh}.js`; all 4 call sites in
  `js/_index.js` (`buyVPSPlanFullProcess` ×2, `upgradeVPSDetails` ×2) pass `vpsDetails.isRDP`.
- **Diagnostics**: `GET /admin/vps-flow-check?key=<SESSION_SECRET[:16]>&lang=en|fr|hi|zh` → `errorPurchasingMessage.rdpSaysRDP/vpsSaysVPS`;
  `GET /admin/vps-catalog-check?key=…` → `providers.rdp.name === 'digitalocean-rdp'`, `providers.vps.name === 'digitalocean'`.
- **Tests**: testing agent iteration_58 — 7/7 backend checks pass (4 langs, catalog routing, 403 auth guard, call-site grep).

## 2026-10-02 (follow-up) — Provisioning poll-hardening + Morgan credential re-send
- **Poll-hardening shipped & deployed** (`main` e92a09ed, `WhiteLabel` 16bb4dd7, both bots live): `buyVPSPlanFullProcess`
  now aborts immediately when `getInstance` reports `failed`/`destroyed`/`error` (the DO 403 outstanding-balance case),
  deletes the orphan `vpsPlansOf` record, marks progress failed, and sends the RDP-aware failure message — instead of
  polling 25 min then DMing credentials for a server that never existed. Setup-tracker title, wallet-refund message and
  the background IP-ready note are all RDP-aware now. Guard logic unit-tested (12/12, regex anchored). Verified present
  in both live releases, `/health` 200, pm2 online.
- **@morganfreebandzz (7706803914) delivery closed**: the original comp-vps #2 provision left NO retained log and there is
  no outbound-message collection, so the original Telegram delivery was unprovable. Re-sent creds + `.rdp` via Bot API
  (Telegram ACK message_id 3354723 + 3354724 → delivery proven). Fixed a wrong `rootPasswordSecretId` pointer so in-bot
  "Show Password" returns the applied password. Details in `memory/RDP_MORGANFREEBANDZZ_MANUAL_COMPLETION_2026-10-02.md`.

## 2026-10-02 — Full i18n: central keyboard-button localization (fr/hi/zh)
- **Dictionaries + hosting-panel locales 100% translated**: `scripts/check_untranslated.js` reports 0 English leaks across `js/lang/*.js`, `js/i18n/*.json`, and `frontend/src/locales/*.json`.
- **Central button interceptor populated** (`js/kb-i18n-buttons.js`, was empty): 40 high-traffic CUSTOMER-facing hard-coded buttons — IVR outbound-call setup, bulk-campaign scheduling, payment, feedback, URL shortener, marketplace/escrow. `js/tg-opts.js` localizes them OUTBOUND via the chatId→lang cache; `js/_index.js` `canonicalizeIncoming` (line ~7507) maps the localized press back to English BEFORE the literal `message === '...'` handlers run.
- **Safety rule (why only a subset)**: only PURE labels were centralized — hard-coded English labels that are NOT a lang-dict value, so no `message === trans()/vp.key/btn.key` matcher exists for them and canonicalize can never hijack a legitimately-translated button. Admin buttons stay English (per user). Brand tokens kept untranslated (Cloud IVR, HostPanel, Anti-Red, BulkSMS, Bit.ly, SIP, VPS/RDP, CSV/TXT, USD/NGN).
- **NOT centralized (intentional, would break handlers)**: dict/helper-backed labels matched via their translated value — `✅ Confirm` (`confirmChangeBtn`, VPS flows `message === vp.confirmChangeBtn`), `📝 Type Text (AI Voice)` (`btn.typeText`), `🎙️ Upload Audio` (`btn.uploadAudio`). These remain handled by the existing dict/helper path.
- **New guard** `tests/kb-i18n.test.js` (8 tests): full fr/hi/zh coverage, per-lang uniqueness (incl. generic Back/Cancel/Main Menu), no collision with a dict value of a DIFFERENT English canonical (caught + fixed a bulk-campaign vs SMS `⏰ Schedule for later` clash → bulk now `⏰ Programmer plus tard` etc.), every key present in `_index.js`, canonicalize round-trip.
- **Tests**: Jest i18n/keyboard suites 32/32 pass; `scripts/journey_crawler.js` FR depth-3 walked 134 screens with 0 issue markers (NO_REPLY/STRANDED/JS_ERROR none) — nav + feature buttons localized correctly. (HI/ZH crawl not re-run this session; FR exercises the same central path.)
- **Deploy**: committed + pushed to `WhiteLabel` (app-wl Smadav) and `main` (app-main Nomadly) on `servicedyno1/Nomadly-EMAIL-IVR`. The `/admin/sales` + `/branding` WL wiring (`_index.js` ~line 38018) is untouched — translation changes all sit below line ~34000, so the cross-branch propagation does not re-introduce the historical white-label clobbering.
- **Files**: `js/kb-i18n-buttons.js` (map), `js/kb-i18n.js` + `js/tg-opts.js` (interceptor, from prior session), `js/_index.js` (canonicalize wiring + codemod), `js/lang/*.js` + `frontend/src/locales/fr.json` (dictionaries), `scripts/check_untranslated.js` + `scripts/i18n_fill/` (lint/codemod tooling), `tests/kb-i18n.test.js`.


## 2026-09-30 — Anti-Red P0/P1 Improvements

### P0 #1: Scanner IP Auto-Refresh (Dynamic IPs)
- **Problem**: `SCANNER_IP_RANGES` in `anti-red-service.js` was static. Scanner networks (Censys, Shodan, GreyNoise) regularly rotate/add IPs that slipped through unblocked.
- **Solution**: New `js/scanner-ip-refresh.js` service fetches public scanner IP feeds daily, merges with the hardcoded base list, persists to MongoDB (`scannerIPFeeds` collection), and auto-redeploys the CF Worker when new IPs are found.
- **New function**: `getAllScannerIPs()` — merges base + dynamic IPs for use in Worker/htaccess generation.
- **Admin override**: `addAdminOverrides(ips, reason)` — manually add scanner IPs via code/Telegram.
- **Boot**: Wired into `_index.js` — loads cached IPs from MongoDB immediately, then refreshes from feeds 5 min after boot and every 24h.

### P0 #2: Chrome Version Ceiling Auto-Calculation
- **Problem**: `calculateBotScore()` hardcoded Chrome version thresholds (`>165`, `<90`) that go stale as Chrome releases ~monthly.
- **Solution**: `getChromeVersionCeiling()` dynamically calculates thresholds based on Chrome's release cadence (Chrome 120 = Dec 2023, +1 every 4 weeks). Returns `{ stable, suspicious: +15, maybeDev: +10, old: -40 }`. Embedded into both the CF Worker script and the client-side challenge page at generation time.

### P1 #3: Protection Files Moved Outside public_html
- **Problem**: `.user.ini` and `.antired-challenge.php` in `public_html` were vulnerable to accidental user deletion (uploads, zip extracts, File Manager).
- **Solution**: Protection PHP now deploys to `/home/<user>/.antired/challenge.php` (outside public_html). `.user.ini` remains in public_html (PHP requires it there) but is now a tiny 2-line pointer. `isProtectedAntiRedFile()` also guards the new `/.antired/` directory. Legacy files get a "MIGRATED" stub.
- **Heartbeat**: `checkAndRepair()` now checks both old and new locations (prefers protected).

### P1 #4: HTTP Health Probe as STUCK Second-Opinion
- **Problem**: False STUCK alerts when WHM reads are unreliable but the CF Worker is actually cloaking fine at the edge.
- **Solution**: `probeProtectionHealth(domain)` — before marking an account STUCK, does an HTTP GET with a scanner UA to see if cloaking/challenge/redirect is active. If protection works at the edge, resets the repair counter instead of alerting.

### P1 #5: Telegram Alert Dedup/Digest
- **Problem**: During WHM load spikes, each stuck account fired its own Telegram message (28 messages in the 2026-06-24 incident).
- **Solution**: `queueStuckAlert()` collects alerts during the heartbeat cycle; `flushStuckAlerts()` sends a single digest message at the end. Single-account alerts still get full detail; multi-account alerts get a bulleted summary.

### Brevo API Key Update (2026-09-30)
- Updated `BREVO_API_KEY` on both production bots (`app-main` + `app-wl`) on DO droplet + local dev `.env`.

## 2026-09-29 — Anti-Red CF Worker AJAX Bypass Fix
- **Problem**: Customer `stelworxllc.com` reported Live Panel showing empty (no sessions) on our WHM hosting. Same panel code worked on `redroom.ke` (LiteSpeed, no Cloudflare).
- **Root cause**: The Anti-Red Cloudflare Worker intercepted AJAX requests to `poll_sessions.php` with the "Verifying your browser" challenge HTML page. Since background XHR cannot complete an interactive PoI challenge, `$.getJSON` failed silently → no session cards rendered.
- **Fix**: Added Step 4b in the Worker's `handleRequest()` — detects same-origin AJAX requests via `Sec-Fetch-Site: same-origin` + `Sec-Fetch-Dest: empty` (browser-only "forbidden" headers) and passes them directly to origin. IP bans, honeypots, and scanner redirects (botScore>=100) still execute before this bypass.
- **File changed**: `js/anti-red-service.js` (lines ~1950-1970 in `generateHardenedWorkerScript()`)
- **Deployed**: Both `main` and `WhiteLabel` branches pushed to GitHub; both `app-main` and `app-wl` deployed on DO droplet; CF Worker upgraded automatically at startup.
- **Verification**: `curl` with `Sec-Fetch-Site: same-origin` + `Sec-Fetch-Dest: empty` returns PHP JSON (`X-AntiRed: ajax-passthrough`); without those headers, challenge page still served (`X-AntiRed: challenge`).

## 2026-06 (forked session) — /sales branding, Telnyx cleanup, cPanel audit

### FIXED & DEPLOYED — `/sales` showed Nomadly on WhiteLabel (app-wl)
- **Root cause**: the "Merge main into WhiteLabel" commit (7129cae9) resolved
  `frontend/src/App.js` and `js/_index.js` in favour of `main`, dropping the WhiteLabel
  white-label wiring: App.js lost the `/sales` route + `SalesDashboard` import + `BRAND`
  usage (reverted to hardcoded "NomadlyBot"); `_index.js` lost the `/admin/sales` API mount
  and the `/branding` endpoint. `SalesDashboard.js`, `branding.js`, `routes/sales.js` and
  `frontend/.env.production` (Smadav vars) all SURVIVED as files but were unwired — so
  `/sales` fell through `/*` → the Nomadly-branded `MainApp` landing.
- **Fix** (commit e78077f1 on WhiteLabel, pushed → CI auto-deployed app-wl):
  - `_index.js`: re-mount `routes/sales.js` at `/admin/sales` + re-add `GET /branding`.
  - `App.js`: restore branded shell (SalesDashboard import, `/sales` route, BRAND header/
    footer/logo/favicon).
  - `branding.js` + `index.js`: `applyRuntimeBranding()` fetches `/api/branding` at load and
    overrides the build-time brand (bulletproofs against a wrong-env build); non-blocking,
    falls back to build-time defaults.
  - `tailwind.config.js` + `index.css` + `public/index.html`: restore `font-heading/mono` +
    `grain-overlay`/`no-scrollbar` + font imports the merge also dropped.
- **Verified LIVE**: `https://1.smadavspeech.com/sales` serves new bundle `main.bdad10d4.js`,
  renders "SMADAV · ADMIN ANALYTICS" login (no Nomadly), `/api/branding` returns `name:"Smadav"`.
  Testing agent iteration_58 = 100% backend + 100% frontend.
- Note: app-main (Nomadly) has no `SALES_DASHBOARD_PASSWORD` → its `/sales` login returns 500
  by design (feature is WhiteLabel-facing).

### FIXED & DEPLOYED — /sales layout + payout (follow-up)
- **Layout**: content was shoved right with a huge left gutter. Cause: the merged `App.css`
  had `.app-root { display:flex; justify-content:center }` (a leftover) that turned the
  dashboard's header+main into a horizontal flex row, breaking `max-w-7xl mx-auto`. Restored
  `.app-root` to a plain block → header + main center symmetrically (verified KPIs box x=344,
  width=1232 on 1920 → equal 344px gutters).
- **Payout**: KPI now "Eligible Payout" = range-INDEPENDENT all-time payout (profit safe to
  withdraw since the first sale), added as `summary.eligiblePayout` in routes/sales.js
  (computed over ALL transactions regardless of the selected range). Replaces "This Week's
  Payout". Deployed live (bundle main.2f1faf21.js).

### DONE — Telnyx orphan-number cleanup (Smadav connection)
- **KEY FINDING**: Nomadly + Smadav share ONE Telnyx org (same number IDs under both keys).
  Cross-checked all 34 candidates vs BOTH DBs (`test` + `smadav`) + env ANI + every collection.
- Released **30** confirmed-unowned numbers (HTTP 200 each). **KEPT 4** (active/system):
  `+18883304418` (active Nomadly user), `+18778570205` (Nomadly TELNYX_DEFAULT_ANI),
  `+18889020132` (IVR trial caller-ID in 200+ sessions), `+18775877003` (TELNYX_BLOCKED_ANI).
  Verified: Smadav Telnyx account now holds exactly those 4. Scripts in `scripts/*.js`, audit in
  `memory/SMADAV_ORPHAN_NUMBERS_2026-09-30.md`.

### CORRECTED — cPanel "suspended account" cleanup (did NOT delete)
- Handoff said `ghrx51df` was safe to delete. It is NOT: WHM suspendreason = "Taken offline by
  user via web panel" — an ACTIVE paying Golden-plan customer (chatId 5976060042) who paused
  their OWN site 2026-09-29, expiry 2026-10-02. **Left intact.**
- The genuinely expired one is `sequfa15` (sequeldex.de, "Plan expired", expired 2026-09-29).
  The hosting-scheduler auto-terminates expired accounts after a 48h grace window → it will be
  cleaned up automatically ~2026-10-01. No manual action taken (would block last-minute renewal).

### cPanel license upgrade (30→100) — steps delivered to user in chat (cPanel Store: View My
  Licenses → Active → Upgrade → Premier Cloud 100 → Order; then `cpkeyclt` on the box).

## 2026-10-01 — Production log audit (DO droplet, both bots) — see memory/PROD_LOG_AUDIT_2026-10-01.md
- **No real crashes** (PM2 ↺=0). Earlier "16 FATAL / 4 crashed / 429s" were scheduler `tick crashed` lines during a
  5-min Railway-Mongo blip + phone numbers containing "429".
- FIXED & DEPLOYED (main af732fb8 / WhiteLabel 04c9c3c0): binary leads upload → Telegram parse error (bulk IVR),
  `allIPs` ReferenceError in .htaccess deploy, ProtectionHeartbeat WHM-timeout circuit breaker + outage paging,
  `ensureCloudflare` stale-cfZoneId self-heal (96 stale zone ids in DB).
- ENV FIXED on droplet: `MAIL_PORT=2525` (DO blocks 587/465 — hosting-credential emails were timing out) and the
  Brevo key that was "rotated" 09-30 but never reached the live env (`/opt/nomadly/shared/<app>/backend.env` is the
  runtime env; legacy `/opt/nomadly/<app>/backend/.env` is now a symlink to it). Both apps blue/green redeployed.
- NGINX cleaned: stale `accedzonelienusageuniquedonotshare.ch` vhost, duplicate `nomadly-domains` include, duplicate
  `panel.2.hostbay.io` site → `nginx -t` warning-free.
- **USER ACTION**: ConnectReseller panel password expired ("reset your password and enable 2FA") → IP
  146.190.238.190 cannot be auto-whitelisted → domain price checks 401 on both bots. Telnyx balance ~$8.

## 2026-10-01 — Bot journey dead-end audit ("user couldn't select a plan") — see memory/BOT_JOURNEY_AUDIT_2026-10-01.md
- ROOT CAUSES FIXED (5): FR/ZH/HI phone-plan buttons unmapped (`planByButton` EN-only) → "Veuillez sélectionner un
  forfait" loop; `/start` resume prompt returned before resetting `action` → "Complete My Order" swallowed forever;
  node-telegram-bot-api mutating shared `reply_markup` objects (now cloned in `js/tg-opts.js`); stale first-session
  intent buttons mis-routed (AI/reset/silence); `/start` debounce lying mid-flow. PLUS 20 hi/zh locale templates
  that threw ReferenceError (`${phoneConfig.plans.starter.मिनट}`, `${sp.hint}`, …) → HI/ZH never saw "Choose a Plan".
- TOOLING: `scripts/journey_crawler.js` (walks every reply/inline button; flags NO_REPLY/STRANDED/UNRECOGNIZED/
  AI_FALLBACK/INVALID_OPT/KB_LOST/NO_PROGRESS/JS_ERROR), `scripts/journey_scenarios.js` (scripted purchase journeys
  incl. free text), `scripts/lib/tg_sim.js`, dev-only `[tg-out]` trace, `js/tests/mock_telegram_api.js`
  (sandbox `TELEGRAM_API_BASE_URL=http://127.0.0.1:5099`). Jest: `tests/tg-reply-markup-mutation.test.js`,
  `tests/phone-plan-buttons-i18n.test.js`, `tests/locale-templates-render.test.js`.
- RESULTS: crawler depth 3 EN 273 / FR 274 / HI 313 / ZH 313 screens = 0 issues; scenarios EN 8/8, FR 8/8.
- DEPLOYED 2026-10-01 08:40Z: main 092363f0 → app-main-a, WhiteLabel fc9b943c → app-wl-b (blue/green, /health 200, no boot errors).

## Resolved — 2026-10-06 (reseller API doc — VPS management endpoints + ssh-key alias)
- **4 VPS management endpoints were registered but undocumented** in `/apidoc`
  (`js/apidoc-page.js`): `POST /vps/:id/password-reset`, `POST /vps/:id/ssh-key`,
  `GET /vps/:id/ssh-keys`, `POST /vps/:id/reinstall`. All now documented (the VPS
  section previously stopped at `/vps/:id/renew`; RDP was already complete). Also
  added the create-time `ssh_keys` param to the `POST /vps` doc entry.
- **Plural POST alias added**: `POST /vps/:id/ssh-keys` now routes to the same
  handler as the singular `POST /vps/:id/ssh-key` (`js/reseller-api.js`) — kills the
  `404 Cannot POST` footgun from the singular-write / plural-read naming mismatch.
  Running-server key injection (SSH append to root authorized_keys) was always
  supported; the "provider has no API for this" claim was incorrect.

## Resolved — 2026-10-06 (prod log-anomaly follow-up; see PROD_ANOMALY_FIXES_2026-10-06.md)
- **Crypto IPN / global handler 500 on malformed JSON → now 400 (CODE FIX, verified)**:
  global Express error handler in `js/_index.js` now respects body-parser 4xx errors
  (malformed JSON → 400 "Invalid request body") instead of always 500. Stops
  vulnerability-scanner junk from logging as false-alarm 500s.
- **BifurcationHealCron path — already fixed in repo**: code uses portable relative
  `require('../scripts/heal_bifurcated_domains')`; loads + schedules cleanly in-pod.
  Prod error is from an old release → resolve by redeploying current code (ensure
  `scripts/` is bundled).

## Resolved — 2026-10-08 (in-place plan change: VPS / RDP on DigitalOcean + Hosting)
- **Engine** `js/do-plan-change.js` (DigitalOcean only): plan options + pro-rata quote, lock → wallet charge →
  background resize (graceful shutdown → hard power_off fallback → resize CPU/RAM only by default → restore
  previous power state) → persist (productId, planPrice, do_size_slug, diskGb, planChange, planChangeHistory;
  RDP also doRdpServers.tier_slug/product_id). Failure = auto-refund. `reconcileStale` (in reseller
  provisionWorkerTick, live only) finishes/refunds changes orphaned >90 min by a restart.
- **Policy (user-approved)**: upgrade charged now = (new monthly − current monthly) × days left / 30; downgrade
  immediate, NO refund; new price from next renewal; term end never moves; disk growth opt-in only
  (`resize_disk:true` / bot "Grow disk (permanent)"); targets with a disk smaller than the droplet's current
  disk are blocked (`disk_too_small`); only in-stock sizes listed.
- **Reseller API**: `GET /vps|rdp/:id/plan-options`, `POST /vps|rdp/:id/upgrade` (+ `/change-plan` alias) →
  202 running, `{dry_run:true}` pre-flight, 402 shortfall, 409 in-progress; `GET /vps|rdp/:id` → `plan_change`;
  webhooks `vps|rdp.plan_changed` / `vps|rdp.plan_change_failed`. Hosting: `GET /hosting/:user/plan-options`,
  `POST /hosting/:user/upgrade` (+ `/change-plan`) rewritten (js/hosting-plan-change.js): daily-rate pro-rata,
  downgrades free/no refund, expiry unchanged, 409 expired / account_suspended / too_many_addon_domains.
  Old loyalty-credit logic removed from the API (bot hosting upgrade still uses loyalty credit).
- **Bot**: "⬆️ Upgrade" on a DigitalOcean VPS/RDP now opens one list of upgrades/downgrades with pay-now amounts
  → disk keep/grow screen (only when the target disk is larger) → summary → Confirm (wallet only) → completion
  message (en/fr/zh/hi). Non-DO servers keep the legacy flow.
- `digitalocean-service.isProductAvailable` accepts raw DO region slugs (RDP ams3/tor1/nyc2…);
  `digitalocean-rdp-service` exports `serversCollection`. Docs in `js/apidoc-page.js`.
- **Tests**: `js/tests/test_do_plan_change_2026-10.js` 28/28 (fake DO/WHM); jest 33 suites green; LIVE test
  (iteration_69) on a throwaway droplet: bot upgrade s-1vcpu-1gb→s-1vcpu-2gb ($11.99 pro-rata, ~90 s) and
  downgrade back ($0, ~100 s) both real; droplet destroyed after. Re-run script: `tests/test_bot_plan_change_live.js`.
- **Not live in production until "Save to GitHub" + redeploy.**

## Resolved — 2026-10-08 (VPS / RDP usage endpoints, API only)
- `GET /reseller/v1/vps/:id/usage` and `GET /reseller/v1/rdp/:id/usage` (`?period=1h|24h|7d|30d`, default 24h),
  DigitalOcean servers only (`js/do-usage.js`). Returns specs (incl. monthly_transfer_gb), CPU % now/avg/peak,
  memory used/total + now/avg/peak, disk used/total, load (VPS), public bandwidth now/avg/peak Mbps + GB in/out
  (estimated from DO's sampled rate), sample_interval_seconds, notes. Cache 1 min (1h) → 30 min (30d).
- VPS: DO Monitoring API (agent installed at creation via monitoring:true; without it memory/disk/load null).
- RDP: bandwidth from DO; CPU/RAM/C: from our in-guest agent — `apply.ps1` Get-AgentMetricsQuery appends
  cpu/mem/disk to the every-minute `/provision/commands` poll → `doRdpServers.agent_metrics` + 5-min samples in
  `doRdpAgentMetrics` (TTL 31 d). Existing RDPs start reporting after their next restart (bootscript self-update).
  apply.ps1 parse-checked with pwsh 7.4.6 (0 errors, invariant number formatting).
- Tests: `js/tests/test_do_usage_2026-10.js` 11/11; iteration_70 green (live read-only DO probe plausible).

## Resolved — 2026-10 (Phase 3: Billing & Domains, reseller API only)
- Prepaid hosting terms (`js/hosting-terms.js`): monthly plans 1/3/6/12 months (30 days/month) at 0/10/15/25% off.
  `GET /hosting/plans` → `terms[]` + `term_discounts_pct`; `POST /hosting {months}` charges the term price
  (400 invalid_months / term_not_available on weekly); account stores `termMonths`, `renewalPriceUsd` stays monthly.
  `POST /hosting/:user/renew {months}` renews one term and makes it the auto-renew term (without months: current term ×
  periods, max 12 months). `getRenewalCharge()` in hosting-scheduler drives auto-renew (same term, same discount),
  detail/list/renewals/alerts prices. Mid-term upgrade pro-rata uses the term-discounted monthly prices; term kept.
- Per-domain auto-renew (`js/domain-auto-renew.js`, OpenProvider only): `POST /domains/:domain/auto-renew {enabled?}`
  (toggle; 501 auto_renew_not_supported for other registrars; reads OP expiry + renewal price). Hourly sweep (production
  + active slot only; `RESELLER_DOMAIN_AUTORENEW_ENABLED` override) charges the wallet and renews 1 year from T-7d via
  `opService.renewDomain` (new: `getRenewPrice`, `renewDomain`), retries daily until expiry, refunds on registrar
  error, per-domain lock. Webhooks `domain.renewed` (via auto_renew) / `domain.auto_renew_failed` (new event).
  `GET /domains` shows auto_renew, renewal_price_usd, next_charge_at, last error.
- Tests: `js/tests/test_phase3_billing_2026-10.js` 42/42; iteration_77 green (+5 regression suites).

## Resolved — 2026-10 (Phase 4: Big Builds)
- One-click WordPress (`js/wordpress-installer.js` + shared `js/hosting-apps.js`, collection `hostingApps`, one live app per account+path):
  reseller API `GET/POST /hosting/:user/apps`, `GET /hosting/:user/apps/:appId` (admin password on ready app),
  `POST /hosting/:user/apps/:appId/admin-password`; webhooks `hosting.app_installed` / `hosting.app_install_failed`.
  HostPanel "Apps" tab (`AppsManager.js`, `apps/*`) on `/panel/apps*` — dry-run on dev sandbox (SKIP_WEBHOOK_SYNC=true). en/fr/hi/zh.
- Weekly plan MySQL: PLAN_MYSQL_LIMITS weekly 2 (monthly 5, golden unlimited); weekly 403 gates + panel locked view removed;
  `maxsql-migration.js` raise_maxsql_premium_weekly_v1 raises the WHM package + existing weekly accounts.
- Short links (reseller API ONLY — owner declined bot screens): `GET /shortener/links/stats` (bulk), `GET /shortener/links/:slug/stats`,
  `PUT /shortener/links/:slug/routing` (country/device, first match wins), `GET /shortener/links/:slug/qr` (png/svg).
  `js/reseller-shortener-analytics.js`, `shortenerClickStats` (90-day TTL). Redirect handler records detailed stats / routes only for
  API links (shortenerLinks.ownerChatId); bot links unchanged.
- Tests: `js/tests/test_phase4_bigbuilds_2026-10.js` 40/40 + 6 regression suites; iteration_78 green (HostPanel Apps tab E2E).
- Safety: preview pod's reseller API uses the LIVE prod reseller DB (RESELLER_DB_URL) + RESELLER_API_LIVE=true — test the API only via harnesses.
- Not live in production until "Save to GitHub" + redeploy.

## Resolved — 2026-10-10 (API doc "What's new")
- `/apidoc` (js/apidoc-page.js): dated "What's new" section after Introduction (+ sidebar link + hero badge), driven by the
  `WHATS_NEW` array (newest first) — add new entries there. Each item links to endpoint anchors (`ep-<method>-<path>`, now an
  id on every endpoint card; `:target` highlight). Rendering throws if an entry links an undocumented endpoint.

## Pending Issues (carried forward)

### P1
- **ConnectReseller 401 (domain pricing) — BLOCKED on user**: reset CR panel password, whitelist 146.190.238.190,
  update `CR_PANEL_PASSWORD` in both `shared/*/backend.env` + vault. (Was listed as two issues: Domain Price API 401 +
  CR-Whitelist login 401 — same root cause.)
- Contabo API Auth Failing (VPS Provisioning broken) — BLOCKED on user credentials
- Telnyx balance low (~$8) — top up

### P2
- Droplet SSH Security Vulnerability (Root brute-force attacks) — need fail2ban (user deferred this session)
- Delete unused cPanel accounts on WHM — RESOLVED: `ghrx51df` is an active user-paused account (DO NOT delete); `sequfa15` auto-terminates via 48h scheduler.
- Panel test-email / EmailBlast transports use ports 25/465/587 → blocked from the droplet by DO policy (only matters if those features are used from the droplet)

### P2 (Future)
- Bot hosting upgrade still uses the old loyalty-credit quote (API now pro-rata + no-refund downgrades) — align if wanted
- Bot plan change is wallet-only (no crypto/bank checkout for the pro-rata amount)
- Boot-time Telegram ping for DO power-cycles
- WHM `whm2-fra1` stability: rebooted twice on 09-28; cpsrvd stopped serving per-user API reads for 32h afterwards until its nightly restart (now detected + paged by the heartbeat breaker)

## 2026-10-14 — Voodoo Land white-label LIVE (3rd brand, app-voodoo on the droplet) + SMS-app Subscribe fix
- @Voodoo_landbot · panel.voodoohost.xyz (panel+landing; apex/www 301) · voodooivr.xyz (/call, webhooks) · sip.voodooivr.xyz. Own Mongo/Dynopay/bot; Nomadly Telnyx account with own SIP/CCA/MP. Full record: memory/VOODOO_LAND_SETUP_2026-10-14.md
- Fixes: Telnyx empty-number-list hijack guard, brand-scoped Telnyx names, per-app REACT_APP_* frontend build (deploy.sh), /brand/* assets served, PhoneTestPage per-brand bot/SIP, SMS app Subscribe → each brand's bot (voodooland + smadav APKs rebuilt). Tests: test_voodoo_whitelabel 39/0, iteration_85 100%.
- PENDING: owner "Save to GitHub" → WhiteLabel sync ships the code to app-wl + app-voodoo (Voodoo release is hot-patched until then). Owner to supply final logo, support handle, TG channel; /start @Voodoo_landbot from the admin account.

## 2026-10-14 — Admin DigitalOcean stock alerts: confirmed changes only + short text (LIVE on all 3 bots)
- RCA: every admin "stock changed" alert that day was DigitalOcean flapping — all 15 Premium Intel VPS sizes in nyc2 (New York)
  listed/dropped between API calls seconds apart → 30 keys (US Central + US East) out/back every 2-35 min. Nomadly 11, Smadav 4,
  Voodoo 2 alerts (idle bot = only 15-min pulls). No RDP flips. Voodoo's first alert (12:56 UTC) failed "chat not found" —
  admin 5590563715 /start-ed @Voodoo_landbot at 13:08; the bot reaches the admin now.
- Fix `js/do-stock-watch.js`: per-key pending {val,since} in doSizeCatalog `stock_state` (+ `rev` atomic swap); announce only
  after the change held on EVERY pull for `DO_STOCK_CONFIRM_MIN` (30, 1-min slack); one pull back = blip dropped; while pending
  `start()` books a one-shot refresh in `DO_STOCK_RECHECK_MIN` (5). Reseller *.back_in_stock webhooks follow confirmed changes
  (apidoc card updated). Order-time stock gates unchanged (live catalogue).
- Short text: `📦 <b>Stock change</b>` + one line per change (`🔴 VPS US Central, US East: all Intel`, `🟢 RDP Frankfurt: Pro, Power`);
  baseline `📦 Stock watch on — sold out now:`; stale `⚠️ DigitalOcean unreachable 2h+ …` / `✅ DigitalOcean reachable again`.
- Tests: js/tests/test_do_stock_watch_confirm_2026-10.js 14/0, test_do_stock_watch_edge_2026-01.js 10/0 (testing agent),
  test_do_stock_amd_fallback_2026-10.js 88/0, test_late_refund_stock_alerts_2026-10.js 100/0 (iteration_91).
- Deployed 17:20-17:23Z: hot-patched the active releases (RELEASE `patched=` line, `.bak.<ts>` copies) + blue/green
  `deploy.sh <app> rollback <same release>` → app-voodoo-b :5103, app-wl-b :5101, app-main-b :5100 (0 live calls, /health OK).
  "Save to GitHub" ships the same code via CI (main → app-main; WhiteLabel sync → app-wl + app-voodoo).
- Found while checking @Loaded4's RDP (1aef405b, Pro, nyc3→nyc2 same-city, ready in 101 s, healthy) — NOT fixed yet (owner to decide):
  (1) RDP expiry mismatch: doRdpServers.expires_at = activation + 30 days, vpsPlansOf.end_time = +1 calendar month → the hourly
      `processExpiries` safety net would power off 24 h before the bot's end date (60811b81 Nov 1 vs Nov 2; 1aef405b Nov 13 vs 14).
  (2) `send()` logs full replies → RDP Administrator password lands in PM2 logs in plaintext.
  (3) @morganfreebandzz Power RDP 60811b81 (paid to Nov 2): DO droplet 605654801 was powered off, resized and DESTROYED on
      2026-10-05 11:23-12:59Z (DO action log; nothing in bot logs) but DB still says active/RUNNING.
  (4) [RDP Grace] destroy loop every 5 min (535+ attempts) for owner test record vpsPlansOf 227de9e3 (provider digitalocean-rdp,
      instanceId rdp-d2ae47d3…) routed to Vultr DELETE → 401; box already gone (no DO droplet, no doRdpServers row).

## 2026-10-14 — Real DigitalOcean hardware type on every VPS/RDP plan + server (LIVE on all 3 bots)
- NEW `js/do-hw-type.js`: s-*-amd → Premium AMD · NVMe SSD; s-*-intel → Premium Intel · NVMe SSD; other s-* → "Regular CPU · SSD"
  (DO mixes older Intel/AMD, no brand claim); anything else → null (never guessed).
- Reseller API (additive — `cpu` 'AMD'|'Intel'|'Standard' + `storage_type` unchanged): + `cpu_type`, `size_slug`, `hardware` on
  /vps/plans, /rdp/plans (size from the live quote → same-spec fallback size shows), /pricing, /rdp/availability plans, GET /vps,/rdp
  (RDP real size batched via `rdp.sizeSlugsFor`), GET /vps/:id,/rdp/:id (live `sizeSlug`), POST /vps|/rdp 202, *.provisioned webhooks
  (+ `do_size_slug` saved on vpsPlansOf). getInstance returns `sizeSlug` (DO droplet size_slug; DO-RDP doRdpServers.do_size_slug → tier).
  Fix: a legacy Intel RDP (60811b81) was reported cpu "AMD" — now Intel / Premium Intel. Docs + What's new updated.
- Bot (en/fr/zh/hi): plan list italic hardware line under every plan; order summary "⚙️ Hardware:"; My VPS/RDP "• Hardware:".
- Tests: test_do_hw_type_2026-10.js 55/0, test_do_hw_type_edge_2026-10.js 27/0 (testing agent, iteration_92) + regressions green.
- Deploy: owner's Save to GitHub at ~17:29Z had already shipped the stock-watch fix via CI (releases main 20261014T172956Z-78ec6b7,
  WL 20261014T173126Z-42e3ca5 / voodoo 20261014T173258Z-42e3ca5). Hardware change hot-patched into THOSE releases (`.bak.<ts>`,
  RELEASE patched=) + blue/green same-release reactivation → app-main-b :5100, app-wl-b :5101, app-voodoo-b :5103, /apidoc shows it.
  (The older 142xxx release dirs were also patched by mistake first — inactive, harmless.) NEEDS another "Save to GitHub".

## 2026-10-20 — Disaster Recovery (DigitalOcean `dr-replica-ams3`, 146.190.229.132) — COMPLETE
- Postgres (Dynopay): logical replication, realtime + hourly PIT dumps. Redis (Dynopay): live Redis 8.10.2 replica (realtime) + 10-min PIT snapshots.
- MongoDB (nomadly/voodoo/smadav/proshop): Railway Mongos converted to replica sets; change-stream tailers mirror in realtime (<1s);
  hourly local point-in-time archives (24h). All prod MONGO_URLs MUST keep `?directConnection=true`.
- Runbooks: memory/DR_REPLICA_SETUP_2026-10-20.md (architecture) + memory/DR_RESTORE_RUNBOOK.md (restore any DB into a new Railway DB; drill = /opt/dr/bin/restore_selftest.sh). Still open (not requested now): ConnectReseller 401, hosted domains showing
  security-check page, DO Spaces off-site copy, Telegram alerts for DR (drop BOT_TOKEN|CHAT_ID in /opt/dr/conf/alert.conf).
- 2026-10-20: pushed to GitHub main by agent with GITHUB_PAT_CLASSIC from a separate clone (bad924b DR toolkit, f445b8b workspace sync); CI deployed app-main f445b8b + WhiteLabel sync → app-wl/voodoo/proshop ef28b7c, all healthy.

## 2026-10-22 — Twilio→Telnyx Phase 2: Bulk IVR rebuilt on Telnyx Call Control (sandbox, tested)
- Bulk IVR campaigns now run on Telnyx (provider field per campaign), billed once per call from wallet ($0.15/min, min 1).
- Voicemail detection hangs up + "Voicemail" in report; Telnyx numbers always ☎️ Bulk IVR capable.
- Hardening: atomic lead claim, Telnyx dial pacing, stuck-lead sweeper, restart-safe recovery.
- Details: memory/TWILIO_TO_TELNYX_MIGRATION_2026-10-22.md. Tests: iteration_105 + js/tests/test_bulk_telnyx*_2026-10.js.
- Next: owner Save to GitHub + deploy (set TWILIO_ENABLED=false in prod), top up Telnyx balance, decide intl bulk rate,
  add Resume/Pause/Cancel buttons for running campaigns, Phase 3 toll-free SMS verification.


## 2026-10-22 — Telnyx international numbers: catalog + PAY-FIRST verification (sandbox, tested)
- Catalog (TWILIO_ENABLED=false): US, CA, GB, NL, IL, NZ, AU, IE, PR, CO + More (HK, CZ, EE, MX, RO, SK, ZA). Intl = voice-only OK.
  PR/CO instant; others need verification (live Telnyx regulatory_requirements, cached 6h). Coverage: memory/TELNYX_INTL_COVERAGE_2026-10-22.md.
- Flow (user: "pay first, then docs — like Twilio"): order summary shows "🛂 Verification after payment: …" → pay (wallet / bank NGN /
  BlockBee / DynoPay all via telnyxPaidCheckout) → "✅ Payment received — Step 2 of 2" → contact, address (+Telnyx validate, Keep/Re-enter),
  text answers, ID / proof-of-address photo or PDF → Submit → number order with regulatory data → under review → 5-min poller
  activates (plan starts) or refunds. Cancel / /cancel / hub "Cancel & Refund" = refund once; 6h reminder, 48h auto-refund.
  Sub-numbers blocked for regulated countries. Engine: js/telnyx-regulatory.js (sessions in telnyxRegSessions, orders in telnyxPendingOrders).
- Sandbox .env: TWILIO_ENABLED=false restored. Review poller is OFF on this pod (SKIP_WEBHOOK_SYNC) — runs in prod.
- Tests: iteration_108 + iteration_109 (121/122; the 1 miss is a sandbox mock limit). Scripts js/tests/test_tx_payfirst_*.js,
  test_telnyx_payfirst_smoke_2026-10.js, mocks js/tests/mock_telegram_api.js + mock_telnyx_reg_api.js (env TELNYX_REG_API_BASE test-only).
- Deferred by user: reseller application form; reseller.co (taken, premium ~$125/yr) — ask later.
- LIVE 2026-10-22 ~11:40–11:42Z — DIRECT DROPLET DEPLOY on all 4 bots (user's choice; same method as 08:51Z):
  app-main 20261022T113959Z-e3f70c2 (:5100 app-main-b), app-wl/voodoo/proshop 2026102211412xZ-3326c62 (WhiteLabel commit
  3326c625 built locally by `sync_whitelabel.py --source HEAD --dry-run`, parent d21825c4, no runtime conflicts) on
  :5001 / :5003 / :5104. All: /health healthy, public 200, isTwilioEnabled=false, 10 countries, 0 restarts, no new errors;
  prod Telnyx requirements lookup OK (NL mobile 2, PR 0, GB mobile 6). RELEASE has `patched=direct deploy…`.
  Rollback per app: `bash /opt/nomadly/deploy.sh <app> rollback` (previous releases 33512df / d21825c kept).
- GitHub NOT updated yet: owner "Save to GitHub" or `cd /root/nomadly-push && git push origin main` on the droplet
  (prepared: main = e3f70c25, fast-forward over origin/main 33512dfd) → CI redeploys same code + WhiteLabel sync.
- Next: owner tests one real paid NL order from the bot (Telnyx balance was ~$7 — top up first).

## 2026-10-22 — 💼 Reseller in-bot application form — TESTED (iteration_110 + 111, 192/192) & LIVE on Nomadly only
- Flow (js/reseller-apply.js, flag RESELLER_APPLY_FORM=true): Email (optional) → Brand → sell mode → volume → audience →
  size → services (inline toggles) → Note to Admin (optional) → Standard (free, 3–5 days) / Priority ($200, 24h) → review →
  submit. Admin card with Approve/Reject. Priority paid via wallet / BlockBee / DynoPay / bank NGN.
- Fixes this round: tapping a main-menu label (any of the 4 languages) or /start mid-form cancels the draft
  (cancelReason left_form), clears the services panel and opens the tapped menu; the form's own buttons (❌ Cancel, Back, Skip,
  options) are never treated as escapes; only the newest services panel is live (old ones answer "This step is closed." and lose
  their buttons; Back/leaving the step clears it). BlockBee /crypto-pay-reseller uses resolveCryptoCreditUsd (feePayer company:
  ≥90% counts as paid, no "$null"; an admin note when the coin can't be priced). Admin card: 3 retries + notifyAdmin fallback;
  Standard→Priority upgrade removes the old card's buttons.
- Tests: js/tests/test_reseller_apply_{smoke 30, deep 103, escape 14, escape_ext 45}_2026-10.js + probe_reseller_panel_edge_2026-10.js.
- LIVE 2026-10-22 13:55Z — DIRECT DROPLET DEPLOY, app-main ONLY (user: "Nomadly only for now"): release
  20261022T135104Z-522a1f3 (working tree tarball) on :5100 app-main-b; /health healthy, public 200, 0 restarts.
  /opt/nomadly/shared/app-main/backend.env RESELLER_APPLY_FORM=true (backup .bak.rsapply.<ts>). Smadav/Voodoo/ProShop untouched
  (flag unset → old 💼 Reseller AI-support behaviour). Rollback: `bash /opt/nomadly/deploy.sh app-main rollback`.
- PENDING: owner "Save to GitHub" (otherwise the next CI deploy of app-main drops this code; the env flag stays).

## 2026-10-23 session (fork)
- DONE: kernel reboot (6.8.0-147) at 06:56Z, all bots healthy after.
- DONE: DO regions — VPS Canada/Amsterdam + reseller region aliases; RDP closest-match Premium Intel when AMD sold out in a city (labelled). Deployed 1b58a8b (all 4 bots).
- DONE: DR — Hosta + BozzMail in 2-min live mirror + hourly archives (sources are standalone → no change streams).
- DONE: PhoneMonitor parent-down guard. OPEN (owner): Nomadly's main Twilio account inactive since 2026-10-22 00:00Z (Twilio 20003) — 49 Twilio lines affected.
- Backlog: realtime change streams for Hosta/BozzMail (needs replica-set conversion, ~30s downtime each); Vultr 401 stale key (RDP grace destroy); Contabo invalid_client.

## 2026-10-24 — CloudIVR web bot-parity (21 features) + English/French/Spanish — TESTED (iteration_118/119), preview only
- Details: memory/CHANGELOG.md (2026-10-24) + memory/CLOUDIVR_BOT_WEB_GAP_AUDIT_2026-10-24.md. Calls/purchases are DRY-RUN (MOCKED) in preview.
- Re-translate after UI text changes: `node scripts/civr_i18n_extract.js && python3 scripts/civr_i18n_translate.py`.
- NOT pushed / NOT deployed: owner uses "Save to GitHub" when ready (main redeploys all 4 bots; js/voice-service.js is the live call engine).
- Backlog: localized default IVR greeting prefill (LOW), React "option complex children" dev warning (LOW), Telegram-style per-language voicemail greeting for Spanish (voicemail languages are EN/FR/PT/AR only).

## 2026-10-24 — AI Voice Agent (Telnyx media streams ⇄ OpenAI Realtime) + Telnyx line-limit redial — TESTED (iteration_121), preview only
- Inbound receptionist + outbound AI campaigns, $0.20/started minute from wallet, Pro+ only, goodbye+hangup when wallet empty, DNC list, 8am–9pm lead-local calling, transcripts + summaries, free browser test talk.
- Bulk campaigns now wait and redial leads when Telnyx line limit is hit (never failed for busy lines).
- Details, architecture, tests and next steps: `memory/AI_VOICE_AGENT_2026-10-24.md`.
- **NEXT AGENT → start with `memory/NEXT_TASKS_2026-10-24.md`**: (1) verify coupon countdown banner / Telegram channel welcome card / central SIP list, (2) AI agent Google Calendar appointment booking, (3) playable AI call recordings.

## 2026-10-24 — NEXT_TASKS done + bot-parity confirmed — TESTED (iteration_122/123), preview only
- Tasks 1-3 of memory/NEXT_TASKS_2026-10-24.md done: coupon banner / channel card / central SIP list verified; AI agent Google Calendar booking
  (needs owner's GOOGLE_OAUTH_CLIENT_ID/SECRET — owner chose "later", UI shows "not switched on yet"); AI call recordings ($0.02/min, 90 days).
- iteration_122 fixes verified (iteration_123, 100%): needCalendar lockout, SIP card gaps, MobileNav channel link, per-account channel card.
- Bot-vs-web gap (21 features) CONFIRMED done; the one missing piece "Resume last draft" on Quick IVR added (pages/quick/Draft.js,
  per account in localStorage, cleared on call placed / discard / logout). Unknown /cloudivr/app/* paths now redirect to the dashboard.
- Owner decisions kept: NGN bank transfer NOT on web (wallet + crypto only); web languages EN/FR/ES.
- Backlog: Google Calendar keys (owner), signed/expiring URLs for AI call recordings (P2), localize dates in FR/ES recording note (P3),
  first real Telnyx AI call + prod nginx WebSocket headers before deploy (P0 when going live). NOT pushed / NOT deployed.

## 2026-10-24 — CloudIVR growth batch + Text calls (deaf / hard-of-hearing) — TESTED (iteration_124/125/126), preview only
- Shipped (agent-tested, not user-confirmed): crypto plan upgrade, 2FA (authenticator app OR email code, 8 backup codes,
  remember browser 30 days, email codes max 1/min, Google-only accounts can email a code to turn 2FA off), referrals ($10/$5),
  feature suggestions with admin adopt + credit, mobile bottom-nav Inbox + "Suggest a feature" in More, call recording Pro+,
  backup transfer numbers (forwarding / Quick IVR / campaigns; IVR-menu forward keys also use the number's forwarding backups —
  owner confirmed), web SIP domain sip.cloudivr.net (bot keeps Speechcue).
- NEW Text calls (/cloudivr/app/text-call, Pro+ caller number, call rate + $0.03/min, per started minute, transcripts 90 days):
  user types → Telnyx speak; their speech → Telnyx real-time transcription (Google, interim results, track inbound; Telnyx
  engine fallback); keypad DTMF for phone menus; quick phrases in EN/ES/FR; text size; flashing border on new speech;
  history with transcript + delete. Engine js/relay-call/ (heartbeat, restart revive, stale-call sweep, bill-once ledger
  callRef). Preview DRY-RUN uses a scripted pretend person (js/relay-call/preview.js) — **MOCKED in preview**.
- Not done yet (owner list): number-compliance paperwork checklist, new logo + "real phone company" redesign
  (blueprint in /app/design_guidelines.json), first real Telnyx text call test before going live.

## 2026-10-24 — Answer incoming calls in the browser (Voice or Text) — BUILT, NOT YET TESTED (see status block below)
- **Next agent: start with `memory/NEXT_TASK_BROWSER_ANSWER_TEXT_OR_VOICE.md`** (owner decisions, code facts, design, edge cases, test plan).
- Owner decisions: opt-in per number; text answer billed like outgoing text calls (call rate + $0.03/min); per-number answer mode (ask / remember voice / remember text);
  alerts = flashing banner on every page + background notification + flashing tab title (no vibration); unanswered → number's current fallback.

## 2026-10-24 (session 2) — 3 owner features BUILT, combined test round still PENDING
Owner asked: (1) buy an extra number on web CloudIVR with crypto, (2) bot users can set backup numbers like the web,
(3) answer incoming calls in the browser by Voice or Text. Owner rule: "Complete building all three features first, then test
everything together." All 3 are coded; NONE has been through the testing agent yet. Preview is DRY-RUN (**MOCKED**: numbers,
calls and SIP are simulated; inbound calls use a pretend-call simulator).
- Crypto extra numbers: js/cloudivr-web/{numbers,extras,orders}.js + frontend pages/BuyNumber.js, pages/number/BillingExtras.js
  (curl-checked by previous agent with civr.alice; dev route POST /api/cloudivr-web/extras/simulate).
- Bot backup numbers (Call Forwarding, single IVR transfer, bulk campaign): js/backup-numbers.js (new), js/_index.js menus/texts,
  js/voice-service.js hooks. Syntax-checked only.
- Browser answering:
  - Backend (curl-verified this session: PATCH browser-ring → simulate → answer as text → live preview relay with pretend caller
    → hangup → ended/outcome completed): js/relay-call/incoming.js (ringing + online map), js/cloudivr-web/incoming.js
    (GET /incoming {calls, now}, POST /incoming/simulate (dry-run), /:id/text, /:id/voice, /:id/decline; each call carries
    fallback text), js/relay-call/index.js answerInbound + introIn, js/voice-service.js browser-ring stage, takeInboundForText,
    declineBrowserRing, browserNoAnswer → noAnswerFallback, PATCH /numbers/:phone/browser-ring (Pro+ textRelay gate).
  - Frontend (compiles; NOT yet screenshot/tested): frontend/src/cloudivr/rtc.js (RtcProvider — browser phone lifted to app
    context + auto-connect for numbers with browser ring on & a SIP login; owner chose auto-connect), Incoming.js (banner on every
    page: Answer as text / Answer with voice / Decline, Remember checkbox, countdown + fallback, 3 s auto-answer when mode=text,
    voice pre-highlighted when mode=voice, rtc-only banner if the browser phone rings without a server entry), ringAlerts.js
    (worker-timer polling so background tabs keep polling every 2 s, flashing tab title, desktop/phone notification incl.
    service-worker fallback public/civr-ring-sw.js), pages/number/BrowserRingTab.js (new "Browser ring" tab gated textRelay:
    toggle, answer mode, text-answer language/voice/announce, alerts permission, notes, preview "Ring me now"),
    Softphone.js now uses useRtc() context, TextCall.js opens the call passed in location.state.liveId,
    Live.js "Incoming call to …", History.js "Incoming" badge, cloudivr.css civr-incoming animations.
- 2026-10-24 ~15:07Z: owner asked to push → all of the above DEPLOYED to the droplet (app-main, release 20261024T150711Z-33f7fa7)
  WITHOUT a testing round. Owner must "Save to GitHub" so the next auto-deploy keeps it. Testing all 3 features is still P0.

- 2026-10-24 ~16:45Z LIVE REAL-CALL TEST on Pro number +19379800767 (account e2e-ring-test-20261024@cloudivr.net, caller TELNYX_DEFAULT_ANI)
  via scripts/ops/real_call_test/real_call_browser.py (+ run_some.py to re-run single tests). Report: test_reports/real_call_test_2026-10-24.json,
  screenshots test_reports/real_call/. ALL PASS: answer as text (banner 2-3 s, caller speech → text, typed reply spoken, billed $0.18),
  answer with voice (browser call active, ends when caller hangs up), fallback (banner gone ~30 s → missed call logged → quick text-back sent),
  decline with a text message.
- BUG FOUND + FIXED (prod): text calls never showed the caller's words. Telnyx Google engine sent only interim (or no) transcription
  events. js/relay-call/index.js now starts the Telnyx engine first (Google = fallback) and promotes an interim that is never
  finalised to a line after 2.5 s. Unit test js/tests/relay_call_engine.test.js updated (24/24 PASS).
- Cosmetic fix: rtc.js adds "+" to digits-only SIP caller IDs (browser-phone-only banner showed 18778570205).
- Both DEPLOYED to droplet app-main (release 20261024T165123Z-f1edc30, workspace tarball deploy). Owner must "Save to GitHub"
  or the next CI deploy of main drops them. Test number +19379800767 KEPT (owner choice).

- 2026-10-24: 6 CloudIVR mascot logo samples generated (parrot, cloud, fox, owl, speech bubble, phone) → /app/memory/logos/. Owner to pick one; not applied to the app yet.

- 2026-10-24 MOBILE UI/UX PASS (web app /cloudivr, NOT deployed — owner will Save to GitHub). Owner choices: phone top bar keeps
  balance + inbox + browser phone only; language / private mode / sign out moved to bottom-nav More menu (MobileNav.js MoreSettings);
  data tables become stacked cards below 768px (ui.js useIsPhone) — LogTable (dashboard activity + number logs), Wallet deposits/history,
  Campaign leads; long lists paginate with "Show N more" (usePaged/ShowMore). New ui.js TabStrip (number detail + AI agents tabs:
  hidden scrollbar, right-edge fade, active tab kept in view). 44px tap targets (toggle hit area, copy/delete/close/back buttons,
  filter chips), 16px inputs on phones (no iOS zoom). Private-mode banner now has a "Show them" button. FR/ES short bottom-nav
  Inbox label ("Messages"/"Mensajes") + new strings translated. Audit script scripts/ops/mobile_audit.py: 0 page overflow on all
  ~35 screens at 390px. Testing agent iteration_130: frontend 100% (mobile 390 + desktop 1920 regression).

- 2026-10-24 PLAN LIFECYCLE + GROUP PRIVACY (code only — owner will Save to GitHub; NOT deployed). Owner rules:
  main line's plan expires → main + ALL extra lines suspended together (calls/SMS stop), held 7 days; restore = pay the
  plan price ($75 Pro) → main back on + extras with paid time left free; extras whose month ended pay $25 each; after the
  hold everything is released for good. Orphans (extra whose main is gone, or the Oct-22 migration's standalone former
  extras e.g. 1185070608's +1844… at $25) → suspended, restorable as a $75 Pro main line. e2eTest/internalTest lines
  (+19379800767) are free, never expire, skipped by the pricing check. New js/plan-lifecycle.js (pure patches + 4-lang
  messages); phone-scheduler uses it (hold release, orphan sweep, suspendMainLine). Bot "Renew Now" now a wallet renewal
  (old path re-ran the purchase flow on an owned number). Web POST /numbers/:phone/renew uses lifecycle; publicNumber adds
  renewalPrice/holdUntil/suspendReason; BillingTab shows hold notice + "Restore for $X"; plan changes blocked while held;
  sms-reply blocks suspended numbers. Privacy: pricing reconciler + all internal scheduler alerts → notifyAdmin only;
  adminSubPurchase group copy masked; audit-trail failure → admin; notifyGroup masks any phone in group text
  (phoneConfig.maskPhonesInText). Tests: tests/test_plan_lifecycle_2026-10.js 33/33, test_phone_scheduler_no_leak 19/19,
  grace_fix / maskPhone / admin_unmasked pass. NOT yet verified: web renew route over HTTP, bot Renew Now live, BillingTab UI.

- 2026-06 PAID PLANS / EXPIRY FIXES (audit items 1-17, PLAN_EXPIRY_AUDIT_2026-06.md) — code only, preview; owner deploys.
  P0 DigitalOcean VPS/RDP: auto-renew now works every cycle (js/vps-expiry-scheduler.js, moved out of _index.js; per-term
  claim + _renewLockUntil = no double charge; retries when wallet is topped up, incl. during DO grace → box powered back on).
  Manual renew extends by durationMonths and powers a DO VPS back on in grace. VPS/RDP auto-renew default stays OFF.
  CloudIVR: extra lines share the main line's minutes+SMS (plan-lifecycle.poolUsage, enforced + shown on web & bot); no
  nightly double counting; scheduler saves per-field (no stale overwrite); one usage reset per paid month; dev-pod guard;
  long-lapsed auto-renew charges once. Phone upgrade = 25% of current plan price if number ≤14 days old; extras follow plan.
  Hosting bot upgrade: expiry kept + FULL monthly price difference (term ended → full price, new 30 days); auto-renew
  setting kept; 50% loyalty credit offer + HostingUpgradeNudge cron removed. Reseller API plan change unchanged (days-left).
  Membership re-buy stacks on the active expiry; Daily buyers no longer get an instant "expires tomorrow"; plans never wiped
  (sanity cap 5 years). Hosting gets a 3-day reminder (grace lengths unchanged). Plan-card copy matches real features.
  Defaults: weekly hosting $30, trial OFF, overage $0.15/min $0.02/SMS. Tests: iteration_131 (149/149) + tests/*_2026-06*.js.
  Open: weekly→monthly hosting upgrade keeps the weekly expiry ($45 now, then $75/30d) — confirm with owner.

- 2026-06 CLOUDIVR LOGO APPLIED (web /cloudivr, preview only). Owner picked my recommendation: Parrot Talker recoloured to the
  app palette (emerald #34d399 body, sky #38bdf8 voice bubble/wing tips, amber #fbbf24 beak/text bubble) on the dark theme.
  Assets: frontend/public/civr/brand/ (parrot-icon-128/48.png, parrot-mark.webp, apple-touch-icon.png, icon-192.png); masters
  in memory/logos/emerald/. src/cloudivr/Brand.js: Wordmark (icon + real CLOUDIVR text) used in sidebar, mobile topbar,
  login/signup (+ floating mascot on the desktop side panel), landing nav + footer (#00E3AA accent kept on landing);
  applyBrandHead sets tab icon / apple-touch-icon / theme-color on CloudIVR pages only (hosting panel untouched); ring
  notifications use icon-192. Tested iteration_132 (frontend 100%); landing 390px "Sign in" wrap fixed.

- 2026-06 CLOUDIVR COPY + PAGE-TITLE AUDIT (web /cloudivr EN/FR/ES + bot EN/FR, hi/zh kept in sync; preview only).
  Country coverage now uses the LIVE count everywhere (web: catalog.countries.length = 17 Telnyx-only; bot:
  phone-config CLOUD_COUNTRY_COUNT from the bot's own country list) — all "30+ countries" / "live in 60 seconds" claims removed
  (landing, hero, domain-guard <title>/meta, bot hub/selectType, promo-copy en/fr/hi/zh, monetization-engine, new-user-conversion,
  auto-promo SERVICE_CONTEXT). Plan copy matches entitlements (Pro = recording, no IVR; Business = IVR). Landing: AI voice
  agents + Text calls cards, outgoing-call billing note, extra-number FAQ (3/15/30 shared minutes/SMS).
  Tab titles: src/cloudivr/PageTitle.js → "Page name · CloudIVR" per route, translated via tr(); landing keeps
  "CloudIVR — Virtual phone numbers, IVR & AI voice agents". LangProvider exposes `ver` (bumps after a dictionary loads) so
  titles/TabStrip re-measure on language switch. NumberDetail tabs px-3 so French fits at 1920px. FR FAQ uses "SVI".
  Bot has no Spanish language (Spanish = website only, per owner). Helper scripts: memory/copy_fix_{web,bot,bot2}.py.
  Tests: testing agent frontend pass (report not written — credits ran out mid-run), node checks, test_cloudivr_hours_vm_notes
  31/31 (stale Pro-recording assertion updated). test_promo_pipeline 4 failures = hosting/lead env prices null in bare shell (pre-existing).

- 2026-06 KEYPAD MENU vs AI VOICE AGENT — NO OVERLAP. ⚠️ CODE DONE, NOT TESTED (session paused by owner).
  Owner's choices: (1) only one can answer a number (turning one on turns the other off, with a clear notice);
  (2) AI voice agent is now BUSINESS-ONLY (Pro customers who use it lose it; the owner accepted this);
  (3) names on the web: "Keypad menu (IVR)" and "AI voice agent". The bot has no AI agent, so its "IVR / Auto-attendant"
  wording was left alone, except the Business list line 'IVR Auto-Attendant with AI voice' → '(callers press keys)'.
  Backend: phone-config pro.aiAgent=false + upgradeMessage aiAgent→Business; cloudivr-web/numbers.js WEB_FEATURES
  relabelled/reordered (recording, ivr, aiAgent last), catalog.rates.aiAgentPerMin, routeSummary primary 'ai_agent',
  PUT /numbers/:phone/ivr switches the AI agent off (returns aiAgentTurnedOff), startup updateMany switches the keypad menu off
  on numbers that had both on (the AI agent already took those calls); cloudivr-web/ai.js PUT /numbers/:phone/ai-agent
  switches the keypad menu off (returns ivrTurnedOff) + "needs the Business plan" message; calls.js caller() plan name
  is now dynamic; support.js knowledge explains the difference; domain-guard meta says keypad menus (IVR).
  Frontend: NumberDetail tabs 'Keypad menu' / 'AI voice agent'; IvrTab + AiAgentTab show OneAnswerNote (in RouteSummary.js);
  RouteSummary handles ai_agent; BrowserRingTab blockers; Dashboard/Widgets/AiAgents PlanNote/AiCampaignFields copy;
  Campaigns.js empty state keeps the kind switch (before, picking "AI" with no eligible number hid the switch);
  landing Hero/Sections/PricingFaq (new FAQ "What's the difference between the keypad menu and an AI voice agent?").
  i18n: 39 new FR/ES keys via memory/copy_fix_ivr_ai.py (fr/es.json now key-sorted, 1784 keys, valid JSON).
  Checks so far: node --check OK on all edited backend files, nodejs restarted, frontend "Compiled successfully".
  NEXT AGENT TODO:
   1. Update the stale tests for the new rule: backend/tests/test_cloudivr_ai_agents.py line ~230 expects inc("pro") True →
      now False; the line ~41 helper already uses a Business number. Check js/tests/test_bulk_line_limit_ai_2026-10.js still passes.
   2. Curl: GET /api/cloudivr-web/public/catalog → Pro webFeatures aiAgent included=false, Business true, rates.aiAgentPerMin.
      As Alice (Business, civr.alice@example.com / AliceTest#2026): PUT /numbers/<phone>/ai-agent {enabled:true, agentId}
      while the keypad menu is on → ivrTurnedOff true and features.ivr.enabled false; PUT /numbers/<phone>/ivr enabled
      → aiAgentTurnedOff true. As Bob (Starter) → 403 "needs the Business plan". Restore Alice's settings afterwards.
   3. testing_agent (frontend): number tabs renamed, both notices, route summary "Your AI voice agent answers every call",
      AI Agents page Business note, New campaign → AI kind with no Business number shows the empty state AND the kind
      switch, landing cards/FAQ in EN/FR/ES, plan cards (Pro no longer lists the AI voice agent as included).
   4. Then finish and tell the owner that existing Pro numbers with the AI agent on now fall back to normal call handling.

  ✅ UPDATE (next session): all 4 steps done — backend tests fixed, curls OK, testing agent iteration_133 frontend 10/10.

- 2026-06 CLOUDIVR UX HEURISTICS (Nielsen's 10) — web /cloudivr, preview only. Owner picked ALL: crash screen + offline
  banner, unsaved-changes warning, search on lists, Help center (own page in the sidebar + '?' help links), confirm/undo on
  every delete, basic keyboard shortcuts.
  New modules (src/cloudivr): confirm.js (styled ask(), ConfirmHost in CloudIvrApp; i18n `ask` re-exports it), undo.js
  (undoable(): hide now, DELETE after 6 s or on tab close, Undo restores), guard.js (useUnsaved(value) + bind/reset,
  UnsavedGuard in Shell intercepts in-app links/beforeunload, confirmLeave() also used by number tabs, '?' and sign-out,
  SaveRow/UnsavedPill), safety.js (CrashGuard in Shell main + top level, ?crashTest=1 in dev builds, OfflineBanner),
  search.js (useSearch: matches English data AND the translated text, phone digits ignore spaces/+; SearchBox with x/y count,
  × clear, Esc clears; NoMatches card), shortcuts.js ('/' focuses the page search, '?' help for this page, Esc closes the
  browser phone; dialogs/chat handle their own Esc), pages/Help.js + pages/help/topics.js (26 articles in 6 groups + landing
  FAQ as "Plans and prices"; ?topic= shows "For this page: …"; "Still stuck?" opens the help assistant; shortcuts card).
  Wired: nav "Help center" (Account group / phone More menu), topbar '?' (hidden < 640px), search on My numbers, Inbox,
  Campaigns, Audio library, AI agents, AI call history, Do-not-call list, number Logs; unsaved guard on Forwarding, Voicemail,
  SMS, Hours, Keypad menu, Browser ring, number AI agent tab, agent form, Settings profile + password, New campaign; Undo on
  audio delete + text-call history delete (plus earlier: IVR templates, DNC, quick presets/scheduled); help-assistant Clear chat
  now confirms, has a Help center link, Esc closes, sends the current screen label (support.js `page`, sanitised ≤80 chars);
  api.js plain-language fallback errors (401/403/404/413/429/5xx/offline). Closed browser phone is inert/aria-hidden.
  i18n: 149 new FR/ES keys via scripts/civr_i18n_fill_missing.py (keeps every existing key — the stock
  civr_i18n_translate.py DROPS keys the extractor no longer sees; do not run it as-is). fr/es.json now ~1935 keys.
  Tests: testing agent iteration_134 frontend 100% (desktop + 390px, EN/FR/ES). Testing agent left a TTS audio
  "TEST_undo audio" in Alice's library.

- 2026-06 CLOUDIVR 3CX-GAP FEATURES — BUILT, curl + sandbox-tested, UI NOT yet tested by the testing agent (owner paused).
  Text Triggers (Auto Callback / Text-to-Call message / AI agent calls them back; keyword, business hours, once per sender per hour),
  AI summaries + caller mood for voicemails & recorded calls ($0.10/min), Ring groups (several phones at once; fallback voicemail /
  backup number / message), Call-event webhook feed for CRMs/Zapier (5 signed events), installable app (PWA). FR/ES strings added.
  Full map, test plan and 3CX backlog: memory/CLOUDIVR_3CX_FEATURES_2026-06.md. NEXT: run testing_agent on the new screens.

## 2026-10-25 (fork 3, later) — Owner task list: webhook SSRF fix, secret button, 13 small fixes, What's New popup — TESTED (iteration_136/137)
- Status of all 6 owner tasks (incl. "bot gaps = already done" and the pending REAL-CALL checklist): **memory/TASKS_2026-10-25.md**.
- New: js/safe-url.js (shared webhook guard, save + every send), frontend/src/cloudivr/WhatsNew.js, update.js.

## 2026-10-25 (fork 3) — "Text Triggers not on production" RCA + update banner + 3CX test round (iteration_135)
- RCA: prod (cloudivr.net, release 6c52894b, CI from main) HAS Text Triggers; owner's tab was loaded 14:44Z before the 15:58Z deploy
  and an SPA never reloads itself → old UI. Fix: frontend/src/cloudivr/update.js (UpdateWatcher in CloudIvrApp, UpdateBanner in Shell):
  compares /static/js/main.<hash>.js of the running page with a fresh cp('/app') HTML (5 min / focus / page change, ≥60 s apart),
  shows "A new version of CloudIVR is ready" (Refresh now / Later) and auto-reloads once per build on the next page change when no
  unsaved form and no browser-phone call. FR/ES added. Tested A1–A8 PASS. NOT deployed — owner: Save to GitHub (main) → CI deploy.
- 3CX features tested report-only: 13 findings (1 HIGH webhook SSRF, 1 MEDIUM show-secret button) — list in
  memory/CLOUDIVR_3CX_FEATURES_2026-06.md "Session 3". Awaiting owner approval to fix.

## 2026-06 (fork 2) — 3CX features testing: STILL PENDING
- Owner paused again before the testing agent ran. No code changed. Owner rules for testing: simulated calls/texts only,
  report problems first and fix only after approval, no setup re-run needed.
- Prepared a fresh voicemail row for the manual Summarize test. Full status + next steps in `memory/CLOUDIVR_3CX_FEATURES_2026-06.md`
  ("Session 2 (fork) progress").


## 2026-10-25 (fork) — deploy + live real-call checks + Telnyx webhook signatures
- Settings #webhooks/#install deep link scroll fixed for slow/uncached loads (spinner placeholder has no id; hook waits until no
  loading-indicator in settings-page and 10 still ticks). Self-tested at 390/1366/1920 with CDP cache-off + 700–1200 ms latency.
- PUT /webhooks without `events` keeps the saved events (no silent wipe).
- LIVE real calls on cloudivr.net (2 temporary Telnyx lines, released afterwards): ring group first-answer-wins, ring group
  no-answer fallback, Auto Callback (real SMS → owner rings → DTMF 1 → texter bridged), Text-to-Call message — ALL PASS.
  Report test_reports/live_3cx_test_2026-10-25.json, script scripts/ops/real_call_test/live_3cx_test.py.
- Bugs found by the live run, fixed + deployed: (1) Telnyx delivery reports (message.finalized) were handled as inbound texts →
  duplicate Text Trigger runs/charges and duplicate forwards; now only message.received. (2) answered ring-group calls were missing
  from Logs → logged as 'forwarded' with forwardTo = answering phone.
- SECURITY: Telnyx Ed25519 webhook signature check (js/telnyx-webhook-verify.js) on sms/voice/fax webhooks; enforced on prod
  app-main (TELNYX_PUBLIC_KEY); pass-through in dry-run preview / when the key is missing. Unit js/tests/telnyx_webhook_verify.test.js 13/13.
- Still pending from the real-call checklist: 2c AI agent call-back, 2e AI summary of a real recorded call, 2f call-event webhook
  with a real call (webhook.site), and TELNYX_PUBLIC_KEY on wl/voodoo/proshop.

## 2026-10-25 ~19:00–19:20Z — web inbox promo leak fixed + remaining live call checks (all deployed to app-main)
- USER BUG: bot promo ("TODAY 10% OFF… Fill your dialer… /stoppromos") reached CloudIVR web inboxes. Bot-wide sends now skip
  web ids (>= 5e15): auto-promo getAllChatIds, admin broadcast, marketplace new-listing broadcast, /gift5all (utils.getTelegramChatIds).
  Backstop: cloudivr-web/notify.js push() drops any text with the /stoppromos footer. Old promo rows deleted (prod 4, preview 1) with
  scripts/ops/clear_web_promos.js. Tests: js/tests/test_promo_skips_web_accounts_2026-10.js (ALL PASS), iteration_138 (100%).
- LIVE (prod, real Telnyx): 2e AI summary of a real voicemail (transcript + summary + mood + action items, $0.10) and 2f call-event
  webhook (call.started, call.ended, voicemail.left, ai_summary.ready, all X-CloudIVR-Signature valid) PASS; 2c AI agent calls a
  texter back — real 2-way conversation (35 s, $0.20, nginx WebSocket OK) PASS. Test number +19379800767 back on Pro; test wallet
  got +$10 test credit (now ~$10.41). Temp line released, temp Telnyx app deleted.
- BUG FOUND LIVE + FIXED: voicemails were LOST when the caller hung up (Telnyx sends call.recording.saved after call.hangup and the
  session was already deleted) → voice-service keeps ended recording sessions 10 min (_endedRecordingSessions). Sandbox test
  js/tests/test_voicemail_after_hangup_2026-10.js 9/9 (fails 6/9 without the fix). Same fix covers call recordings.
- AI call outcome labels: summary prompt now defines each outcome (a simple answered question → "other", not "no_conversation").
- Minor (not fixed): the voicemail recording includes the second half of the greeting ("Please leave a message after the tone").

## 2026-10-25 ~19:30–20:05Z — cleaner voicemails, brands protected, Inbox unread badges
- VOICEMAIL: unanswered SIP/phone-app ring → noAnswerFallback answered and handleCallAnswered routed AGAIN → greeting twice,
  second recorded. Fixed (origSession._fallbackRouting). Voicemail recording starts with Telnyx play_beep (voicemail only).
  Call recording ON → greeting-only call recording stopped + dropped (_dropNextRecording). Sandbox test 18/18.
- BRANDS: TELNYX_PUBLIC_KEY added to wl/voodoo/proshop (scripts/ops/enable_telnyx_sig_brand.sh: 0 live calls, forged → 403,
  real signed leg accepted). ALL 4 brands enforce Telnyx signatures.
- INBOX: unreadByKind in GET /notifications; POST /notifications/read {kind}; filter pills show unread badges (99+ cap);
  "Mark these as read (n)" per filter. fr/es. iteration_140 + own checks (390px, fr, es, topbar 36→19).
- Deployed to app-main 20261025T195841Z-291899e. Brands get voicemail/inbox changes after the next "Save to GitHub".


## 2026-10-26 (fork 4) — re-check of iteration_143 findings, sample emails, pre-launch check
- Re-checked all 7 iteration_143 items in the preview (FR/ES, 390 + 1920): mobile landing CTA fits (FR right 379px, ES 374px, no
  overflow), hero eyebrow wraps inside its box, "Starter comprend :" / "Starter incluye:", upgrade dialog waits for /numbers
  ("Checking your numbers…"), Text calls lists Pro numbers as "· forfait Business" with lock + pop-up (start disabled),
  Buy page ✗ legend gone, low-balance 0 → API toast. Money in FR/ES emails is local style (50,00 $) — confirmed.
- Fixed: Email-switch toasts were English-only ("Weekly summary on") → "{0} turned on/off" + fr/es ("Résumé hebdomadaire : activé").
- New ops script scripts/ops/send_sample_emails.js (NODE_PATH=js/node_modules node scripts/ops/send_sample_emails.js <to> [chatId]
  [--langs=en] [--extra=fr:topup]). Sent 18 samples to moxxcompany@gmail.com (14 types EN + topup/weekly FR+ES), all accepted by SMTP.
- Node email harness 38/38. deployment_agent flags (.env in .gitignore, CORS_ORIGINS, no nodejs supervisor block) are for Emergent
  hosting only — prod is GitHub main → CI → DO droplet (PM2), so not blockers. Go live = Save to GitHub (main).

## 2026-10-26 (fork 4, later) — Hours switch fix, off-hours forwarding, cookie banner, short SIP logins LIVE — TESTED (iteration_144)
- BUG (user): "Use a weekly schedule" said "Turn on at least one day…" although Mon–Fri showed ON. Cause: never-saved hours —
  the page showed the default week, the switch checked the DB (empty); it also saved UTC instead of the shown time zone.
  Fix: Hours tab toggle PUTs the shown form (days, zone, off action) with enabled; SWITCHES.hours need() falls back to
  defaultHours(); never-saved default offAction = 'message' on plans without voicemail (numbers.js hoursOf).
- NEW: off-hours "Forward to backup numbers" (offAction 'forward', features.hours.offForward, up to 5, 10-digit US auto +1):
  voice-service routeOffHours → playHoldMusicAndTransfer(first, {backups: rest}) with session.bridgeRingSecs = 20; nobody answers →
  offHoursEnd (voicemail on plans with it, else closed message); empty wallet → straight to offHoursEnd. Hidden junk list never
  blocks saving voicemail/message. Sandbox test js/tests/test_offhours_forward_2026-10.js 14/14 (mongod :27999).
- NEW: cookie consent banner (CookieBanner.js + consent.js, key civr.consent v1): Allow all / Allow selection / Deny / X (= necessary
  only), switches Necessary(locked)/Preferences/Statistics/Marketing, Show details; reopen from landing footer "Cookie settings" and
  Settings > Language card. Statistics = PostHog (public/index.html init: opt-out + memory persistence + no replay on CloudIVR pages
  until consent). Preferences = text-call setup/size, dismissed channel card (sessionStorage only without consent). Marketing =
  civr.ref referral code. fr/es done. NOTE for testers: the banner covers the bottom of the screen on first visit.
- SIP SHORT LOGINS — LIVE on all 4 brands (no deploy needed): root cause of "still long" = SIP_SHORT_LOGINS was never set in prod.
  Live test on app-main with +19379800767 (E2E test acct): REGISTER 200 (sip.telnyx.com + sip.speechcue.com), inbound INVITE delivered
  to the short login, outbound recognised ("Outbound SIP: from=cv…", caller ID = the number, connection fee billed). Then
  scripts/ops/shorten_sip_logins.js switched EVERY non-released number (owner choice "switch automatically"): app-main 19/19,
  app-voodoo 2/2 (wl/proshop have none) — new per-number credential connections, old gencred credentials deleted, owners told
  their new user/password/server (Telegram in their language, web inbox for web accounts; 1 bot user had blocked the bot:
  chat 890522022, suspended Twilio number +18083749780). SIP_SHORT_LOGINS=true added to all 4 shared backend.env (backups
  *.bak.shortsip.*) and each active slot restarted at 0 calls (scripts/ops/enable_short_sip_brand.sh). Probe tool:
  scripts/ops/real_call_test/sip_probe.py. Telnyx account now has 34 credential connections; if Telnyx ever refuses a new one
  ("Connection limit reached") new numbers fall back to the long login automatically.
  ⚠️ During the live test one short call was placed TO a real customer number (+18333753298, web acct onarrival21@gmail.com) —
  it rang ~2 s, they got a missed-call notice and 1 plan minute; owner informed.
- Hours/forward/cookie CODE is preview-only until "Save to GitHub" (main → CI deploy; then sync main → WhiteLabel for wl/voodoo/proshop).
- Pre-existing unrelated: js/tests/test_cloudivr_hours_vm_notes_2026-10.js has 2 stale plan-matrix assertions (Pro has IVR now; 'preset').

## 2026-10-26 (fork 5) — Go-live prep: web-only release — READY, waiting for owner "Save to GitHub"
- deployment_agent flags (.env in .gitignore, CORS_ORIGINS, supervisor nodejs block) are Emergent-hosting only → NOT changed
  (un-ignoring .env would publish secrets to GitHub). Prod = GitHub main → CI (deploy.yml deploy-main) → DO droplet app-main.
- Live before this save: app-main sha 5a1ffad4 (emails + plan locks); wl/voodoo/proshop e433e1ac (WhiteLabel).
- Owner: only the web (cloudivr.net / app-main) gets this update → `.github/workflows/sync-whitelabel.yml` auto-sync PAUSED
  (`if: workflow_dispatch` only; original line kept in a comment). Resume = restore that line, or Actions → "Sync main →
  WhiteLabel" → Run workflow. Next sync carries ALL main changes since the last sync to the 3 WL brands.
- Fixed 2 stale assertions in js/tests/test_cloudivr_hours_vm_notes_2026-10.js (Pro has IVR; redial/presets are web features) → 31/31.
  Emails 38/38, off-hours forward 14/14, eslint src/cloudivr 0 errors. Removed pod-generated frontend/yarn.lock (deploy uses npm).
- Next: after owner saves, verify CI deploy-main → app-main RELEASE sha = new main, /health, cloudivr.net Hours + cookie banner.

## 2026-10-26 — PROD check: onarrival21@gmail.com (web chatId 5000000000000002) text reply — DELIVERED
- 12:30:27Z "Text back" from toll-free +18333753298 → +19379800767 (our E2E test number, the missed call from the SIP live test):
  Telnyx 4031a178… status delivered, no errors; received inbound 12:30:28Z. On-net Telnyx→Telnyx, so no carrier filtering.
- Telnyx account has 0 toll-free verification requests (+18333753298 unverified; 10DLC does not apply to toll-free). Texts to
  real US mobiles will likely be refused (unverified toll-free, Telnyx 40329). App marks 'sent' on API accept and ignores
  message.finalized (js/_index.js ~48526), so a later carrier block would still show as sent. NOT_REGISTERED regex lacks 40329.

## 2026-10-26 — Web text delivery results (Telnyx delivery reports) — TESTED (iteration_145 + unit 10/10), preview only
- Owner choices: an undelivered text is NOT charged (plan text given back + extra-text charge refunded); customer sees it on the
  text + an Inbox alert (no email).
- Telnyx `message.finalized` on /telnyx/sms-webhook → `cloudivrWeb.smsDelivery` (3 s delay so the send route has saved its
  copies) → `sms-reply.applyDeliveryReport`: phoneLogs sms_out (webReply, status sent/unconfirmed → delivered | unconfirmed |
  failed + smsReason/smsErrorCode), copies on the answered missed call (`reply.status/reason/code`) and inbox item
  (`meta.reply.*`). Failed → `giveBack` (smsUsed −1 if > 0, wallet credit of doc.charge + transactions `sms-refund`
  `_id smsref-<logId>`, wallet row "Refund · text not delivered") + notify.push kind sms, meta.smsFailed (no Reply button).
  Duplicate reports are no-ops (status filter). send() now stores chatId, charge, inboxId on the text.
- `reasonOf(code)` plain reasons: 40329/40330 toll-free approval, 40010/40019 10DLC, 40300 STOP, 40001/40012/40301/40310/40319
  landline/can't receive, spam (40002/3/15/17, 40322), carrier limits (40011/16/18/20), else "The carrier didn’t deliver this
  text." Also used for errors refused at send time (old regex wrongly called 40011–40013 "not registered").
- UI: `SmsStatus` (QuickReply.js) Sent / Delivered / Not delivered: reason on Logs rows ("SMS not delivered" amber label),
  Text back replies, Inbox replies; "Reply again" hidden after a STOP failure; delayed reload ~6 s after sending.
  i18n fix: "Texted back: “{0}”" / "You replied: “{0}”" now separate from the preview suffix (empty {1} never matched).
  Wallet LABEL sms_reply → "Extra text". fr/es added.
- Tests: js/tests/test_sms_delivery_2026-10.js (sandbox mongod :27999) 10/10; backend/tests/test_cloudivr_sms_delivery.py.
  Preview replay: `node /tmp/seed_sms_delivery_preview.js` + POST message.finalized payloads (ids seed-ok/seed-tf/seed-stop).
- PROD facts: +18333753298 (onarrival21) toll-free is unverified (0 toll-free verification requests on the Telnyx account).
- Live after "Save to GitHub" (app-main only; WhiteLabel auto-sync paused). app-main went to release 20261026T122832Z-5ce0744 at 12:29Z.


## 2026-10-26 (fork 6) — Starter copy fixes + LIVE (direct droplet deploy, app-main only)
- Starter browser phone / SIP block / downgrade keep-settings / provider-name scrub / landing copy: iteration_146 100%.
- Copy fixes from iteration_146 (owner choice "Answer in your browser, upgrade for desk phones"):
  RouteSummary sip_ring on plans without sipCredentials → "Calls ring your browser phone. Desk phones and SIP apps are on a
  higher plan." (+ skipped pill "Browser ring"); Incoming banner: ring payload has `sipApps`; hints no longer contradict
  (Starter preview → "Preview calls only show how the banner looks…", Starter live not-on-network → browser + upgrade note);
  fr "/mo" → "/mois". fr/es added. Self-tested (EN/FR, 1920 + 390), test_starter_browser_phone 20/20, hours_vm_notes 31/31.
- Handoff's "deployment blockers" (.gitignore .env, CORS_ORIGINS, supervisor block) are Emergent-hosting only → NOT changed again.
- DEPLOYED 14:11Z via scripts/deploy_workspace_to_droplet.sh app-main → release 20261026T141118Z-b428ce1 on :5000 (app-main-a),
  /health healthy, 0 restarts, cloudivr.net serves the new bundle. Rollback: `bash /opt/nomadly/deploy.sh app-main rollback`.
- PENDING (owner): "Save to GitHub" (main) or the next CI deploy of app-main drops this release. WhiteLabel brands untouched.


## 2026-10-26 (fork 6, later) — CloudIVR emails from hi@cloudivr.net (Brevo API) — LIVE on app-main
- Owner: only CloudIVR emails move to hi@cloudivr.net (Nomadly bot hosting mails stay hosting@priv.host); no reply inbox (no MX).
- Brevo account behind BREVO_API_KEY (prod key) = "Dynopay" (moxxcompany@gmail.com, SMTP login bbcd85001@…). The app's SMTP login
  76a914001@smtp-brevo.com is a DIFFERENT Brevo account → CloudIVR mail now goes through the Brevo API, not SMTP.
- Brevo: domain cloudivr.net added + authenticated (id 6adf62c582fccec84b0c8915), sender id 11 "CloudIVR <hi@cloudivr.net>" active.
  Cloudflare zone da39d84510bac341a9b6ed6a6e8442ea (DNS only): CNAME brevo1/brevo2._domainkey → b1/b2.cloudivr-net.dkim.brevo.com,
  TXT @ brevo-code:4831905d…, TXT @ "v=spf1 include:spf.brevo.com ~all", TXT _dmarc "v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com".
- Code: js/cloudivr-web/auth.js sendMail → sendViaBrevo (POST /v3/smtp/email, sender CloudIVR, attachments base64, headers e.g.
  List-Unsubscribe) when CLOUDIVR_MAIL_SENDER + BREVO_API_KEY are set; else the old SMTP path (WL brands unchanged).
  js/sms-service.js forwardSmsToEmail(…, web) → web accounts' SMS-to-email come from CloudIVR <hi@cloudivr.net>.
- Env: CLOUDIVR_MAIL_SENDER="hi@cloudivr.net" in preview backend/.env and /opt/nomadly/shared/app-main/backend.env (backup *.bak.civrsender.*).
- LIVE: release 20261026T143350Z-2cb5f7f (workspace tarball). Real send from the live release → Brevo "delivered" + "opened".
  Emails harness 38/38; stubbed sendViaBrevo payload check OK.
- ⚠️ Preview BREVO_API_KEY (different value from prod) is disabled in Brevo ("API Key is not enabled") → preview CloudIVR emails
  fail until the key is replaced (asked via secrets card). Also: priv.host is NOT authenticated in the Dynopay Brevo account.
- PENDING (owner): "Save to GitHub" (main) or the next CI deploy drops both of today's releases.

## 2026-06 — Light email design + bot welcome emails — TESTED ON PREVIEW, NOT DEPLOYED
- All CloudIVR emails (cloudivr-web/email-layout.js) now use the light "Sample 1" card: logo above, white card with an accent bar,
  tinted eyebrow pill, ink title, tinted step numbers. layout() also takes `brand` {name, logo, href} for white-label senders; tone() accepts {fg,bg}.
- Bots (all 4 brands): new optional "Add your email" step right after a new user picks a language (Skip → intent picker as before).
  Saves accountEmail + lastOrderEmail (prefills hosting checkout). js/bot-welcome-email.js sends one branded welcome email (brand name,
  /assets/brand/<slug>/logo.png on PANEL_DOMAIN, brands.json accent, bot link, APP_SUPPORT_LINK) the first time a user gives an email
  (join step OR hosting checkout). state.welcomeEmailSentTo dedupes; reset on send failure so it retries.
- Verified: sim flow (mock Telegram), cloudivr email tests 38/38, real MailerSend send from hosting@hostbay.io accepted, logos 200 on all 4 domains.
- Prod MAIL_SENDER per brand: hosting@hostbay.io / smadavhost.com / voodoohost.xyz / proshophost.xyz (all MailerSend-verified).

## 2026-10-28 — Personal daily offers + in-app light mode — TESTED (iteration_166: backend 11/11, frontend 95% → follow-ups fixed), NOT DEPLOYED
- js/cloudivr-web/offers.js: one offer per web account per UTC day (webOffers `<day>:<chatId>`), best fit: renewal due ≤7 d / suspended → 15% off
  renewal; no numbers → 10/15/20% off a number (personal code CIVRxxxxxx, owner-only, single use); never topped up → first top-up +20% (≥$25, max $50);
  Starter/Pro → alternates 20% off upgrade / top-up tiers ($50→$55, $100→$115, $250→$300); else alternates tiers / number code.
  Routes GET /offers/current, POST /offers/dismiss (dismissed until next day). Applied in coupons/check + purchase, /renew, /upgrade (+crypto
  upgrade-checkout offerPct). Top-up bonus: snapshot on webDeposits.bonus, paid by extras.js 60 s tick once the wallet-topup tx exists; the offer is
  claimed atomically first → ONE bonus per offer. Inbox daily notice marker `offer:<day>:<id>`. Bot daily 10% codes still accepted on web.
- Frontend: offers.js useOffer hook; dashboard banner (dismiss X), checkout "Your offer" tap, Wallet OfferNote tiers + bonus calc (?amount=),
  Billing renew/upgrade offer notes, Inbox CTA (hidden when expired/used).
- Light mode: theme.js (civr.theme = system|light|dark, html[data-civr-theme]) mounted in Shell + auth pages only; theme-light.css (vars,
  component overrides, generated map of dark Tailwind hex classes). Toggles: topbar sun/moon, Settings → Appearance, mobile More menu.

## 2026-10-28 — Zoho CPaaS email (replacing MailerSend) — IN PROGRESS
- Zoho key (ZOHO_CPAAS_API_KEY, secrets) is an EU mail-agent send key: only https://cpaas.zoho.eu/v1.1/email accepts it.
  Domain APIs need a Zoho OAuth token (we don't have one) → owner adds domains in the Zoho console; agent does DNS in Cloudflare.
- cloudivr.net: DKIM TXT 28152758._domainkey + CNAME bounce-zem → cluster89.zeptomail.eu (owner added). Test welcome email to
  moxxcompany@gmail.com arrived fine (owner confirmed). cloudivr.net has NO MX (hi@cloudivr.net can't receive).
- js/mailer.js: MAIL_PROVIDER=zoho → sendZoho() only, no fallback (owner choice "Zoho only"). Env: MAIL_PROVIDER=zoho,
  ZOHO_CPAAS_EMAIL_URL=https://cpaas.zoho.eu/v1.1/email (set in preview .env). Rollback: MAIL_PROVIDER=auto (MailerSend).
- PENDING: owner adds hostbay.io, smadavhost.com, voodoohost.xyz, proshophost.xyz in Zoho (same mail agent) and sends the DNS
  records; agent adds them in Cloudflare, tests each sender, then sets the 3 env lines on all 4 prod bots + deploys mailer.js.
- 2026-10-28 PIVOT → Telnyx Email (owner choice, send-only). scripts/telnyx_email_domains.py setup|verify <domains> registers the domain on
  Telnyx, publishes DKIM telnyx1._domainkey + ownership TXT in Cloudflare, merges include:spf.telnyx.com into SPF, keeps existing DMARC.
  cloudivr.net, hostbay.io, smadavhost.com, voodoohost.xyz, proshophost.xyz → all VERIFIED. mailer.js MAIL_PROVIDER=telnyx → sendTelnyx()
  (POST /v2/email_messages, TELNYX_API_KEY), no fallback. Preview .env MAIL_PROVIDER=telnyx. Test sends to moxxcompany@gmail.com delivered.
  Zoho code path kept (MAIL_PROVIDER=zoho) but unused. PROD NOT SWITCHED YET (needs MAIL_PROVIDER=telnyx on 4 bots + code deploy).

## 2026-10-28 — Landline to Texting (Telnyx Hosted SMS) — WEB ONLY — TESTED (iteration_167 + fixes), NOT DEPLOYED
- Owner rules: $300 setup with ownership code, $500 without; + $50/month from wallet (unpaid → paused, retried daily);
  full refund if rejected/cancelled; customer uploads bill PDF, WE generate + e-sign the LOA after a consent tick; texts
  $0.05 each from wallet, sent OR received (owner: receiving costs the same; empty wallet → inbound not delivered + 1 notice/day); no bulk SMS; NOT in the Telegram bots (web only).
- js/hosted-sms.js (core + 30 s/10 min tick: Telnyx review poll, monthly billing), js/cloudivr-web/hosted.js (routes),
  frontend pages/Texting.js + pages/texting/*. Collection hostedSms (unique live phoneNumber via partial index live:true).
  Telnyx API: eligibility_numbers_check → messaging_hosted_number_orders (TELNYX_MESSAGING_PROFILE_ID) → verification_codes /
  validation_codes → actions/file_upload (loa + bill) → status poll. Preview: WEB_CLOUDIVR_DRY_RUN → all simulated (code 123456).
- Inbound: sms-service no-owner branch → hosted onInbound → web Inbox item meta.hosted (reply via hosted number).
- Bot: NO reply feature (owner removed the swipe-reply; sms-reply-bot.js deleted). Promo copy web_cloudivr (4 langs) advertises Landline to Texting.
- Open: US 10DLC / toll-free registration for outbound texting not automated; Main has no sales dashboard (txn types
  hosted-sms-setup/renewal/text/refund written to transactions for when WL sales.js is ported).

## 2026-10-28 — Clean console redesign + landing texting tile (LIVE on app-main)
- Whole in-app UI restyled like Zoho CPaaS (theme-clean.css): navy sidebar in both themes, white light mode, blue primary,
  squarer buttons, DM Sans titles, underline tabs, dashed empty-state art (ui.js EmptyArt). Light/dark switch kept.
- Landing "Who it's for" grid: new tile `usecase-texting` (Landline to Texting, shows only $0.05/text — setup + monthly prices removed 2026-10-28 per owner).
- Tested: /app/test_reports/iteration_168.json (frontend 100%). Deployed to app-main only (reseller bots untouched).
- Backlog: white-label CloudIVR sites (need 3 domains), Voodoo email inbox placement, Hosted SMS sales-dashboard mapping.
- 2026-10-28 18:10Z (LIVE app-main 4c1bc0d): Products menu + footer now list "Text-to-voice calls" and "Landline to Texting"
  (landing/menu.js); platform tab `platform-tab-hosted` with LandlineTextMock (MockupsLive.js), text tab renamed
  "Text-to-voice calls"; in-app nav label renamed; Overview card row `dashboard-new-products` (dashboard/NewProducts.js). Self-tested via screenshots.

## 2026-10-28 ~19:40Z — Audio picker "all say Payment Notification" (fundmyllc@gmail.com) — FIXED, LIVE app-main 8109bf1
- Cause: campaign Save auto-voice named every clip after the template (`script.templateName`), so 9 clips = "Payment Notification".
- Fix: audio-library-service.saveAudio gives unique names ("Name 2", "Name 3"); campaign auto-voice name = campaign name or
  "Template · first words…"; AudioSelect (ui.js audioLabel) adds voice + date to same-named clips; publicAudio returns originalName.
- Prod data: web accounts' duplicate clip names renamed (9 for fundmyllc 5000000000000006 "Payment Notification 2..9",
  1 for 5000000000000007 "vm.mpeg 2"); field `renamedFrom` keeps the old name. Bot users untouched.
- PENDING (owner choices given 2026-10-28): SMS sending rules — NO US 10DLC approval for now (block US mobiles with notice),
  customer's own brand sender name only where instant (skip countries needing pre-registration), price by country,
  status (Ready / Needs approval / Limited + countries) shown before sending. See memory/TELNYX_SMS_DESTINATIONS_2026-10-28.md.

## 2026-10-28 ~18:55Z — SMS carrier rules (LIVE app-main 5161231) — tested iteration_169 (backend 13/13, frontend 100%)
- js/sms-rules.js: per sender number (Telnyx profile allow-list, messaging_product, 10DLC campaign, toll-free verification;
  cached 10 min) × destination country table (mode number/brand/blocked + price). US mobiles need 10DLC or P2P; hosted
  landlines auto-switch to P2P when Telnyx marks them eligible (Telnyx: P2P needs no 10DLC; receiving never needs it).
  Brand countries GB/DE/FR/PT use the customer's sender name (webPrefs.senderName, Settings card). AU/IN/NG/GH/KE/PH blocked
  (pre-registration takes weeks). Caribbean/US-territory +1 codes are not offered. Prices: US/CA 0.05, GB .08, DE .12, FR .10,
  PT/BR/MX .06, ZA .05 — international texts charged from the wallet (not plan); hosted outbound uses the country price.
- API: GET /sms-reach?phone, POST /sms-reach/check, GET/PUT /prefs/sender-name. Enforced in sms-reply.send + hosted sendText.
- UI: SmsReach.js ReachChip (Texting page, number detail) + DestNote/CheckedReply (Inbox reply, missed-call text back, hosted thread).
- Live check: toll-free = "Needs texting approval"; long code = "Limited" (CA, BR, MX, ZA). No numbers have 10DLC today.

## 2026-10-28 ~20:00Z — Landing redesign "NOWPayments-grade" (PREVIEW ONLY, not deployed — owner to approve)
- pages/landing/np.css (scoped .civr-np + html[data-civr-np] for portals): graphite #1b1e22, blue #64acff (dark ink text on
  blue for AA), lime #daff7c, pink #ffa3bb, Source Sans 3 (same family NOWPayments uses), 8px buttons, star field.
- New: Bubbles.js (product pill cloud + HeroDecor floating outlined circles), ProductCards.js (coin-card style slider w/ arrows).
  Trust cards outlined pink/green/blue; FinalCta star box. Order: Hero, Facts, Bubbles, Statement, UseCases, Platform, TryCall,
  Coverage, ProductCards, Trust, HowItWorks, Pricing, Faq, FinalCta. Kept live call demo + Hear-it sample. No fake press/reviews.
- Tested: /app/test_reports/iteration_170.json (90%; all reported contrast issues fixed after: sticky bar, lang menu, cookie
  banner, payment chips, button text). Deploy with scripts/deploy_workspace_to_droplet.sh app-main once approved.

## 2026-10-28 ~20:15Z — Landing + sign-in + in-app restyle (LIVE app-main f3ecc64) — tested iteration_170/171
- Landing: NOWPayments-grade dark page (np.css). Sign-in/up: graphite star side panel in both themes (AuthPages SidePanel
  .civr-auth-side). In-app (theme-clean.css): Source Sans 3; dark = graphite #1b1e22/#23272d, accent #64acff, buttons #2f74d8;
  light = white, accent #1f6fd6; graphite side menu (#13171c) + mobile More menu in both themes. Old near-black classes and
  important (!) surfaces remapped; contrast fixed to ~AA in both themes (iteration_171 ~97%).

## 2026-10-28 ~21:10Z — Onboarding, setup guide, reviews, owner-name + lead checks (PREVIEW, tested; deploy awaiting 50-ECU confirm)
- User choices: CNAM = user taps "Look up owner name", $0.015 each (free again 30 days). Lead check $0.015/number in Contacts +
  Campaign builder; numbers checked in last 30 days are skipped/free (webLeadResults), "Check all again" re-charges. Publish main only.
- Backend js/cloudivr-web/leads.js: /leads/quote, /leads/check (numbers | {scope:'contacts'} | {listId}), /leads/check/:id,
  /leads/check/:id/delete-dead, /cnam (refund on lookup error, in-flight guard). Wallet debit/credit/balance round4 (exact $0.015);
  transactions rows 'lead-check', 'lead-check-refund', 'cnam-lookup' show in wallet history. POST /reviews gated on answered call.
- Frontend: LeadCheck.js, quick/OwnerName.js, Onboarding (sticky footer, reopen via Overview "Change what I use CloudIVR for",
  "Keep my current picks"), interleaved suggestions, mobile More "For you", SetupGuide re-entry link (setup-open). money(): 3
  decimals only for amounts < $1 with sub-cent value.
- Tests: iteration_172 (found bugs) -> iteration_173 (backend 10/10, frontend 95%); all 173 findings fixed + self-verified after.

## 2026-10-29 07:31Z — AI voice agent call-quality fixes (LIVE on app-main, release 50513f3)
- RCA (prod data, fundmyllc@gmail.com, 99 AI calls/4 days): outbound opening spoken BEFORE answer (greeting present even on
  0-s/no-answer calls) → callee heard silence; slow/unsure voicemail detection → agent chatted with machines/screeners;
  semantic VAD eagerness 'auto'; droplet ams3 adds ~0.2–0.3 s/turn for US calls.
- Fixes: js/ai-agent/bridge.js — never speaks on outbound until call.answered (callLive gate, pending signals in calls.js);
  waits for "Hello?" (default ON, one-time aiMeta migration set all agents waitForHello=true); semantic_vad eagerness 'high' +
  near_field noise reduction; call-screener detection (one-line intro then wait); voicemail: Telnyx PREMIUM AMD, stop talking,
  leave one message after beep (9 s fallback), transcript voicemail-greeting fallback; "Are you still there?" after 7 s of
  silence (from playback-end mark) then polite wrap-up; outcomes screened/no_answer/no_conversation + friendly labels.
- Model default gpt-realtime (full). Price AI_AGENT default $0.30/min (+$0.02 recorded); UI/i18n/catalog updated.
- Admin Telegram alert (non-blocking) when an agent script has fraud/impersonation markers (store.screenScript).
- Cost (30-day real usage ~4.9k in / 860 out tokens per min): full model ~$0.12–0.23/min all-in vs $0.30 price.
- ⚠️ Customer fundmyllc@gmail.com agents "Emily"/"Brian smith" contain explicit fraud script markers (PCH prize impersonation,
  "[Victim Name]", "[Your Fake Name]"). User chose to leave campaigns running and handle blocking manually.
- Tests: js/tests/ai_bridge_flow.test.js 16/16; iteration_174 backend 100% / frontend 100%; follow-ups all fixed.

## 2026-10-29 08:40Z — Admin dashboard + Landline-to-Texting no-bill flow (LIVE app-main, release f36ca94)
- cloudivr.net/admin (preview /cloudivr/admin): owner sign-in CIVR_ADMIN_EMAIL + CIVR_ADMIN_PASSWORD_HASH_B64 (bcrypt, base64)
  → 6-digit email code (10 min) → 12 h httpOnly cookie civr_admin; 5 fails/IP/15 min lock. js/cloudivr-web/admin-auth.js.
- js/cloudivr-web/admin.js (mounted before customer auth): overview (deposits, net sales − refunds, users bot+web, numbers,
  campaigns, texting queue counts, flagged AI scripts), users & wallets (search, detail, credit/debit, suspend → webAccounts.disabled
  + chatIdBlocked), texting queue (upload PDFs/JPG/PNG → merged PDF + signed LOA → Telnyx; message customer; reject & refund),
  numbers, campaigns (pause/resume/stop), AI agents (flagged filter, stop/allow → agent.disabled blocks dials, campaign creation,
  tests, inbound), resellers read-only via RESELLER_DBS env (Smadav/Voodoo/PROSHOP DBs), admin audit log (adminAudit). Every
  change requires a reason.
- Hosted SMS: customer can skip bill (+$50 NOBILL_FEE) → status admin_docs, admin alerted on Telegram; customer told approval
  takes 1–3 business days (Telnyx reviews Mon–Fri); review shows submitted date + "expected by" (3 business days).
- Frontend: pages/admin/* (AdminApp, AdminLogin, Overview, Users, Texting, Cloud[+Resellers, Audit], common); texting
  DocumentsStep no-bill option, NewSetup timeline, NumberPanel admin_docs + expected date.
- Tests: backend/tests/test_cloudivr_admin_dashboard.py 16/16 pass; UI smoke-checked by screenshots (testing agent's frontend
  pass did not complete — credits ran out).

## 2026-10-29 — Telnyx Email policy: no "crypto" wording (LIVE app-main 229535a)
- js/mailer.js telnyxPayload → telnyxSafe(): subject, text, visible HTML text and alt/title/aria-label rewrite
  crypto/cryptos/cryptocurrency/-ies → "digital currency/-ies" (FR cryptomonnaie → monnaie numérique). URLs/tags untouched.
- Source copy cleaned: cloudivr-web/email-copy.js (welcome + wallet-empty EN/FR), bot-welcome-email.js (EN/FR),
  cloudivr-web/orders.js swapped-number message. Telegram/bot texts unchanged (not email).
- Note: reseller bots (app-wl/voodoo/proshop) were NOT redeployed — their emails still use their own older code.
- 2026-10-29: White-label bots moved to Telnyx email. Running releases (app-wl 103003Z-e433e1a, app-voodoo 103143Z-e433e1a,
  app-proshop 103212Z-e433e1a) had an old mailer with NO Telnyx support (MAIL_PROVIDER=telnyx was ignored → MailerSend/Brevo).
  Patched in place ONLY js/mailer.js (new, with "crypto" filter) + email-copy.js/orders.js wording; backups *.bak-crypto-<ts>;
  pm2 restarted app-wl-a/app-voodoo-a/app-proshop-b. Test sends via Telnyx ok for all three (to moxxcompany@gmail.com).
  A future reseller deploy must keep these patches (not yet in their source).
- 2026-10-29: Shared fixes now flow to WhiteLabel on every Save to GitHub via the `shared` job (manifest
  ops/whitelabel-shared-files.txt). See memory/DEPLOYMENT_STATE.md.

## STANDING RULE (owner, 2026-10-29) — white-label shared fixes
- Do NOT wait for the owner to say "this should go to the white-label bots too". For EVERY change, the agent decides:
  if the fix also applies to the white-label bots (Smadav, Voodoo Land, PROSHOP) — e.g. email sending/wording, provider
  policy, billing/wallet bugs, security fixes, shared bot code — add the changed file(s) to ops/whitelabel-shared-files.txt
  in the same task, and tell the owner in the summary which files will travel on the next Save to GitHub.
- Never add CloudIVR-web-only features or brand files. If a file differs heavily on WhiteLabel, warn the owner instead.

## 2026-10-29 — Free-call conversion (LIVE app-main cd7c9b7)
- Prod finding (3 days): 45 web sign-ups, 1 depositor; landing test call used 4× (2 no answer — Nigerian mobiles, 1 voicemail,
  1 answered no key); free Quick IVR used by 2 accounts, both answered, no key pressed. Calls technically work.
- Changes: demo greeting clearer + repeats the menu; landing ring time 30→45 s; Overview trial card copy "Make your free
  call"/"Call me now"; onboarding last step "Make my free call first" (when trial available); emails `tryNudge` (24 h after
  sign-up, no free call, no number) and `tryFollowup` (~3 min after a Quick IVR trial or landing test call; landing visitors
  without an account emailed directly; no-answer variant) EN/FR/ES; admin GET /admin/funnel + Overview funnel card
  (sign-ups → tried → answered → pressed → paid, per-day table). No deposit offer (owner choice).
- Not done: caller number for Africa test (owner skipped); catch-up nudge for users who signed up >30 h before deploy.

## 2026-10-29 — "Show as" own caller ID (Telnyx Verified Numbers) — LIVE on app-main only
- Owner choices: any customer after verifying by code; $25 per verified number (charged only when code accepted,
  wrong code auto-refunds); usable on Quick IVR, Bulk campaigns, AI agent campaigns, browser phone.
- Backend: js/cloudivr-web/caller-ids.js (GET/POST /caller-ids, POST /caller-ids/verify, DELETE /caller-ids/:n; collection
  webCallerIds, one account per number, 8 codes/day/account, 5 tries, 15-min code window; RATE_CALLER_ID_VERIFY env, default 25).
  Wiring: outbound.js cfg.showAs → engine displayCallerId → voice-service createOutboundCall from; campaigns store showAs
  (bulk-call-service dialTelnyx, ai-agent/calls.js from); browser phone header X-Civr-Show-As verified in handleOutboundSipCall;
  web scheduled calls pass ivrObData.displayCallerId (_index.js scheduler). Billing/ownership stay on the CloudIVR number.
- Frontend: pages/number/CallerIds.js card on My numbers (#caller-ids); CallerIdPick.js ShowAsSelect in QuickCall, Campaigns, Softphone.
- Tested: preview curl flow (send/verify/wrong-code refund/already/taken/delete), js/tests/caller_id_show_as.test.js, UI screenshot.
  Deployed 10:15Z release 20261029T101526Z-c9f20d5 (app-main-b), /health healthy. NOT live-tested with a real code/call yet.
- Not covered: "Call me first" / text-trigger callbacks still show the CloudIVR number; Twilio paths unchanged.

## 2026-10-29 10:31Z — Show-as extended + bulk verify — LIVE app-main (release 20261029T103132Z-350c5dc, app-main-a, healthy)
- Owner asked for arbitrary/unverified caller ID via Telnyx CLI override → DECLINED (illegal spoofing + known fraud scripts on
  platform); not tested with a spoofed call. Only verified numbers can be shown. Do not build free-text caller ID.
- Call me first: body.showAs → transferCallerId (owner's mobile sees CloudIVR number; connected person sees verified number).
  voice-service legFrom(s) = s.transferCallerId || s.callerId used for key-press/menu/backup/OTP transfers + transfer-leg matcher.
- Text triggers: per-rule showAs (validated verified on save; falls back to CloudIVR number at run time if removed).
  callback → transferCallerId, message → displayCallerId, AI → dialLead campaign.showAs. UI: ShowAsSelect in TriggerParts RuleCard.
- Bulk verify: POST /caller-ids accepts numbers[] (≤10/batch, 25 codes/day/account); pending items listed with per-number code box.
- Tests: js/tests/caller_id_show_as.test.js (4/4 incl. press-1 transfer from verified number), preview curl + UI screenshot.

## 2026-10-29 10:44Z — Arbitrary caller ID via admin approval — LIVE app-main (20261029T104423Z-7d70850, healthy)
- Owner wants to show numbers that can't receive a code (main line, toll-free, call center). No spoofing-by-default:
  customer submits + attests authorization → admin approves → usable. Telnyx still filters the actual call.
- Backend caller-ids.js: POST /caller-ids/request (debit $25, status 'review', note, authorized flag); DELETE refunds a review item;
  adminApi(db) list/approve/reject. admin.js: GET /admin/caller-ids, POST /admin/caller-ids/:number/:action (reason required,
  audit logged, notify.push customer on approve/reject; reject refunds $25). resolve()/isVerified accept status 'verified' only,
  so review numbers are unusable until approved; approval sets status 'verified' adminApproved:true.
- Frontend: ReviewForm + review rows in pages/number/CallerIds.js; new admin tab pages/admin/CallerIds.js (AdminApp tab 'caller-ids').
- Tested in preview: request charges $25, authorized=false blocked, show-as rejects review number, admin approve→Quick IVR rate 0.15,
  reject refunds, audit shows caller_id_approve/reject; admin UI screenshot. NOT live-tested with a real approved outbound call.

## 2026-10-29 11:06Z — Caller-ID decision emails + bulk approve — LIVE app-main (20261029T110611Z-9e4346e, healthy)
- admin.js: on approve/reject (single or bulk) now emails the customer via auth.sendMail (approved → how to use; rejected → reason + refund note),
  in addition to the in-app notify.push. Email lookup = webAccounts.email by numeric chatId. Shared decide() helper.
- New POST /admin/caller-ids/bulk { action, numbers[], reason } (≤100, reason required, each decision audited + emailed/refunded).
- Admin UI pages/admin/CallerIds.js: per-row checkboxes + Select all + BulkBar (approve/reject selected with one reason).
- Tested preview: bulk approve 2 → verified, bulk reject 1 → refund +$25, audit shows caller_id_approve/reject; lint clean. Email send is
  skipped in dry-run (no error). NOT verified with a real delivered email.

## 2026-10-29 11:17Z — AI disclosure now optional per agent — LIVE app-main (20261029T111743Z-e5ff333, healthy)
- New agent field discloseAi (default true). Off = opening skips the "I'm an AI assistant" line (recording notice unaffected);
  bridge screener line + rules relaxed (won't volunteer AI, still never claims to be human if asked). Owner's custom first
  message: AI phrase added only when discloseAi on and missing.
- languages.js: added inPlain/outPlain (no-AI intro) for all 20 languages. opening.js standard()/withNotices() honor discloseAi.
  store.js cleanAgent/FIELDS/publicAgent include discloseAi. ai.js opening-preview passes discloseAi.
- UI: AgentForm "Announce it's an AI" toggle (on by default) + OpeningPreview reflects it. Landing copy updated:
  ProductCards ai bullet + Trust.js card ("You choose how it introduces itself").
- Tested: opening preview ON/OFF, all 20 plain openings AI-free, ai_bridge_flow.test.js 10/10, UI screenshot. Lint clean.

## 2026-10-29 11:38Z — Add/verify caller ID inline from the "Show as" picker — LIVE app-main (20261029T113812Z-e638c37)
- CallerIds.js refactored: reusable <CallerIdManager onVerified> (list + add/verify + bulk + review); page section wraps it.
- CallerIdPick.js ShowAsSelect now has "Add or verify a number" button → Dialog with CallerIdManager; on code-verify the new
  number is auto-selected and the dialog closes. Compact (browser phone) variant now always renders the add button even with no
  verified numbers (was a dead-end). Tested: popup verify flow on Quick IVR selects the number; lint clean.
- Also fixed AiCampaignFields disclosure bullet to say "(as an AI if you turned that on)".
- NOTE: other empty-state links (buy number / create audio / create agent / upload contacts) already route forward (not true
  dead-ends); inline-creation modals for those were NOT built. Revisit if the owner names specific stuck screens.

## 2026-10-29 11:51Z — Press-1 caller-ID verification — LIVE app-main (20261029T115129Z-eb764f0)
- Telnyx Verified Numbers SMS/call can't be rebranded (no sender/template option) — told owner.
- Added method 'dtmf' (Telnyx calls, user presses 1, no code). /caller-ids/verify for dtmf checks GET /v2/verified_numbers/{n}
  verified_at (debit → refund if not pressed). UI: "Call me — I'll press 1" option; pending row shows "I pressed 1" button.
- Tested preview (dry-run auto-passes). NOT live-tested: real Telnyx dtmf call + verified_at polling on production.

## 2026-06 — Cross-device usability audit + fixes (preview only, NOT deployed)
- Programmatic audit (no screenshots): scripts/usability_audit.py (+ usability_report.py, usability_axe_check.py); 27 routes x 6 devices = 162 pages, 0 errors. Clean baseline: test_reports/usability_audit_clean_run.json. Preview visual-edits disabled (DISABLE_VISUAL_EDITS=true) so the DOM matches production.
- Baseline: no horizontal overflow, focus rings OK, loads under 2s. Fixed: phone tap targets (landing links, Hear-it seek bar, caller-ID "Add" button), sub-12px UI text, unlabeled toggles (Toggle now takes `label`), unlabeled selects/read-only input, Live map ARIA, contrast (payment chips, light-theme error red, SIP mock buttons, SMS reach note), auth pages main/aside landmarks, keyboard-scrollable tables (plan compare, usage rates, wallet), preview banner/SIP sticky CTA landmarks, duplicate sidebar landmark, number-detail error state (h1 + back link), React whitespace warning in plan table.
- Re-check: axe clean on 25/26 page x device checks; open: phone-mockup illustration text 11px (decorative), AMEX/DISCOVER logo marks (exempt).
- 2026-06 follow-up: landing phone mock-ups, keypad labels, transcript speaker labels, count badges and AMEX/Discover marks all raised to >=12px (no text under 12px anywhere on /cloudivr, /sip, /terms at 320-1920px). IVR mock "Forward to" row now wraps instead of truncating. axe re-scan: 26/26 clean (incl. SIP desktop). Checker: scripts/landing_text_check.py. Still preview only, not deployed.
- 2026-10-29: Public-site light mode (landing, SIP, Terms). np.css palette is now CSS variables; light block keyed on html[data-civr-np-theme="light"] (set by useSiteLook in pages/landing/kit.js); dark sections, ink tiles and [bg-#13171c]/[bg-#0a0a0a] mock-ups re-declare the dark palette. Default = device preference; SiteThemeButton (landing/sip/terms-theme-button) shares 'civr.theme' with the app. Below 420px public headers show only the parrot icon (wordmark sr-only) so the switch fits. Checks: scripts/public_theme_check.py, scripts/public_header_fit.py; testing agent iteration_175 (header-fit bug found and fixed). LIVE on app-main 20261029T135655Z-bee80af.
- 2026-10-29: Empty audio library UX. AudioSelect (ui.js) takes `onAdded` (+ `compact`): empty library -> "Your audio library is empty" panel with Upload a recording / Make one from text, opening AudioAddDialog (AudioAdd.js, reuses exported UploadCard/TtsCard from AudioLibrary.js). The new audio is auto-selected, page edits kept; "+ New audio" link when the library has items; loading state instead of a flash of empty. Wired: IVR greeting + key messages, Quick Call, campaign message + voicemail drop, voicemail custom greeting. Checks: scripts/audio_empty_flow_check.py, scripts/audio_empty_sites_check.py (run with /usr/local/bin/python3; .venv playwright got upgraded past installed browser). NOT deployed yet.
- 2026-10-29: Quick IVR / Bulk IVR / SMS set-up audit (testing agent iterations 176-177, all requested flows pass).
  - Preview campaign simulator js/cloudivr-web/campaign-sim.js: dry-run campaigns Start/Resume -> running -> completed with fake per-lead outcomes (never dials/bills). Preview-only minute tick in _index.js BulkSchedule cron (SKIP_WEBHOOK_SYNC && WEB_CLOUDIVR_DRY_RUN) launches due scheduled dry-run campaigns + next repeat run. Guards: real launcher + recovery skip dryRun:true; startCampaign refuses dryRun. Scheduling now allowed in preview.
  - POST /campaigns validateOnly(+audioPending): campaign form validates before paying for the script's AI voice (no orphan audio).
  - DateTimePicker: today -> now+10 min; inline warnings (passed / too soon / out of window); minMinutes prop (campaigns 2).
  - Empty leads message fixed; cancel copy for never-started campaigns; voicemail "messages left" hidden before start; friendly lead labels ("no answer", "not called" on ended campaigns).
  - Add-audio + caller-ID dialogs compact (!min-h-0; .civr has min-height 100vh).
  - SMS: 10DLC/toll-free blocked note has "Ask us to register it" -> openHelpChat(prefill). openHelpChat(text) now takes optional text.
  - Voicemail/answered mismatch was simulator-only (real engine counts voicemail separately); fixed in campaign-sim.js 2026-10-29, preview only (sim never runs in prod). Known/left: Sim completion doesn't create the completion inbox notification. No self-serve 10DLC registration and no "new text" composer (texts only as replies).
  - NOT deployed yet.
- 2026-10-30: Flags + coin logos. New frontend/src/cloudivr/Pickers.js: Flag (flag-icons SVG, emoji flags showed as letters on Windows), CoinIcon/Coin/coinName (cryptocurrency-icons; USDT TRC20/ERC20 get a TRON/ETH badge), IconSelect (shadcn Select styled with --c-* vars, portal carries .civr) and CoinSelect. Used in: Buy number country picker (buy-country-select-option-<iso>), checkout + wallet coin pickers (…-option-btc / -usdt-trc20), wallet + order payment panels, deposits list, landing coverage flags, LangSwitcher (flag in button + menu; LANG_FLAG en=us, fr, es; landing tone shows code until xl). Language switcher added to Terms. Fixes from iteration_178: phone More sheet Language row contrast in light theme (theme-clean.css), SIP/Terms lang menu dark in dark mode (np.css), app lang menu follows theme. yarn add needs --ignore-engines (camera-controls wants node 22). Checks: scripts/menu_theme_check.py, scripts/public_header_fit.py. NOT deployed yet.
