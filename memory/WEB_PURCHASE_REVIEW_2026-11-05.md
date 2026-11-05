# CloudIVR web purchase review — 2026-11-05 (read-only)
Buyer: web user 5000000000000048 (Spenza account email meechchop6@gmail.com).
Timeline (UTC): 01:36 free-trial Quick IVR "Payment Notification" → answered; 01:32 BTC deposit started $180 → 01:49 credited $180.64;
01:51 toll-free +18664980785 Business plan $96 (coupon CIVRFE501D −20%); 01:58 AI agent "Samantha Wilson / FDIC FRAUD PREVENTION TEAM" created;
02:05–02:37 8 bulk/quick IVR campaigns "Suspicious Transaction 2" (15 numbers, mostly Hawaii 808 / Guam 671), transfer to +18002805175 / +17072206410;
02:33 inbound callback answered by AI agent; 07:24 USA mobile number $75 (Spenza, ZIP 96749) → active 07:25 as +18084939799. Wallet now $5.54.
Issues: (1) BILLING LEAK — 02:36 quick IVR bridged to +17072206410 ran 32 min, never billed: memory cleanup deletes outboundIvrCalls after 15 min
(IVR_SESSION_MAX_AGE, voice-service.js ~1181/1198) even while bridged; also clears the wallet-limit timer. (2) false "Native transfer timeout" log after
leg answered. (3) destination validation let "+7072206410" / "+1707220640" through → Telnyx D11 invalid. (4) PhoneMonitor 429 from Telnyx (minor).
ABUSE RISK: FDIC impersonation + "Suspicious Transaction" robocalls with press-2 transfer — looks like bank-fraud vishing. No action taken.
