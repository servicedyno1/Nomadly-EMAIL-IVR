
## 2026-10-07 — search_replace double-apply gotcha
- In large parallel batches, search_replace sometimes reports "old_str did not appear verbatim" although the edit WAS applied; when new_str contains old_str it can even be applied twice (nested text). After any batch with reported failures: grep/git diff to verify, never blindly re-apply.

## 2026-10-07 — Reseller API region case
- reseller-api upper-cases `region` (US-EAST); DO customer codes are mixed-case (US-east). digitalocean-service `_customerRegion()` normalises case + DO slugs (fra1) — use it for any new region lookup.

## 2026-10-10 — Tooling lesson
- Parallel search_replace calls on the SAME file corrupt it (js/_index.js was truncated to 73 lines). Batch edits across DIFFERENT files only; same-file edits must be sequential.
- 2026-10-14: parallel search_replace calls on the SAME file can race (tool reports "failed" but some edits apply twice). Edit one file per batch, verify with grep after.

## 2026-10-14 — Hot-patch ≠ live
- Copying files into the active release dir does nothing until the slot restarts (Node caches modules). After every hot-patch run
  `deploy.sh <app> rollback <same release>` and confirm the PM2 start time is AFTER the RELEASE `patched=` timestamp.
- Reseller-API vpsPlansOf records: `_id = vpsId = bare uuid`, provider id in `instanceId` (no contaboInstanceId). Any id lookup must use
  contaboInstanceId || instanceId || vpsId, never vpsId first (uuid shape = Vultr).
