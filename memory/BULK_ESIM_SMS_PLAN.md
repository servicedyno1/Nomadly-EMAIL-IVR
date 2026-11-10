# eSIM BulkSMS (USA/Canada) — plan & decisions (2026-11-10)
User choices: shared pool of platform eSIMs; bookings 500–2000 SMS paid via existing bot checkout (wallet / crypto / bank);
full spec except customer web dashboard; SEPARATE Spenza account (env SPENZA_BULK_API_KEY / SPENZA_BULK_API_SECRET);
all four bots (code under js/ syncs to WhiteLabel; never require js/cloudivr-web web-only files from new non-web code
except wallet.js which WL already has).
Spenza facts: POST /api/v1.1/sms 30/min ACCOUNT-wide (+120/min all endpoints), sync 201, no message id, no delivery receipts,
Idempotency-Key header supported; inbound via signed webhook (x-spenza-signature v1=HMAC(ts.raw)); renew-number = replacement.
Design: js/bulk-esim/ modules (provider adapter, inventory, quota, capacity/bookings, queue worker, inbound/sessions, health,
compliance STOP/HELP/suppression, admin API), bot flow js/bulk-esim/bot.js hooked into _index.js BulkSMS submenu.
Low Spenza credit (user req): credit watch every 2 min + send errors of kind 'credit' → platform paused (reason provider_credit),
admin alerted; auto-resume when credit >= cfg.minCredit; admin alerted again.
Multi-bot: ONE shared Mongo for pool/queue (env BULK_ESIM_MONGO_URL/BULK_ESIM_DB; default = own DB). Customer id = brand:chatId.
Single worker via lock doc (leader). Each bot delivers its own customers' notices by polling bsNotify where brand = its brand.
Test sends: max 2 per campaign during setup, not counted in booking volume, count against daily quota.
