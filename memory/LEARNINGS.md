
## 2026-10-07 — search_replace double-apply gotcha
- In large parallel batches, search_replace sometimes reports "old_str did not appear verbatim" although the edit WAS applied; when new_str contains old_str it can even be applied twice (nested text). After any batch with reported failures: grep/git diff to verify, never blindly re-apply.

## 2026-10-07 — Reseller API region case
- reseller-api upper-cases `region` (US-EAST); DO customer codes are mixed-case (US-east). digitalocean-service `_customerRegion()` normalises case + DO slugs (fra1) — use it for any new region lookup.
