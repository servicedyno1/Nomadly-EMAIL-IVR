# Telnyx coverage vs former Twilio country catalog — 2026-10-22 (READ-ONLY audit)

Why: with `TWILIO_ENABLED=false` the bot's Buy-Number / IVR-plan flow shows only US + CA (Telnyx). User asked whether
Telnyx also offers the 24 countries Twilio used to show (phone-config.js `twilioCountries` + "More Countries").

Tool: `node js/ops/telnyx_country_coverage_2026-10.js [--only=GB,IE]` (read-only: country_coverage +
available_phone_numbers + regulatory_requirements?action=ordering). Raw data: `memory/telnyx_country_coverage_2026-10-22.json`.
Control: US/CA local + toll-free → requirements NONE (matches today's instant buy). Zero-stock rows re-checked with best_effort=true.

## Results for the number type Twilio sold (TX = Telnyx cost/mo, upfront in brackets)
**A. Instant, no paperwork (same as US/CA today)**
- 🇵🇷 PR local — stock ✓, voice+SMS, $3 (TW $3.25). Also PR toll-free $1, no paperwork.
- 🇨🇴 CO mobile (TW sold toll-free, 0 stock) — voice only, $20 [$20], no paperwork.

**B. Contact info + address only (no ID document — closest to Twilio "address required")**
- 🇳🇱 NL mobile — voice+SMS, $3 [$2] (TW $6) — contact + worldwide address.
- 🇮🇱 IL mobile — voice, $3.60 [$3] (TW $15) — contact + email + worldwide address.
- 🇳🇿 NZ local — voice, $2 (TW $3.15) — contact + address INSIDE New Zealand.
- 🇨🇴 CO local — voice, $13.50 — contact + worldwide address.

**C. Stock exists but ID / proof-of-address documents required (Telnyx manual review, not instant)**
- 🇬🇧 GB mobile voice+SMS $2 · 🇮🇪 IE local $0.50 · 🇮🇱 IL local $3 · 🇦🇺 AU mobile voice+SMS $5.50 [$6.50] (Onfido ID + AU address),
  AU toll-free $10 [$50] · 🇳🇿 NZ toll-free $25 · 🇭🇰 HK toll-free $85 · 🇨🇿 CZ local $1 / toll-free $25 · 🇪🇪 EE local $2.50 /
  toll-free $50 [$260] · 🇲🇽 MX toll-free $20 · 🇷🇴 RO toll-free $20 · 🇸🇰 SK toll-free $20 · 🇿🇦 ZA local $4.

**D. Not available on Telnyx for the type Twilio sold**
- 🇹🇳 TN — no Telnyx coverage at all. 🇲🇾 MY, 🇹🇭 TH — 0 stock in every type.
- 0 stock: 🇮🇹 IT toll-free, 🇫🇮 FI mobile+toll-free, 🇵🇱 PL mobile, 🇧🇬 BG toll-free, 🇮🇩 ID toll-free, 🇰🇪 KE local,
  🇨🇴 CO toll-free, 🇪🇪 EE mobile. 🇭🇰 HK mobile not offered by Telnyx.
- Alternatives (other types, all need documents): IT local $2, FI local/national $1, PL local $1 / toll-free $15, KE mobile $35 [$60].

## Code facts that matter before enabling any of these
1. `telnyx-service.js searchNumbers()` keeps only numbers with voice AND sms → most international Telnyx numbers
   (voice-only) would be filtered out. Owner decision: Telnyx = voice/IVR only for now → intl search should require voice only.
2. The Telnyx buy flow sends a plain `number_orders` request — no requirement group / address / documents. Group A works as-is;
   B needs the bot to collect contact + address and attach them; C needs document upload + Telnyx review (not instant).
3. `phone-config.js` `countries` (Telnyx list) is just US/CA — new Telnyx countries would be added there (provider 'telnyx').
No purchases or orders were made.
