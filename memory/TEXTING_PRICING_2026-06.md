# Two-way texting — instant, no-ID numbers (Multitel file 2026-11-14 + Infobip scan)

Source: `multitel-sms-rates-20261114.csv` (cost per outbound segment) + `memory/multitel_classified.json` (stock/paperwork scan) + `memory/infobip_full_report.csv`.
Full table: `memory/texting_pricing_2026-06.csv`. Receiving texts stays free. NOTHING here is live — prices await owner approval.

Suggested price per sent text = max($0.05, cost x 1.6, rounded up to the cent).

| Country | Type | Multitel number cost/mo | Multitel cost per sent text | Loses money at $0.05? | Suggested price per text | Infobip (SMS paperwork / delivery) |
|---|---|---|---|---|---|---|
| United States | Local | $0.60 | $0.0164 (incl. carrier fee max) | No | $0.05 | No paperwork, instant (10DLC still needed to send) |
| United States | Toll-free | $1.00 (+$0.78 setup) | $0.0164 | No | $0.05 | No paperwork, instant (toll-free verification needed to send) |
| Canada | Local | n/a in scan | $0.0164 | No | $0.05 | No paperwork, instant |
| United Kingdom | Local | $0.70 | $0.0587 | Yes | $0.10 | No paperwork, on request |
| United Kingdom | Mobile | $0.70 | $0.0587 | Yes | $0.10 | No paperwork, on request |
| Netherlands | Mobile | $1.11 | $0.0794 | Yes | $0.13 | No paperwork, on request |
| Colombia | Mobile | $15.91 | $0.0678 | Yes | $0.11 | not offered for SMS |
| Brazil | Mobile | $9.81 | $0.0892 | Yes | $0.15 | not offered |
| Denmark | Mobile | $9.81 | $0.0889 | Yes | $0.15 | Name + address, on request |
| Peru | Mobile | $24.98 | $0.4807 | Yes | $0.77 | not offered for SMS |
| Israel | Mobile | n/a in scan | $0.6255 | Yes | $1.01 | Documents, on request |

## Infobip — instant + no paperwork + SMS
Canada, Lithuania, Poland, Puerto Rico, Spain, United States (instant stock at scan time).
No paperwork but "on request" (Infobip assigns after order, not instant): Austria, Estonia, Guernsey, Hong Kong, Hungary, Italy, Latvia, Malta, Netherlands, Norway, Portugal, Slovakia, United Kingdom.
Infobip per-text cost is not in our data (their API doesn't return SMS rates) — check the Infobip portal price list before pricing those.

## Notes
- Costs are Multitel's rate to text a number in that same country; texting abroad costs the destination rate.
- Stock is point-in-time; resale rights not confirmed by either API.
