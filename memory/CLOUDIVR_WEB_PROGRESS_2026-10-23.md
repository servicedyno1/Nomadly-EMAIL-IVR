# CloudIVR Web App — progress & handoff (2026-10-23)

Status (late 2026-10-23): **BUILT + TESTED ON PREVIEW** (test_reports/iteration_113.json: backend 24/24, all frontend flows pass;
minor findings fixed after). Mounted at `/api/cloudivr-web/*`, UI at `/cloudivr`.
**LIVE in production since 2026-10-23 ~11:03Z at https://cloudivr.net** (app-main, branch WITH-WEBIVR — see DEPLOYMENT_STATE.md).
Prod is NOT dry-run: real number purchases, real calls. ✅ `WEB_DYNO_PAY_API_KEY` set on preview + droplet (2026-10-23 12:07Z). Still pending:
app-main backend.env), `GOOGLE_OAUTH_CLIENT_ID` (+ add https://cloudivr.net to Authorized JavaScript origins).
Pending owner: `GOOGLE_OAUTH_CLIENT_ID` via the secure secrets card (WEB_DYNO_PAY_API_KEY done 2026-10-23). UX audit fixes LIVE (see PRD 2026-10-23 eve).
Google Cloud Console → Authorized JavaScript origins must include the preview origin (and later the custom domain).
The sections below are the original plan; "Remaining work" items 1–5 are DONE.
Pitfalls found: babel visual-edits plugin overflows on mutually recursive React components (IvrTab uses a render-prop list);
phone monitor must skip `dryRun` numbers; googleSub index must be partial; Node app does NOT hot-reload (restart `nodejs`).

---
Original status: **IN PROGRESS — backend modules written, NOT mounted, NOT tested; frontend NOT started.**
Nothing here is live: `js/cloudivr-web/` is not `require`d by `_index.js`, so shipping it is inert.

## User decisions (locked — do not re-ask)
- Separate **web-only accounts** (not linked to Telegram accounts).
- Sign-in: **email/password + the owner's OWN Google sign-in app** (Google Identity Services button, ID token verified
  server-side). Google button stays hidden until `GOOGLE_OAUTH_CLIENT_ID` is set — request it with the secure secrets
  card (`secrets_request`), never in chat. Owner must add the web origin(s) to "Authorized JavaScript origins".
- Wallet top-up: **DynoPay crypto only** for now.
- Countries: **all bot countries** (US/CA + Telnyx international, incl. pay-first ID-verification countries).
- Brand: Nomadly first. Custom domain: none yet → **stay on the preview link** after tests; go live only when the owner
  sends a domain.
- Launch scope: everything at once (numbers, IVR builder, audio, logs, campaigns, quick call, wallet, browser phone).
- Never show carrier names (Telnyx/Twilio) to web users — say "Speechcue" network (see `sanitize-provider.networkLabel`).

## Architecture (how web accounts reuse the bot engine)
- Web account ids live in a reserved chatId range `WEB_ID_BASE = 5e15` (+ counter `webCounters.webChatId`), stored
  as **Strings** everywhere like bot chatIds (`walletOf`, `phoneNumbersOf`, `state`, `nameOf`, `bulkCallCampaigns`,
  `phoneTransactions`, `telnyxRegSessions`). `auth.requireUser` sets `req.webChatId = String(acc._id)`.
- `notify.attach(bot)` wraps `bot.sendMessage/sendPhoto/sendDocument/...`: messages to web ids never hit Telegram,
  they are stored in `webNotifications` (in-app inbox: SMS, voicemail, call alerts, campaign reports, deposits).
- Money: the same `walletOf` doc the engine bills (calls, forwarding, renewals). Atomic `walletOps.debit`.
- Top-up: `createCryptoDeposit` (to add in `_index.js`) = same as bot `showDepositCryptoInfo`: `getDynopayCryptoAddress
  (amountUsd, tickerOfDyno[coin], `${SELF_URL}/dynopay/crypto-wallet`, { product_name: dynopayActions.walletFund, refId })`
  + `set(chatIdOfDynopayPayment, ref, { chatId, action: walletFund, address, channel: 'web' })`. The existing
  `/dynopay/crypto-wallet` webhook then credits the wallet + logs `transactions.type='wallet-topup' metadata.ref`.
  `wallet.js` marks a `webDeposits` row "credited" when that ref appears.
- Regulated countries: `numbers.js` buy → `deps.paidCheckout` (= `telnyxPaidCheckout`) → returns `{_verification}`
  → web wizard `verification.js` drives `txReg.handleInput` (text answers + file uploads stored in `webUploads`
  (TTL 7 d) with file ids `web:<uuid>`). `txReg.init` must get `downloadFile: makeDownloader(() => db, bot)`.

