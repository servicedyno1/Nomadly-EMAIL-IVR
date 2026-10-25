# Paid Plans, Subscriptions & Expiry — Audit Report (June 2026)

Scope: every paid plan — CloudIVR (Starter/Pro/Business + extra lines), Anti-Red Hosting (Weekly/Premium/Golden + trial),
VPS/RDP (Contabo, DigitalOcean Linux, DigitalOcean RDP, reseller API), Bot Membership (Daily/Weekly/Monthly), reseller domain auto-renew.
STATUS 2026-06: items 1-17 FIXED in code (preview, tested iteration_131) — see PRD.md. Original report below. Risk: 🔴 High · 🟠 Medium · 🟡 Low.

## 🔴 High

1. **VPS/RDP auto-renew only works once** (`_index.js` checkVPSPlansExpiryandPayment, flag `_autoRenewAttempted`).
   After a successful auto-renew the flag stays "already tried" forever (only a manual renew clears it). Next cycle:
   - Contabo/other boxes: never charged, never cancelled → customer keeps the server free, we keep paying the provider.
   - DigitalOcean VPS/RDP: not charged → powered off at expiry and deleted 2 days later, even with auto-renew ON and money in the wallet.
   - Reseller-API renewals also leave the flag set (non-DO boxes then run unpaid).
2. **CloudIVR SMS counted twice, minutes likely too** (`phone-scheduler.js` runUsageTracking).
   Every SMS is counted live, then the 3 AM job counts yesterday's SMS again. Customers hit their SMS limit at about half
   the advertised amount → $0.02 overage charges or dropped SMS. The same job re-adds the last 100 Telnyx calls every night
   with no date filter, on top of live minute counting.
3. **CloudIVR scheduled jobs overwrite the whole customer phone record with an old copy** (`phone-scheduler.js` lines 358/762/810 use `set()`).
   Anything that changed while the job ran (a number just bought, settings, usage, a manual renewal) can be undone, and the
   saved Twilio sub-account login/addresses are wiped every time. This exact pattern was already fixed in `_index.js` (Apr-2026) but not here.
4. **CloudIVR bot upgrade credit is wrong** (`phone-config.js` computeUpgradeQuote reads `expiryDate`, numbers store `expiresAt`).
   After the first month customers get no credit for unused days and pay the full new price. In month one the credit is
   pro-rata up to 100%, while the plan cards promise "25% off within 14 days".
5. **Membership plans** (`utils.js` subscribePlan, `_index.js` reminders):
   - Buying again while active replaces the end date → remaining paid days are lost.
   - Daily buyers get the "FINAL REMINDER: expires tomorrow" message minutes after paying, and the reminder/expiry flags
     never reset for Daily-only users, so later reminders never arrive.
   - Any end date more than 31 days out is silently wiped to "expired" (no alert, no refund).

## 🟠 Medium

6. **Hosting bot upgrade** turns auto-renew back ON even if the customer switched it off, and starts a fresh 30-day term
   (remaining days forfeited). The reseller API prices the same upgrade differently (pro-rata, expiry kept) → same upgrade, two prices.
7. **DigitalOcean RDP 2/3-month terms**: a manual renew charges the 2/3-month price but extends the bot record by 1 month →
   powered off early. A DigitalOcean Linux VPS renewed during its grace period is not powered back on.
8. **CloudIVR auto-renew extends from the old expiry date.** If a number's expiry is months in the past (e.g. Twilio numbers
   when TWILIO_ENABLED is switched back on), it charges every hour until the date catches up.
9. **CloudIVR plan rules differ by path**: minute limits are per-number on Telnyx but pooled (main + extras) on Twilio;
   bot upgrades/downgrades don't move extra lines to the new plan (web does) and drop the number surcharge, so the next
   renewal charges more than the customer was shown.
10. **Charge result not checked** in the bot CloudIVR upgrade (wallet) and Membership wallet purchase → if the balance drops
    between the check and the charge, the service is given for free.
11. **VPS renewals have no double-charge guard** (hosting/phone have one). Overlapping 5-minute runs could charge twice.
    Once renewal fails 24 h before expiry, a top-up is never retried and Contabo boxes are cancelled straight away.
12. **CloudIVR scheduler lacks the dev-pod safety switch** that hosting/VPS have (SKIP_WEBHOOK_SYNC). No live risk in this
    preview (local database), but a dev pod on the production database would charge and release real numbers.
13. **CloudIVR monthly usage reset** keys on purchase day: numbers bought on the 29th–31st skip months; numbers whose renewal
    day drifted get two resets a month. 80%/100% usage-alert flags aren't cleared on renewal.

## 🟡 Low

14. **Grace periods and notices are inconsistent**: CloudIVR main line 24 h working + 7-day hold; extra line released after
    0–24 h; hosting one 24 h notice, offline at expiry, deleted at 48 h; DO VPS/RDP 2 days off then deleted; Contabo deleted at
    expiry. Auto-renew default: phone ON, hosting ON, VPS OFF.
15. **Price fallbacks disagree when env is missing**: weekly hosting $50 (hosting-scheduler, config-setup) vs $30 elsewhere;
    hosting trial defaults ON; Twilio overage $0.04 vs $0.15; some files have no fallback (price becomes NaN). Current env values are correct.
16. **Feature overlaps in plan copy**: Call Recording listed as Pro but Business card sells "All Pro + Recording"; Pro card says
    "IVR" though auto-attendant is Business-only; bot says Call Scheduling is Business, web says bulk scheduling is Pro;
    AI support says weekly hosting has "NO hosting panel" while the card lists HostPanel; unused `hosting/plans.js` says
    "Unlimited domains" for all plans (real limits 2 / 6 / unlimited); web SMS replies use the "inbound SMS" allowance.
17. Two VPS 3-day reminder jobs share one flag (duplicate or differing messages); hosting 24 h warning has one English-only line.

## Working well
Hosting renewals (double-charge guard + refund), reseller domain auto-renew (lock + refund on registrar failure),
CloudIVR suspend/hold/restore logic for main + extra lines, daily CloudIVR price reconciler, blue/green single-writer cron guard.

## Suggested fix order
1 → 2 → 3 → 5 → 4 → 10 → 11 → 6/7 → rest.
