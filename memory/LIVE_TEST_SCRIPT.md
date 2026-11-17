# Live test script — new keypad keys, queue, stop key (written 2026-11-17)
Calls A–F (deep menu, webhook, collect, PIN, pay text) and the wrong-key path PASSED on production 2026-11-17 with scripts/ivr_live_probe.js. After the next deploy: re-run E (PIN pound fix), then G–O (queue, stop key) which are not live yet.
Agent side: confirm the release on app-main contains js/cloudivr-web/ivr-blueprint.js and `grep -c queueContinue js/voice-service.js` > 0, then tail the app log while the owner calls.

Setup on the test number's Keypad menu (then Save, switch ON):
1 → sub-menu → 1 → sub-menu → 1 → sub-menu → 1 → Play a message "deep test"
2 → Call your system: a https://webhook.site/... address
3 → Collect digits (6), confirmation message, same webhook address
4 → Ask for a PIN 4821, correct → message "welcome"
5 → Text a payment link (any https link) from a Texting Number
6 → Call queue: two phones you control, longest wait 60s, last resort = closing message, call back offer ON

Calls (expected → log line to look for):
A. 1,1,1,1 → hear "deep test" → `[Voice] DTMF received: "1" ... (sub-menu 1.1.1)`
B. 2 → hear the thank-you line; webhook.site shows event ivr_key → `IVR webhook delivered (ivr_key)`
C. 3 then 123456# → confirmation; webhook.site shows collected 123456 → `IVR webhook delivered (ivr_collect)`; owner notification with the digits
D. 3 then nothing → goodbye
E. 4 then 0000# → asked again; 4821# → "welcome". Then 3 wrong codes → hangs up
F. 5 → "we have sent you a text" and the text arrives with the link
G. 6, answer on phone 1 → connected, both sides hear each other, hold music stopped
H. 6, let both phones ring out → "Everyone is still busy… press 1 and we will call you back" → press nothing → music + phones ring again → after ~60s closing message → `Queue ...: nobody answered in ..s → overflow message`
I. 6, ring out, press 1 at the offer → "we will call you back", call ends, owner notification "Call back requested"
J. Two callers on 6 at once, nobody answering → second caller hears "You are number 2 in the queue"
K. 6 then hang up while it rings → the ringing phone stops
L. Low wallet (< per-minute rate): 6 or a forward key → "wallet balance is insufficient", not connected
Outbound (Quick call to your own mobile, connect key 1, stop key 9, script says both):
M. press 9 → "You will not receive these calls again"; number appears on the Do not call page; owner notification
N. press 1 → connected as before
O. Start a small campaign that includes that mobile → it is skipped as do-not-call
Unknowns to watch: whether a no-key timeout on the call-back offer fires promptly (there is a 20s safety net); DTMF length/terminator (#) behaviour for collect and PIN on Bird vs MultiTEL.
