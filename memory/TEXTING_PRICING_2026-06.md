# Instant, no-ID two-way texting — costs and customer prices (updated 2026-11-14)

Sources: MultiTEL SMS rate file (2026-11-14) + MultiTEL scan; Infobip live number search (capabilities=SMS) + Infobip public SMS prices (max network, USD).
Rules (owner): 3x our cost. Sent text >= $0.05, extra number on a plan >= $25, receiving free. New number = Basic plan $50/mo.
USA = Spenza USA Texting Number, $50/mo, unlimited texts (no per-text charge), number assigned after payment near the ZIP.
Live in code: js/texting-countries.js.

| Country | Provider used | Number type | Calls too? | Our number cost /mo | Our setup | Our cost per sent text | Customer per text | Extra number on a plan /mo |
|---|---|---|---|---|---|---|---|---|
| Brazil | MultiTEL | Mobile | Yes | $9.81 | $0 | $0.0892 | $0.27 | $29.43 |
| Canada | MultiTEL | Local | Yes | $0.60 | $0 | $0.0164 | $0.05 | $25 |
| Colombia | MultiTEL | Mobile | Yes | $15.91 | $0 | $0.0679 | $0.21 | $47.73 |
| Denmark | MultiTEL | Mobile | Yes | $9.81 | $0 | $0.0889 | $0.27 | $29.43 |
| Lithuania | Infobip | Local | No (SMS only) | $9.76 | $9.76 | $0.047 | $0.15 | $29.28 |
| Netherlands | MultiTEL | Mobile | Yes | $1.11 | $0 | $0.0794 | $0.24 | $25 |
| Peru | MultiTEL | Mobile | Yes | $24.98 | $0 | $0.4807 | $1.45 | $74.94 |
| Poland | Infobip | Local | No (SMS only) | $19.52 | $19.52 | $0.036 | $0.11 | $58.56 |
| Puerto Rico | Infobip | Local | Yes | $0.98 | $0.98 | $0.037 | $0.12 | $25 |
| Spain | Infobip | Local | No (SMS only) | $39.03 | $9.76 | $0.071 | $0.22 | $117.09 |
| United Kingdom | MultiTEL | Mobile | Yes | $0.70 | $0 | $0.0587 | $0.18 | $25 |

Also available but not used (more expensive): Canada via Infobip $0.98/mo, $0.0093/text. Israel mobile (MultiTEL, no ID) has no monthly price in the scan, so it isn't sold.
Margin on a $50 Basic number: Spain is the thinnest at about $11/mo before texts; Peru ~$25; everything else is $30-49.
Bird travel eSIM: 748 active data offers in 187 single-country zones (no regional or global packs, no phone numbers). Full list with 3x prices: memory/bird_esim_offers_2026-11.csv.
