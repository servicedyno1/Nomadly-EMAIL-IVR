# RCA — Nomadly RDP purchase failed (nyc3 "Size is not available") — 2026-10-14

## Incident (prod app-main-b :5100, release 20261013T170031Z-dcc4687)
- User **Loaded4** (chatId 911434986) bought **Pro — Windows RDP** (`pro-1m`, ws2022, region **nyc3** "United States (New York)"),
  $112 from wallet at 06:11:08Z.
- doRdpServers `59bcada5-a885-46e8-8c37-d203fbd20ea7` logs:
  - 06:11:08 creating from golden image 246825481 (fast path)
  - 06:11:09 `s-4vcpu-8gb-intel is not available in nyc3` → next size
  - 06:11:10 `s-4vcpu-8gb is not available in nyc3` → next size
  - 06:11:10 FAILED `DigitalOcean API error 422: Size is not available in this region.`
- 06:11:23 bot aborted (13 s, no 25-min poll), **auto-refunded $112** (wallet bal now $112.53), no orphan vpsPlansOf.
  User asked "What happened?" → AI escalation `WyVal` opened.

## Root cause
`js/digitalocean-rdp-service.js` hardcodes which DO size families are sold per region (verified 2026-09-24):
`PREMIUM_AMD_REGIONS` excludes nyc3, `PREMIUM_INTEL_REGIONS` includes nyc3. DigitalOcean has since changed nyc3's catalog
(live `GET /v2/sizes` 2026-10-14): in nyc3 ONLY Premium AMD (`s-*-amd`) is sold; Premium Intel and Basic are gone.
So `sizeCandidatesFor(tier,'nyc3')` = [intel, basic] — never includes the one size that exists → the 422 fallback walks
two dead candidates and fails. **Every tier (Standard/Pro/Power) in nyc3 fails**; it's also the default for `US`/unknown
region codes (reseller API). The other 8 regions still resolve to at least one live size.

Live catalog (2026-10-14): AMD = ams3,blr1,lon1,nyc1,nyc2,nyc3,sfo3,sgp1,syd1 · Intel = ams3,blr1,fra1,lon1,nyc2,sfo2,sfo3,
sgp1,syd1,tor1 · Basic s-4vcpu-8gb = ams3,blr1,fra1,lon1,sfo2,sgp1,syd1,tor1. Last good nyc3 order: 2026-09-24 (basic).
Ruled out: DO billing (account active, balance credit −$5, 4/15 droplets), golden image (present in nyc3), code drift
(deployed file md5 == repo).

## Proposed fix (NOT applied — awaiting owner OK)
- Make `sizeCandidatesFor` always return all three families (preferred order per region sets) so the existing 422 walk
  self-heals catalog changes; and/or refresh the region sets from a cached live `GET /v2/sizes`.
- Add nyc3 to `PREMIUM_AMD_REGIONS`; refresh `PREMIUM_INTEL_REGIONS` to the live list.

## Unrelated anomaly seen in the same logs
- `[RDP Grace] destroy FAILED ... Vultr DELETE /instances/227de9e3-c9da-4d38-aa06-8ff31b216057 (401 Unauthorized)` every
  5 min (attempt 407+) — stale/invalid Vultr API key; legacy Vultr RDP can't be destroyed.