## Files (js/cloudivr-web/)
| file | state | notes |
|---|---|---|
| notify.js | done | attach/push/strip + `GET /notifications`, `POST /notifications/read` |
| auth.js | done (review vs integration playbook) | bcryptjs + jsonwebtoken httpOnly cookie, lockout, reset email (`/cloudivr/reset-password?token=`), Google ID-token via tokeninfo, `GET /auth/config` exposes client id |
| wallet.js | done | `GET /wallet`, `POST /wallet/topup {amountUsd, coin}`; coins passed in as `Object.keys(tickerOfDyno)` |
| numbers.js | done | catalog, search (cached per account 2 h in `webSearchCache` → server-side price), buy, forwarding, voicemail, sms, recording, IVR (+analytics), logs/activity, SIP view/reset, renew, auto-renew, upgrade, delete |
| verification.js | done | `GET /verification`, `POST /verification/input`, `POST /verification/upload` (multer) |
| audio.js | done | list, voices, upload, TTS, rename, delete — **needs `audioLibraryService.saveBuffer` (not written yet)** |
| calls.js | done | `POST /calls/quick`, campaigns list/estimate/create/get/start/pause/resume/cancel |
| index.js | done | `createCloudIvrWeb(deps)` lazy-builds router once DB is up; `GET /dashboard` |

`WEB_CLOUDIVR_DRY_RUN=true` (set in PREVIEW only) = no real number purchase/release, no SIP credential calls, no dialing
(quick call / campaign start / resume return `dryRun`), scheduling refused, verification submit stops before the carrier
order. **Must be clearly labelled MOCKED in preview.** Never set it in production.

## Remaining work (in order)
1. `audio-library-service.js`: split `downloadAndSave` → download + new `saveBuffer(buf, chatId, originalName, mime)`
   (same ffmpeg → mono MP3 path), export it.
2. `_index.js` wiring (all deps exist in scope):
   - right after `wrapBotMethods(bot, …)` (~L1797): `cloudivrWeb.notify.attach(bot)`.
   - where `txReg.init({ db, bot, log })` (~L4850): add `downloadFile: cloudivrWeb.makeDownloader(() => db, bot)` and
     `cloudivrWeb.notify.setDb(db)`.
   - after the store routes (~L39429): `app.use('/cloudivr-web', cloudivrWeb.createCloudIvrWeb({ getDb: () => db, log,
     telnyxApi, getTelnyxResources: () => telnyxResources, paidCheckout: telnyxPaidCheckout,
     numberSurcharge: (cc, type, sel) => isTelnyxIntl('telnyx', cc) ? (getTelnyxIntlSurcharge(sel)?.monthly || 0) : (getNumberSurcharge(cc, type) || 0),
     verificationInfo: async (cc, type, name) => { const rq = await txReg.getRequirements(cc, type); if (!rq.ok) return { error: '…' }; const need = rq.reqs.length > 0; return { required: need, supported: !need || txReg.analyze(rq.reqs).supported, note: need ? txReg.prePayNote(rq.reqs, name, 'en') : null } },
     txReg, refundTelnyxVerification, submitTelnyxVerification, audioLibraryService, ttsService, voiceService,
     bulkCallService, notifyAdmin, logTransaction, generateTransactionId, coins: Object.keys(tickerOfDyno),
     createCryptoDeposit })`. Check exact names/signatures (`txReg.getRequirements` return shape, `getTelnyxIntlSurcharge`).
   - Express strips `/api` → external path `/api/cloudivr-web/*`; `express.json` is global (50 MB).
3. `yarn add @react-oauth/google` in frontend; build React app under `/cloudivr/*` (route in `App.js` next to the
   existing journey): landing, sign up / sign in / forgot / reset, dashboard, numbers list + detail tabs (forwarding,
   voicemail, SMS, SIP, recording, IVR builder, logs, billing), buy wizard + verification wizard, audio library (upload +
   TTS), quick call, campaigns (create from pasted leads, live progress, pause/resume/cancel), wallet (QR via
   `react-qr-code`, deposits, history), inbox, settings, softphone dock (`@telnyx/webrtc`, SIP creds from
   `/numbers/:phone/sip`). Follow `/app/design_guidelines.json` (obsidian/slate + emerald #34d399). `data-testid` on
   every interactive/critical element. All fetches `credentials: 'include'` to `${REACT_APP_BACKEND_URL}/api/cloudivr-web`.
4. Secrets: `WEB_SESSION_SECRET` (check name in auth.js), `GOOGLE_OAUTH_CLIENT_ID` via secrets card; preview
   `WEB_CLOUDIVR_DRY_RUN=true`.
5. Test: one smoke screenshot then `testing_agent` (auth, isolation between two web accounts, buy (dry run), settings,
   IVR save/validation, audio upload/TTS, campaign create/cancel, wallet top-up address, verification wizard, 401s).
6. Keep on preview until the owner sends a domain (HTTPS needed for the browser phone).

## Known pitfalls
- chatIds must be Strings (bot convention, see CLOUDIVR_BILLING_AUDIT_2026-09-16 F2). Earlier draft used Numbers — fixed.
- Twilio parent account is inactive — web is Telnyx-only; never offer Twilio numbers.
- Auth code was written before the integration playbook was re-read; next agent must call `integration_expert` again
  before touching auth (rule) and align with it.
