# @blacknmilds — Cloud IVR Support Complaints Investigation
**User:** @blacknmilds (chatId `1185070608`, first name "Tax")
**Source:** Railway production logs (service `Nomadly-EMAIL-IVR`, env `production`) pulled 2026-02 via Railway CLI (project `New Hosting`, token `API_KEY_RAILWAY`)
**Timeline covered:** ~18:00 – 19:00 UTC (same session, ~1h window)
**Wallet:** first-time depositor. USDT-TRC20 $110.07 → auto-credited (+ $5 first-deposit bonus)
**Purchased plan:** Cloud IVR Pro $75/mo, US Toll-Free `+18665632608`, Twilio sub-account `ACeb309f4c4c76f66a069ab7ba2dddba66`

---

## Support session transcript (from `[Support]` log lines)

### Session #1 — 18:2x UTC (message id 3309918)
- **User:** "when doing bulk ivr doing i put +1 before the phone"
- **AI reply:** "Yes, when setting up a Bulk IVR campaign, you should include the full international format for phone numbers, which for US numbers means including the +1 country code prefix… If you need help with the exact navigation or campaign setup steps, just ask!"
- **Escalate:** false — user then `/done`

### Session #2 — 18:3x UTC (message id 3310010 / 3310020) — **ESCALATED to human**
- **User:** "i do the ivr but no sound plays after uploading the audio file"
- **AI reply:** "…1. Use a different voice from the voice selection menu during your Quick IVR Call setup. 2. Ensure your uploaded audio file meets the required format and size limits. 3. Keep your script text under 1000 characters if using text-to-speech. 4. Try running the call again — sometimes temporary TTS or audio generation issues occur…"
- **User uploaded document:** `busto cries today.wav` (1.67 MB) → `[Escalation] OPENED id=1aqE2 chatId=1185070608 reason="media:document"`
- **User:** "its a wav auido file"
- **AI reply (escalate=true):** "Thanks for sharing that you used a WAV audio file. Please ensure your WAV file is properly encoded (typical PCM, 16-bit, 8kHz or 16kHz). Sometimes unsupported WAV formats cause playback issues… I'm flagging this for our technical team…"
- User then re-uploaded a smaller re-encoded version named **`busto_cries_today_16k`** and re-launched — that campaign (`2a96660e-fd7a-4dc5-966d-e63f7fd9f0e9`) ran with TwiML served + calls in-progress 7-19s, i.e. **the 16 kHz re-encode worked around the bug**.

---

## Root causes (ranked, with file:line pointers)

### 🔴 P0 · Bulk IVR audio proxy hardcodes `Content-Type: audio/mpeg` for every file — WAV plays as silence
**File:** `js/_index.js` L45847–L45903 (`app.get('/twilio/audio-proxy', …)`)
- Line **45867**: local `/assets/user-audio/*` → `res.set('Content-Type', 'audio/mpeg')`
- Line **45880**: MongoDB `ivrAudioStore` restore path → same hardcoded `audio/mpeg`
- Line **45897**: external URL passthrough → same hardcoded `audio/mpeg`

**Impact:** For any WAV upload, Twilio `<Play>` receives WAV bytes with an MPEG MIME type. Twilio picks the MP3 decoder → fails to decode the RIFF/WAVE header → silent call. The audio-library service tracks the real MIME in `finalMimeType` (`js/audio-library-service.js:132` `audio/wav` for WAV) and persists it into `ivrAudioStore.mimeType` (`audio-library-service.js:152`) — but the proxy ignores it and forces `audio/mpeg`.

**Fix (minimum):** derive Content-Type from the file extension (or from `ivrAudioStore.mimeType`) instead of hardcoding. Only `.mp3`→`audio/mpeg`, `.wav`→`audio/wav`, `.ogg`→`audio/ogg`.

**Fix (recommended, kills the whole class):** in `js/audio-library-service.js` L104 the "keep WAV as-is" branch should also transcode when the WAV is not Twilio-compatible (non-PCM, non-mono, sample-rate ≠ 8000/16000). Simplest form — transcode **every non-MP3 upload** (including WAV) to mono 44.1 kHz 128 kbps MP3 the same way the current fallback does at L112. WAV is already the odd one out; converting it removes the whole Twilio-WAV-format minefield.

---

### 🟠 P1 · `parseLeadsFile` blindly prepends `+` — bare 10-digit US numbers dial to Romania
**File:** `js/bulk-call-service.js:511`
```js
if (!number.startsWith('+')) number = '+' + number.replace(/^0+/, '')
```
When the user pastes `4065067340` (a legitimate US-format 10-digit number), this yields **`+4065067340`**, which E.164 parses as Romania `+40 6506 7340`, not US `+1 406 506 7340`.

**Log evidence — campaign `cb77e43c-74f8-41b7-a3bb-66493f42318a` (all 5 failed):**
```
[BulkCall] Speechcue call failed for +4065067340: Account not authorized to call +4065067340.
  Perhaps you need to enable some international permissions… /geo-permissions/low-risk
[BulkCall] Speechcue call failed for +4079281382: …
[BulkCall] Speechcue call failed for +4107031840: …
[BulkCall] Speechcue call failed for +3852568800: …
[BulkCall] Speechcue call failed for +7147681019: …
```
This is exactly what triggered Session #1 (user learned the hard way that `+1` is mandatory).

**Fix:** if a 10-digit NANP number is pasted without `+`, assume `+1`; alternatively use `libphonenumber-js` with `defaultCountry` = the caller-ID's country. Either way the user should not have to guess. Bonus: show the parsed E.164 preview before "Launch Campaign".

---

### 🟠 P1 · AI Support answer for "no sound" was misleading — pointed user to the wrong feature
**File:** wherever the AI-Support system prompt / knowledge base lives (see `js/_index.js` `streamAiReply` L1967 + `getAiResponseStreaming` referenced at L2026)
The AI told the user to *"Use a different voice from the voice selection menu during your **Quick IVR Call** setup"* — but the user was in **Bulk IVR Campaign** (a different flow with no voice picker for uploaded audio). This is a hallucination: the AI conflated Quick-IVR and Bulk-IVR.

Second reply was better ("PCM, 16-bit, 8kHz or 16kHz") and coincidentally correct — but only because the AI guessed the Twilio WAV constraints, not because it knows the audio-proxy bug.

**Fix:** update the AI Support knowledge doc with:
1. The audio-proxy Content-Type bug (until it's fixed): "If a WAV upload plays silence, re-encode to mono 16 kHz PCM WAV *or* convert to MP3 before uploading."
2. Explicit feature disambiguation: Quick IVR Call ≠ Bulk IVR Campaign.

---

### 🟡 P2 · `editMessageText` failing on every AI Support reply (log noise + latency)
**File:** `js/_index.js:1947`
```
[Support] editMessageText failed for 1185070608 mid=3309918: html="ETELEGRAM: 400 Bad Request: message can't be edited" plain="ETELEGRAM: 400 Bad Request: message can't be edited"
[Support] AI reply delivered via fallback message (send) for 1185070608 — editMessageText failed
```
Both AI replies to blacknmilds fell back to `sendMessage`. `deliverFinalReply` (L1914) already handles this — but the underlying cause ("message can't be edited") means Telegram is treating the streamed placeholder as un-editable. Common cause: the streaming edit path (`doEdit` at L1995) has already turned the placeholder into a non-editable state (e.g. edited past 48 h, or the placeholder message was deleted mid-stream, or Telegram's server-side de-dup). Adds ~1-2s to every reply and a duplicate visible message.

**Fix:** investigate why the placeholder is "not editable" specifically at final-render time — very likely the placeholder is being deleted by the streaming path before `deliverFinalReply` runs (see `bot.deleteMessage` at L2030 for the null-response branch, and L1950 in the fallback branch). Add a guard: never `deleteMessage` in `streamAiReply` if we still intend to edit later.

---

### 🟡 P2 · $50 minimum wallet balance for Bulk IVR is enforced only at launch — 5 steps too late
**Evidence:** After configuring the entire campaign (leads, audio, mode, keys, concurrency, preview), user tapped 🚀 Launch → got `Failed to start: Minimum wallet balance of $50.00 required. USD: $45.07, NGN: ₦0.`

**Fix:** surface the minimum-balance requirement on the **📞 Bulk IVR Campaign** entry screen (or block the flow at "Select Caller ID" step if wallet < $50). Estimated cost is already shown at leads-loaded step — the min-balance check should sit next to it.

---

## Summary table

| # | Severity | Component | Symptom user saw | Fix location | Status |
|---|----------|-----------|------------------|--------------|--------|
| 1 | P0 | `js/_index.js:45847` audio-proxy | WAV upload → silent IVR call | `res.set('Content-Type', …)` derive from ext OR transcode WAV→MP3 in `audio-library-service.js:104` | ✅ FIXED |
| 2 | P1 | `js/bulk-call-service.js:511` parseLeadsFile | US 10-digit paste dialed Romania | prepend `+1` for 10-digit NANP or use libphonenumber-js `defaultCountry` | ✅ FIXED |
| 3 | P1 | AI Support prompt/KB | AI told user to change TTS voice for a WAV problem in Bulk-IVR | update AI Support KB (Quick-IVR ≠ Bulk-IVR; add WAV compat note) | ✅ FIXED |
| 4 | P2 | `js/_index.js:1947` streamAiReply | 400 "can't be edited" → duplicate reply + latency | do not `deleteMessage` before `deliverFinalReply` | ✅ FIXED |
| 5 | P2 | Bulk IVR entry UX | $50 min balance error only at launch | check wallet at Bulk IVR entry step | ⏳ backlog |
| 6 | P0 | `js/vm-instance-setup.js:1247` isAlreadyGone helper | `🚨 VPS DELETE FAILED` spammed admin 43× in a day for vmi3508080 | Match Contabo's "already been cancelled" error as idempotent success; DB → DELETED; skip Auto-Deleted admin post on alreadyGone; throttle failure alerts to ≥6h with 10-retry hard-stop | ✅ FIXED (6/6 tests pass, testing agent iteration 45) |

## Notes / non-issues
- Twilio sub-account provisioning, SIP cred creation, wallet crediting, first-deposit bonus, cart-recovery clearing — all worked correctly for this user.
- `PhoneMonitor` health checks are running normally on the 35 sub-accounts.
- Escalation reference `1aqE2` — human support should follow up with the user now that the 16 kHz workaround unblocked the second campaign.
