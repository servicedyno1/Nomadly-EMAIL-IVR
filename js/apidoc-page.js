// ============================================================
// Reseller API — Developer Documentation Page  (js/apidoc-page.js)
// ------------------------------------------------------------
// Renders a self-contained, dependency-free HTML developer guide for the
// public Reseller REST API (js/reseller-api.js). Served by Express at:
//     GET /apidoc      →  https://2.speechcue.com/apidoc
//
// The page has ZERO external assets (all CSS + JS are inline) so it renders
// instantly and keeps working even if a CDN is blocked.
// ============================================================

const BRAND = process.env.CHAT_BOT_BRAND || 'Nomadly'
const SUPPORT_HANDLE = process.env.SUPPORT_HANDLE || process.env.SUPPORT_USERNAME || '@onarrival1'

// ── Endpoint reference model ──
// Each group → { id, title, blurb, endpoints:[ { method, path, auth, billed, desc, params:[[name,req,desc]], curl, resp } ] }
function endpointGroups(base) {
  let BNS = ['ns1.hosta.sh', 'ns2.hosta.sh']
  let BR = false
  try { const b = require('./branded-ns'); BNS = b.brandedNameservers(); BR = b.isEnabled() } catch (_) { /* default */ }
  const BNS_JSON = JSON.stringify(BNS)
  const BNS_TXT = BNS.join(' / ')
  const CF_JSON = '["ada.ns.cloudflare.com", "rob.ns.cloudflare.com"]'
  const NS_EVENTS = BR ? ',"domain.nameservers_branded","domain.nameservers_reverted","domain.nameservers_branding_failed"' : ''
  const ALERT_EVENTS = ',"hosting.expiring","hosting.renewed","hosting.unsuspended","vps.expiring","vps.renewed","rdp.expiring","rdp.renewed","domain.expiring","domain.expired","domain.renewed","domain.auto_renew_failed","hosting.site_down","hosting.site_recovered","hosting.usage_threshold","vps.usage_threshold","rdp.usage_threshold","account.low_balance"'
  return [
    {
      id: 'meta', title: 'Meta',
      blurb: 'Service status, your account/wallet balance and the full bot price catalog.',
      endpoints: [
        {
          method: 'GET', path: '/health', auth: false, billed: false,
          desc: 'Health probe. No authentication required. Returns the current run mode (live or dry_run) and the list of sellable products.',
          curl: `curl -s ${base}/health`,
          resp: `{
  "ok": true,
  "service": "reseller-api",
  "version": "v1",
  "mode": "live",
  "products": ["domains", "dns", "vps", "rdp", "hosting"]
}`,
        },
        {
          method: 'GET', path: '/account', auth: true, billed: false,
          desc: 'Returns the account bound to your API key and its current bot wallet balance in USD (usd_in − usd_out — the same balance the Telegram bot shows). Every billed call is funded by this wallet. webhook_url is the RDP-lifecycle push webhook currently registered on your key (null if none).',
          curl: `curl -s ${base}/account \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "owner_chat_id": "7304424395",
  "label": "acme-reseller",
  "wallet_balance_usd": 142.50,
  "currency": "usd",
  "webhook_url": "https://your-app.com/hooks/nomadly",
  "mode": "live"
}`,
        },
        {
          method: 'GET', path: '/jobs/:job_id', auth: true, billed: false,
          desc: 'Poll an async create for live progress. POST /hosting, /vps and /rdp return a job_id; GET /jobs/:job_id reports status (provisioning → provisioned → or failed) plus a storefront-ready progress bar and ETA countdown so you can render a "setting up your service…" screen without hammering the resource read. While provisioning: progress ramps 10→95, stage_label is a human string, eta_seconds counts down and eta_at is the estimated completion timestamp (hosting ≈ 2 min, Linux VPS ≈ 3 min, Windows RDP ≈ 3-5 min for fast_deploy editions / up to ~45 min for a full install). On provisioned: progress 100 — read the live resource at poll_url (and credentials at credentials_url). On failed: the wallet was auto-refunded (refunded:true) and error/provision_failed_reason explain why — safe to retry the create. Owner-scoped: a job_id you do not own returns 404.',
          curl: `curl -s ${base}/jobs/JOB_ID -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "status": "provisioning",
  "progress": 45,
  "stage": "provisioning",
  "stage_label": "Registering domain & creating your cPanel account",
  "eta_seconds": 66,
  "eta_at": "2026-09-24T15:01:06.000Z",
  "elapsed_seconds": 54,
  "mode": "live",
  "job_id": "0ae7cc0a-…",
  "price_usd": 100,
  "created_at": "2026-09-24T15:00:00.000Z",
  "finished_at": null,
  "product": "hosting",
  "username": "mysite01",
  "id": "mysite01",
  "domain": "mysite.com",
  "plan": "Golden Anti-Red HostPanel (1-Month)",
  "poll_url": "/hosting/mysite01",
  "credentials_url": "/hosting/mysite01/credentials"
}`,
        },
        {
          method: 'GET', path: '/account/webhook', auth: true, billed: false,
          desc: 'Get the push-webhook URL + signing secret registered on your API key and the full list of lifecycle events it receives. Registering a webhook lets you react to expiry/grace/deletion instantly instead of polling GET /renewals.',
          curl: `curl -s ${base}/account/webhook \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "webhook_url": "https://your-app.com/hooks/nomadly",
  "webhook_secret": "whsec_…",
  "events": ["hosting.provisioned","hosting.provision_failed","hosting.grace_start","hosting.suspended","hosting.deleted","hosting.auto_renew_failed","hosting.plan_changed","hosting.app_installed","hosting.app_install_failed","vps.provisioned","vps.provision_failed","vps.grace_start","vps.deleted","vps.plan_changed","vps.plan_change_failed","rdp.provisioned","rdp.provision_failed","rdp.grace_start","rdp.deleted","rdp.plan_changed","rdp.plan_change_failed"${NS_EVENTS}${ALERT_EVENTS}],
  "delivery": "POST signed with HMAC-SHA256 (X-Nomadly-Signature: sha256=<hex>), auto-retry with backoff, de-duplicated per server+event"
}`,
        },
        {
          method: 'PUT', path: '/account/webhook', auth: true, billed: false,
          desc: 'Register (or clear) the push-webhook URL for your account. Send {"webhook_url":"https://…"} to set it (the first time this also mints a webhook_secret you must store), or {"webhook_url":null} to clear it (the secret is kept for re-enabling). Nomadly then POSTs a JSON body { event, product, occurred_at, data:{ id, product, domain, reason, … } } to your URL for each lifecycle event across all three products: hosting.provisioned / vps.provisioned / rdp.provisioned (an async create finished — data carries the id/username, domain, plan and ip/nameservers), hosting.provision_failed / vps.provision_failed / rdp.provision_failed (an async create ultimately failed — the wallet was auto-refunded; data carries reason and refunded:true), hosting.grace_start / vps.grace_start / rdp.grace_start (subscription expired → service suspended/powered off and a grace period begins; data carries expired_at + delete_at + grace_hours — hosting grace is 48h, VPS/RDP is 72h/3-day), hosting.auto_renew_failed (a wallet auto-renew attempt failed on insufficient funds; data carries price_usd, wallet_balance_usd, next_attempt_at — the plan then falls into grace, it is NOT terminated), hosting.deleted / vps.deleted / rdp.deleted (the resource was permanently removed after grace; data carries reason), hosting.plan_changed (a hosting plan change made through the API was applied; data carries username, domain, direction, billing ("pro_rata" = Premium <-> Golden, expiry unchanged | "new_term" = weekly -> monthly, fresh 30-day term), from_plan, to_plan, to_plan_name, charged_usd, unused_credit_usd, previous_expires_at, expires_at, renewal_price_usd), hosting.app_installed / hosting.app_install_failed (a one-click WordPress install finished or failed — data carries username, domain, app, app_id, path and site_url/admin_url/admin_user/version, or reason + message), vps.plan_changed / rdp.plan_changed (an in-place plan change finished; data carries change_id, direction, from_plan, to_plan, charged_usd, resize_disk, disk_gb) and vps.plan_change_failed / rdp.plan_change_failed (the resize did not complete, the server stays on its old plan and any charge was refunded; data carries reason, refunded, refund_usd)' + (BR ? ', and the branded-nameserver events domain.nameservers_branded (registrar switched to the branded nameservers; data carries domain + nameservers + previous_nameservers), domain.nameservers_reverted (rolled back to the Cloudflare-assigned names to keep the domain protected; data carries reason + nameservers) and domain.nameservers_branding_failed (the domain stays on the Cloudflare names; data carries reason)' : '') + '. ALERTS (see "Alerts, Monitoring & Activity"): hosting.expiring / vps.expiring / rdp.expiring / domain.expiring (7, 3 and 1 day before expiry), *.renewed, hosting.unsuspended, domain.expired, hosting.site_down / hosting.site_recovered (uptime monitor), *.usage_threshold and account.low_balance. SECURITY: every delivery is signed — header "X-Nomadly-Signature: sha256=<hex>" is HMAC-SHA256 of the exact raw request body keyed by your webhook_secret. Recompute it and constant-time compare BEFORE acting on any *.deleted. Delivery is retried with backoff and de-duplicated per server+event (grace/auto_renew_failed re-fire each billing cycle; *.deleted fires once). Reply 2xx to acknowledge.',
          params: [['webhook_url', true, 'Your http(s) endpoint URL, or null to clear']],
          curl: `curl -s -X PUT ${base}/account/webhook \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"webhook_url":"https://your-app.com/hooks/nomadly"}'`,
          resp: `{
  "webhook_url": "https://your-app.com/hooks/nomadly",
  "webhook_secret": "whsec_… (store this — it signs every delivery)",
  "events": ["hosting.provisioned","hosting.provision_failed","hosting.grace_start","hosting.suspended","hosting.deleted","hosting.auto_renew_failed","hosting.plan_changed","hosting.app_installed","hosting.app_install_failed","vps.provisioned","vps.provision_failed","vps.grace_start","vps.deleted","vps.plan_changed","vps.plan_change_failed","rdp.provisioned","rdp.provision_failed","rdp.grace_start","rdp.deleted","rdp.plan_changed","rdp.plan_change_failed"${NS_EVENTS}${ALERT_EVENTS}],
  "delivery": "POST signed with HMAC-SHA256 (X-Nomadly-Signature: sha256=<hex>), auto-retry with backoff, de-duplicated per server+event"
}

// Example event Nomadly POSTs to your URL (verify X-Nomadly-Signature first):
// { "event": "hosting.grace_start", "product": "hosting",
//   "occurred_at": "2026-09-24T15:00:00.000Z",
//   "data": { "id": "mysite01", "product": "hosting", "domain": "mysite.com",
//             "plan": "Golden Anti-Red HostPanel (1-Month)", "reason": "plan_expired",
//             "expired_at": "2026-09-24T15:00:00.000Z", "delete_at": "2026-09-26T15:00:00.000Z",
//             "grace_hours": 48 } }`,
        },
        {
          method: 'GET', path: '/pricing', auth: true, billed: false,
          desc: 'One call returns the full bot price catalog — the exact prices the Telegram bot charges — for hosting, VPS and RDP, plus a domain-pricing note and your current wallet balance. Use it to compute resale margins without hitting each product endpoint.',
          params: [['region', false, 'Region code for VPS/RDP plan pricing — defaults to EU']],
          curl: `curl -s "${base}/pricing?region=EU" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "mode": "live",
  "currency": "usd",
  "wallet_balance_usd": 142.50,
  "region": "EU",
  "domains": {
    "note": "Per-name; call /domains/search?domain=<name> for an exact quote.",
    "min_price_usd": 30
  },
  "hosting": [
    { "plan_id": "premium-weekly", "name": "Premium Anti-Red (1-Week)", "tier": "premium", "price_usd": 30, "duration_days": 7, "addon_domains": 1 }
  ],
  "vps": { "provider": "digitalocean", "region": "EU", "plans": [
    { "plan_id": "s-1vcpu-1gb", "name": "Cloud VPS 10", "vcpus": 1, "ram_gb": 1, "disk_gb": 25, "cpu": "Standard", "storage_type": "SSD", "price_usd": 18.00 },
    { "plan_id": "s-1vcpu-1gb-amd", "name": "NVMe AMD 1vCPU/1GB/25GB", "vcpus": 1, "ram_gb": 1, "disk_gb": 25, "cpu": "AMD", "storage_type": "NVMe SSD", "price_usd": 21.00 }
  ] },
  "rdp": { "provider": "digitalocean", "region": "EU", "plans": [
    { "plan_id": "standard-1m", "name": "Standard — Windows RDP (1 month)", "ram_gb": 4, "disk_gb": 80, "cpu": "AMD", "storage_type": "NVMe SSD", "price_usd": 56 }
  ] }
}`,
        },
      ],
    },
    {
      id: 'domains', title: 'Domains',
      blurb: 'Search, register and list domains. Registration is wallet-billed at the live registrar price.',
      endpoints: [
        {
          method: 'GET', path: '/domains/search', auth: true, billed: false,
          desc: 'Check availability and live price for a domain.',
          params: [['domain', true, 'The domain to check, e.g. mysite.com']],
          curl: `curl -s "${base}/domains/search?domain=mysite.com" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "domain": "mysite.com",
  "available": true,
  "price_usd": 12.99,
  "registrar": "ConnectReseller",
  "message": ""
}`,
        },
        {
          method: 'POST', path: '/domains/register', auth: true, billed: true,
          desc: !BR
            ? 'Register a domain. Charged to your wallet at the price returned by /domains/search. NAMESERVERS: by default (ns_choice "cloudflare") the domain is delegated to its Cloudflare-assigned nameservers, so DNS sits on our protected Cloudflare edge (proxy, WAF, anti-red). Use ns_choice "registrar" for the registrar default DNS, or pass your own "nameservers" array (2–4 hostnames) to use custom nameservers — custom DNS is NOT protected by our edge.'
            : `Register a domain. Charged to your wallet at the price returned by /domains/search. NAMESERVERS: by default (ns_choice "branded") the domain is delegated to the branded nameservers ${BNS_TXT} while DNS stays on our protected Cloudflare edge (proxy, WAF, anti-red). Cloudflare only activates a zone on its own assigned names, so the domain is first registered on the Cloudflare-assigned nameservers and our worker switches the registrar to ${BNS_TXT} automatically as soon as the zone is ACTIVE and proxied (usually minutes, up to a few hours) — no action needed; the response carries nameserver_status "activating" and current_nameservers until then, and the domain.nameservers_branded webhook fires when done. Every branded domain is then monitored hourly: if Cloudflare ever stops treating it as active, it is switched back to the Cloudflare names automatically (domain.nameservers_reverted webhook) so the site stays protected. Opt out with ns_choice "cloudflare" (Cloudflare-assigned names) or "registrar" (registrar default DNS), or pass your own "nameservers" array (2–4 hostnames) to use custom nameservers — custom DNS is NOT protected by our edge.`,
          params: [
            ['domain', true, 'Domain to register, e.g. mysite.com'],
            ['ns_choice', false, BR ? `"branded" (default — ${BNS_TXT}) | "cloudflare" | "registrar"` : '"cloudflare" (default) | "registrar"'],
            ['nameservers', false, BR ? 'Array of 2–4 custom nameserver hostnames — overrides ns_choice (passing exactly the branded pair = "branded")' : 'Array of 2–4 custom nameserver hostnames — overrides ns_choice'],
          ],
          curl: `curl -s -X POST ${base}/domains/register \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"domain":"mysite.com"}'`,
          resp: `{
  "mode": "live",
  "product": "domain",
  "action": "register",
  "charged_usd": 12.99,
  "wallet_balance_usd": 129.51,
  "result": {
    "success": true,
    "domain": "mysite.com",
    "registrar": "ConnectReseller",${BR ? `
    "nameserver_mode": "branded",
    "nameserver_status": "activating",
    "nameservers": ${BNS_JSON},
    "current_nameservers": ${CF_JSON},
    "note": "Cloudflare is activating the zone on its assigned nameservers; the registrar is switched to the branded nameservers automatically (usually within minutes to a few hours). No action needed."` : `
    "nameserver_mode": "cloudflare",
    "nameservers": ${CF_JSON}`}
  }
}`,
        },
        {
          method: 'GET', path: '/domains', auth: true, billed: false,
          desc: BR
            ? 'List all domains owned by your account (max 500). Branded domains also carry nameserver_mode, nameserver_status (activating | branded | reverted | branding_failed) and current_nameservers (what the registry delegates to right now).'
            : 'List all domains owned by your account (max 500).',
          curl: `curl -s ${base}/domains \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "domains": [
    {
      "domain": "mysite.com",
      "registrar": "ConnectReseller",
      "nameserver_type": "cloudflare",${BR ? `
      "nameservers": ${BNS_JSON},
      "nameserver_mode": "branded",
      "nameserver_status": "branded",
      "current_nameservers": ${BNS_JSON},` : `
      "nameservers": ${CF_JSON},`}
      "registered_at": "2026-09-08T10:22:00.000Z",
      "expires_at": "2027-09-08T10:22:00.000Z",
      "auto_renew": false,
      "auto_renew_supported": false,
      "renewal_price_usd": null,
      "next_charge_at": null,
      "auto_renew_last_error": null,
      "auto_renew_next_attempt_at": null,
      "dns_records_url": "/dns/mysite.com/records",
      "nameservers_url": "/dns/mysite.com/nameservers"
    }
  ]
}`,
        },
        {
          method: 'POST', path: '/domains/:domain/auto-renew', auth: true, billed: false,
          desc: 'Turn wallet auto-renew on or off for one domain. Off by default; OpenProvider-registered domains only for now (enabling any other domain returns 501 auto_renew_not_supported — disabling always works). Send {enabled:true|false}, or omit the body to toggle. Enabling reads the real expiry date and the 1-year renewal price from the registrar (renewal_price_usd, next_charge_at). From 7 days before expires_at an hourly worker charges renewal_price_usd to your wallet and renews the domain for 1 year (domain.renewed webhook, via:"auto_renew"). If the wallet is short or the registrar refuses, the charge is not taken (or is refunded), auto_renew_last_error is set (insufficient_funds | pricing_unavailable | registrar_error), domain.auto_renew_failed fires and the worker retries once a day until the expiry date. After a top-up, send {enabled:true} again to retry on the next run instead of waiting a day. The registrar-side auto-renew stays off, so a domain is never renewed twice. Free — no wallet charge for the toggle itself.',
          params: [['enabled', false, 'boolean — omit to toggle']],
          curl: `curl -s -X POST ${base}/domains/mysite.com/auto-renew \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"enabled":true}'`,
          resp: `{
  "domain": "mysite.com", "registrar": "OpenProvider",
  "auto_renew": true, "auto_renew_supported": true,
  "renewal_period_years": 1, "renewal_price_usd": 30,
  "expires_at": "2027-09-08T10:22:00.000Z", "next_charge_at": "2027-09-01T10:22:00.000Z",
  "auto_renew_last_error": null, "auto_renew_last_attempt_at": null, "auto_renew_next_attempt_at": null,
  "wallet_balance_usd": 42.51, "sufficient_balance": true, "mode": "live"
}`,
        },
        {
          method: 'POST', path: '/domains/:domain/renew', auth: true, billed: true,
          desc: 'Renew a domain you own for another registration term. Dry-run returns the price + wallet check; live registrar renewal is not yet wired (returns 501 not_implemented before any charge).',
          curl: `curl -s -X POST ${base}/domains/mysite.com/renew \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "mode": "dry_run", "product": "domain", "action": "renew",
  "price_usd": 39, "wallet_balance_usd": 5, "sufficient_balance": false
}`,
        },
      ],
    },
    {
      id: 'dns', title: 'DNS Management',
      blurb: 'Full CRUD over DNS records plus nameserver control. DNS operations are FREE — no wallet charge.',
      endpoints: [
        {
          method: 'GET', path: '/dns/:domain/records', auth: true, billed: false,
          desc: 'List all DNS records for a domain you own.',
          curl: `curl -s ${base}/dns/mysite.com/records \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "domain": "mysite.com",
  "records": [
    { "id": "a1b2", "type": "A", "name": "@", "value": "203.0.113.10", "ttl": 3600 }
  ],
  "source": "cloudflare"
}`,
        },
        {
          method: 'POST', path: '/dns/:domain/records', auth: true, billed: false,
          desc: 'Add a DNS record.',
          params: [
            ['type', true, 'Record type: A, AAAA, CNAME, MX, TXT, …'],
            ['name', false, 'Host/subdomain — defaults to "@" (root)'],
            ['value', true, 'Record value / target'],
            ['priority', false, 'Priority (MX/SRV records)'],
            ['ttl', false, 'Time-to-live in seconds'],
          ],
          curl: `curl -s -X POST ${base}/dns/mysite.com/records \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"A","name":"www","value":"203.0.113.10","ttl":3600}'`,
          resp: `{
  "domain": "mysite.com",
  "added": { "type": "A", "name": "www", "value": "203.0.113.10", "ttl": 3600 },
  "detail": { "success": true, "id": "c3d4" }
}`,
        },
        {
          method: 'PUT', path: '/dns/:domain/records', auth: true, billed: false,
          desc: 'Update an existing DNS record. Send back the full record object obtained from the GET call (optionally wrapped in { "record": {…} }).',
          curl: `curl -s -X PUT ${base}/dns/mysite.com/records \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"record":{"id":"c3d4","type":"A","name":"www","value":"203.0.113.20","ttl":3600}}'`,
          resp: `{ "domain": "mysite.com", "updated": true, "detail": { "success": true } }`,
        },
        {
          method: 'DELETE', path: '/dns/:domain/records', auth: true, billed: false,
          desc: 'Delete a DNS record. Send the record object obtained from the GET call.',
          curl: `curl -s -X DELETE ${base}/dns/mysite.com/records \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"record":{"id":"c3d4","type":"A","name":"www"}}'`,
          resp: `{ "domain": "mysite.com", "deleted": true, "detail": { "success": true } }`,
        },
        {
          method: 'GET', path: '/dns/:domain/nameservers', auth: true, billed: false,
          desc: BR
            ? 'Current nameserver delegation for a domain on your account, including the branded-nameserver status (activating → branded, or reverted / branding_failed).'
            : 'Current nameserver delegation for a domain on your account (nameserver_mode: cloudflare | registrar | custom).',
          curl: `curl -s ${base}/dns/mysite.com/nameservers \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: BR ? `{
  "domain": "mysite.com",
  "nameserver_type": "cloudflare",
  "nameserver_mode": "branded",
  "nameserver_status": "branded",
  "nameservers": ${BNS_JSON},
  "current_nameservers": ${BNS_JSON},
  "branded_at": "2026-10-07T11:05:00.000Z"
}` : `{
  "domain": "mysite.com",
  "nameserver_type": "cloudflare",
  "nameserver_mode": "cloudflare",
  "nameservers": ${CF_JSON},
  "current_nameservers": ${CF_JSON}
}`,
        },
        {
          method: 'PUT', path: '/dns/:domain/nameservers', auth: true, billed: false,
          desc: !BR
            ? 'Replace the domain nameservers (2–4 hostnames). The change is applied at the registrar as-is; custom nameservers are NOT protected by our Cloudflare edge.'
            : `Replace the domain nameservers (2–4 hostnames). Sending exactly ${BNS_TXT} switches the domain to the protected branded nameservers (its DNS must already be on our Cloudflare; if the zone is not active yet the registrar is kept on the Cloudflare names and the switch happens automatically after activation). Any other set = custom nameservers: branded monitoring stops and the change is applied as-is.`,
          params: [['nameservers', true, 'Array of 2–4 nameserver hostnames']],
          curl: `curl -s -X PUT ${base}/dns/mysite.com/nameservers \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"nameservers":["ns1.example.com","ns2.example.com"]}'`,
          resp: `{
  "domain": "mysite.com",
  "nameservers": ["ns1.example.com", "ns2.example.com"],
  "updated": true
}`,
        },
      ],
    },
    {
      id: 'shortener', title: 'URL Shortener',
      blurb: 'Turn any domain into a branded link shortener. Activate a domain three ways — BUY it (wallet-billed at the domain price, then auto-configured), connect an EXISTING on-account domain (free, DNS auto-set via Cloudflare), or connect an EXTERNAL domain you host elsewhere (free — we return the exact CNAME + TXT records to add, then call /verify). Links resolve on your domain (https://yourdomain/slug → 301) and every click is counted, with per-day / country / device / referrer analytics (90 days), optional smart routing by visitor country or device, and a QR code per link. Creating / managing links is FREE. Links only work on domains you have activated. On a sandbox pod, domain activation returns a dry-run envelope (no DNS change); link CRUD runs live against the database.',
      endpoints: [
        {
          method: 'POST', path: '/shortener/domains', auth: true, billed: true,
          desc: 'Activate a domain as a URL shortener. Body { domain, source } where source is "buy" (register the domain — wallet-billed at the domain price — then auto-activate), "existing" (a domain already on your account — free, DNS set automatically via Cloudflare) or "external" (a domain you host elsewhere — free; the response lists the CNAME + TXT records to add at your DNS host, then confirm with POST /shortener/domains/:domain/verify).',
          params: [['domain', true, 'Domain to use for short links, e.g. go.mysite.com'], ['source', true, '"buy" | "existing" | "external"']],
          curl: `curl -s -X POST ${base}/shortener/domains \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"domain":"go.mysite.com","source":"external"}'`,
          resp: `{ "mode": "live", "domain": "go.mysite.com", "source": "external", "status": "pending_dns", "dns_records": [ { "type": "CNAME", "host": "go.mysite.com", "value": "nomadly.up.railway.app" }, { "type": "TXT", "host": "_acme.go.mysite.com", "value": "verify-abc123" } ] }`,
        },
        {
          method: 'GET', path: '/shortener/domains', auth: true, billed: false,
          desc: 'List every domain you have activated (or are activating) as a shortener, with its status (pending/host_linked/dns_added/completed/failed/deactivated), an `active` boolean (true when it accepts links), and the DNS target.',
          curl: `curl -s ${base}/shortener/domains \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "domains": [ { "domain": "go.mysite.com", "status": "completed", "cname_target": "nomadly.up.railway.app", "record_type": "CNAME", "activated_at": "2026-06-20T10:00:00.000Z" } ] }`,
        },
        {
          method: 'POST', path: '/shortener/domains/:domain/verify', auth: true, billed: false,
          desc: 'Re-check DNS for an EXTERNAL domain and finalise activation once your CNAME has propagated. Returns verified:true and status:"completed" when the domain resolves to the given target.',
          curl: `curl -s -X POST ${base}/shortener/domains/go.mysite.com/verify \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "domain": "go.mysite.com", "verified": true, "status": "completed", "message": "go.mysite.com is now active as a URL shortener." }`,
        },
        {
          method: 'DELETE', path: '/shortener/domains/:domain', auth: true, billed: false,
          desc: 'Deactivate a shortener domain. Removes the shortener DNS record (when we manage the domain\u2019s DNS). Existing links are kept but stop resolving until you re-activate.',
          curl: `curl -s -X DELETE ${base}/shortener/domains/go.mysite.com \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "domain": "go.mysite.com", "deactivated": true }`,
        },
        {
          method: 'POST', path: '/shortener/links', auth: true, billed: false,
          desc: 'Create a short link on one of your activated domains. Provide a custom alias or let one be auto-generated. Optionally set an expiry.',
          params: [['domain', true, 'An activated shortener domain of yours'], ['url', true, 'The long URL to redirect to (http/https)'], ['alias', false, 'Custom short code (a–z, 0–9, -, _). Omitted → random 7-char code'], ['expires_in_days', false, 'Auto-expire the link after N days']],
          curl: `curl -s -X POST ${base}/shortener/links \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"domain":"go.mysite.com","url":"https://example.com/a/very/long/path","alias":"promo"}'`,
          resp: `{ "created": true, "short_url": "https://go.mysite.com/promo", "domain": "go.mysite.com", "slug": "promo", "url": "https://example.com/a/very/long/path", "clicks": 0, "status": "active", "expires_at": null }`,
        },
        {
          method: 'GET', path: '/shortener/links', auth: true, billed: false,
          desc: 'List your short links with live click counts. Filter with ?domain=go.mysite.com and paginate with ?limit=.',
          curl: `curl -s "${base}/shortener/links?domain=go.mysite.com" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "links": [ { "short_url": "https://go.mysite.com/promo", "domain": "go.mysite.com", "slug": "promo", "url": "https://example.com/a/very/long/path", "clicks": 42, "status": "active", "expires_at": null } ], "count": 1 }`,
        },
        {
          method: 'GET', path: '/shortener/links/stats', auth: true, billed: false,
          desc: 'Bulk analytics for ALL your links in one call, most-clicked first: total clicks plus by_day, by_country (ISO-2, "XX" = unknown), by_device (mobile | tablet | desktop | bot | unknown) and by_referrer (host, "direct" = none). Window: ?days=1..90 (default 30) or ?since=ISO date. Filter with ?domain= and cap with ?limit= (max 2000). Detailed analytics are recorded for links created through the API from the moment this feature went live.',
          params: [['domain', false, 'Only links on this shortener domain'], ['days', false, '1–90, default 30'], ['since', false, 'ISO date (overrides days)'], ['limit', false, 'Max links (default 500, max 2000)']],
          curl: `curl -s "${base}/shortener/links/stats?days=7" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "since": "2026-10-03T00:00:00.000Z", "count": 1, "total_clicks": 42, "links": [ { "domain": "go.mysite.com", "slug": "promo", "short_url": "https://go.mysite.com/promo", "total_clicks": 42, "by_day": [ { "day": "2026-10-09", "clicks": 30 }, { "day": "2026-10-10", "clicks": 12 } ], "by_country": [ { "name": "US", "clicks": 25 }, { "name": "DE", "clicks": 17 } ], "by_device": [ { "name": "mobile", "clicks": 31 }, { "name": "desktop", "clicks": 11 } ], "by_referrer": [ { "name": "direct", "clicks": 20 }, { "name": "t.co", "clicks": 22 } ] } ] }`,
        },
        {
          method: 'GET', path: '/shortener/links/:slug', auth: true, billed: false,
          desc: 'Inspect a single link with its click analytics. Pass ?domain= so the code resolves to the right domain.',
          curl: `curl -s "${base}/shortener/links/promo?domain=go.mysite.com" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "short_url": "https://go.mysite.com/promo", "domain": "go.mysite.com", "slug": "promo", "url": "https://example.com/a/very/long/path", "clicks": 42, "status": "active", "expires_at": null, "created_at": "2026-06-20T10:05:00.000Z" }`,
        },
        {
          method: 'PATCH', path: '/shortener/links/:slug', auth: true, billed: false,
          desc: 'Update a link: enable/disable it, and/or set or clear its expiry. Disabling makes it return 404 to visitors without deleting it; set expires_in_days:null to remove an expiry.',
          params: [['domain', true, 'The link\u2019s domain'], ['disabled', false, 'true to disable, false to re-enable'], ['expires_in_days', false, 'Number of days from now, or null to clear the expiry']],
          curl: `curl -s -X PATCH ${base}/shortener/links/promo \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"domain":"go.mysite.com","disabled":true}'`,
          resp: `{ "updated": true, "short_url": "https://go.mysite.com/promo", "domain": "go.mysite.com", "slug": "promo", "status": "disabled", "clicks": 42, "expires_at": null }`,
        },
        {
          method: 'GET', path: '/shortener/links/:slug/stats', auth: true, billed: false,
          desc: 'Analytics for one link: total clicks and the by_day / by_country / by_device / by_referrer breakdown for the window (?days=1..90, default 30, or ?since=). Pass ?domain=.',
          params: [['domain', true, 'The link\u2019s domain'], ['days', false, '1–90, default 30'], ['since', false, 'ISO date (overrides days)']],
          curl: `curl -s "${base}/shortener/links/promo/stats?domain=go.mysite.com&days=30" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "domain": "go.mysite.com", "slug": "promo", "short_url": "https://go.mysite.com/promo", "url": "https://example.com/a/very/long/path", "since": "2026-09-10T00:00:00.000Z", "total_clicks": 42, "by_day": [ { "day": "2026-10-10", "clicks": 42 } ], "by_country": [ { "name": "US", "clicks": 42 } ], "by_device": [ { "name": "mobile", "clicks": 42 } ], "by_referrer": [ { "name": "direct", "clicks": 42 } ] }`,
        },
        {
          method: 'PUT', path: '/shortener/links/:slug/routing', auth: true, billed: false,
          desc: 'Smart routing: send visitors to different destinations by country (ISO-2) and/or device (mobile | tablet | desktop | bot). Rules are checked top to bottom and the first match wins; everyone else gets routing.default, or the link\u2019s own url when there is no default. Up to 50 targets. Send {"routing": null} to clear. Country comes from the Cloudflare edge.',
          params: [['domain', true, 'The link\u2019s domain'], ['routing', true, '{ "targets": [ { "country"?, "device"?, "url" } ], "default"? } or null to clear']],
          curl: `curl -s -X PUT ${base}/shortener/links/promo/routing \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"domain":"go.mysite.com","routing":{"targets":[{"country":"DE","url":"https://example.de/promo"},{"device":"mobile","url":"https://m.example.com/promo"}]}}'`,
          resp: `{ "updated": true, "domain": "go.mysite.com", "slug": "promo", "short_url": "https://go.mysite.com/promo", "base_url": "https://example.com/a/very/long/path", "routing": { "targets": [ { "country": "DE", "url": "https://example.de/promo" }, { "device": "mobile", "url": "https://m.example.com/promo" } ] } }`,
        },
        {
          method: 'GET', path: '/shortener/links/:slug/qr', auth: true, billed: false,
          desc: 'QR code that opens the short link. Returns the image itself: ?format=png (default, ?size=64–1024 px, default 300) or ?format=svg. Pass ?domain=.',
          params: [['domain', true, 'The link\u2019s domain'], ['format', false, 'png | svg'], ['size', false, 'PNG width in px (64–1024)']],
          curl: `curl -s "${base}/shortener/links/promo/qr?domain=go.mysite.com&size=512" \\
  -H "Authorization: Bearer YOUR_API_KEY" -o promo-qr.png`,
          resp: `(binary image/png — or image/svg+xml with format=svg)`,
        },
        {
          method: 'DELETE', path: '/shortener/links/:slug', auth: true, billed: false,
          desc: 'Permanently delete a short link (and its click stats). Pass ?domain=.',
          curl: `curl -s -X DELETE "${base}/shortener/links/promo?domain=go.mysite.com" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "deleted": true, "domain": "go.mysite.com", "slug": "promo" }`,
        },
      ],
    },
    {
      id: 'vps', title: 'VPS (Linux)',
      blurb: 'Provision and control Linux virtual servers. Creation is wallet-billed at the plan price (includes markup).',
      endpoints: [
        {
          method: 'GET', path: '/vps/plans', auth: true, billed: false,
          desc: 'List the Linux VPS plans that can be ordered RIGHT NOW in a region (stock is re-checked hourly; out-of-stock plans are hidden). Two storage classes: Standard plans (storage_type "SSD", cpu "Standard") and Premium NVMe plans (storage_type "NVMe SSD", cpu "AMD" or "Intel" — newer EPYC / Xeon CPUs with a much faster disk). Use ?storage=nvme or ?storage=ssd to filter.',
          params: [['region', false, 'Region code — defaults to EU'], ['storage', false, '"nvme" | "ssd" — omit for both']],
          curl: `curl -s "${base}/vps/plans?region=EU" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "product": "vps",
  "provider": "digitalocean",
  "region": "EU",
  "plans": [
    { "plan_id": "s-1vcpu-1gb", "name": "Cloud VPS 10", "vcpus": 1, "ram_gb": 1, "disk_gb": 25, "cpu": "Standard", "storage_type": "SSD", "price_usd": 18.00 },
    { "plan_id": "s-2vcpu-4gb-amd", "name": "NVMe AMD 2vCPU/4GB/80GB", "vcpus": 2, "ram_gb": 4, "disk_gb": 80, "cpu": "AMD", "storage_type": "NVMe SSD", "price_usd": 84.00 },
    { "plan_id": "s-2vcpu-4gb-120gb-intel", "name": "NVMe Intel 2vCPU/4GB/120GB", "vcpus": 2, "ram_gb": 4, "disk_gb": 120, "cpu": "Intel", "storage_type": "NVMe SSD", "price_usd": 96.00 }
  ]
}`,
        },
        {
          method: 'POST', path: '/vps', auth: true, billed: true,
          desc: 'Create a Linux VPS. ASYNC: returns 202 immediately with status "provisioning" and a stable id (the build runs in the background so the request never times out). The wallet is charged up-front; if the build ultimately fails the charge is auto-refunded and a vps.provision_failed webhook fires. Poll GET /vps/:id until status "RUNNING" (then read /vps/:id/credentials), or subscribe to the vps.provisioned / vps.provision_failed webhooks. Pass an optional idempotent client_ref — a retry with the same client_ref echoes the SAME 202 handle and never double-charges.',
          params: [
            ['plan_id', true, 'A plan_id from GET /vps/plans (SSD or NVMe). An out-of-stock plan returns 409 out_of_stock — pick another plan or region'],
            ['region', false, 'Region code — defaults to EU'],
            ['hostname', false, 'Optional label/hostname'],
            ['os', false, 'OS image — defaults to ubuntu'],
            ['ssh_keys', false, 'Optional OpenSSH public key(s) to pre-install for root at first boot — a single string or an array (e.g. "ssh-ed25519 AAAA… user@host"). Keys are registered on the provider and baked into the droplet, so you can SSH in immediately. (Linux VPS only; ignored for RDP.)'],
            ['client_ref', false, 'Your own idempotency key — a retry with the same value returns the same provisioning job (no double-charge)'],
          ],
          curl: `curl -s -X POST ${base}/vps \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"plan_id":"s-1vcpu-1gb","region":"EU","hostname":"web-01","ssh_keys":["ssh-ed25519 AAAA… user@host"],"client_ref":"order-9A1"}'`,
          resp: `HTTP 202 Accepted
{
  "status": "provisioning",
  "mode": "live",
  "product": "vps",
  "job_id": "9c9d6b66-…",
  "id": "4e2a6b47-…",
  "plan": "Cloud VPS 10",
  "region": "EU",
  "price_usd": 18,
  "wallet_balance_usd": 111.51,
  "poll_url": "/vps/4e2a6b47-…",
  "credentials_url": "/vps/4e2a6b47-…/credentials",
  "note": "Provisioning started. Poll GET /vps/{id} until status=\\"RUNNING\\", or subscribe to the vps.provisioned / vps.provision_failed webhooks. Reuse client_ref to make retries idempotent."
}`,
        },
        {
          method: 'GET', path: '/vps', auth: true, billed: false,
          desc: 'List all Linux VPS instances owned by your account.',
          curl: `curl -s ${base}/vps -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "vps": [
    { "id": "b2f1c0a4-…", "instance_id": "419287654", "ip": "203.0.113.55",
      "plan": "1 vCPU / 1 GB", "region": "EU", "os": "linux", "status": "active",
      "created_at": "2026-09-08T10:40:00.000Z" }
  ]
}`,
        },
        {
          method: 'GET', path: '/vps/:id', auth: true, billed: false,
          desc: 'Get one VPS with live status pulled from the provider.',
          curl: `curl -s ${base}/vps/b2f1c0a4-… \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "id": "b2f1c0a4-…", "instance_id": "419287654",
  "plan": "1 vCPU / 1 GB", "region": "EU", "os": "linux",
  "status": "active", "ip": "203.0.113.55", "live": { "status": "active" }
}`,
        },
        {
          method: 'POST', path: '/vps/:id/action', auth: true, billed: false,
          desc: 'Power action on a VPS.',
          params: [['action', true, 'One of: start, stop, reboot, shutdown']],
          curl: `curl -s -X POST ${base}/vps/b2f1c0a4-…/action \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"reboot"}'`,
          resp: `{ "mode": "live", "id": "b2f1c0a4-…", "action": "reboot", "detail": { "ok": true } }`,
        },
        {
          method: 'DELETE', path: '/vps/:id', auth: true, billed: false,
          desc: 'Destroy (cancel) a VPS. This is irreversible.',
          curl: `curl -s -X DELETE ${base}/vps/b2f1c0a4-… \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "mode": "live", "id": "b2f1c0a4-…", "destroyed": true }`,
        },
        {
          method: 'GET', path: '/vps/:id/credentials', auth: true, billed: false,
          desc: 'Reveal login credentials (root user + password). Password is only returned in live mode.',
          curl: `curl -s ${base}/vps/b2f1c0a4-…/credentials \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "id": "b2f1c0a4-…", "ip": "203.0.113.55", "username": "root", "password": "Xy8!kP2q…", "mode": "live" }`,
        },
        {
          method: 'POST', path: '/vps/:id/renew', auth: true, billed: true,
          desc: 'Renew (extend) a VPS subscription and, if it had expired, bring it out of its grace period — the server is powered back on and its scheduled deletion is cancelled. Charged from your wallet at the bundle-discounted rate for the chosen term. PRE-FLIGHT: send { dry_run: true } to get the price + renewability WITHOUT any charge or state change (works on a LIVE key). Blocked items 409/400 BEFORE any charge: 409 already_destroyed (renew_blocked_reason "already_destroyed") if it was permanently deleted after grace, 400 pricing_failed ("pricing_unavailable") if no price resolves. months defaults to 1 and is clamped to 1–12.',
          params: [['months', false, 'Renewal term in months (default 1, max 12). Price uses the plan\u2019s bundle rate for that term.'], ['dry_run', false, 'If true, return price + renewability only — no charge, no state change (safe on a live key).']],
          curl: `curl -s -X POST ${base}/vps/b2f1c0a4-…/renew \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"months":1}'`,
          resp: `{ "mode": "live", "product": "vps", "action": "renew", "charged_usd": 12.00, "wallet_balance_usd": 88.00,
  "result": { "success": true, "id": "b2f1c0a4-…", "months": 1, "plan": "VPS 2vCPU / 4GB", "expires_at": "2026-07-20T10:00:00.000Z" } }

// Pre-flight — POST {"dry_run":true} (no charge): { "dry_run": true, "product": "vps", "action": "renew",
//   "id": "b2f1c0a4-…", "renewable": true, "renew_blocked_reason": null, "months": 1, "plan": "VPS 2vCPU / 4GB",
//   "price_usd": 12.00, "wallet_balance_usd": 88.00, "sufficient_balance": true }`,
        },
        {
          method: 'POST', path: '/vps/:id/password-reset', auth: true, billed: false,
          desc: 'Reset the root password IN PLACE — the data is preserved (no reinstall). Returns a freshly generated password and updates GET /vps/:id/credentials to match. The server must be reachable with a known credential (the stored root-password secret or an installed SSH key); if it cannot be set in place this returns 409 password_not_set_in_place (password: null) with guidance, and 501 not_supported if the provider/record has no reset op.',
          curl: `curl -s -X POST ${base}/vps/b2f1c0a4-…/password-reset \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "mode": "live", "id": "b2f1c0a4-…", "username": "root", "password": "N3w-Pass-…", "verified": true, "data_preserved": true }`,
        },
        {
          method: 'POST', path: '/vps/:id/ssh-key', auth: true, billed: false,
          desc: 'Install an OpenSSH public key onto the ALREADY-RUNNING VPS — appended to root\u2019s authorized_keys in place (idempotent, nothing is wiped, data preserved). Logs in using the stored root password or an existing key. The plural path POST /vps/:id/ssh-keys is an alias for this same action. Requires the box to have an IP already (else 409 no_host); on an unreachable server returns 409 ssh_key_apply_failed. (Linux VPS only.)',
          params: [['public_key', true, 'An OpenSSH public key string (e.g. "ssh-ed25519 AAAA… user@host"). Alias field: ssh_key.']],
          curl: `curl -s -X POST ${base}/vps/b2f1c0a4-…/ssh-key \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"public_key":"ssh-ed25519 AAAA… user@host"}'`,
          resp: `{ "mode": "live", "id": "b2f1c0a4-…", "username": "root", "installed": true, "method": "password", "note": "Public key appended to root authorized_keys (idempotent); SSH access ensured." }`,
        },
        {
          method: 'GET', path: '/vps/:id/ssh-keys', auth: true, billed: false,
          desc: 'List the public keys currently in the running VPS\u2019s root authorized_keys (best-effort read over SSH). Requires the box to have an IP (else 409 no_host); if it cannot be reached with a known credential returns 409 ssh_keys_read_failed. (Linux VPS only.)',
          curl: `curl -s ${base}/vps/b2f1c0a4-…/ssh-keys \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "mode": "live", "id": "b2f1c0a4-…", "username": "root", "keys": ["ssh-ed25519 AAAA… user@host"], "count": 1 }`,
        },
        {
          method: 'POST', path: '/vps/:id/reinstall', auth: true, billed: false,
          desc: 'DESTRUCTIVE OS reinstall — rebuild the SAME droplet from a chosen image. The disk is WIPED (all data lost) but the public IP is kept, and the box is back in ~3 min. CONFIRMATION REQUIRED: the first call without {"confirm": true} returns 400 confirmation_required; re-send with confirm:true to proceed. Optionally switch distro with "os" (an image id from the provider; defaults to the current OS). Your original root password is re-applied by the re-run cloud-init; if the box had no stored password, call POST /vps/:id/password-reset (or use your SSH key) once it is back online. Returns 400 invalid_os for an unknown image and 501 not_supported if the provider/record has no reinstall op.',
          params: [
            ['confirm', true, 'Must be true — reinstall wipes the disk, so it is never performed accidentally.'],
            ['os', false, 'Image id to reinstall (e.g. ubuntu-24-04-x64) — defaults to the current OS. Invalid values return 400 invalid_os with the valid list.'],
          ],
          curl: `curl -s -X POST ${base}/vps/b2f1c0a4-…/reinstall \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"confirm":true,"os":"ubuntu-24-04-x64"}'`,
          resp: `{ "mode": "live", "id": "b2f1c0a4-…", "os": "ubuntu-24-04-x64", "ip": "203.0.113.55", "eta_minutes": 3,
  "username": "root", "password": "Xy8!kP2q…", "data_preserved": false,
  "note": "Reinstall started (disk wiped, IP kept). Your original root password is re-applied by cloud-init once the server finishes booting (~3 min)." }`,
        },
        {
          method: 'GET', path: '/vps/:id/usage', auth: true, billed: false,
          desc: 'Resource usage of a VPS (DigitalOcean servers only) for a period: CPU % (now / average / peak), memory used vs total, root disk used vs total, load average, and public bandwidth (current, average and peak Mbps, plus GB in/out over the period). Query: period = 1h | 24h (default) | 7d | 30d. CPU and bandwidth come from the hypervisor; memory, disk and load come from the monitoring agent installed at creation (metrics_agent:false → those fields are null). "now" values are the latest sample; DigitalOcean\u2019s sample interval grows with the period (sample_interval_seconds: ~120 for 1h, ~216 for 24h, ~1500 for 7d, ~6500 for 30d), so use period=1h for live values. Bandwidth GB is estimated from the sampled rate (bandwidth.estimated:true); specs.monthly_transfer_gb is the included monthly transfer. Cached per server+period (1 min for 1h, 2 min for 24h, 10 min for 7d, 30 min for 30d). Errors: 400 invalid_period, 404 not_found, 409 not_active, 501 not_supported (non-DigitalOcean server).',
          curl: `curl -s "${base}/vps/b2f1c0a4-.../usage?period=24h" -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "id": "b2f1c0a4-…", "product": "vps", "period": "24h", "from": "2026-10-07T10:00:00.000Z", "to": "2026-10-08T10:00:00.000Z", "status": "active",
  "specs": { "vcpus": 2, "ram_gb": 4, "disk_gb": 80, "monthly_transfer_gb": 4000 }, "metrics_agent": true,
  "cpu": { "percent_now": 3.1, "percent_avg": 2.4, "percent_peak": 41.2, "last_sample_at": "2026-10-08T09:58:00.000Z" },
  "memory": { "total_gb": 3.82, "used_gb": 0.84, "available_gb": 2.98, "percent_now": 22, "percent_avg": 21.5, "percent_peak": 30.2 },
  "disk": { "total_gb": 76.45, "used_gb": 8.47, "free_gb": 67.98, "percent": 11.1 },
  "load": { "load_1": 0.07, "load_5": 0.05, "load_15": 0.01 },
  "bandwidth": { "inbound": { "now_mbps": 0.041, "avg_mbps": 0.052, "peak_mbps": 3.912, "gb": 0.562 },
    "outbound": { "now_mbps": 1.136, "avg_mbps": 0.88, "peak_mbps": 12.4, "gb": 9.504 }, "interface": "public", "estimated": true },
  "notes": [] }`,
        },
        {
          method: 'GET', path: '/vps/:id/plan-options', auth: true, billed: false,
          desc: 'List every plan this VPS can be moved to IN PLACE (DigitalOcean servers only — same server, data, IP and credentials). Each option carries direction (upgrade | downgrade | switch), monthly_price_usd, renewal_price_usd, charge_now_usd (the pro-rata amount POST /vps/:id/upgrade would charge right now), disk_gb vs disk_after_gb, can_resize_disk and allowed. POLICY: upgrades are charged now as (new monthly price − current monthly price) × days left in the term / 30; downgrades apply immediately with NO refund; the new price applies from the next renewal, and the term end date AND term length never change (renewal_price_usd is the new plan\u2019s price for the same term length — see the "Plan changes" guide). A disk can never shrink, so plans whose disk is smaller than the server\u2019s current disk are returned with allowed:false + blocked_reason "disk_too_small". Only plans in stock in the server\u2019s region are listed. Errors: 409 expired (renew first), 409 term_ending_soon (less than 1 hour left in the term — renew first), 409 not_active, 409 plan_change_in_progress, 501 not_supported (non-DigitalOcean server).',
          curl: `curl -s ${base}/vps/b2f1c0a4-…/plan-options -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "id": "b2f1c0a4-…", "product": "vps", "term_ends_at": "2026-11-02T20:57:57.549Z", "remaining_days": 18.4,
  "current": { "plan_id": "s-2vcpu-4gb-amd", "vcpus": 2, "ram_gb": 4, "disk_gb": 80, "storage_type": "NVMe SSD", "cpu": "AMD", "monthly_price_usd": 56 },
  "policy": { "upgrade": "Applies immediately. Charged now: (new monthly price - current monthly price) x days left in the term / 30.", "downgrade": "Applies immediately. No refund or credit for the current term.", "…": "…" },
  "last_plan_change": null,
  "options": [ { "plan_id": "s-4vcpu-8gb-amd", "name": "NVMe AMD 4vCPU/8GB/160GB", "vcpus": 4, "ram_gb": 8, "disk_gb": 160, "storage_type": "NVMe SSD", "cpu": "AMD",
    "direction": "upgrade", "monthly_price_usd": 112, "monthly_difference_usd": 56, "renewal_price_usd": 112, "charge_now_usd": 34.35, "refund_usd": 0,
    "disk_after_gb": 80, "can_resize_disk": true, "allowed": true, "blocked_reason": null, "downtime_minutes": "2-5" } ] }`,
        },
        {
          method: 'POST', path: '/vps/:id/upgrade', auth: true, billed: true,
          desc: 'Change the plan IN PLACE — works for upgrades AND downgrades (alias: POST /vps/:id/change-plan). DigitalOcean servers only. The server is powered off, resized and powered back on (usually 2-5 min of downtime, longer for large disks); data, IP and credentials are kept. BILLING: an upgrade charges the pro-rata difference now ((new monthly − current monthly) × days left / 30); a downgrade is free and immediate with NO refund; the new price applies from the next renewal, and the term end date and term length do not change. DISK: by default only CPU/RAM change, which keeps later downgrades possible. Send resize_disk:true to also grow the disk to the plan size — this is PERMANENT (the server can then never move to a plan with a smaller disk). ASYNC: returns 202 with plan_change.status "running"; poll GET /vps/:id until plan_change.status is "completed" or "failed" (a failed change is refunded automatically), or subscribe to the vps.plan_changed / vps.plan_change_failed webhooks. PRE-FLIGHT: {"dry_run": true} returns the exact quote + wallet check with no charge and no server action. Errors before any charge: 400 missing_plan_id / invalid_plan / same_plan / invalid_resize_disk, 402 insufficient_wallet_balance (with shortfall_usd), 409 disk_too_small / expired / term_ending_soon / not_active / plan_change_in_progress, 501 not_supported.',
          params: [['plan_id', true, 'Target plan_id from GET /vps/:id/plan-options.'], ['resize_disk', false, 'true = also grow the disk to the plan size (PERMANENT, blocks later downgrades to smaller disks). Default false = CPU/RAM only.'], ['dry_run', false, 'If true, return the quote + wallet check only — no charge, server untouched (safe on a live key).']],
          curl: `curl -s -X POST ${base}/vps/b2f1c0a4-…/upgrade \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"plan_id":"s-4vcpu-8gb-amd","resize_disk":false}'`,
          resp: `{ "mode": "live", "product": "vps", "action": "plan_change", "id": "b2f1c0a4-…", "status": "running",
  "plan_change": { "id": "9d1e…", "status": "running", "phase": "queued", "direction": "upgrade", "from_plan": "s-2vcpu-4gb-amd", "to_plan": "s-4vcpu-8gb-amd",
    "resize_disk": false, "charged_usd": 34.35, "refunded": false, "started_at": "2026-10-15T10:12:00.000Z", "finished_at": null },
  "quote": { "plan_id": "s-4vcpu-8gb-amd", "direction": "upgrade", "charge_now_usd": 34.35, "renewal_price_usd": 112, "disk_after_gb": 80, "…": "…" },
  "charged_usd": 34.35, "wallet_balance_usd": 65.65, "poll_url": "/vps/b2f1c0a4-…" }
// Then GET /vps/b2f1c0a4-… → "plan_change": { "status": "completed", "phase": null, "disk_after_gb": 80, "finished_at": "…", … }
// Downgrade → "direction": "downgrade", "charged_usd": 0 (no refund). Pre-flight {"dry_run":true} → { "dry_run": true, "quote": {…}, "sufficient_balance": true }`,
        },
        {
          method: 'GET', path: '/vps/:id/plan-changes', auth: true, billed: false,
          desc: 'Plan-change history of one VPS, newest first: every in-place resize with status completed | failed | running, from_plan → to_plan, charged_usd, refund_usd/refunded (failed changes are refunded automatically), reason (failed), resize_disk, size_slug + disk_gb after the change, renewal_price_usd, started_at, via ("api" | "bot" — changes your customers make in the Telegram bot are included) and legacy (true = reconstructed from the server\u2019s last recorded attempt before full history existed; fewer fields). The term end date never changes on a VPS plan change, so entries carry no expiry. Same filters + paging as GET /plan-changes (status, via, since, until, limit, cursor). 404 if the server is not yours.',
          params: [['status', false, 'completed | failed | running'], ['via', false, 'api | bot'], ['since / until', false, 'ISO-8601 date/time bounds on "at"'], ['limit', false, '1-200 (default 50)'], ['cursor', false, 'next_cursor from the previous page']],
          curl: `curl -s ${base}/vps/b2f1c0a4-…/plan-changes -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "product": "vps", "id": "b2f1c0a4-…", "plan": "s-4vcpu-8gb-amd", "count": 2, "total": 2, "has_more": false, "next_cursor": null,
  "plan_changes": [
    { "id": "9d1e…", "product": "vps", "resource_id": "b2f1c0a4-…", "at": "2026-10-15T10:16:40.000Z", "status": "completed",
      "direction": "upgrade", "from_plan": "s-2vcpu-4gb-amd", "from_plan_name": "Premium AMD 2 vCPU / 4 GB", "to_plan": "s-4vcpu-8gb-amd", "to_plan_name": "Premium AMD 4 vCPU / 8 GB",
      "charged_usd": 34.35, "refund_usd": 0, "refunded": false, "reason": null, "resize_disk": false, "size_slug": "s-4vcpu-8gb-amd", "disk_gb": 80,
      "renewal_price_usd": 112, "started_at": "2026-10-15T10:12:00.000Z", "via": "api", "legacy": false },
    { "id": "77ab…", "product": "vps", "resource_id": "b2f1c0a4-…", "at": "2026-10-02T08:03:10.000Z", "status": "failed",
      "direction": "upgrade", "from_plan": "s-2vcpu-4gb-amd", "to_plan": "s-4vcpu-8gb-amd", "charged_usd": 40.1, "refund_usd": 40.1, "refunded": true,
      "reason": "Resize errored.", "via": "bot", "legacy": false, "…": "…" } ] }`,
        },
      ],
    },
    {
      id: 'rdp', title: 'RDP (Windows)',
      blurb: 'Identical to the VPS endpoints but provisions Windows Server (DigitalOcean). Replace /vps with /rdp. The login user is "Administrator". Choose the edition with the optional "os" field (ws2019 | ws2022 | ws2025, default ws2022). Editions flagged fast_deploy in GET /rdp/plans boot from a pre-built golden image and are RDP-ready in about 3 minutes (Windows Server 2025: about 5 — see eta_minutes per edition); otherwise a full unattended Windows install runs (20-45 min). Poll GET /rdp/:id (its "provisioning" block gives stage, progress, ETA countdown and a step timeline you can render as a live "Windows is booting" status page) until credentials_ready is true, then read GET /rdp/:id/credentials. Manage the running server with POST /rdp/:id/password-reset (in-place Administrator password change, data preserved) and POST /rdp/:id/reinstall (rebuild from a golden image, same IP, disk wiped, ~3-5 min). Password reset runs through a lightweight in-guest agent — check agent_online on GET /rdp/:id first (it must be true); reinstall needs no agent. When a subscription ends without renewal the server is powered off and held for a 3-day grace period (GET /rdp/:id then shows a "grace" block with delete_at + days_remaining, and GET /renewals lists it with status "grace"); if it is still not renewed the droplet is permanently deleted. Call POST /rdp/:id/renew {months} any time before deletion to extend the term, power the box back on and cancel the pending deletion.',
      endpoints: [
        {
          method: 'GET', path: '/rdp/plans', auth: true, billed: false,
          desc: 'List Windows RDP plans and prices for a region, plus os_options with per-edition fast_deploy readiness and eta_minutes. Each tier is sold in 1/2/3-month terms — the multi-month terms carry a bundle discount (2 months = 10% off, 3 months = 15% off); each plan returns duration_months and discount_pct, and price_usd is already the discounted total. Every tier runs on premium AMD hardware with NVMe SSD storage — each plan also returns cpu (AMD/Intel) and storage_type (NVMe SSD) so resale buyers can see the class of hardware at a glance.',
          params: [['region', false, 'Region code — defaults to EU']],
          curl: `curl -s "${base}/rdp/plans?region=EU" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "product": "rdp", "provider": "digitalocean", "region": "EU", "default_os": "ws2022",
  "plans": [
    { "plan_id": "standard-1m", "name": "Standard — Windows RDP (1 month)",  "vcpus": 2, "ram_gb": 4, "disk_gb": 80, "cpu": "AMD", "storage_type": "NVMe SSD", "duration_months": 1, "discount_pct": 0,  "price_usd": 56 },
    { "plan_id": "standard-2m", "name": "Standard — Windows RDP (2 months)", "vcpus": 2, "ram_gb": 4, "disk_gb": 80, "cpu": "AMD", "storage_type": "NVMe SSD", "duration_months": 2, "discount_pct": 10, "price_usd": 100.8 },
    { "plan_id": "standard-3m", "name": "Standard — Windows RDP (3 months)", "vcpus": 2, "ram_gb": 4, "disk_gb": 80, "cpu": "AMD", "storage_type": "NVMe SSD", "duration_months": 3, "discount_pct": 15, "price_usd": 142.8 }, … ],
  "os_options": [ { "id": "ws2022", "name": "Windows Server 2022", "default": true, "fast_deploy": true, "eta_minutes": 3, "fast_deploy_regions": ["EU","US","UK",…] }, … ] }`,
        },
        {
          method: 'POST', path: '/rdp', auth: true, billed: true,
          desc: 'Create a Windows RDP server. Same body as POST /vps plus an optional "os" edition. ASYNC: returns 202 immediately with status "provisioning" and a stable id; the wallet is charged up-front and auto-refunded (with an rdp.provision_failed webhook) if the build fails. Poll GET /rdp/:id until status "RUNNING"/credentials_ready, or subscribe to rdp.provisioned / rdp.provision_failed. Pass an optional idempotent client_ref — a retry with the same client_ref echoes the SAME 202 handle and never double-charges.',
          params: [
            ['plan_id', true, 'A plan_id from GET /rdp/plans (e.g. standard-1m)'],
            ['region', false, 'Region code — defaults to EU'],
            ['os', false, 'Windows edition: ws2019 | ws2022 | ws2025 — defaults to ws2022'],
            ['hostname', false, 'Optional label/hostname'],
            ['client_ref', false, 'Your own idempotency key — a retry with the same value returns the same provisioning job (no double-charge)'],
          ],
          curl: `curl -s -X POST ${base}/rdp \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"plan_id":"standard-1m","region":"EU","os":"ws2022","client_ref":"rdp-77"}'`,
          resp: `HTTP 202 Accepted
{ "status": "provisioning", "mode": "live", "product": "rdp", "job_id": "f050afee-…", "id": "dc012468-…",
  "plan": "Standard — Windows RDP (1 month)", "region": "EU", "price_usd": 56, "os": "ws2022",
  "poll_url": "/rdp/dc012468-…", "credentials_url": "/rdp/dc012468-…/credentials",
  "note": "Provisioning started. Poll GET /rdp/{id} until status=\\"RUNNING\\", or subscribe to the rdp.provisioned / rdp.provision_failed webhooks." }`,
        },
        { method: 'GET', path: '/rdp', auth: true, billed: false, desc: 'List all Windows RDP instances you own.', curl: `curl -s ${base}/rdp -H "Authorization: Bearer YOUR_API_KEY"`, resp: `{ "rdp": [ { "id": "…", "os": "windows", "os_id": "ws2022", "status": "active", "ip": "203.0.113.80" }, … ] }` },
        { method: 'GET', path: '/rdp/:id', auth: true, billed: false, desc: 'Get one RDP instance with a live "provisioning" status block built for order/status pages: stage + human label, progress %, eta_seconds countdown (eta_at), elapsed_seconds, a 4-step timeline (steps[].done/current), credentials_ready and password_confirmed flags, and the last 10 log lines. Also returns agent_online — true when the in-guest management agent has checked in recently (required before POST /rdp/:id/password-reset). Poll every 10-15 s until credentials_ready is true, then call credentials_url. Status goes queued → creating → booting → installing (fast path) or converting (full install) → active; "failed" is terminal. If the subscription has expired and entered the 3-day grace period, the response also carries a "grace" block: { in_grace: true, expired_at, delete_at, days_remaining }; once the box is deleted after grace, status becomes "destroyed" with destroy_reason "expired_grace". Renew with POST /rdp/:id/renew to clear grace.', curl: `curl -s ${base}/rdp/ID -H "Authorization: Bearer YOUR_API_KEY"`, resp: `{ "id": "…", "os": "windows", "os_id": "ws2022", "status": "installing", "ip": "203.0.113.80", "agent_online": false, "credentials_ready": false, "credentials_url": null,
  "provisioning": { "status": "installing", "stage": "rdp_up", "stage_label": "RDP port open - confirming password", "progress": 90,
    "fast_deploy": true, "os": "ws2022", "eta_minutes": 3, "eta_seconds": 42, "eta_at": "2026-09-22T22:25:00.000Z", "elapsed_seconds": 138, "time_to_active_s": null,
    "credentials_ready": false, "password_confirmed": null,
    "steps": [ { "key": "creating", "label": "Creating the server", "done": true, "current": false }, { "key": "booting", "label": "Server booting", "done": true }, { "key": "installing", "label": "Windows starting - applying network + password", "done": true }, { "key": "rdp_ready", "label": "Windows is ready", "done": false, "current": true } ],
    "logs": [ { "ts": "…", "stage": "booting", "message": "Droplet 6028… created from image. Booting..." }, … ] },
  "live": { "status": "installing", "progress": 90, "logs": [ … ], "provisioning": { … } } }` },
        { method: 'POST', path: '/rdp/:id/action', auth: true, billed: false, desc: 'Power action (start, stop, reboot, shutdown).', params: [['action', true, 'start | stop | reboot | shutdown']], curl: `curl -s -X POST ${base}/rdp/ID/action \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"reboot"}'`, resp: `{ "mode": "live", "id": "…", "action": "reboot" }` },
        { method: 'POST', path: '/rdp/:id/password-reset', auth: true, billed: false, desc: 'Change the Administrator password IN PLACE via the in-guest agent — no reinstall, all data preserved. The server must be running and its agent online (check agent_online on GET /rdp/:id first). Returns a freshly generated password; GET /rdp/:id/credentials is updated to match. On agent-offline / server-stopped this returns 409 with a human-readable message.', curl: `curl -s -X POST ${base}/rdp/ID/password-reset \\
  -H "Authorization: Bearer YOUR_API_KEY"`, resp: `{ "mode": "live", "id": "…", "password": "N3w-Pass-…", "username": "Administrator", "method": "agent", "data_preserved": true }` },
        { method: 'POST', path: '/rdp/:id/reinstall', auth: true, billed: false, desc: 'Reinstall Windows = rebuild the SAME droplet from a golden image. The public IP is kept, the disk is wiped, and the server is RDP-ready again in about 3 minutes (about 5 for Windows Server 2025 — see eta_minutes in the response). Optionally switch edition with "os" (ws2019 | ws2022 | ws2025); omit it to reinstall the current edition. A new password is generated and applied on first boot. Updates os_id, status (→ reinstalling) and credentials on the record.', params: [['os', false, 'Windows edition to reinstall: ws2019 | ws2022 | ws2025 — defaults to the current edition']], curl: `curl -s -X POST ${base}/rdp/ID/reinstall \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"os":"ws2019"}'`, resp: `{ "mode": "live", "id": "…", "os": "ws2019", "os_name": "Windows Server 2019", "ip": "203.0.113.80", "eta_minutes": 3, "password": "N3w-Pass-…" }` },
        { method: 'POST', path: '/rdp/:id/renew', auth: true, billed: true, desc: 'Renew (extend) a Windows RDP subscription and, if it had expired, bring it out of the 3-day grace period — the server is powered back on and its scheduled deletion is cancelled. Charged from your wallet at the bundle-discounted rate for the chosen term (1 month = full price, 2 months −10%, 3 months −15%). PRE-FLIGHT: send { dry_run: true } for price + renewability with no charge or state change (works on a LIVE key). Blocked items 409/400/501 BEFORE any charge: 409 already_destroyed if deleted after grace, 501 not_supported ("not_supported") if this box has no provider renew op, 400 pricing_failed ("pricing_unavailable"). months defaults to 1 and is clamped to 1–3.', params: [['months', false, 'Renewal term in months: 1 | 2 | 3 — defaults to 1'], ['dry_run', false, 'If true, return price + renewability only — no charge (safe on a live key).']], curl: `curl -s -X POST ${base}/rdp/ID/renew \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"months":1}'`, resp: `{ "mode": "live", "product": "rdp", "action": "renew", "charged_usd": 56.00,
  "result": { "success": true, "id": "…", "months": 1, "plan": "Standard — Windows RDP (1 month)", "expires_at": "2026-08-01T11:00:00.000Z" } }` },
        { method: 'DELETE', path: '/rdp/:id', auth: true, billed: false, desc: 'Destroy the RDP instance (irreversible).', curl: `curl -s -X DELETE ${base}/rdp/ID -H "Authorization: Bearer YOUR_API_KEY"`, resp: `{ "mode": "live", "id": "…", "destroyed": true }` },
        { method: 'GET', path: '/rdp/:id/credentials', auth: true, billed: false, desc: 'Reveal Administrator credentials (live mode only).', curl: `curl -s ${base}/rdp/ID/credentials -H "Authorization: Bearer YOUR_API_KEY"`, resp: `{ "id": "…", "ip": "203.0.113.80", "username": "Administrator", "password": "…", "mode": "live" }` },
        {
          method: 'GET', path: '/rdp/:id/usage', auth: true, billed: false,
          desc: 'Resource usage of a Windows RDP server (DigitalOcean servers only) for a period: CPU % (now / average / peak), memory used vs total, drive C: used vs total, and public bandwidth (current, average and peak Mbps, plus GB in/out). Query: period = 1h | 24h (default) | 7d | 30d. Bandwidth comes from the hypervisor; CPU, memory and C: come from the in-server management agent (a snapshot every minute, history every 5 minutes, kept 31 days). metrics_agent:false means the agent has never reported (CPU/memory/disk null); agent_reporting:false means it has not reported in the last 10 minutes (server off/restarting) — the last known values are shown. Servers created before this feature start reporting after their next restart (see notes). Bandwidth GB is estimated from DigitalOcean\u2019s sampled rate (sample_interval_seconds grows with the period). Cached per server+period (1 min for 1h up to 30 min for 30d). Errors: 400 invalid_period, 404 not_found, 409 not_active / not_ready, 501 not_supported.',
          curl: `curl -s "${base}/rdp/ID/usage?period=7d" -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "id": "ID", "product": "rdp", "period": "7d", "from": "2026-10-01T10:00:00.000Z", "to": "2026-10-08T10:00:00.000Z", "sample_interval_seconds": 1512, "status": "active",
  "specs": { "vcpus": 2, "ram_gb": 4, "disk_gb": 80, "monthly_transfer_gb": 4000 },
  "metrics_agent": true, "agent_reporting": true, "agent_metrics_at": "2026-10-08T09:59:31.000Z",
  "cpu": { "percent_now": 7.5, "percent_avg": 11.2, "percent_peak": 96 },
  "memory": { "total_gb": 4, "used_gb": 1.9, "available_gb": 2.1, "percent_now": 47.5, "percent_avg": 44.1, "percent_peak": 81.3 },
  "disk": { "drive": "C:", "total_gb": 79.5, "used_gb": 22.4, "free_gb": 57.1, "percent": 28.2 },
  "bandwidth": { "inbound": { "now_mbps": 0.21, "avg_mbps": 0.4, "peak_mbps": 18.2, "gb": 30.2 }, "outbound": { "…": "…" }, "interface": "public", "estimated": true },
  "notes": [] }`,
        },
        {
          method: 'GET', path: '/rdp/:id/plan-options', auth: true, billed: false,
          desc: 'List every plan this RDP can be moved to IN PLACE (DigitalOcean servers only — same server, data, IP and credentials). MULTI-MONTH TERMS: a server on a 2- or 3-month term stays on that term — the upgrade charge still uses the 1-month prices ((new 1-month − current 1-month) × days left / 30, where days left can be up to ~90), and renewal_price_usd is the new tier\u2019s 2-/3-month bundle price with the bundle discount kept. Each option carries direction (upgrade | downgrade | switch), monthly_price_usd, renewal_price_usd, charge_now_usd (the pro-rata amount POST /rdp/:id/upgrade would charge right now), disk_gb vs disk_after_gb, can_resize_disk and allowed. POLICY: upgrades are charged now as (new monthly price − current monthly price) × days left in the term / 30; downgrades apply immediately with NO refund; the new price applies from the next renewal, and the term end date AND term length never change (renewal_price_usd is the new plan\u2019s price for the same term length — see the "Plan changes" guide). A disk can never shrink, so plans whose disk is smaller than the server\u2019s current disk are returned with allowed:false + blocked_reason "disk_too_small". Only plans in stock in the server\u2019s region are listed. Errors: 409 expired (renew first), 409 term_ending_soon (less than 1 hour left in the term — renew first), 409 not_active, 409 plan_change_in_progress, 501 not_supported (non-DigitalOcean server).',
          curl: `curl -s ${base}/rdp/ID/plan-options -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "id": "ID", "product": "rdp", "term_ends_at": "2026-11-02T20:57:57.549Z", "remaining_days": 18.4,
  "current": { "plan_id": "standard", "vcpus": 2, "ram_gb": 4, "disk_gb": 80, "storage_type": "NVMe SSD", "cpu": "AMD", "monthly_price_usd": 56 },
  "policy": { "upgrade": "Applies immediately. Charged now: (new monthly price - current monthly price) x days left in the term / 30.", "downgrade": "Applies immediately. No refund or credit for the current term.", "…": "…" },
  "last_plan_change": null,
  "options": [ { "plan_id": "pro", "name": "Pro", "vcpus": 4, "ram_gb": 8, "disk_gb": 160, "storage_type": "NVMe SSD", "cpu": "AMD",
    "direction": "upgrade", "monthly_price_usd": 112, "monthly_difference_usd": 56, "renewal_price_usd": 112, "charge_now_usd": 34.35, "refund_usd": 0,
    "disk_after_gb": 80, "can_resize_disk": true, "allowed": true, "blocked_reason": null, "downtime_minutes": "2-5" } ] }`,
        },
        {
          method: 'POST', path: '/rdp/:id/upgrade', auth: true, billed: true,
          desc: 'Change the plan IN PLACE — works for upgrades AND downgrades (alias: POST /rdp/:id/change-plan). DigitalOcean servers only. The server is powered off, resized and powered back on (usually 2-5 min of downtime, longer for large disks); data, IP and credentials are kept. BILLING: an upgrade charges the pro-rata difference now ((new monthly − current monthly) × days left / 30); a downgrade is free and immediate with NO refund; the new price applies from the next renewal, and the term end date and term length do not change. DISK: by default only CPU/RAM change, which keeps later downgrades possible. Send resize_disk:true to also grow the disk to the plan size — this is PERMANENT (the server can then never move to a plan with a smaller disk). ASYNC: returns 202 with plan_change.status "running"; poll GET /rdp/:id until plan_change.status is "completed" or "failed" (a failed change is refunded automatically), or subscribe to the rdp.plan_changed / rdp.plan_change_failed webhooks. PRE-FLIGHT: {"dry_run": true} returns the exact quote + wallet check with no charge and no server action. Errors before any charge: 400 missing_plan_id / invalid_plan / same_plan / invalid_resize_disk, 402 insufficient_wallet_balance (with shortfall_usd), 409 disk_too_small / expired / term_ending_soon / not_active / plan_change_in_progress, 501 not_supported.',
          params: [['plan_id', true, 'Target plan_id from GET /rdp/:id/plan-options.'], ['resize_disk', false, 'true = also grow the disk to the plan size (PERMANENT, blocks later downgrades to smaller disks). Default false = CPU/RAM only.'], ['dry_run', false, 'If true, return the quote + wallet check only — no charge, server untouched (safe on a live key).']],
          curl: `curl -s -X POST ${base}/rdp/ID/upgrade \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"plan_id":"pro","resize_disk":false}'`,
          resp: `{ "mode": "live", "product": "rdp", "action": "plan_change", "id": "ID", "status": "running",
  "plan_change": { "id": "9d1e…", "status": "running", "phase": "queued", "direction": "upgrade", "from_plan": "standard", "to_plan": "pro",
    "resize_disk": false, "charged_usd": 34.35, "refunded": false, "started_at": "2026-10-15T10:12:00.000Z", "finished_at": null },
  "quote": { "plan_id": "pro", "direction": "upgrade", "charge_now_usd": 34.35, "renewal_price_usd": 112, "disk_after_gb": 80, "…": "…" },
  "charged_usd": 34.35, "wallet_balance_usd": 65.65, "poll_url": "/rdp/ID" }
// Then GET /rdp/ID → "plan_change": { "status": "completed", "phase": null, "disk_after_gb": 80, "finished_at": "…", … }
// Downgrade → "direction": "downgrade", "charged_usd": 0 (no refund). Pre-flight {"dry_run":true} → { "dry_run": true, "quote": {…}, "sufficient_balance": true }`,
        },
        {
          method: 'GET', path: '/rdp/:id/plan-changes', auth: true, billed: false,
          desc: 'Plan-change history of one RDP server, newest first — same entry shape as GET /vps/:id/plan-changes (status completed | failed | running, from_plan/to_plan tier slugs standard | pro | power, charged_usd, refund_usd/refunded, reason, resize_disk, disk_gb, renewal_price_usd = the new tier\u2019s price for the server\u2019s own 1/2/3-month term, via api | bot, legacy). Same filters + paging as GET /plan-changes. 404 if the server is not yours.',
          params: [['status', false, 'completed | failed | running'], ['via', false, 'api | bot'], ['since / until', false, 'ISO-8601 date/time bounds on "at"'], ['limit', false, '1-200 (default 50)'], ['cursor', false, 'next_cursor from the previous page']],
          curl: `curl -s ${base}/rdp/ID/plan-changes -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "product": "rdp", "id": "ID", "plan": "Pro — Windows RDP (3 months)", "count": 1, "total": 1, "has_more": false, "next_cursor": null,
  "plan_changes": [
    { "id": "5c0f…", "product": "rdp", "resource_id": "ID", "at": "2026-10-15T10:16:40.000Z", "status": "completed", "direction": "upgrade",
      "from_plan": "standard", "from_plan_name": "Standard", "to_plan": "pro", "to_plan_name": "Pro", "charged_usd": 112, "refund_usd": 0, "refunded": false,
      "reason": null, "resize_disk": false, "size_slug": "s-4vcpu-8gb-amd", "disk_gb": 80, "renewal_price_usd": 285.6,
      "started_at": "2026-10-15T10:12:00.000Z", "via": "api", "legacy": false } ] }`,
        },
      ],
    },
    {
      id: 'hosting', title: 'cPanel Hosting',
      blurb: 'Sell Anti-Red cPanel hosting plans. Creation is ASYNC + wallet-billed (plan price + domain price when domain_mode=buy): POST /hosting returns 202 with status "provisioning" and the cPanel username straight away, then the slow WHM build runs in the background and emits hosting.provisioned (or, on failure, auto-refunds the wallet and emits hosting.provision_failed) — so a client can never time out and orphan an account. Reuse client_ref to make a retry idempotent. The account "id" is its cPanel username — it is returned as both id and username, and is the value you pass as the :user path segment (so hosting reads consistently with /vps/:id and /rdp/:id). LIFECYCLE & AUTO-RENEW: a guaranteed hourly worker runs on the production bot. At (and after) expiry it first ATTEMPTS a wallet auto-renew (when auto_renew is on); on insufficient funds it records auto_renew_last_error + auto_renew_next_attempt_at, emits the hosting.auto_renew_failed webhook, suspends the site and starts a 48h grace window (state "grace", delete_at = expiry + 48h) — it does NOT terminate immediately, so the customer keeps a renewal window. If still unrenewed 48h later the account is terminated (hosting.deleted). Every read (GET /hosting, GET /hosting/:user, GET /renewals) exposes state (provisioning | online | suspended | grace | failed | terminated) + renewable so you never have to infer it.',
      endpoints: [
        {
          method: 'GET', path: '/hosting/plans', auth: true, billed: false,
          desc: 'List the available hosting plans, prices and features. Monthly plans also list "terms": prepay 1, 3, 6 or 12 months (30 days per month) at 0% / 10% / 15% / 25% off — pass months on POST /hosting or POST /hosting/:user/renew. Auto-renew repeats the same term at the same discount. The weekly plan has no terms (1 week at a time).',
          curl: `curl -s ${base}/hosting/plans \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "platform": { "hosting_trial_on": false, "offshore_hosting_on": true, "gold_price_usd": 100 },
  "plans": [
    { "plan_id": "golden-monthly", "name": "Golden Anti-Red HostPanel (1-Month)",
      "tier": "gold", "price_usd": 100, "duration_days": 30,
      "addon_domains": "unlimited", "visitor_captcha_available": true,
      "features": ["Anti-Red protection", "Unlimited addon domains", "Visitor Captcha + Geo", "30 days"],
      "terms": [
        { "months": 1, "duration_days": 30, "discount_pct": 0, "price_usd": 100, "monthly_equivalent_usd": 100, "savings_usd": 0 },
        { "months": 3, "duration_days": 90, "discount_pct": 10, "price_usd": 270, "monthly_equivalent_usd": 90, "savings_usd": 30 },
        { "months": 6, "duration_days": 180, "discount_pct": 15, "price_usd": 510, "monthly_equivalent_usd": 85, "savings_usd": 90 },
        { "months": 12, "duration_days": 360, "discount_pct": 25, "price_usd": 900, "monthly_equivalent_usd": 75, "savings_usd": 300 }
      ] }
  ],
  "term_discounts_pct": { "1": 0, "3": 10, "6": 15, "12": 25 }
}`,
        },
        {
          method: 'POST', path: '/hosting', auth: true, billed: true,
          desc: 'Create a cPanel hosting account. ASYNC: returns 202 immediately with status "provisioning", the cPanel username (generated up-front) and a job_id — the slow WHM build runs in the background so the request never times out (no more orphaned accounts from a 30s client timeout). The wallet is charged up-front (plan price + domain price when domain_mode=buy); if the build ultimately fails the charge is auto-refunded and a hosting.provision_failed webhook fires. Poll GET /hosting/:user until state "online", or subscribe to the hosting.provisioned / hosting.provision_failed webhooks. domain_mode "buy" registers a new domain in the same call; "existing" links a domain already on this platform (Cloudflare); "external" connects a domain at an outside registrar (point its nameservers at Cloudflare). Legacy "byo" = "external". Pass an optional idempotent client_ref — a retry with the same client_ref echoes the SAME 202 handle and never double-charges.',
          params: [
            ['plan_id', true, 'A plan_id from GET /hosting/plans'],
            ['months', false, 'Prepaid term for monthly plans: 1 (default), 3, 6 or 12 — charged at the term price from GET /hosting/plans (10% / 15% / 25% off). Auto-renew repeats this term. Weekly plan: omit (else 400 term_not_available).'],
            ['domain', true, 'The primary domain for the account'],
            ['domain_mode', false, '"buy" | "existing" | "external" (legacy "byo" = external, default)'],
            ['ns_choice', false, BR
              ? `domain_mode=buy only: "branded" (default — ${BNS_TXT}, switched automatically after Cloudflare activation) | "cloudflare". Custom nameservers are not accepted for hosting.`
              : 'domain_mode=buy only: "cloudflare" (default — Cloudflare-assigned nameservers). Custom nameservers are not accepted for hosting.'],
            ['email', false, 'Contact email for the account'],
            ['client_ref', false, 'Your own idempotency key — a retry with the same value returns the same provisioning job (no double-charge)'],
          ],
          curl: `curl -s -X POST ${base}/hosting \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"plan_id":"golden-monthly","months":6,"domain":"mysite.com","domain_mode":"external","email":"client@mysite.com","client_ref":"order-42"}'`,
          resp: `HTTP 202 Accepted
{
  "status": "provisioning",
  "mode": "live",
  "product": "hosting",
  "job_id": "0ae7cc0a-…",
  "username": "mysite01",
  "id": "mysite01",
  "domain": "mysite.com",
  "plan": "Golden Anti-Red HostPanel (1-Month)",
  "price_usd": 510,
  "term_months": 6, "term_discount_pct": 15, "hosting_usd": 510, "domain_usd": 0,
  "wallet_balance_usd": 42.51,
  "poll_url": "/hosting/mysite01",
  "credentials_url": "/hosting/mysite01/credentials",
  "note": "Provisioning started. Poll GET /hosting/{username} until state=\\"online\\", or subscribe to the hosting.provisioned / hosting.provision_failed webhooks. Reuse client_ref to make retries idempotent."
}`,
        },
        {
          method: 'GET', path: '/hosting', auth: true, billed: false,
          desc: 'List all cPanel hosting accounts you own. Add ?usage=true to include a quick live disk summary (disk_used_mb / disk_limit / disk_used_pct) per account.',
          params: [['usage', false, 'Set to "true" to include a per-account disk usage summary (live WHM read)']],
          curl: `curl -s "${base}/hosting?usage=true" -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "panel_url": "https://panel.1.hostbay.io",
  "server_ip": "68.183.77.106",
  "usage_included": true,
  "accounts": [
    { "id": "mysite01", "username": "mysite01", "domain": "mysite.com",
      "plan": "Golden Anti-Red HostPanel (1-Month)", "suspended": false,
      "created_at": "2026-09-08T11:00:00.000Z",
      "expires_at": "2026-10-08T11:00:00.000Z",
      "credentials_url": "/hosting/mysite01/credentials",
      "usage": { "disk_used_mb": 412.5, "disk_limit": 5120, "disk_used_pct": 8.1 } }
  ]
}`,
        },
        {
          method: 'POST', path: '/hosting/:user/suspend', auth: true, billed: false,
          desc: 'Suspend a hosting account. Sets suspended_at (and suspended_reason = your reason) on GET /hosting/:user; unsuspend clears both.',
          params: [['reason', false, 'Optional suspend reason']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/suspend \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"reason":"non-payment"}'`,
          resp: `{ "mode": "live", "username": "mysite01", "suspended": true }`,
        },
        {
          method: 'POST', path: '/hosting/:user/unsuspend', auth: true, billed: false,
          desc: 'Unsuspend a hosting account.',
          curl: `curl -s -X POST ${base}/hosting/mysite01/unsuspend \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "mode": "live", "username": "mysite01", "suspended": false }`,
        },
        {
          method: 'DELETE', path: '/hosting/:user', auth: true, billed: false,
          desc: 'Terminate a hosting account (irreversible). Cloudflare cleanup (worker routes + website DNS) runs per domain and is SKIPPED for any domain another live account still uses — e.g. deleting a failed duplicate provisioning record never touches the live site on the same domain. "cloudflare_cleanup" reports each domain: removed | kept_in_use_by_another_account | no_zone | error.',
          curl: `curl -s -X DELETE ${base}/hosting/mysite01 \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "mode": "live", "username": "mysite01", "terminated": true, "whm_terminate_pending": false,
  "cloudflare_cleanup": [ { "domain": "mysite.com", "result": "removed" } ] }`,
        },
        {
          method: 'POST', path: '/hosting/:user/dns/repair', auth: true, billed: false,
          desc: 'Self-heal website DNS. For the primary and every addon domain in our Cloudflare, re-creates a missing apex and/or www record as a proxied CNAME to the hosting tunnel. Existing records are never changed; domains on external DNS report "no_zone". Pass {"dry_run":true} to only report. Status per domain: ok | missing (dry run) | repaired | repair_failed | no_zone | error. 409 account_not_live for failed/terminated records. POST /security/anti-red/deploy runs the same check automatically.',
          params: [['dry_run', false, 'true = report missing records without creating them']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/dns/repair \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "mode": "live", "username": "mysite01", "domains": [
  { "domain": "mysite.com", "status": "repaired", "missing": ["mysite.com", "www.mysite.com"],
    "created": [ { "name": "mysite.com", "type": "CNAME", "content": "<tunnel>.cfargotunnel.com", "proxied": true, "success": true },
                 { "name": "www.mysite.com", "type": "CNAME", "content": "<tunnel>.cfargotunnel.com", "proxied": true, "success": true } ] } ] }`,
        },
        {
          method: 'GET', path: '/hosting/:user/login', auth: true, billed: false,
          desc: 'Generate a one-click cPanel login URL for the account (live mode only).',
          curl: `curl -s ${base}/hosting/mysite01/login \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "mode": "live", "username": "mysite01", "login_url": "https://whm-host/cpsess…/login/?…" }`,
        },
        {
          method: 'GET', path: '/hosting/:user', auth: true, billed: false,
          desc: 'Full lifecycle + details for one hosting account. "state" is one of online | suspended | grace | terminated. When state is "grace" the plan has expired and is suspended but still recoverable — the "grace" block gives expired_at, delete_at (= expiry + 48h; hosting grace is 48 hours, shorter than the 72h VPS/RDP grace), grace_hours and days/hours_remaining so you can message the customer. "renewable" + "renew_blocked_reason" tell you whether POST /hosting/:user/renew will succeed (reason: account_terminated | pricing_unavailable | weekly_renew_too_early). Weekly plans renew one week at a time and only once 7 days or fewer are left, so a weekly account with more time left shows renewable:false, renew_blocked_reason "weekly_renew_too_early" and "renew_available_at" (when the Renew button can be enabled; null otherwise). "auto_renew_last_error"/"_last_attempt_at"/"_next_attempt_at" expose the hourly auto-renew worker. A TERMINATED account returns state:"terminated", terminated:true, renewable:false, suspended:false (the legacy boolean is forced false), deliverables + credentials nulled, but keeps its identifying metadata (domain, plan, expires_at, terminated_at) so you can reconcile your catalog. Non-terminated responses also carry live disk/bandwidth usage read from WHM.',
          curl: `curl -s ${base}/hosting/mysite01 \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "id": "mysite01",
  "username": "mysite01",
  "domain": "mysite.com",
  "plan": "Golden Anti-Red HostPanel (1-Month)",
  "price_usd": 100,
  "duration_days": 30,
  "state": "online",
  "terminated": false,
  "suspended": false,
  "grace": null,
  "renewable": true,
  "renew_blocked_reason": null,
  "renew_available_at": null,
  "suspended_reason": null,
  "auto_renew": true,
  "auto_renew_last_error": null,
  "auto_renew_last_attempt_at": null,
  "auto_renew_next_attempt_at": null,
  "expires_at": "2026-10-08T11:00:00.000Z",
  "panel_url": "https://panel.1.hostbay.io",
  "server_ip": "68.183.77.106",
  "deliverables": {
    "cpanel_username": "mysite01",
    "panel_url": "https://panel.1.hostbay.io",
    "server_ip": "68.183.77.106",
    "nameservers": ["ada.ns.cloudflare.com", "rob.ns.cloudflare.com"],
    "credentials_url": "/hosting/mysite01/credentials"
  },
  "addon_quota": "unlimited",
  "addon_domain_count": 1,
  "addon_domains": ["blog.mysite.com"],
  "usage": {
    "disk_used_mb": 412.5, "disk_limit": 5120, "disk_used_pct": 8.1,
    "bandwidth_used_mb": 270.2, "bandwidth_limit": 100000, "bandwidth_used_pct": 0.3, "bandwidth_period": "current_month",
    "inodes_used": 10432, "inodes_limit": "unlimited"
  },
  "mode": "dry_run"
}

// A TERMINATED account (state:"terminated") — deliverables/credentials nulled, metadata kept:
// { "id": "old01", "username": "old01", "domain": "old.com", "plan": "Premium Anti-Red HostPanel (1-Month)",
//   "state": "terminated", "terminated": true, "terminated_at": "2026-06-01T00:00:00.000Z",
//   "termination_reason": "expired_grace", "suspended": false, "grace": null,
//   "renewable": false, "renew_blocked_reason": "account_terminated",
//   "expires_at": "2026-05-30T00:00:00.000Z", "deliverables": null, "credentials_url": null,
//   "panel_url": null, "server_ip": null, "usage": null }`,
        },
        {
          method: 'GET', path: '/hosting/:user/credentials', auth: true, billed: false,
          desc: 'Reveal the customer login deliverables: cPanel username, HostPanel URL, server IP and nameservers (always), plus the panel PIN and a one-click direct cPanel SSO URL (LIVE mode only — revealing the PIN regenerates it, invalidating the previous one).',
          curl: `curl -s ${base}/hosting/mysite01/credentials \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "username": "mysite01",
  "domain": "mysite.com",
  "plan": "Golden Anti-Red HostPanel (1-Month)",
  "panel_url": "https://panel.1.hostbay.io",
  "server_ip": "68.183.77.106",
  "nameservers": ["ada.ns.cloudflare.com", "rob.ns.cloudflare.com"],
  "expires_at": "2026-10-08T11:00:00.000Z",
  "mode": "live",
  "panel_pin": "842196",
  "direct_cpanel_login_url": "https://panel.1.hostbay.io/cpsess…/login/?…",
  "note": "This PIN was freshly generated — the previous PIN is now invalid."
}`,
        },
        {
          method: 'POST', path: '/hosting/:user/renew', auth: true, billed: true,
          desc: 'Renew a hosting account for another term at the exact bot price for its plan. Extends the expiry (from the later of today or the current expiry), unsuspends the account if it was suspended, and re-deploys anti-red protection. Verifies the account still exists on the server first (returns provisioning_failed + full refund, and marks it terminated, if it was already removed). Optional body { periods: 1..12 } renews several billing cycles at once (price × periods) — MONTHLY plans only. PREPAID TERMS: send { months: 1 | 3 | 6 | 12 } instead to renew a monthly plan for that many months at the term discount (10% / 15% / 25% off — see GET /hosting/plans); the chosen term becomes the account\'s auto-renew term (term_months). Without months the account\'s current term is renewed (periods × term, at most 12 months in one call). Sending months together with periods > 1 → 400 invalid_body; months on a weekly plan → 400 term_not_available. WEEKLY plans renew ONE week at a time (periods must be 1, else 400 weekly_single_period_only) and only once 7 days or fewer are left in the term (else 409 weekly_renew_too_early with renew_available_at), so a weekly account never holds more than ~14 days; to give a weekly customer longer, switch them to a monthly plan (POST /hosting/:user/change-plan — see "Plan changes"). RACE-SAFE: if two renewals (or a renewal and a plan change) for the same account land at the same moment, only one is applied and the other is refunded automatically (502 provisioning_failed, refunded:true) — never "charged twice, extended once". PRE-FLIGHT: send { dry_run: true } to get the price, renewability and would_expire_at WITHOUT any charge or state change — this works on a LIVE key too, so a wallet-billed storefront never has to charge→409→refund to discover a dead item. Blocked items always 409/400 BEFORE any charge: 409 account_terminated (renew_blocked_reason "account_terminated") if the plan was cancelled, 400 pricing_failed ("pricing_unavailable") if no price/duration resolves, 400 weekly_single_period_only / 409 weekly_renew_too_early for weekly plans.',
          params: [['months', false, 'Monthly plans: 1, 3, 6 or 12 — renew one prepaid term at its discount; it becomes the auto-renew term. Omit to renew the current term.'], ['periods', false, 'Number of billing cycles of the current term to renew at once (default 1, max 12 months in total). Weekly plans: must be 1.'], ['dry_run', false, 'If true, return price + renewability only — no charge, no state change (safe on a live key).']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/renew \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"months":3}'`,
          resp: `{
  "mode": "live", "product": "hosting", "action": "renew", "charged_usd": 270, "wallet_balance_usd": 42.51,
  "result": { "success": true, "id": "mysite01", "username": "mysite01", "domain": "mysite.com",
    "plan": "Golden Anti-Red HostPanel (1-Month)", "periods": 1, "term_months": 3, "term_discount_pct": 10,
    "monthly_price_usd": 100, "duration_days": 90, "expires_at": "2027-01-06T11:00:00.000Z" }
}

// Pre-flight — POST {"dry_run":true} (no charge, works on a live key):
// { "dry_run": true, "product": "hosting", "action": "renew", "id": "mysite01", "username": "mysite01",
//   "domain": "mysite.com", "plan": "Golden Anti-Red HostPanel (1-Month)", "renewable": true,
//   "renew_blocked_reason": null, "periods": 1, "term_months": 1, "term_discount_pct": 0, "monthly_price_usd": 100,
//   "duration_days": 30, "price_usd": 100,
//   "wallet_balance_usd": 142.51, "sufficient_balance": true, "would_expire_at": "2026-11-08T11:00:00.000Z" }

// Weekly plan with more than 7 days left → 409 (nothing charged):
// { "error": "weekly_renew_too_early", "renew_blocked_reason": "weekly_renew_too_early",
//   "renew_available_at": "2026-10-12T09:00:00.000Z", "id": "mysite01", "username": "mysite01",
//   "plan": "Premium Anti-Red (1-Week)", "expires_at": "2026-10-19T09:00:00.000Z",
//   "message": "Weekly plans can be renewed once 7 days or fewer are left in the term. Renewal opens at 2026-10-12T09:00:00.000Z." }`,
        },
        {
          method: 'GET', path: '/hosting/:user/plan-options', auth: true, billed: false,
          desc: 'List the plans this hosting account can move to, with the exact charge and the expiry AFTER the change for each (see the "Plan changes" guide). RULES: Premium Monthly <-> Golden Monthly changes only the package — an upgrade is charged now as (new monthly − current monthly) × days left / 30 (on a prepaid 3/6/12-month term both monthly prices are taken at that term\'s 10% / 15% / 25% discount, and the new plan renews on the same term — see term_months / renewal_price_usd on each option), a downgrade is free with NO refund, and the expiry date never moves (billing "pro_rata"). Weekly -> Premium/Golden Monthly credits the unused weekly days (weekly price × days left / 7), charges the rest of the monthly price now and starts a FRESH 30-day term today (billing "new_term", expiry_changes:true). Monthly -> Weekly is NEVER offered (a monthly account simply has no weekly option; requesting it returns 409 weekly_downgrade_not_allowed). Each option carries billing, charge_now_usd, unused_credit_usd, refund_usd (always 0), expiry_changes, expires_at (the expiry after the change), new_term_days, renewal_price_usd, renewal_days and allowed/blocked_reason. A downgrade is blocked (allowed:false, blocked_reason "too_many_addon_domains") while the account has more addon domains than the target plan allows. Errors: 409 expired (renew first), 409 account_terminated, 409 unknown_plan.',
          curl: `curl -s ${base}/hosting/mysite01/plan-options -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `// Weekly account, 5 days left → both monthly plans start a fresh 30-day term
{ "username": "mysite01", "domain": "mysite.com", "product": "hosting", "remaining_days": 5, "term_ends_at": "2026-10-15T09:00:00.000Z",
  "current": { "plan_id": "premium-weekly", "name": "Premium Anti-Red (1-Week)", "price_usd": 30, "renewal_price_usd": 30, "duration_days": 7, "addon_domains": 0 },
  "options": [
    { "plan_id": "premium-monthly", "direction": "upgrade", "billing": "new_term", "charge_now_usd": 53.57, "unused_credit_usd": 21.43, "refund_usd": 0,
      "expiry_changes": true, "expires_at": "2026-11-09T09:00:00.000Z", "new_term_days": 30, "new_price_from": "now",
      "renewal_price_usd": 75, "renewal_days": 30, "allowed": true, "blocked_reason": null, "…": "…" },
    { "plan_id": "golden-monthly", "direction": "upgrade", "billing": "new_term", "charge_now_usd": 78.57, "unused_credit_usd": 21.43, "refund_usd": 0,
      "expiry_changes": true, "expires_at": "2026-11-09T09:00:00.000Z", "new_term_days": 30, "renewal_price_usd": 100, "allowed": true, "…": "…" } ],
  "policy": { "upgrade": "…", "downgrade": "…", "weekly_to_monthly": "…", "monthly_to_weekly": "Never allowed. …", "renewal": "…" } }

// Premium Monthly account, 12.5 days left → only Golden is offered (no weekly option)
// "options": [ { "plan_id": "golden-monthly", "direction": "upgrade", "billing": "pro_rata", "charge_now_usd": 10.42,
//   "unused_credit_usd": 0, "expiry_changes": false, "expires_at": "2026-10-28T09:00:00.000Z" (= unchanged), "new_term_days": null, … } ]`,
        },
        {
          method: 'POST', path: '/hosting/:user/upgrade', auth: true, billed: true,
          desc: 'Change the hosting plan — upgrades AND downgrades (alias: POST /hosting/:user/change-plan). Applies immediately on the server (package change + anti-red redeploy for the new tier) and returns synchronously. BILLING follows GET /hosting/:user/plan-options exactly: Premium Monthly -> Golden Monthly charges the pro-rata difference and keeps the expiry date; Golden Monthly -> Premium Monthly is free with NO refund and keeps the expiry date; Weekly -> Premium/Golden Monthly charges (monthly price − unused weekly credit) and sets a fresh 30-day expiry from today; Monthly -> Weekly is never allowed (409 weekly_downgrade_not_allowed). result carries billing, unused_credit_usd, previous_expires_at, expires_at, expiry_changed and renewal_price_usd/renewal_days. SAFETY: one change per account at a time — a concurrent request gets 409 plan_change_in_progress and is never charged; the quote is re-computed on the locked account so the charge always matches the current days left. Emits the hosting.plan_changed webhook on success. PRE-FLIGHT: {"dry_run": true} returns the quote + wallet check with no charge and no change. Errors before any charge: 400 invalid_plan / same_plan, 402 insufficient_wallet_balance, 409 weekly_downgrade_not_allowed, 409 too_many_addon_domains, 409 plan_change_in_progress, 409 expired (renew first — an expired plan is no longer upgraded into a fresh cycle), 409 account_suspended (unsuspend first). A WHM refusal returns 502 and any charge is refunded.',
          params: [['plan_id', true, 'Target plan_id from GET /hosting/:user/plan-options: golden-monthly | premium-monthly (premium-weekly is never accepted from a monthly plan).'], ['dry_run', false, 'If true, return the quote + wallet check only — no charge, no change (safe on a live key).']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/upgrade \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"plan_id":"golden-monthly"}'`,
          resp: `// Premium Monthly → Golden Monthly (pro-rata, expiry unchanged)
{
  "mode": "live", "product": "hosting", "action": "upgrade", "charged_usd": 10.42,
  "wallet_balance_usd": 89.58,
  "result": { "success": true, "username": "mysite01", "domain": "mysite.com", "plan": "Golden Anti-Red HostPanel (1-Month)", "plan_id": "golden-monthly",
    "previous_plan": "Premium Anti-Red HostPanel (1-Month)", "previous_plan_id": "premium-monthly", "direction": "upgrade", "billing": "pro_rata",
    "unused_credit_usd": 0, "previous_expires_at": "2026-10-28T09:00:00.000Z", "expires_at": "2026-10-28T09:00:00.000Z", "expiry_changed": false,
    "renewal_price_usd": 100, "renewal_days": 30, "refund_usd": 0 }
}
// Weekly (5 days left) → Golden Monthly: "charged_usd": 78.57, result: { "billing": "new_term", "unused_credit_usd": 21.43,
//   "previous_expires_at": "2026-10-15T09:00:00.000Z", "expires_at": "2026-11-09T09:00:00.000Z", "expiry_changed": true, … }
// Golden → Premium: { "action": "downgrade", "charged_usd": 0, "result": { "billing": "pro_rata", "expiry_changed": false, "refund_usd": 0, … } }
// Premium/Golden → premium-weekly: 409 { "error": "weekly_downgrade_not_allowed", "message": "A monthly plan can never be switched to the weekly plan. …" }`,
        },
        {
          method: 'GET', path: '/hosting/:user/plan-changes', auth: true, billed: false,
          desc: 'Plan-change history of one hosting account, newest first — changes made through the API AND upgrades your customers made in the Telegram bot (via "api" | "bot"). Each entry: id, at, status ("completed"), direction, from_plan/to_plan (premium-weekly | premium-monthly | golden-monthly) + their names, billing ("pro_rata" = Premium <-> Golden, expiry unchanged | "new_term" = a fresh 30-day term: API weekly -> monthly, and every bot upgrade), charged_usd, unused_credit_usd (API weekly -> monthly), loyalty_credit_usd (bot upgrade discount), previous_expires_at, expires_at, renewal_price_usd, legacy. legacy:true entries are either best-effort reconstructions of a change made before full history existed (only at, direction, from/to plan and, for bot upgrades, charged_usd + loyalty_credit_usd are known) or changes recorded before billing details were stored (pre 2026-10-10) — for both, billing, expiries and renewal price are null, and via is null when the channel is unknown. Same filters + paging as GET /plan-changes. Works for terminated accounts too. 404 if the account is not yours.',
          params: [['via', false, 'api | bot'], ['since / until', false, 'ISO-8601 date/time bounds on "at"'], ['limit', false, '1-200 (default 50)'], ['cursor', false, 'next_cursor from the previous page']],
          curl: `curl -s ${base}/hosting/mysite01/plan-changes -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "product": "hosting", "username": "mysite01", "domain": "mysite.com", "plan": "Golden Anti-Red HostPanel (1-Month)",
  "count": 2, "total": 2, "has_more": false, "next_cursor": null,
  "plan_changes": [
    { "id": "3f6a…", "product": "hosting", "resource_id": "mysite01", "domain": "mysite.com", "at": "2026-10-10T09:00:00.000Z", "status": "completed",
      "direction": "upgrade", "from_plan": "premium-monthly", "from_plan_name": "Premium Anti-Red HostPanel (30 Days)", "to_plan": "golden-monthly", "to_plan_name": "Golden Anti-Red HostPanel (1-Month)",
      "billing": "pro_rata", "charged_usd": 10.42, "unused_credit_usd": 0, "loyalty_credit_usd": null, "refund_usd": 0, "refunded": false, "reason": null,
      "previous_expires_at": "2026-10-28T09:00:00.000Z", "expires_at": "2026-10-28T09:00:00.000Z", "renewal_price_usd": 100, "via": "api", "legacy": false },
    { "id": "hpc_legacy_mysite01_1756684800000", "product": "hosting", "resource_id": "mysite01", "at": "2026-09-01T00:00:00.000Z", "status": "completed",
      "direction": "upgrade", "from_plan": "premium-weekly", "from_plan_name": "Premium Anti-Red (1-Week)", "to_plan": "premium-monthly", "to_plan_name": "Premium Anti-Red HostPanel (30 Days)",
      "billing": null, "charged_usd": 37.5, "loyalty_credit_usd": 37.5, "previous_expires_at": null, "expires_at": null, "renewal_price_usd": null,
      "via": "bot", "legacy": true, "…": "…" } ] }`,
        },
        {
          method: 'GET', path: '/hosting/:user/addons', auth: true, billed: false,
          desc: 'List the addon domains on a hosting account, with the plan addon quota.',
          curl: `curl -s ${base}/hosting/mysite01/addons \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "username": "mysite01", "plan": "Golden Anti-Red HostPanel (1-Month)",
  "addon_quota": "unlimited", "addon_count": 1,
  "addons": [ { "domain": "blog.mysite.com", "created_at": "2026-09-08T12:00:00.000Z" } ] }`,
        },
        {
          method: 'POST', path: '/hosting/:user/addons', auth: true, billed: false,
          desc: 'Add an addon domain to a hosting account (free — no wallet charge; enforces the plan addon quota: weekly 1, premium 5, gold unlimited).',
          params: [['domain', true, 'The addon domain to attach']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/addons \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"domain":"blog.mysite.com"}'`,
          resp: `{ "mode": "live", "username": "mysite01", "addon_domain": "blog.mysite.com", "created": true }`,
        },
        {
          method: 'GET', path: '/hosting/captcha/:domain', auth: true, billed: false,
          desc: 'Read the Visitor Captcha status for a domain attached to a hosting account. Visitor Captcha is a Golden Anti-Red HostPanel exclusive; eligible requires a Gold plan + the domain on Cloudflare.',
          curl: `curl -s ${base}/hosting/captcha/mysite.com \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "domain": "mysite.com", "cpanel_username": "mysite01",
  "plan": "Golden Anti-Red HostPanel (1-Month)",
  "gold_plan": true, "eligible": true, "has_cloudflare": true,
  "visitor_captcha_enabled": true, "gold_price_usd": 100
}`,
        },
        {
          method: 'POST', path: '/hosting/captcha/:domain', auth: true, billed: false,
          desc: 'Turn Visitor Captcha ON or OFF for a Gold-plan domain. 403 if the domain is not on a Gold plan; 409 if the domain is not on Cloudflare.',
          params: [['enabled', true, 'true = show the captcha challenge, false = bypass it']],
          curl: `curl -s -X POST ${base}/hosting/captcha/mysite.com \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"enabled":false}'`,
          resp: `{ "mode": "live", "domain": "mysite.com", "visitor_captcha_enabled": false }`,
        },
      ],
    },
    {
      id: 'renewals', title: 'Renewal Alerts',
      blurb: 'One call returns every product you own that is expiring soon — hosting, domains, VPS and RDP — with days remaining, a status bucket and a per-item renewable flag. Poll it to drive renewal reminders / auto-renew. For instant reconciliation, prefer the push webhooks (grace_start / *.deleted).',
      endpoints: [
        {
          method: 'GET', path: '/renewals', auth: true, billed: false,
          desc: 'Unified upcoming-expiry list across hosting + domains + VPS + RDP. Use ?days=N to filter to items expiring within N days (default 30); already-expired/grace items are always included. Each hosting/VPS/RDP item carries "renewable" + "renew_blocked_reason" and (for an item in its grace window) in_grace/delete_at/days_until_deletion, so you can drive a "Renew" button without a charge→409 round-trip. Hosting items also carry "renew_available_at": a weekly plan with more than 7 days left is listed with renewable:false, renew_blocked_reason "weekly_renew_too_early" and the time renewal opens. Terminated items are OMITTED by default (this list is for things you can act on); pass ?include_terminated=true to also get items terminated in the last 90 days with status "terminated", terminated_at and renewable:false.',
          params: [['days', false, 'Only return items expiring within this many days (default 30)'], ['include_terminated', false, 'If true, also include items terminated in the last 90 days (status "terminated").']],
          curl: `curl -s "${base}/renewals?days=30" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "within_days": 30,
  "include_terminated": false,
  "count": 3,
  "summary": { "expired": 0, "expiring_soon": 1, "upcoming": 1, "in_grace": 1, "terminated": 0 },
  "renewals": [
    { "product": "hosting", "id": "mysite01", "domain": "mysite.com",
      "plan": "Golden Anti-Red HostPanel (1-Month)",
      "expires_at": "2026-09-11T11:00:00.000Z", "days_until_expiry": 3,
      "status": "expiring_soon", "state": "online", "suspended": false, "auto_renew": true,
      "renewable": true, "renew_blocked_reason": null, "renew_available_at": null },
    { "product": "rdp", "id": "a1b2c3d4-…", "plan": "Standard — Windows RDP (1 month)", "region": "US",
      "expires_at": "2026-06-14T11:00:00.000Z", "days_until_expiry": -1,
      "status": "grace", "in_grace": true, "expired_at": "2026-06-14T11:00:00.000Z",
      "delete_at": "2026-06-17T11:00:00.000Z", "days_until_deletion": 2,
      "renewable": true, "renew_blocked_reason": null },
    { "product": "vps", "id": "b2f1c0a4-…", "plan": "s-1vcpu-1gb", "region": "EU",
      "expires_at": "2026-10-01T11:00:00.000Z", "days_until_expiry": 23, "status": "upcoming",
      "renewable": true, "renew_blocked_reason": null }
  ]
}`,
        },
      ],
    },
    {
      id: 'plan-history', title: 'Plan Change History',
      blurb: 'Every plan change on your hosting accounts, VPS and RDP servers in one feed — upgrades, downgrades, failed (auto-refunded) VPS/RDP resizes and changes still running — whether made through this API or by your customers in the Telegram bot. Use it for audit trails, billing reconciliation and customer-facing "plan history" screens. Per-item lists: GET /hosting/:user/plan-changes, GET /vps/:id/plan-changes, GET /rdp/:id/plan-changes. For real-time updates subscribe to the hosting.plan_changed / vps.plan_changed / rdp.plan_changed / *.plan_change_failed webhooks and use this feed to reconcile.',
      endpoints: [
        {
          method: 'GET', path: '/plan-changes', auth: true, billed: false,
          desc: 'Account-wide plan-change history across hosting + VPS + RDP, newest first ("at" descending), only for resources you own (deleted/terminated resources included). ENTRY (common fields): id, product (hosting | vps | rdp), resource_id (cPanel username or server id), at, status (completed | failed | running), direction (upgrade | downgrade | switch), from_plan / from_plan_name, to_plan / to_plan_name, charged_usd, refund_usd, refunded, reason (why a change failed), via (api | bot | null), legacy. HOSTING adds domain, billing (pro_rata | new_term), unused_credit_usd, loyalty_credit_usd, previous_expires_at, expires_at, renewal_price_usd. VPS/RDP add resize_disk, size_slug, disk_gb, renewal_price_usd, started_at. LEGACY: legacy:true marks a best-effort entry rebuilt from data stored before full history existed (fewer fields, unknown values are null) — hosting: the account\u2019s last upgrade/downgrade made before full history recording was released (mostly older Telegram-bot upgrades); VPS/RDP: the server\u2019s last failed attempt from before failed attempts were recorded. PAGINATION: pass limit (1-200, default 50); when has_more is true, call again with cursor=next_cursor (opaque — pass it back unchanged with the SAME filters). total = entries matching the filters. Errors: 400 invalid_product | invalid_date | invalid_status | invalid_via | invalid_limit | invalid_cursor.',
          params: [['product', false, 'hosting | vps | rdp — comma-separated for several (e.g. vps,rdp). Default: all.'], ['since', false, 'ISO-8601 date/time — only changes at or after this moment.'], ['until', false, 'ISO-8601 date/time — only changes at or before this moment.'], ['status', false, 'completed | failed | running'], ['via', false, 'api | bot'], ['limit', false, 'Page size 1-200 (default 50; larger values are capped at 200).'], ['cursor', false, 'next_cursor from the previous page.']],
          curl: `curl -s "${base}/plan-changes?product=vps,rdp&since=2026-10-01&limit=50" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "filters": { "product": ["vps", "rdp"], "since": "2026-10-01T00:00:00.000Z", "until": null, "status": null, "via": null, "limit": 50 },
  "count": 2, "total": 2, "has_more": false, "next_cursor": null,
  "plan_changes": [
    { "id": "5c0f…", "product": "rdp", "resource_id": "a1b2c3d4-…", "at": "2026-10-15T10:16:40.000Z", "status": "completed",
      "direction": "upgrade", "from_plan": "standard", "to_plan": "pro", "charged_usd": 112, "refund_usd": 0, "refunded": false,
      "resize_disk": false, "disk_gb": 80, "renewal_price_usd": 285.6, "via": "api", "legacy": false, "…": "…" },
    { "id": "77ab…", "product": "vps", "resource_id": "b2f1c0a4-…", "at": "2026-10-02T08:03:10.000Z", "status": "failed",
      "direction": "upgrade", "from_plan": "s-2vcpu-4gb-amd", "to_plan": "s-4vcpu-8gb-amd", "charged_usd": 40.1, "refund_usd": 40.1, "refunded": true,
      "reason": "Resize errored.", "via": "bot", "legacy": false, "…": "…" }
  ]
}
// Next page: GET /plan-changes?product=vps,rdp&since=2026-10-01&limit=50&cursor=<next_cursor>
// Bad filter → 400 { "error": "invalid_status", "message": "status must be completed, failed or running." }`,
        },
      ],
    },
    {
      id: 'alerts', title: 'Alerts, Monitoring & Activity',
      blurb: 'Proactive push alerts so a customer never loses a site by surprise, an origin health check that sees past the protection layer, and a per-service change log. All alerts are webhook events (register a URL with PUT /account/webhook) and are de-duplicated: each reminder, transition and threshold fires once. EXPIRY: hosting.expiring / vps.expiring / rdp.expiring / domain.expiring fire 7, 3 and 1 day before expires_at (only the stages shorter than the plan term — a weekly hosting plan gets the 3- and 1-day reminders); data carries expires_at, days_left (7 | 3 | 1), hours_left, renewal_price_usd, auto_renew, wallet_balance_usd and sufficient_balance. DOMAIN AUTO-RENEW: domain.auto_renew_failed fires (at most once a day) when a per-domain wallet auto-renew (POST /domains/:domain/auto-renew) could not renew — data carries reason (insufficient_funds | pricing_unavailable | registrar_error), price_usd, wallet_balance_usd, expires_at and next_attempt_at (null on the last day). RENEWALS: hosting.renewed / vps.renewed / rdp.renewed / domain.renewed fire whenever the expiry moves forward — through the API, the Telegram bot or a wallet auto-renew (data: previous_expires_at, expires_at; auto-renewals add via:"auto_renew", charged_usd, wallet_balance_usd). hosting.unsuspended fires when a suspended account is back online (data: suspended_since). domain.expired fires when a domain passes its expiry date. LOW BALANCE: account.low_balance fires once when your wallet drops below the threshold you set with PUT /account/alerts (data: wallet_balance_usd, threshold_usd) and re-arms when the balance is back above it. UPTIME: every 5 minutes each of your live hosting accounts is probed through the Cloudflare Tunnel (DNS, tunnel, real origin response — not the decoy page datacenter traffic receives). After 3 failed checks in a row hosting.site_down fires (data: down_since, consecutive_failures, checks); the next good check fires hosting.site_recovered (data: down_since, recovered_at, downtime_minutes). When the DNS check fails, missing apex/www records are re-created automatically (recorded in the activity log as dns.repair). USAGE: hosting.usage_threshold (hourly: disk, bandwidth and inodes at 80% and 95%) and vps.usage_threshold / rdp.usage_threshold (every 15 min: CPU above 90% averaged over 15 minutes, RAM above 90%, disk above 85%); data carries metric, percent, threshold_pct plus used/limit figures. Each level fires once and re-arms after the metric drops 5 points below its lowest level.',
      endpoints: [
        {
          method: 'GET', path: '/account/alerts', auth: true, billed: false,
          desc: 'Your alert settings: the low-balance threshold on this API key (null = off), the current wallet balance and whether it is below the threshold, plus the fixed reminder days, uptime-monitor settings, usage thresholds and the list of alert events.',
          curl: `curl -s ${base}/account/alerts -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "low_balance_usd": 50,
  "wallet_balance_usd": 142.5,
  "below_threshold": false,
  "low_balance_alerted_at": null,
  "webhook_configured": true,
  "expiry_reminder_days": [7, 3, 1],
  "health_check": { "interval_minutes": 5, "failures_before_site_down": 3, "auto_dns_repair": true },
  "usage_thresholds": {
    "hosting": { "disk_pct": [80, 95], "bandwidth_pct": [80, 95], "inodes_pct": [80, 95], "check_interval_minutes": 60 },
    "vps_rdp": { "cpu_pct": 90, "cpu_window_minutes": 15, "memory_pct": 90, "disk_pct": 85, "check_interval_minutes": 15 }
  },
  "events": ["hosting.expiring", "…", "account.low_balance"]
}`,
        },
        {
          method: 'PUT', path: '/account/alerts', auth: true, billed: false,
          desc: 'Set the low-balance alert threshold for this API key. account.low_balance is pushed once when the wallet drops below it (checked right after every API charge and every 10 minutes) and again only after the balance has gone back above it. Send null or 0 to turn it off. The alert is off until you set it. Errors: 400 nothing_to_update | invalid_low_balance_usd.',
          params: [['low_balance_usd', true, 'Threshold in USD (0-1000000), or null / 0 to turn the alert off']],
          curl: `curl -s -X PUT ${base}/account/alerts \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"low_balance_usd":50}'`,
          resp: `{ "low_balance_usd": 50, "wallet_balance_usd": 42.1, "below_threshold": true, "…": "…" }

// Webhook pushed to your URL:
// { "event": "account.low_balance", "product": "account", "occurred_at": "…",
//   "data": { "id": null, "product": "account", "wallet_balance_usd": 42.1, "threshold_usd": 50, "currency": "usd" } }`,
        },
        {
          method: 'GET', path: '/safe-browsing/flags', auth: true, billed: false,
          desc: 'List every domain of yours (across hosting, VPS, RDP and the URL shortener) that Google Safe Browsing has flagged. When a linked domain is flagged we auto-unlink it from our server (hosting → suspended; VPS/RDP → its DNS A-record removed; shortener → deactivated so its slugs stop resolving) and push a <product>.flagged webhook. Filter with ?product=hosting|vps|rdp|shortener. For an on-demand LIVE check of a single hosting plan, see GET /hosting/:user/safe-browsing.',
          params: [['product', false, 'Filter: hosting | vps | rdp | shortener']],
          curl: `curl -s ${base}/safe-browsing/flags \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "count": 1, "flags": [ { "domain": "bad.example.com", "product": "shortener", "status": "unlinked",
  "flagged": true, "threats": ["MALWARE"], "first_flagged_at": "…", "last_checked_at": "…", "unlinked_at": "…" } ] }`,
        },
        {
          method: 'GET', path: '/safe-browsing/status', auth: true, billed: false,
          desc: 'Get the current Safe-Browsing flag state for one of your domains. Returns { domain, flagged:false, status:"clear" } when the domain is not flagged (or not yours). This reads the stored flag from the monitor; for a forced LIVE recheck of a hosting plan use GET /hosting/:user/safe-browsing.',
          params: [['domain', true, 'The domain to look up']],
          curl: `curl -s "${base}/safe-browsing/status?domain=bad.example.com" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "domain": "bad.example.com", "product": "shortener", "status": "unlinked", "flagged": true, "threats": ["MALWARE"] }`,
        },
        {
          method: 'GET', path: '/hosting/:user/health', auth: true, billed: false,
          desc: 'Live health of a hosting account, probed from our network through the Cloudflare Tunnel so you see the REAL origin, not the decoy page the protection layer serves to datacenter traffic. dns: apex/www resolve publicly (null = resolver unavailable); when a lookup fails, dns.cloudflare shows whether the records exist on Cloudflare and dns.repair_url points to POST /hosting/:user/dns/repair. tunnel: connected + status. origin: ok, http_status, ttfb_ms, checked_at (a 5xx / 52x / 530 or a network error = down). ssl: valid, valid_until, days_left, issuer (the certificate visitors see). php_errors_last_24h: PHP errors written to public_html/error_log in the last 24 hours (null + php_errors_note when it cannot be read). status: up | degraded (works, but www/tunnel/SSL has a problem) | down | unknown. monitor: the 5-minute uptime monitor state (status, consecutive_failures, down_since, last_ok_at, last_checked_at, last_dns_repair_at). Read-only. 409 account_not_live (provisioning / failed / terminated), 409 account_suspended or maintenance_mode.',
          curl: `curl -s ${base}/hosting/mysite01/health -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "username": "mysite01",
  "domain": "mysite.com",
  "status": "up",
  "checked_at": "2026-10-12T09:00:00.000Z",
  "dns": { "apex": true, "www": true, "ok": true },
  "tunnel": { "connected": true, "status": "healthy", "connections": 4 },
  "origin": { "ok": true, "http_status": 200, "ttfb_ms": 182, "checked_at": "2026-10-12T09:00:00.000Z" },
  "ssl": { "valid": true, "valid_until": "2027-01-05T23:59:59.000Z", "days_left": 85, "issuer": "Google Trust Services" },
  "php_errors_last_24h": 0,
  "monitor": { "enabled": true, "interval_minutes": 5, "failures_before_site_down": 3, "status": "up", "consecutive_failures": 0,
               "down_since": null, "last_ok_at": "2026-10-12T08:55:00.000Z", "last_checked_at": "2026-10-12T08:55:00.000Z", "last_dns_repair_at": null }
}`,
        },
        {
          method: 'GET', path: '/activity', auth: true, billed: false,
          desc: 'Change-activity log for everything you own, newest first, kept 90 days. Each entry: id, at, resource_type (hosting | vps | rdp | domain | account), resource_id (cPanel username, server id or domain), action, actor (api = your API calls · bot = your customers in the Telegram bot · panel = your customers in the HostPanel · system = our schedulers and monitors) and details. Actions include create, renew, delete, suspend, unsuspend, site.take_offline / site.bring_online, auto_renew.enabled / disabled / charged / failed, plan_change, dns.repair, anti_red.deploy, addon.add / remove, primary_domain.change, security.*, geo.*, ssl.autossl, credentials.reveal, power.* (VPS/RDP), password_reset, reinstall, nameservers.update, dns_record.*, site.down / site.recovered, webhook.update and alerts.update. Dry-runs and failed calls are not recorded. Errors: 400 invalid_resource | invalid_resource_type | invalid_actor | invalid_date | invalid_limit | invalid_cursor.',
          params: [['resource', false, '"<type>:<id>", e.g. hosting:mysite01 or vps:b2f1c0a4-…, or a bare id'], ['resource_type', false, 'hosting | vps | rdp | domain | account'], ['actor', false, 'api | bot | panel | system'], ['action', false, 'Exact action or a prefix: "auto_renew" matches auto_renew.charged, auto_renew.failed …'], ['since', false, 'ISO-8601 date/time'], ['until', false, 'ISO-8601 date/time'], ['limit', false, '1-200 (default 50)'], ['cursor', false, 'next_cursor from the previous page (same filters)']],
          curl: `curl -s "${base}/activity?resource=hosting:mysite01&limit=20" -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "filters": { "resource_type": "hosting", "resource_id": "mysite01", "actor": null, "action": null, "since": null, "until": null, "limit": 20 },
  "retention_days": 90,
  "count": 3, "has_more": false, "next_cursor": null,
  "activity": [
    { "id": "8c1e…", "at": "2026-10-12T09:05:00.000Z", "resource_type": "hosting", "resource_id": "mysite01", "action": "dns.repair", "actor": "system", "details": { "trigger": "health_check", "created": ["www.mysite.com"] } },
    { "id": "51aa…", "at": "2026-10-11T18:00:00.000Z", "resource_type": "hosting", "resource_id": "mysite01", "action": "auto_renew.charged", "actor": "system", "details": { "charged_usd": 100, "expires_at": "2026-11-10T18:00:00.000Z" } },
    { "id": "0f3b…", "at": "2026-10-10T12:00:00.000Z", "resource_type": "hosting", "resource_id": "mysite01", "action": "auto_renew.enabled", "actor": "bot", "details": {} }
  ]
}`,
        },
      ],
    },
    {
      id: 'hosting-apps', title: 'Hosting · One-click Apps (WordPress)',
      blurb: 'Install WordPress on a hosting account in one call — no WP Toolkit, no shell. We create a MySQL database + user, place the latest WordPress in the site root (or a sub-folder via path), write wp-config.php with fresh security keys, add the permalink rules and run the WordPress setup with a generated admin login (24-character password). Available on every plan (it uses one of the plan\u2019s MySQL databases). The install folder must not already contain WordPress / index.php; a static index.html is kept as index.html.pre-wordpress. If anything fails, everything the installer created is removed again. ASYNC: POST returns 202 with state "installing" — poll GET …/apps/:app_id (stage: preflight → database → download → files → config → install) until state is "ready" (admin_password included) or "failed" (error), or subscribe to hosting.app_installed / hosting.app_install_failed. Same feature as the HostPanel "Apps" tab. FREE. On a sandbox pod the install is validated and recorded as state "dry_run" only.',
      endpoints: [
        {
          method: 'GET', path: '/hosting/:user/apps', auth: true, billed: false,
          desc: 'List the apps installed (or installing / failed) on the account plus the catalog of installable apps.',
          curl: `curl -s ${base}/hosting/mysite01/apps \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "username": "mysite01", "domain": "mysite.com", "catalog": [ { "app": "wordpress", "name": "WordPress", "requires": "mysql" } ], "apps": [ { "id": "wp_3f9a1c0b2d", "app": "wordpress", "state": "ready", "stage": "ready", "path": "", "site_url": "https://mysite.com", "admin_url": "https://mysite.com/wp-admin/", "admin_user": "admin_7c2e", "version": "6.8.3", "installed_at": "2026-10-12T09:03:10.000Z" } ] }`,
        },
        {
          method: 'POST', path: '/hosting/:user/apps', auth: true, billed: false,
          desc: 'Start a one-click install. Errors before anything runs: 400 invalid_app / invalid_path / invalid_email, 404 not_found, 409 app_exists (already installing/installed at that path) / account_suspended / account_terminated / not_ready. Install-time failures (e.g. docroot_not_empty, db_create_failed when the plan\u2019s database limit is reached, wp_install_failed) are reported on the app as state "failed" with an error code.',
          params: [['app', false, '"wordpress" (default)'], ['path', false, 'Sub-folder under the site root, e.g. "blog" → https://mysite.com/blog. Omit for the site root'], ['title', false, 'Site title (default: the domain)'], ['admin_email', false, 'WordPress admin email (default: admin@<domain>)']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/apps \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"app":"wordpress","title":"My Site","admin_email":"me@example.com"}'`,
          resp: `{ "mode": "live", "id": "wp_3f9a1c0b2d", "app": "wordpress", "state": "installing", "stage": "queued", "username": "mysite01", "domain": "mysite.com", "path": "", "site_url": "https://mysite.com", "admin_url": "https://mysite.com/wp-admin/", "poll_url": "/hosting/mysite01/apps/wp_3f9a1c0b2d" }`,
        },
        {
          method: 'GET', path: '/hosting/:user/apps/:app_id', auth: true, billed: false,
          desc: 'Poll one app. Once state is "ready" the response includes admin_password (the WordPress admin login) — store it securely.',
          curl: `curl -s ${base}/hosting/mysite01/apps/wp_3f9a1c0b2d \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "id": "wp_3f9a1c0b2d", "app": "wordpress", "state": "ready", "stage": "ready", "site_url": "https://mysite.com", "admin_url": "https://mysite.com/wp-admin/", "admin_user": "admin_7c2e", "admin_password": "q7#Rk2…", "admin_email": "me@example.com", "version": "6.8.3", "db_name": "mysite01_wp1a2b", "db_user": "mysite01_wp1a2b", "error": null }`,
        },
        {
          method: 'POST', path: '/hosting/:user/apps/:app_id/admin-password', auth: true, billed: false,
          desc: 'Generate a new WordPress admin password (the old one stops working). 409 app_not_ready if the install has not finished.',
          curl: `curl -s -X POST ${base}/hosting/mysite01/apps/wp_3f9a1c0b2d/admin-password \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "mode": "live", "id": "wp_3f9a1c0b2d", "admin_url": "https://mysite.com/wp-admin/", "admin_user": "admin_7c2e", "admin_password": "Zx9!m…", "note": "This password was freshly generated — the previous one no longer works." }`,
        },
      ],
    },
    {
      id: 'hosting-email', title: 'Hosting · Email Accounts',
      blurb: 'Manage a hosting account\u2019s email mailboxes — the same operations the HostPanel and Telegram bot expose. All are FREE (no wallet charge). On a sandbox pod every write returns a dry-run envelope; reads run live.',
      endpoints: [
        {
          method: 'GET', path: '/hosting/:user/email', auth: true, billed: false,
          desc: 'List all email accounts (mailboxes) on the hosting account, with disk usage.',
          curl: `curl -s ${base}/hosting/mysite01/email \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "status": 1, "data": [ { "email": "info@mysite.com", "diskused": 12.4, "diskquota": 250 } ] }`,
        },
        {
          method: 'POST', path: '/hosting/:user/email', auth: true, billed: false,
          desc: 'Create a new email account.',
          params: [['email', true, 'Local part (before the @)'], ['password', true, 'Mailbox password'], ['domain', true, 'Domain for the mailbox'], ['quota', false, 'Mailbox quota in MB (default 250)']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/email \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"email":"info","password":"S3cret!","domain":"mysite.com","quota":500}'`,
          resp: `{ "status": 1, "data": [ { "reason": "OK", "result": 1 } ] }`,
        },
        {
          method: 'DELETE', path: '/hosting/:user/email', auth: true, billed: false,
          desc: 'Delete an email account. Params may be sent in the JSON body or the query string.',
          params: [['email', true, 'Local part'], ['domain', true, 'Domain']],
          curl: `curl -s -X DELETE "${base}/hosting/mysite01/email?email=info&domain=mysite.com" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "status": 1 }`,
        },
        {
          method: 'PUT', path: '/hosting/:user/email/password', auth: true, billed: false,
          desc: 'Change the password of an existing mailbox.',
          params: [['email', true, 'Local part'], ['password', true, 'New password'], ['domain', true, 'Domain']],
          curl: `curl -s -X PUT ${base}/hosting/mysite01/email/password \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"email":"info","password":"N3wPass!","domain":"mysite.com"}'`,
          resp: `{ "status": 1 }`,
        },
      ],
    },
    {
      id: 'hosting-mysql', title: 'Hosting · MySQL Databases',
      blurb: 'Full MySQL management: databases, database users, per-database privileges and remote-access hosts. Available on every plan — the plan sets how many databases you can create: Premium (1-Week) 2, Premium (1-Month) 5, Golden unlimited (over the limit cPanel returns its own "maximum reached" error). FREE.',
      endpoints: [
        {
          method: 'GET', path: '/hosting/:user/mysql/databases', auth: true, billed: false,
          desc: 'List all MySQL databases on the account.',
          curl: `curl -s ${base}/hosting/mysite01/mysql/databases \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "status": 1, "data": [ { "database": "mysite01_wp", "users": ["mysite01_admin"] } ] }`,
        },
        {
          method: 'POST', path: '/hosting/:user/mysql/databases', auth: true, billed: false,
          desc: 'Create a database (cPanel auto-prefixes it with the account username).',
          params: [['name', true, 'Database name (unprefixed)']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/mysql/databases \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"name":"wp"}'`,
          resp: `{ "status": 1 }`,
        },
        {
          method: 'DELETE', path: '/hosting/:user/mysql/databases', auth: true, billed: false,
          desc: 'Delete a database. Also: POST /mysql/databases/rename {oldname,newname}, /repair {name}, /check {name}.',
          params: [['name', true, 'Database name (prefixed)']],
          curl: `curl -s -X DELETE "${base}/hosting/mysite01/mysql/databases?name=mysite01_wp" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "status": 1 }`,
        },
        {
          method: 'GET', path: '/hosting/:user/mysql/users', auth: true, billed: false,
          desc: 'List MySQL users. Create: POST {name,password}. Delete: DELETE {name}. Change password: PUT /mysql/users/password {user,password}. Rename: POST /mysql/users/rename {oldname,newname}.',
          curl: `curl -s ${base}/hosting/mysite01/mysql/users \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "status": 1, "data": [ "mysite01_admin" ] }`,
        },
        {
          method: 'POST', path: '/hosting/:user/mysql/privileges/grant', auth: true, billed: false,
          desc: 'Grant privileges to a user on a database. Revoke with POST /mysql/privileges/revoke {user,database}.',
          params: [['user', true, 'DB user (prefixed)'], ['database', true, 'DB name (prefixed)'], ['privileges', true, 'Array e.g. ["ALL PRIVILEGES"] or ["SELECT","INSERT"]']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/mysql/privileges/grant \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"user":"mysite01_admin","database":"mysite01_wp","privileges":["ALL PRIVILEGES"]}'`,
          resp: `{ "status": 1 }`,
        },
        {
          method: 'GET', path: '/hosting/:user/mysql/remote-hosts', auth: true, billed: false,
          desc: 'List whitelisted remote-MySQL hosts. Add: POST {host}. Remove: DELETE {host}.',
          curl: `curl -s ${base}/hosting/mysite01/mysql/remote-hosts \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "status": 1, "data": [ "203.0.113.40" ] }`,
        },
      ],
    },
    {
      id: 'hosting-web', title: 'Hosting · Subdomains, Domains & SSL',
      blurb: 'Manage subdomains, list domains, change an addon/subdomain document root, remove an addon domain, read SSL status and trigger AutoSSL, and read disk/bandwidth stats. FREE.',
      endpoints: [
        {
          method: 'GET', path: '/hosting/:user/subdomains', auth: true, billed: false,
          desc: 'List subdomains. Create: POST {subdomain, rootdomain?, dir?} (rootdomain defaults to the primary domain). Delete: DELETE {subdomain} (full subdomain).',
          curl: `curl -s ${base}/hosting/mysite01/subdomains \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "status": 1, "data": [ { "domain": "shop", "rootdomain": "mysite.com", "fullDomain": "shop.mysite.com" } ] }`,
        },
        {
          method: 'GET', path: '/hosting/:user/domains', auth: true, billed: false,
          desc: 'List every domain on the account (main, addon, parked, sub). Change docroot: POST /domains/docroot {subdomain,rootdomain,dir}. Remove an addon domain: DELETE /domains/addon {domain}.',
          curl: `curl -s ${base}/hosting/mysite01/domains \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "status": 1, "data": { "main_domain": "mysite.com", "addon_domains": ["blog.com"], "sub_domains": ["shop.mysite.com"] } }`,
        },
        {
          method: 'GET', path: '/hosting/:user/ssl', auth: true, billed: false,
          desc: 'SSL certificate status for the account\u2019s installed hosts (issuer, expiry, self-signed flag).',
          curl: `curl -s ${base}/hosting/mysite01/ssl \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "status": 1, "data": [ { "servername": "mysite.com", "certificate": { "not_after": 1767225600 } } ] }`,
        },
        {
          method: 'POST', path: '/hosting/:user/ssl/autossl', auth: true, billed: false,
          desc: 'Trigger an AutoSSL check to (re)issue certificates for all the account\u2019s domains.',
          curl: `curl -s -X POST ${base}/hosting/mysite01/ssl/autossl \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "success": true, "message": "AutoSSL check started. Certificates will be issued shortly (1-3 minutes)." }`,
        },
        {
          method: 'GET', path: '/hosting/:user/stats', auth: true, billed: false,
          desc: 'Disk quota + bandwidth usage for the account.',
          curl: `curl -s ${base}/hosting/mysite01/stats \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "username": "mysite01", "quota": { "status": 1, "data": { … } }, "bandwidth": { "status": 1, "data": { … } } }`,
        },
      ],
    },
    {
      id: 'hosting-files', title: 'Hosting · File Manager',
      blurb: 'Full File Manager over the API: list, read, save, mkdir, delete, rename, extract, compress, copy, move, base64 upload and one-tap unzip. Paths may be relative to the account home (e.g. public_html) or absolute (/home/<user>/...); the API always resolves to absolute paths, so extract/copy/move/rename never duplicate the source directory and destDir is always honored. move, copy, extract and unzip return a before/after `receipt` (added/removed entries) so you can confirm placement without a second request — opt out with receipt:false. Anti-Red protected files (.htaccess, .user.ini, .antired-challenge.php in public_html) are blocked from edit/delete with 403 protected_file. FREE.',
      endpoints: [
        {
          method: 'GET', path: '/hosting/:user/files', auth: true, billed: false,
          desc: 'List files/folders in a directory. Read a file: GET /files/content?dir=&file=.',
          params: [['dir', false, 'Directory to list (default /public_html)']],
          curl: `curl -s "${base}/hosting/mysite01/files?dir=/public_html" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "status": 1, "data": [ { "file": "index.php", "type": "file", "size": 1024 } ] }`,
        },
        {
          method: 'POST', path: '/hosting/:user/files/save', auth: true, billed: false,
          desc: 'Create/overwrite a text file. Other ops: /files/mkdir {dir,name}, /files/rename {dir,oldName,newName}, /files/extract {dir,file,destDir?}, /files/compress {dir,files[],destFile}, /files/copy {sourceDir,fileName,destDir}, /files/move {sourceDir,fileName,destDir}, /files/unzip {dir,fileName,content_base64,destDir?,removeArchive?}. Delete: DELETE /files {dir,file,isDirectory?}. move/copy/extract/unzip also return a `receipt` {dest:{dir,before,after,added}, source?:{dir,before,after,removed}} confirming what landed/left — add receipt:false to skip it.',
          params: [['dir', true, 'Directory'], ['file', true, 'File name'], ['content', false, 'File contents (text)']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/files/save \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"dir":"/public_html","file":"robots.txt","content":"User-agent: *"}'`,
          resp: `{ "status": 1 }`,
        },
        {
          method: 'POST', path: '/hosting/:user/files/upload', auth: true, billed: false,
          desc: 'Upload a (small) binary/text file as base64.',
          params: [['dir', true, 'Target directory'], ['fileName', true, 'File name'], ['content_base64', true, 'Base64-encoded file bytes']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/files/upload \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"dir":"/public_html","fileName":"logo.png","content_base64":"iVBORw0KGgo…"}'`,
          resp: `{ "status": 1 }`,
        },
        {
          method: 'POST', path: '/hosting/:user/files/unzip', auth: true, billed: false,
          desc: 'One-tap unzip: upload a base64 archive, extract it, and return the destination listing — all in a single call. destDir defaults to dir; removeArchive:true deletes the archive after a successful extract. Returns listing[] and added[] (plus a before/after receipt unless receipt:false). Supports zip/tar/tar.gz.',
          params: [['dir', true, 'Directory to upload the archive into'], ['fileName', true, 'Archive file name (e.g. site.zip)'], ['content_base64', true, 'Base64-encoded archive bytes'], ['destDir', false, 'Extract target directory (default = dir)'], ['removeArchive', false, 'Delete the archive after a successful extract (default false)']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/files/unzip \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"dir":"/public_html","fileName":"site.zip","content_base64":"UEsDBBQ…","removeArchive":true}'`,
          resp: `{ "status": 1, "action": "files.unzip", "uploaded": { "fileName": "site.zip", "bytes": 20480 }, "extracted": { "src": "/home/mysite01/public_html/site.zip", "dest": "/home/mysite01/public_html" }, "archiveRemoved": true, "listing": ["index.php", "assets"], "added": ["index.php", "assets"], "receipt": { "dest": { "dir": "/home/mysite01/public_html", "before": [], "after": ["index.php", "assets"], "added": ["index.php", "assets"] } } }`,
        },
      ],
    },
    {
      id: 'hosting-security', title: 'Hosting · Security, Geo & Analytics',
      blurb: 'The premium Anti-Red / Cloudflare protection layer the HostPanel exposes: protection status, Anti-Red deploy, Cloudflare anti-bot profile, Safe-Browsing / blacklist checks, Visitor Captcha and Geo rules (both Golden-plan only), Honeypot Traps (Monthly plans), plus zone analytics. FREE.',
      endpoints: [
        {
          method: 'GET', path: '/hosting/:user/security/status', auth: true, billed: false,
          desc: 'Aggregated security posture: Cloudflare anti-bot settings, Safe-Browsing + blacklist results, JS-challenge state and scanner-signature counts. Also reports plan-tier flags (is_gold, is_monthly) and an "eligibility" map telling you which plan-gated features this account may toggle — Visitor Captcha / Geo / JS-Challenge are Golden-only, MySQL is available on every plan, and Honeypot Traps need any Monthly plan.',
          curl: `curl -s ${base}/hosting/mysite01/security/status \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "username": "mysite01", "domain": "mysite.com", "plan": "Golden Anti-Red HostPanel (1-Month)",
  "is_gold": true, "is_monthly": true, "captcha_gold_only": true, "honeypot_monthly_only": true,
  "eligibility": { "visitor_captcha": true, "geo_blocking": true, "js_challenge": true, "mysql": true, "honeypot": true },
  "antiRed": { "safeBrowsing": { "safe": true }, "blacklist": { "listed": false } },
  "protectionLayers": { "jsChallenge": true, "honeypot": true, "cloudflareZone": true } }`,
        },
        {
          method: 'GET', path: '/hosting/:user/safe-browsing', auth: true, billed: false,
          desc: 'REALTIME Google Safe Browsing status for the domains ASSOCIATED with this hosting plan (its primary domain + any addon domains). This performs a LIVE check against Google (bypasses the 30-min cache) every call. Pass ?domain=<d> to check a single associated domain (its main or an addon domain — a domain not on this plan returns 404 domain_not_associated); omit it to check every domain on the plan. Read-only: it reports status only (safe / flagged / threat types) and never suspends or unlinks — the background monitor handles enforcement and pushes <product>.flagged webhooks.',
          params: [['domain', false, 'A single domain on this plan to check (defaults to all plan domains)']],
          curl: `curl -s "${base}/hosting/mysite01/safe-browsing?domain=mysite.com" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "username": "mysite01", "plan": "Golden Anti-Red HostPanel (1-Month)", "domain": "mysite.com",
  "checked_at": "2026-10-11T21:30:00.000Z", "realtime": true, "configured": true, "flagged_count": 0,
  "results": [ { "domain": "mysite.com", "is_main": true, "safe": true, "flagged": false, "threats": [], "error": null, "monitor_status": "clear" } ] }`,
        },
        {
          method: 'POST', path: '/hosting/:user/security/anti-red/deploy', auth: true, billed: false,
          desc: 'Deploy the full Anti-Red protection stack (.htaccess cloaking, JS challenge, JA3 fingerprinting, CF worker) for the primary domain. It also checks website DNS first and re-creates any missing apex/www tunnel CNAME (same as POST /dns/repair); see "dns" in the response. Read status: GET /security/anti-red/status.',
          curl: `curl -s -X POST ${base}/hosting/mysite01/security/anti-red/deploy \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "success": true, "htaccess": true, "jsChallenge": true, "hardenedWorker": { "success": true },
  "dns": [ { "domain": "mysite.com", "status": "ok", "missing": [] } ] }`,
        },
        {
          method: 'POST', path: '/hosting/:user/security/anti-bot', auth: true, billed: false,
          desc: 'Set the Cloudflare anti-bot profile. Also: POST /security/anti-bot/rules (create WAF bot rules), GET /security/safe-browsing, GET /security/blacklist.',
          params: [['profile', true, 'off | low | medium | high | under_attack']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/security/anti-bot \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"profile":"high"}'`,
          resp: `{ "success": true, "profile": "high" }`,
        },
        {
          method: 'POST', path: '/hosting/:user/security/visitor-captcha', auth: true, billed: false,
          desc: 'Turn the human "Verify your browser" challenge ON/OFF for a domain (Golden plan only — 403 gold_only otherwise; 400 no_cloudflare if the domain isn\u2019t on Cloudflare). Read state for all domains: GET /security/visitor-captcha. This is the SAME Worker-served "verify your browser" challenge that POST /security/js-challenge toggles for the primary domain and that the HostPanel / Telegram bot expose — there is ONE source of truth for the on/off state (the Cloudflare edge KV bypass and our DB flag are written together in lockstep), so every surface always reports the same state.',
          params: [['enabled', true, 'boolean'], ['domain', false, 'Target domain (defaults to the primary domain; must belong to the account)']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/security/visitor-captcha \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"enabled":true,"domain":"mysite.com"}'`,
          resp: `{ "success": true, "username": "mysite01", "domain": "mysite.com", "enabled": true }`,
        },
        {
          method: 'GET', path: '/hosting/:user/geo', auth: true, billed: false,
          desc: 'List Cloudflare geo firewall rules. GOLDEN PLAN ONLY — list, create and delete all require the Golden Anti-Red HostPanel and return 403 gold_only on any other plan. Create: POST /geo {countries:[],mode:"block"|"allow",description?}. Delete: DELETE /geo {ruleId}. Block rules use the form ip.geoip.country in {"US" "GB"}; allow (whitelist) rules are the negated form not (ip.geoip.country in {…}).',
          curl: `curl -s ${base}/hosting/mysite01/geo \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "rules": [ { "id": "…", "action": "block", "expression": "ip.geoip.country in {\\"CN\\"}" } ], "zoneId": "…" }`,
        },
        {
          method: 'GET', path: '/hosting/:user/analytics', auth: true, billed: false,
          desc: 'Cloudflare zone analytics (traffic, threats, bandwidth) for the domain.',
          params: [['days', false, 'Window in days (default 7)'], ['detailed', false, 'false for a lighter summary']],
          curl: `curl -s "${base}/hosting/mysite01/analytics?days=7" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "success": true, "totals": { "requests": 12045, "threats": 132, "bandwidth_bytes": 894000 } }`,
        },
        {
          method: 'GET', path: '/hosting/honeypot/:domain', auth: true, billed: false,
          desc: 'Read the Honeypot-Traps state for a domain — hidden scanner-trap links injected into the protected site to catch bots/crawlers. Monthly plans only (Premium/Golden); on the 7-day trial eligible is false. Toggle with POST /hosting/honeypot/:domain {enabled:bool} (403 monthly_plan_required on weekly plans; 409 no_cloudflare if the domain is not on Cloudflare).',
          curl: `curl -s ${base}/hosting/honeypot/mysite.com \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "domain": "mysite.com", "cpanel_username": "mysite01", "plan": "Golden Anti-Red HostPanel (1-Month)", "is_monthly": true, "eligible": true, "has_cloudflare": true, "honeypot_enabled": true }`,
        },
      ],
    },
    {
      id: 'hosting-advanced', title: 'Hosting · Advanced Management (full panel parity)',
      blurb: 'The remaining HostPanel operations, exposed for building a full cPanel-like UI: send test email, phpMyAdmin SSO, bulk subdomain import, addon docroot mirror/own, replace primary domain (an addon via set-primary, or any domain via change-primary), nameserver status, take a site offline/online, JS-challenge toggle and large-file chunked upload. All FREE; writes are dry-run on a sandbox pod.',
      endpoints: [
        { method: 'POST', path: '/hosting/:user/email/test', auth: true, billed: false, desc: 'Send a test email from a mailbox to verify SMTP.', params: [['from', true, 'Local part (sender mailbox)'], ['to', true, 'Recipient address']], curl: `curl -s -X POST ${base}/hosting/mysite01/email/test \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"from":"info","to":"you@example.com"}'`, resp: `{ "success": true, "messageId": "…", "message": "Test email sent to you@example.com" }` },
        { method: 'GET', path: '/hosting/:user/mysql/phpmyadmin', auth: true, billed: false, desc: 'Mint a one-click phpMyAdmin SSO URL (live mode only; all plans).', curl: `curl -s ${base}/hosting/mysite01/mysql/phpmyadmin \\
  -H "Authorization: Bearer YOUR_API_KEY"`, resp: `{ "status": 1, "url": "https://server:2083/cpsess…/3rdparty/phpMyAdmin/", "expires": 1767225600 }` },
        { method: 'POST', path: '/hosting/:user/subdomains/bulk-create', auth: true, billed: false, desc: 'Create up to 50 subdomains in one call (also creates Cloudflare tunnel CNAMEs).', params: [['subdomains', true, 'Array or comma/newline-separated string'], ['rootdomain', false, 'Defaults to the primary domain']], curl: `curl -s -X POST ${base}/hosting/mysite01/subdomains/bulk-create \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"subdomains":"shop,blog,api"}'`, resp: `{ "results": [ { "subdomain": "shop", "fqdn": "shop.mysite.com", "success": true } ], "summary": { "total": 3, "succeeded": 3, "failed": 0 } }` },
        { method: 'GET', path: '/hosting/:user/domains/docroot-modes', auth: true, billed: false, desc: 'Show whether each addon domain mirrors the primary site or serves its own folder. Change with POST /domains/docroot-mode {domain, mode:"mirror"|"own"}.', curl: `curl -s ${base}/hosting/mysite01/domains/docroot-modes \\
  -H "Authorization: Bearer YOUR_API_KEY"`, resp: `{ "modes": { "blog.com": "own" }, "primary": "mysite.com" }` },
        { method: 'POST', path: '/hosting/:user/domains/set-primary', auth: true, billed: false, desc: 'Promote an existing addon domain to be the account primary (WHM modifyacct + Cloudflare/anti-red redeploy for the new primary, cleanup of the old). Returns 400 needs_attach if the domain is not yet an addon.', params: [['domain', true, 'The addon domain to promote']], curl: `curl -s -X POST ${base}/hosting/mysite01/domains/set-primary \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"domain":"blog.com"}'`, resp: `{ "success": true, "oldDomain": "mysite.com", "newDomain": "blog.com" }` },
        { method: 'POST', path: '/hosting/:user/change-primary', auth: true, billed: false, desc: 'Replace a plan\u2019s primary domain with ANY domain you own, at the WHM level (modifyacct domain=) — no cPanel session and no terminate+recreate. Unlike /domains/set-primary (which needs the target to already be an addon), change-primary accepts a brand-new domain. Refuses with 409 domain_on_other_plan if the domain is attached to another plan, 403 blocked_domain if it is blocklisted, or 400 already_primary. Cloudflare + anti-red re-point runs in the background (~30-60s).', params: [['domain', true, 'The domain to promote to primary']], curl: `curl -s -X POST ${base}/hosting/mysite01/change-primary \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"domain":"newsite.com"}'`, resp: `{ "success": true, "username": "mysite01", "oldDomain": "mysite.com", "newDomain": "newsite.com", "domain": "newsite.com", "note": "Primary domain changed at WHM. Cloudflare + anti-red re-point runs in the background (~30-60s)." }` },
        { method: 'GET', path: '/hosting/:user/domains/ns-status', auth: true, billed: false, desc: 'Cloudflare nameserver / zone activation status for a domain.', params: [['domain', true, 'Domain to check']], curl: `curl -s "${base}/hosting/mysite01/domains/ns-status?domain=mysite.com" \\
  -H "Authorization: Bearer YOUR_API_KEY"`, resp: `{ "status": "active", "nameservers": ["ada.ns.cloudflare.com","rob.ns.cloudflare.com"], "zoneId": "…" }` },
        { method: 'GET', path: '/hosting/:user/site-status', auth: true, billed: false, desc: 'Whether the site is online, in maintenance, or suspended. Change with POST /hosting/:user/site-status {action:"take_offline"|"bring_online", mode:"maintenance"|"suspended"}. Also available at the legacy alias /hosting/:user/account/site-status.', curl: `curl -s ${base}/hosting/mysite01/site-status \\
  -H "Authorization: Bearer YOUR_API_KEY"`, resp: `{ "status": "online", "domain": "mysite.com", "plan": "Golden Anti-Red HostPanel (1-Month)", "auto_renew": true }` },
        { method: 'POST', path: '/hosting/:user/auto-renew', auth: true, billed: false, desc: 'Turn auto-renew on or off for a hosting plan. Send {enabled:true|false} to set it explicitly, or omit the body to toggle the current value.', params: [['enabled', false, 'boolean — omit to toggle']], curl: `curl -s -X POST ${base}/hosting/mysite01/auto-renew \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"enabled":false}'`, resp: `{ "username": "mysite01", "domain": "mysite.com", "auto_renew": false }` },
        { method: 'POST', path: '/hosting/:user/security/js-challenge', auth: true, billed: false, desc: 'Enable/disable the JS "verify your browser" challenge for the primary domain (Golden plan only). Read state: GET /security/js-challenge. This targets the PRIMARY domain; POST /security/visitor-captcha toggles the SAME underlying Worker "verify your browser" challenge for any owned domain. Both share one source of truth (Cloudflare edge KV + our DB flag kept in lockstep), so the panel, this API and the bot never drift.', params: [['enabled', true, 'boolean']], curl: `curl -s -X POST ${base}/hosting/mysite01/security/js-challenge \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"enabled":true}'`, resp: `{ "jsChallengeEnabled": true, "workerRoutes": { "success": true } }` },
        { method: 'POST', path: '/hosting/:user/files/upload-chunk', auth: true, billed: false, desc: 'Large-file upload via base64 chunks (up to 100 MB). Send each chunk with the same uploadId; the API acks {status:"chunk-received"} until the final chunk assembles and uploads. Cancel with POST /files/upload-chunk/cancel {uploadId}.', params: [['uploadId', true, 'Client-generated id for the upload'], ['chunkIndex', true, '0-based chunk index'], ['totalChunks', true, 'Total number of chunks'], ['fileName', true, 'Target file name'], ['dir', true, 'Target directory'], ['content_base64', true, 'Base64 of this chunk']], curl: `curl -s -X POST ${base}/hosting/mysite01/files/upload-chunk \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"uploadId":"u1","chunkIndex":0,"totalChunks":2,"fileName":"backup.zip","dir":"/public_html","content_base64":"UEsDBAo…"}'`, resp: `{ "status": "chunk-received", "uploadId": "u1", "received": 1, "totalChunks": 2 }` },
      ],
    },
  ]
}

const ERRORS = [
  ['401', 'missing_api_key', 'No API key supplied in Authorization / X-API-Key header.'],
  ['401', 'invalid_api_key', 'The key is unknown or has been disabled.'],
  ['400', 'invalid_domain / invalid_record / invalid_plan', 'A required parameter was missing or malformed.'],
  ['400', 'pricing_failed', 'A valid price could not be determined for the order.'],
  ['402', 'insufficient_wallet_balance', 'Wallet balance is below the order price — order refused before provisioning (both live and dry-run). Response includes price_usd, wallet_balance_usd and shortfall_usd. Top up and retry.'],
  ['409', 'domain_unavailable', 'The requested domain cannot be registered.'],
  ['409', 'domain_in_use', 'That domain already has an active hosting plan.'],
  ['404', 'not_found', 'The resource does not exist or is not owned by your account.'],
  ['400', 'invalid_body / invalid_upgrade_target', 'Request body missing/invalid (e.g. captcha needs {enabled:bool}); or plan_id is not a valid upgrade target (response lists the available targets).'],
  ['403', 'gold_plan_required / gold_only', 'Visitor Captcha & Geo are exclusive to the Golden Anti-Red HostPanel — the account is not on a Gold plan.'],
  ['409', 'app_exists', 'A one-click app is already installing or installed at that path on the hosting account (the response includes it as "app").'],
  ['400', 'invalid_app / invalid_path / invalid_email', 'One-click app request is invalid: only "wordpress" is available; path may contain letters, numbers, -, _ and /; admin_email must be a valid address.'],
  ['409', 'app_not_ready', 'The one-click app has not finished installing (state must be "ready").'],
  ['404', 'app_not_found', 'No such one-click app on that hosting account.'],
  ['403', 'protected_file', 'An Anti-Red protected file (.htaccess / .user.ini / .antired-challenge.php in public_html) cannot be modified or deleted via the API.'],
  ['409', 'no_cloudflare', 'The domain is not on Cloudflare, so Visitor Captcha cannot be toggled.'],
  ['409', 'no_upgrade_path', 'The account is already on the top tier — no higher plan to upgrade to.'],
  ['409', 'addon_exists / addon_quota_exceeded', 'The addon domain already exists, or the plan addon-domain quota is reached.'],
  ['409', 'weekly_downgrade_not_allowed', 'Hosting plan change: a monthly plan can never be switched to the weekly plan (Premium Monthly <-> Golden Monthly is available). See "Plan changes".'],
  ['409', 'plan_change_in_progress', 'Another plan change for the same hosting account / server is still running. Nothing was charged — retry shortly (hosting) or poll the server (VPS/RDP).'],
  ['409', 'too_many_addon_domains / disk_too_small', 'Plan change blocked: the account has more addon domains than the target hosting plan allows, or the target VPS/RDP plan has a smaller disk than the server (disks never shrink).'],
  ['409', 'expired / term_ending_soon', 'Plan change blocked: the term has ended, or (VPS/RDP) less than 1 hour is left in it. Renew first.'],
  ['409', 'weekly_renew_too_early', 'Weekly hosting can only be renewed once 7 days or fewer are left. The response includes renew_available_at.'],
  ['400', 'weekly_single_period_only', 'Weekly hosting renews one week at a time — send periods: 1 (or omit it).'],
  ['400', 'invalid_months', 'months must be one of 1, 3, 6 or 12 (POST /hosting, POST /hosting/:user/renew).'],
  ['400', 'term_not_available', 'Prepaid 3/6/12-month terms are for monthly plans only — the weekly plan is 1 week at a time.'],
  ['501', 'auto_renew_not_supported', 'Domain auto-renew is available for OpenProvider-registered domains only for now.'],
  ['501', 'not_supported / not_implemented / no_credentials', 'The action is not available in this mode (e.g. live domain renewal is not yet wired; cPanel password not on file for an API addon).'],
  ['502', 'provisioning_failed', 'The provider failed to fulfil the request. Any charge is auto-refunded.'],
  ['500', 'internal_error / auth_error', 'Unexpected server error — safe to retry; contact support if persistent.'],
]

// ── HTML escape ──
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── Plan-change guide (hosting + VPS + RDP). Prices are read from the live catalogs so the
//    worked examples never drift from what the API actually charges. ──
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const usd = (n) => `$${r2(n).toFixed(2).replace(/\.00$/, '')}`
function planChangeFacts() {
  const f = { weekly: 30, premium: 75, golden: 100, premiumAddons: 5, rdp: [
    { name: 'Standard', vcpu: 2, ram: 4, disk: 80, m1: 56, m2: 100.8, m3: 142.8 },
    { name: 'Pro', vcpu: 4, ram: 8, disk: 160, m1: 112, m2: 201.6, m3: 285.6 },
    { name: 'Power', vcpu: 8, ram: 16, disk: 320, m1: 224, m2: 403.2, m3: 571.2 },
  ] }
  try {
    const hp = require('./reseller-api').hostingPlans()
    const by = (id) => hp.find((p) => p.id === id)
    if (by('premium-weekly')) f.weekly = by('premium-weekly').priceUsd
    if (by('premium-monthly')) { f.premium = by('premium-monthly').priceUsd; f.premiumAddons = by('premium-monthly').addons }
    if (by('golden-monthly')) f.golden = by('golden-monthly').priceUsd
  } catch (_) { /* static fallback */ }
  try {
    const rdp = require('./digitalocean-rdp-service')
    const price = (slug, m) => { const p = rdp.getProduct(`${slug}-${m}m`); return p && p.pricing ? p.pricing.totalWithMarkup : null }
    const rows = (rdp.TIERS || []).map((t) => ({ name: t.name, vcpu: t.vcpu, ram: t.ram_gb, disk: t.disk_gb, m1: price(t.slug, 1), m2: price(t.slug, 2), m3: price(t.slug, 3) }))
    if (rows.length && rows.every((x) => x.m1 && x.m2 && x.m3)) f.rdp = rows
  } catch (_) { /* static fallback */ }
  return f
}

function planChangeGuide(base) {
  const f = planChangeFacts()
  const credit5 = r2(f.weekly * 5 / 7)
  const credit14 = r2(f.weekly * 14 / 7)
  const [std, pro] = [f.rdp[0], f.rdp[1] || f.rdp[0]]
  const rdpUp = r2((pro.m1 - std.m1) * 60 / 30)
  const examples = `# Weekly (${usd(f.weekly)} / 7 days) with 5 days left  ->  Golden Monthly (${usd(f.golden)})
unused_credit_usd = ${f.weekly} x 5 / 7           = ${credit5.toFixed(2)}
charge_now_usd    = ${f.golden} - ${credit5.toFixed(2)}          = ${r2(f.golden - credit5).toFixed(2)}
expires_at        = today + 30 days       (billing: "new_term")

# Same weekly account  ->  Premium Monthly (${usd(f.premium)})
charge_now_usd    = ${f.premium} - ${credit5.toFixed(2)}           = ${r2(f.premium - credit5).toFixed(2)}   (expires today + 30 days)

# Largest possible weekly credit (renewed with 7 days left -> 14 days held)
unused_credit_usd = ${f.weekly} x 14 / 7          = ${credit14.toFixed(2)}   (always below a monthly price)

# Premium Monthly with 15 days left  ->  Golden Monthly
charge_now_usd    = (${f.golden} - ${f.premium}) x 15 / 30    = ${r2((f.golden - f.premium) * 15 / 30).toFixed(2)}
expires_at        = unchanged             (billing: "pro_rata")

# Golden Monthly  ->  Premium Monthly
charge_now_usd    = 0, refund_usd = 0, expires_at unchanged, next renewal ${usd(f.premium)}`
  const rdpExample = `# ${std.name} RDP on a 3-month term, 60 days left  ->  ${pro.name}
charge_now_usd    = (${pro.m1} - ${std.m1}) x 60 / 30   = ${rdpUp.toFixed(2)}
term end date     = unchanged
next renewal      = ${pro.name}, 3 months = ${usd(pro.m3)}  (the 3-month bundle discount is kept)

# ${pro.name} RDP (CPU/RAM-only upgrade earlier, disk still ${std.disk} GB)  ->  back to ${std.name}
charge_now_usd    = 0, refund_usd = 0, next renewal = ${std.name} for the same term length`
  const flow = `# 1. Show what is possible (only offer options with "allowed": true)
curl -s ${base}/hosting/mysite01/plan-options -H "Authorization: Bearer YOUR_API_KEY"

# 2. Pre-flight the exact charge: nothing is charged or changed (safe on a live key)
curl -s -X POST ${base}/hosting/mysite01/change-plan \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"plan_id":"golden-monthly","dry_run":true}'

# 3. Apply it
curl -s -X POST ${base}/hosting/mysite01/change-plan \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"plan_id":"golden-monthly"}'
#    Hosting is synchronous: read result.expires_at + result.renewal_price_usd.
#    VPS / RDP return 202: poll GET /vps/:id (or /rdp/:id) until
#    plan_change.status is "completed" or "failed" (failed = auto-refunded).

# 4. Optional: react to webhooks instead of polling
#    hosting.plan_changed | vps.plan_changed | vps.plan_change_failed | rdp.plan_changed | rdp.plan_change_failed`
  const hooks = `{ "event": "hosting.plan_changed", "product": "hosting", "occurred_at": "2026-10-10T09:00:00.000Z",
  "data": { "id": "mysite01", "username": "mysite01", "domain": "mysite.com",
    "direction": "upgrade", "billing": "new_term",
    "from_plan": "premium-weekly", "to_plan": "golden-monthly", "to_plan_name": "Golden Anti-Red HostPanel (1-Month)",
    "charged_usd": ${r2(f.golden - credit5)}, "unused_credit_usd": ${credit5}, "refund_usd": 0,
    "previous_expires_at": "2026-10-15T09:00:00.000Z", "expires_at": "2026-11-09T09:00:00.000Z",
    "renewal_price_usd": ${f.golden}, "via": "api" } }

{ "event": "rdp.plan_changed", "product": "rdp",
  "data": { "id": "a1b2c3d4-…", "change_id": "9d1e…", "direction": "upgrade", "from_plan": "standard",
    "to_plan": "pro", "to_plan_name": "Pro", "charged_usd": ${rdpUp}, "resize_disk": false, "disk_gb": ${std.disk} } }

{ "event": "vps.plan_change_failed", "product": "vps",
  "data": { "id": "b2f1c0a4-…", "change_id": "…", "direction": "upgrade", "from_plan": "s-2vcpu-4gb-amd",
    "to_plan": "s-4vcpu-8gb-amd", "charged_usd": 34.35, "reason": "Resize errored.", "refunded": true, "refund_usd": 34.35 } }`
  const ERR = [
    ['400', 'missing_plan_id / invalid_plan', 'plan_id missing, or not one of the current plan-options.', 'Re-read plan-options and send one of its plan_id values.'],
    ['400', 'same_plan', 'The resource is already on that plan.', 'Nothing to do.'],
    ['400', 'invalid_resize_disk', 'VPS/RDP: resize_disk is not true/false.', 'Send a boolean.'],
    ['402', 'insufficient_wallet_balance', 'The wallet is below charge_now_usd (response has shortfall_usd).', 'Top up the wallet, then retry.'],
    ['409', 'weekly_downgrade_not_allowed', 'Hosting: a monthly plan asked for the weekly plan.', 'Not possible. Offer Premium Monthly <-> Golden Monthly instead.'],
    ['409', 'too_many_addon_domains', 'Hosting: Golden -> Premium while the account has more addon domains than Premium allows.', 'Remove addon domains first.'],
    ['409', 'disk_too_small', 'VPS/RDP: the target plan\u2019s disk is smaller than the server\u2019s disk (disks never shrink).', 'Pick a plan with an equal or bigger disk.'],
    ['409', 'plan_change_in_progress', 'Another change for the same account/server is still running.', 'Hosting: retry after a few seconds. VPS/RDP: poll GET /vps|rdp/:id.'],
    ['409', 'expired', 'The current term has ended.', 'Renew first, then change the plan.'],
    ['409', 'term_ending_soon', 'VPS/RDP: less than 1 hour is left in the term.', 'Renew first, then change the plan.'],
    ['409', 'account_suspended', 'Hosting: the account is suspended.', 'POST /hosting/:user/unsuspend first.'],
    ['409', 'not_active / account_terminated / unknown_plan', 'The resource is not running, was terminated, or is on a plan that cannot be changed automatically.', 'Contact support if unexpected.'],
    ['501', 'not_supported', 'VPS/RDP: the server is not on DigitalOcean.', 'Plan changes are DigitalOcean-only.'],
    ['502', 'provisioning_failed / plan_change_failed', 'The provider refused the change.', 'Any charge is refunded automatically; safe to retry.'],
  ]
  const errRows = ERR.map(([s, c, w, d]) => `<tr><td class="st">${s}</td><td><code>${esc(c)}</code></td><td>${esc(w)}</td><td>${esc(d)}</td></tr>`).join('')
  const rdpRows = f.rdp.map((t) => `<tr><td><b>${esc(t.name)}</b><br><span class="muted">${t.vcpu} vCPU / ${t.ram} GB / ${t.disk} GB</span></td><td>${usd(t.m1)}</td><td>${usd(t.m2)} <span class="muted">(-10%)</span></td><td>${usd(t.m3)} <span class="muted">(-15%)</span></td></tr>`).join('')
  return `
    <section id="plan-changes" class="grp">
      <h2>Plan changes (upgrade / downgrade)</h2>
      <p class="grp-blurb">How switching plans works for hosting, VPS and RDP: what changes, what never changes, the exact pricing formulas, worked examples and the safe integration flow.</p>

      <div class="card">
        <h3>The rule: a plan change swaps resources, not the billing term</h3>
        <table class="ptable">
          <thead><tr><th></th><th>Hosting Premium &harr; Golden</th><th>Hosting Weekly &rarr; Monthly</th><th>VPS / RDP</th></tr></thead>
          <tbody>
            <tr><td><b>What changes</b></td><td>Package, features, addon-domain quota</td><td>Plan <b>and</b> billing cycle (one way only)</td><td>CPU / RAM (disk optional) on the <b>same</b> server: same ID, IP, data and login</td></tr>
            <tr><td><b>Expiry date</b></td><td class="yes">Never moves</td><td>Fresh 30-day term from today</td><td class="yes">Never moves</td></tr>
            <tr><td><b>Term length</b></td><td>Stays 30 days</td><td>7 days &rarr; 30 days</td><td>Stays the same (RDP 1, 2 or 3 months)</td></tr>
            <tr><td><b>Charged now</b></td><td>Upgrade: pro-rata difference. Downgrade: $0</td><td>Monthly price &minus; unused weekly credit</td><td>Upgrade: pro-rata difference. Downgrade: $0</td></tr>
            <tr><td><b>Refunds</b></td><td>None</td><td>None (the unused days are credited)</td><td>None</td></tr>
            <tr><td><b>Next renewal</b></td><td>New plan price</td><td>New plan price, 30 days</td><td>New plan price for the <b>same</b> term length</td></tr>
          </tbody>
        </table>
        <p class="note">Because the term length never changes (and weekly can only move <i>up</i> to monthly), there is no expiry recalculation that can drift. Moving a monthly plan down to weekly is never allowed for exactly this reason.</p>
      </div>

      <div class="card">
        <h3>Hosting: allowed switches</h3>
        <table class="ptable">
          <thead><tr><th>From &rarr; To</th><th>Allowed</th><th>Charged now</th><th>Expiry after the change</th></tr></thead>
          <tbody>
            <tr><td>Weekly &rarr; Premium Monthly</td><td class="yes">Yes</td><td>${usd(f.premium)} &minus; unused weekly credit</td><td>Today + 30 days</td></tr>
            <tr><td>Weekly &rarr; Golden Monthly</td><td class="yes">Yes</td><td>${usd(f.golden)} &minus; unused weekly credit</td><td>Today + 30 days</td></tr>
            <tr><td>Premium Monthly &rarr; Golden Monthly</td><td class="yes">Yes</td><td>(${usd(f.golden)} &minus; ${usd(f.premium)}) &times; days left &divide; 30</td><td>Unchanged</td></tr>
            <tr><td>Golden Monthly &rarr; Premium Monthly</td><td class="yes">Yes</td><td>$0 (no refund). Blocked while the account has more than ${esc(f.premiumAddons)} addon domains</td><td>Unchanged</td></tr>
            <tr><td>Premium / Golden Monthly &rarr; Weekly</td><td class="no">Never</td><td>&mdash;</td><td>Not listed in plan-options; a request returns <code>409 weekly_downgrade_not_allowed</code></td></tr>
          </tbody>
        </table>
        <ul class="muted" style="margin-top:12px">
          <li><b>Unused weekly credit</b> = weekly price &times; days left &divide; 7. The weekly price is the account&rsquo;s price-locked renewal price (e.g. a promo price), otherwise the list price (${usd(f.weekly)}).</li>
          <li>Weekly renewals are capped (see below), so the credit is always less than a monthly price and the customer always gets exactly 30 days.</li>
          <li>Safety net for weekly accounts that were renewed several weeks ahead before the cap existed: if the credit is worth more than the monthly price, $0 is charged and the credit is turned into days on the new plan (never fewer than 30). <code>new_term_days</code> shows the exact length.</li>
          <li>Every option in plan-options carries <code>billing</code> (<code>pro_rata</code> | <code>new_term</code>), <code>charge_now_usd</code>, <code>unused_credit_usd</code>, <code>expiry_changes</code> and <code>expires_at</code> (the expiry <i>after</i> the change), so you never have to compute anything yourself.</li>
        </ul>
        <div class="ctitle" style="margin-top:16px"><span>Worked examples</span><button class="copy">Copy</button></div>
        <pre class="code"><code>${esc(examples)}</code></pre>
      </div>

      <div class="card">
        <h3>Hosting: weekly renewals</h3>
        <ul class="muted">
          <li>A weekly plan renews <b>one week at a time</b>: <code>periods</code> must be 1, otherwise <code>400 weekly_single_period_only</code>.</li>
          <li>It can only be renewed once <b>7 days or fewer</b> are left. Earlier requests return <code>409 weekly_renew_too_early</code> with <code>renew_available_at</code>. This applies to the API and the Telegram bot.</li>
          <li><code>GET /hosting/:user</code> and <code>GET /renewals</code> show <code>renewable: false</code>, <code>renew_blocked_reason: "weekly_renew_too_early"</code> and <code>renew_available_at</code>, so you can grey out a Renew button until then.</li>
          <li>Monthly plans can still prepay up to 12 periods. To give a weekly customer longer, switch them to a monthly plan.</li>
        </ul>
      </div>

      <div class="card">
        <h3>VPS &amp; RDP: the same server, resized in place</h3>
        <ul class="muted">
          <li>A plan change never creates a new server. The DigitalOcean droplet is powered off, resized and powered back on, keeping the same ID, IP, data and credentials. Downtime is about 2-5 minutes (CPU/RAM only), and longer when the disk also grows.</li>
          <li><b>Upgrade, charged now</b> = (new monthly price &minus; current monthly price) &times; days left &divide; 30. This uses the 1-month prices, also on 2- and 3-month RDP terms. <b>Downgrade</b> = $0 with no refund. A same-price <b>switch</b> (e.g. AMD &harr; Intel) = $0.</li>
          <li>The term end date and term length never change. <code>renewal_price_usd</code> is the new plan&rsquo;s price for the <b>same</b> term length; for RDP that is the 1-, 2- or 3-month bundle the server is on, with the bundle discount kept.</li>
          <li><b>Disk:</b> by default only CPU/RAM change, which keeps later downgrades possible. <code>resize_disk: true</code> also grows the disk, which is <b>permanent</b>: DigitalOcean disks can never shrink. Plans with a smaller disk than the server&rsquo;s current disk are returned with <code>allowed: false</code> and <code>blocked_reason: "disk_too_small"</code>. A server first bought on a large disk can never move below it.</li>
          <li>Windows RDP automatically extends the C: drive to the full disk on the next boot after a disk resize.</li>
          <li>Requires an active, unexpired server with at least <b>1 hour</b> left in the term (<code>409 term_ending_soon</code>), so a resize never overlaps renewal or expiry processing.</li>
          <li>Asynchronous: <code>202</code> with <code>plan_change.status: "running"</code>. Poll the server until it is <code>completed</code> or <code>failed</code>; a failed change is refunded automatically and the server stays on its old plan.</li>
        </ul>
        <table class="ptable" style="margin-top:14px">
          <thead><tr><th>RDP tier</th><th>1 month</th><th>2 months</th><th>3 months</th></tr></thead>
          <tbody>${rdpRows}</tbody>
        </table>
        <div class="ctitle" style="margin-top:16px"><span>Worked examples</span><button class="copy">Copy</button></div>
        <pre class="code"><code>${esc(rdpExample)}</code></pre>
      </div>

      <div class="card">
        <h3>Recommended integration flow</h3>
        <div class="ctitle"><span>Shell</span><button class="copy">Copy</button></div>
        <pre class="code"><code>${esc(flow)}</code></pre>
        <ul class="muted" style="margin-top:12px">
          <li>Always fetch plan-options right before showing prices: charges depend on the days left, so never hard-code them.</li>
          <li>Only one change per account/server can run at a time. Two simultaneous requests can never both charge; the second gets <code>409 plan_change_in_progress</code>.</li>
          <li>Two simultaneous renewals of the same hosting account are applied once; the other is refunded automatically (<code>502 provisioning_failed</code>, <code>refunded: true</code>).</li>
          <li>Auto-renew never runs in the middle of a plan change: it waits for the change to finish and renews at the new plan&rsquo;s price.</li>
        </ul>
      </div>

      <div class="card" style="padding:6px 14px 14px">
        <h3 style="margin:14px 0 10px">Plan-change errors</h3>
        <table class="etable">
          <thead><tr><th>HTTP</th><th>error</th><th>When</th><th>What to do</th></tr></thead>
          <tbody>${errRows}</tbody>
        </table>
        <p class="muted" style="margin:10px 0 0">Every error is returned <b>before</b> any money moves. Renewal-only errors: <code>400 weekly_single_period_only</code>, <code>409 weekly_renew_too_early</code>.</p>
      </div>

      <div class="card">
        <h3>Plan-change history</h3>
        <ul class="muted">
          <li>Every change is kept: <code>GET /plan-changes</code> (whole account; filter by <code>product</code>, <code>since</code>, <code>until</code>, <code>status</code>, <code>via</code>, paginated) or per item: <code>GET /hosting/:user/plan-changes</code>, <code>GET /vps/:id/plan-changes</code>, <code>GET /rdp/:id/plan-changes</code>.</li>
          <li>It includes changes your customers make in the Telegram bot (<code>via: "bot"</code>), failed VPS/RDP resizes with their refund (<code>status: "failed"</code>, <code>reason</code>, <code>refund_usd</code>) and resizes still running (<code>status: "running"</code>).</li>
          <li>Older changes made before full history recording existed appear as best-effort entries with <code>legacy: true</code> (fewer fields; unknown values are <code>null</code>).</li>
          <li>Use it to reconcile webhooks you may have missed, and for audit and billing reports.</li>
        </ul>
      </div>

      <div class="card">
        <h3>Webhooks for plan changes</h3>
        <p class="muted" style="margin:0 0 10px"><code>hosting.plan_changed</code> fires when a hosting plan change made through the API is applied. <code>vps.plan_changed</code> / <code>rdp.plan_changed</code> fire when a resize finishes, and <code>vps.plan_change_failed</code> / <code>rdp.plan_change_failed</code> when it fails (charge refunded). Each change is delivered once, signed like every other event.</p>
        <div class="ctitle"><span>Example payloads</span><button class="copy">Copy</button></div>
        <pre class="code"><code>${esc(hooks)}</code></pre>
      </div>
    </section>`
}

function methodBadge(m) {
  return `<span class="m m-${m.toLowerCase()}">${m}</span>`
}

// ── Auto-generate Node.js (fetch) + Python (requests) snippets from the cURL ──
function parseCurl(curl) {
  const src = String(curl).replace(/\\\n\s*/g, ' ')
  const methodM = src.match(/-X\s+([A-Z]+)/)
  const method = methodM ? methodM[1] : 'GET'
  const urlM = src.match(/curl\s+-s\s+(?:"([^"]+)"|(\S+))/)
  const url = urlM ? (urlM[1] || urlM[2]) : ''
  const bodyM = src.match(/-d\s+'([^']*)'/)
  const body = bodyM ? bodyM[1] : null
  const hasAuth = /Authorization:\s*Bearer|X-API-Key/i.test(src)
  return { method, url, body, hasAuth }
}
function prettyJson(body) {
  try { return JSON.stringify(JSON.parse(body), null, 2) } catch (e) { return body }
}
function indentCont(s, pad) {
  return s.split('\n').map((l, i) => (i === 0 ? l : pad + l)).join('\n')
}
function toNode({ method, url, body, hasAuth }) {
  const headers = []
  if (hasAuth) headers.push('    "Authorization": "Bearer YOUR_API_KEY"')
  if (body) headers.push('    "Content-Type": "application/json"')
  const opts = [`  method: "${method}"`]
  if (headers.length) opts.push(`  headers: {\n${headers.join(',\n')}\n  }`)
  if (body) opts.push(`  body: JSON.stringify(${indentCont(prettyJson(body), '  ')})`)
  return `const res = await fetch("${url}", {\n${opts.join(',\n')}\n});\nconst data = await res.json();\nconsole.log(data);`
}
function toPython({ method, url, body, hasAuth }) {
  const kwargs = []
  if (hasAuth) kwargs.push('headers={"Authorization": "Bearer YOUR_API_KEY"}')
  if (body) {
    const py = prettyJson(body).replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None')
    kwargs.push('json=' + indentCont(py, '    '))
  }
  let call = `res = requests.${method.toLowerCase()}("${url}"`
  if (kwargs.length) call += ',\n    ' + kwargs.join(',\n    ')
  call += ')'
  return `import requests\n\n${call}\nprint(res.json())`
}
function renderSnippets(ep) {
  const p = parseCurl(ep.curl)
  return `
    <div class="req-tabs">
      <button class="tab" data-lang="curl">cURL</button>
      <button class="tab" data-lang="node">Node.js</button>
      <button class="tab" data-lang="python">Python</button>
      <button class="copy snippet-copy">Copy</button>
    </div>
    <pre class="code snippet s-curl"><code>${esc(ep.curl)}</code></pre>
    <pre class="code snippet s-node"><code>${esc(toNode(p))}</code></pre>
    <pre class="code snippet s-python"><code>${esc(toPython(p))}</code></pre>`
}

const epAnchor = (method, path) => `ep-${method}-${path}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')

// "What's new" changelog, newest first. Each link is [METHOD, path] of a documented endpoint or ['#', anchor, label].
const WHATS_NEW = [
  {
    date: '2026-10-10', title: 'One-click WordPress',
    text: 'Install WordPress on a hosting account in one call. The install runs in the background (state installing → ready | failed, usually 1–3 minutes) and creates its own MySQL database and admin login. The ready app returns the admin password; reset it any time. New webhooks: hosting.app_installed and hosting.app_install_failed. Your customers get the same installer in the new "Apps" tab of the HostPanel.',
    links: [['GET', '/hosting/:user/apps'], ['POST', '/hosting/:user/apps'], ['GET', '/hosting/:user/apps/:app_id'], ['POST', '/hosting/:user/apps/:app_id/admin-password']],
  },
  {
    date: '2026-10-10', title: 'Short-link analytics, smart routing and QR codes',
    text: 'Click stats for all your links in one call, or for one link, broken down by day, country, device and referrer (kept 90 days). Route visitors to different URLs by country or device. Get a QR code for any link as PNG or SVG. Detailed stats are recorded only for links created through this API.',
    links: [['GET', '/shortener/links/stats'], ['GET', '/shortener/links/:slug/stats'], ['PUT', '/shortener/links/:slug/routing'], ['GET', '/shortener/links/:slug/qr']],
  },
  {
    date: '2026-10-10', title: 'MySQL on the weekly plan',
    text: 'The weekly plan now includes 2 MySQL databases (Premium monthly 5, Golden unlimited), so WordPress runs on it too. The 403 mysql_requires_monthly error no longer happens.',
    links: [['GET', '/hosting/plans'], ['GET', '/hosting/:user/mysql/databases'], ['POST', '/hosting/:user/mysql/databases']],
  },
  {
    date: '2026-10-10', title: 'Prepaid 3, 6 and 12-month hosting terms',
    text: 'Pass months (1, 3, 6 or 12) when you create or renew a monthly hosting plan for 10%, 15% or 25% off. GET /hosting/plans lists every term price. Auto-renew repeats the same term at the same discount. The weekly plan is still one week at a time.',
    links: [['GET', '/hosting/plans'], ['POST', '/hosting'], ['POST', '/hosting/:user/renew']],
  },
  {
    date: '2026-10-10', title: 'Per-domain auto-renew',
    text: 'Turn on wallet auto-renew for a single OpenProvider domain (off by default). From 7 days before expiry it renews for 1 year and charges your wallet, retrying daily until expiry. GET /domains shows the auto-renew status and next charge. New webhook: domain.auto_renew_failed.',
    links: [['POST', '/domains/:domain/auto-renew'], ['GET', '/domains']],
  },
  {
    date: '2026-10-10', title: 'Alert webhooks and activity log',
    text: 'Push alerts so nothing expires by surprise: expiry reminders 7, 3 and 1 day before, renewed, unsuspended, site down / recovered, usage thresholds and low wallet balance. Live origin health for each hosting account, and a 90-day change log of everything you own (who did what: API, bot, panel or system).',
    links: [['GET', '/account/alerts'], ['PUT', '/account/alerts'], ['GET', '/hosting/:user/health'], ['GET', '/activity'], ['PUT', '/account/webhook']],
  },
  {
    date: '2026-10-08', title: 'In-place plan changes',
    text: 'Upgrade or downgrade a VPS, RDP or hosting plan in place: same server, data, IP and logins. Upgrades are charged pro-rata for the days left; downgrades apply immediately with no refund; the term end date never moves. Past changes are listed per account.',
    links: [['#', 'plan-changes', 'Plan changes guide'], ['GET', '/vps/:id/plan-options'], ['POST', '/vps/:id/upgrade'], ['GET', '/rdp/:id/plan-options'], ['POST', '/rdp/:id/upgrade'], ['GET', '/hosting/:user/plan-options'], ['POST', '/hosting/:user/upgrade'], ['GET', '/hosting/:user/plan-changes']],
  },
  {
    date: '2026-10-08', title: 'VPS and RDP usage',
    text: 'CPU, memory, disk and bandwidth for a DigitalOcean VPS or RDP over the last 1h, 24h, 7d or 30d: current value, average and peak.',
    links: [['GET', '/vps/:id/usage'], ['GET', '/rdp/:id/usage']],
  },
]

function whatsNewSection(groups) {
  const known = new Set(groups.flatMap(g => g.endpoints.map(ep => epAnchor(ep.method, ep.path))))
  const link = ([m, p, label]) => {
    if (m === '#') return `<a class="wn-link wn-guide" href="#${p}">${esc(label)}</a>`
    const id = epAnchor(m, p)
    if (!known.has(id)) throw new Error(`apidoc WHATS_NEW links an undocumented endpoint: ${m} ${p}`)
    return `<a class="wn-link" href="#${id}"><span class="nm nm-${m.toLowerCase()}">${m}</span>${esc(p)}</a>`
  }
  const items = WHATS_NEW.map((w, i) => `
        <li class="wn-item" data-testid="whats-new-item-${i}">
          <div class="wn-head"><span class="wn-date">${esc(w.date)}</span><h3>${esc(w.title)}</h3></div>
          <p class="muted">${esc(w.text)}</p>
          <div class="wn-links">${w.links.map(link).join('')}</div>
        </li>`).join('')
  return `
    <section id="whats-new" class="grp" data-testid="whats-new-section">
      <h2>What's new</h2>
      <p class="grp-blurb">Recent additions to the API, newest first. Every change is backward-compatible: existing calls keep working as before. Click an endpoint to jump to its full docs.</p>
      <div class="card wn-card"><ol class="wn-list">${items}
      </ol></div>
    </section>`
}

function renderEndpoint(base, ep) {
  const badges = []
  badges.push(ep.auth ? '<span class="tag tag-auth">API key</span>' : '<span class="tag tag-open">No auth</span>')
  if (ep.billed) badges.push('<span class="tag tag-billed">Wallet-billed</span>')
  const params = (ep.params && ep.params.length)
    ? `<div class="ptitle">Parameters</div>
       <table class="ptable"><thead><tr><th>Name</th><th>Required</th><th>Description</th></tr></thead>
       <tbody>${ep.params.map(([n, r, d]) => `<tr><td><code>${esc(n)}</code></td><td>${r ? '<span class="req">required</span>' : '<span class="opt">optional</span>'}</td><td>${esc(d)}</td></tr>`).join('')}</tbody></table>`
    : ''
  return `
  <div class="ep" id="${epAnchor(ep.method, ep.path)}">
    <div class="ep-head">
      ${methodBadge(ep.method)}
      <code class="ep-path">${esc(ep.path)}</code>
      <span class="ep-badges">${badges.join('')}</span>
    </div>
    <p class="ep-desc">${esc(ep.desc)}</p>
    ${params}
    <div class="cols">
      <div class="col">
        <div class="ctitle">Request</div>
        ${renderSnippets(ep)}
      </div>
      <div class="col">
        <div class="ctitle">Response<button class="copy" data-code="resp">Copy</button></div>
        <pre class="code"><code>${esc(ep.resp)}</code></pre>
      </div>
    </div>
  </div>`
}

function renderApiDocPage(baseUrl) {
  const base = baseUrl || 'https://2.speechcue.com/reseller/v1'
  const groups = endpointGroups(base)

  const nav = groups.map(g =>
    `<a class="nav-group" href="#${g.id}">${esc(g.title)}</a>` +
    `<div class="nav-eps">${g.endpoints.map(ep => `<a href="#${g.id}" class="nav-ep"><span class="nm nm-${ep.method.toLowerCase()}">${ep.method}</span>${esc(ep.path)}</a>`).join('')}</div>`
  ).join('')

  const sections = groups.map(g => `
    <section id="${g.id}" class="grp">
      <h2>${esc(g.title)}</h2>
      <p class="grp-blurb">${esc(g.blurb)}</p>
      ${g.endpoints.map(ep => renderEndpoint(base, ep)).join('')}
    </section>`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(BRAND)} Reseller API — Developer Guide</title>
<meta name="description" content="Developer documentation for the ${esc(BRAND)} Reseller REST API: programmatically resell domains, DNS, VPS, RDP and cPanel hosting.">
<style>
  :root{
    --bg:#0a0b0d; --panel:#111318; --panel2:#16181f; --border:#242833;
    --text:#e6e8ee; --muted:#98a0ad; --accent:#10b981; --accent2:#34d399;
    --get:#34d399; --post:#60a5fa; --put:#fbbf24; --delete:#f87171; --patch:#c084fc;
    --code-bg:#0d0f14;
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;overflow-x:hidden}
  a{color:inherit;text-decoration:none}
  code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .layout{display:flex;min-height:100vh}
  /* Sidebar */
  aside{width:290px;flex-shrink:0;background:var(--panel);border-right:1px solid var(--border);position:sticky;top:0;height:100vh;overflow-y:auto;padding:22px 14px}
  .brand{display:flex;align-items:center;gap:10px;padding:4px 8px 18px;margin-bottom:8px;border-bottom:1px solid var(--border)}
  .logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--accent),#0ea5e9);display:flex;align-items:center;justify-content:center;font-weight:800;color:#04121a}
  .brand b{font-size:16px}.brand span{display:block;font-size:11px;color:var(--muted);font-weight:500}
  .nav-group{display:block;padding:9px 10px;margin-top:8px;font-weight:700;border-radius:8px;color:var(--text)}
  .nav-group:hover{background:var(--panel2)}
  .nav-eps{display:flex;flex-direction:column;gap:1px;margin:2px 0 6px 6px;border-left:1px solid var(--border);padding-left:8px}
  .nav-ep{display:flex;align-items:center;gap:8px;padding:5px 8px;font-size:12.5px;color:var(--muted);border-radius:6px;font-family:ui-monospace,monospace}
  .nav-ep:hover{background:var(--panel2);color:var(--text)}
  .nm{font-size:9.5px;font-weight:800;letter-spacing:.4px;min-width:38px}
  .nm-get{color:var(--get)}.nm-post{color:var(--post)}.nm-put{color:var(--put)}.nm-delete{color:var(--delete)}.nm-patch{color:var(--patch)}
  /* Main */
  main{flex:1;min-width:0;width:100%;max-width:1000px;padding:40px 46px 90px}
  .hero h1{font-size:34px;margin:0 0 6px;letter-spacing:-.5px}
  .hero .sub{color:var(--muted);font-size:16px;margin:0 0 22px}
  .pill{display:inline-flex;align-items:center;gap:7px;background:var(--panel2);border:1px solid var(--border);border-radius:999px;padding:5px 13px;font-size:12.5px;color:var(--muted);margin:0 8px 8px 0}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px rgba(16,185,129,.2)}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:20px 22px;margin:20px 0}
  .card h3{margin:0 0 10px;font-size:17px}
  .baseurl{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--code-bg);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-family:ui-monospace,monospace;font-size:14px;flex-wrap:wrap}
  .baseurl b{color:var(--accent2)}
  .muted{color:var(--muted)}
  .grp{margin-top:52px;scroll-margin-top:20px}
  .grp>h2{font-size:24px;margin:0 0 4px;padding-bottom:8px}
  .grp-blurb{color:var(--muted);margin:0 0 18px}
  .ep{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin:16px 0}
  .ep-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .m{font-size:11px;font-weight:800;letter-spacing:.5px;padding:4px 9px;border-radius:7px;color:#04121a}
  .m-get{background:var(--get)}.m-post{background:var(--post)}.m-put{background:var(--put)}.m-delete{background:var(--delete)}.m-patch{background:var(--patch)}
  .ep-path{font-size:15px;font-weight:600}
  .ep-badges{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
  .tag{font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid var(--border);color:var(--muted)}
  .tag-auth{border-color:#334155;color:#93c5fd}
  .tag-open{border-color:#334155;color:#86efac}
  .tag-billed{border-color:#7c5e12;color:var(--put);background:rgba(251,191,36,.08)}
  .ep-desc{color:var(--text);margin:14px 0}
  .ptitle,.ctitle{font-size:12px;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);margin:14px 0 7px;display:flex;align-items:center;justify-content:space-between}
  .ptable{width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:6px}
  .ptable th{text-align:left;color:var(--muted);font-weight:600;border-bottom:1px solid var(--border);padding:6px 8px}
  .ptable td{border-bottom:1px solid var(--border);padding:7px 8px;vertical-align:top}
  .ptable code{background:var(--code-bg);padding:2px 6px;border-radius:5px;color:var(--accent2)}
  .req{color:var(--delete);font-size:12px}.opt{color:var(--muted);font-size:12px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px;min-width:0}
  .col{min-width:0}
  .baseurl,.ep,.card,.grp,.hero{min-width:0;max-width:100%}
  .code{background:var(--code-bg);border:1px solid var(--border);border-radius:10px;padding:14px;overflow:auto;font-size:12.8px;margin:0;white-space:pre}
  .copy{background:var(--panel2);border:1px solid var(--border);color:var(--muted);font-size:11px;padding:3px 10px;border-radius:6px;cursor:pointer}
  .copy:hover{color:var(--text);border-color:var(--accent)}
  .copy.done{color:var(--accent2);border-color:var(--accent)}
  .req-tabs{display:flex;align-items:center;gap:4px;margin-bottom:7px}
  .tab{background:transparent;border:1px solid transparent;color:var(--muted);font-size:12px;font-weight:600;padding:4px 11px;border-radius:7px;cursor:pointer}
  .tab:hover{color:var(--text)}
  .snippet-copy{margin-left:auto}
  .snippet{display:none}
  body[data-lang="curl"] .s-curl,body[data-lang="node"] .s-node,body[data-lang="python"] .s-python{display:block}
  body[data-lang="curl"] .tab[data-lang="curl"],body[data-lang="node"] .tab[data-lang="node"],body[data-lang="python"] .tab[data-lang="python"]{background:var(--panel2);border-color:var(--border);color:var(--accent2)}
  .etable{width:100%;border-collapse:collapse;font-size:13.5px}
  .etable th{text-align:left;color:var(--muted);border-bottom:1px solid var(--border);padding:8px}
  .etable td{border-bottom:1px solid var(--border);padding:9px 8px;vertical-align:top}
  .etable .st{font-family:ui-monospace,monospace;font-weight:700;color:var(--put)}
  .etable code{color:var(--delete);background:var(--code-bg);padding:2px 6px;border-radius:5px}
  footer{margin-top:60px;padding-top:22px;border-top:1px solid var(--border);color:var(--muted);font-size:13px}
  .menu-btn{display:none}
  .ptable .yes{color:var(--get);font-weight:700}.ptable .no{color:var(--delete);font-weight:700}
  .note{border-left:3px solid var(--accent);background:var(--panel2);padding:10px 14px;border-radius:8px;margin:14px 0 0;color:var(--muted);font-size:14px}
  .card ul{margin:0;padding-left:18px}.card li{margin:5px 0}
  #plan-changes .card code{background:var(--code-bg);padding:1px 6px;border-radius:5px;color:var(--accent2)}
  #plan-changes .card pre code{background:none;padding:0;color:inherit}
  #plan-changes .etable code{color:var(--delete)}
  .ptable td,.etable td{word-break:break-word}
  .ep{scroll-margin-top:20px;transition:border-color .3s,box-shadow .3s}
  .ep:target{border-color:var(--accent);box-shadow:0 0 0 3px rgba(16,185,129,.18)}
  .pill-new{color:var(--accent2);border-color:rgba(16,185,129,.45);transition:background-color .2s}
  .pill-new:hover{background:rgba(16,185,129,.12)}
  .wn-card{padding:6px 22px}
  .wn-list{list-style:none;margin:0;padding:0}
  .wn-item{padding:18px 0;border-bottom:1px solid var(--border)}
  .wn-item:last-child{border-bottom:0}
  .wn-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
  .wn-head h3{margin:0;font-size:16px}
  .wn-date{font-family:ui-monospace,monospace;font-size:12px;color:var(--accent2);background:var(--code-bg);border:1px solid var(--border);border-radius:6px;padding:1px 8px}
  .wn-item p{margin:8px 0 10px;font-size:14px}
  .wn-links{display:flex;flex-wrap:wrap;gap:6px}
  .wn-link{display:inline-flex;align-items:center;gap:7px;font-family:ui-monospace,monospace;font-size:12px;color:var(--muted);background:var(--panel2);border:1px solid var(--border);border-radius:7px;padding:4px 9px;transition:color .15s,border-color .15s}
  .wn-link:hover{color:var(--text);border-color:var(--accent)}
  .wn-link .nm{min-width:0}
  .wn-guide{color:var(--accent2);font-family:inherit}
  @media(max-width:920px){
    .ep,.card{overflow-x:auto}
    aside{position:fixed;left:0;top:0;z-index:40;transform:translateX(-100%);transition:transform .2s}
    aside.open{transform:none}
    .menu-btn{display:inline-flex;position:fixed;top:14px;right:14px;z-index:50;background:var(--panel);border:1px solid var(--border);color:var(--text);border-radius:9px;padding:9px 13px;cursor:pointer;font-size:14px}
    main{padding:64px 20px 80px}
    .cols{grid-template-columns:1fr}
    .hero h1{font-size:27px}
  }
</style>
</head>
<body data-lang="curl">
<button class="menu-btn" id="menuBtn">☰ Menu</button>
<div class="layout">
  <aside id="side">
    <div class="brand">
      <div class="logo">${esc(BRAND.slice(0, 1).toUpperCase())}</div>
      <div><b>${esc(BRAND)} Reseller API</b><span>Developer Guide · v1</span></div>
    </div>
    <a class="nav-group" href="#intro">Introduction</a>
    <a class="nav-group" href="#whats-new" data-testid="nav-whats-new">What's new</a>
    <a class="nav-group" href="#auth">Authentication</a>
    <a class="nav-group" href="#billing">Billing &amp; Modes</a>
    <a class="nav-group" href="#plan-changes">Plan changes</a>
    ${nav}
    <a class="nav-group" href="#errors">Errors</a>
  </aside>

  <main>
    <div class="hero">
      <h1>${esc(BRAND)} Reseller API</h1>
      <p class="sub">One REST API to programmatically resell domains, DNS, VPS, RDP and cPanel hosting.</p>
      <div>
        <span class="pill"><span class="dot"></span> Base URL: <b>&nbsp;${esc(base)}</b></span>
        <span class="pill">Version v1</span>
        <span class="pill">JSON over HTTPS</span>
        <a class="pill pill-new" href="#whats-new" data-testid="whats-new-badge"><span class="dot"></span> What's new · updated ${esc(WHATS_NEW[0].date)}</a>
      </div>
    </div>

    <section id="intro" class="grp" style="margin-top:34px">
      <h2>Introduction</h2>
      <p class="grp-blurb">The Reseller API lets you build your own storefront or automation on top of ${esc(BRAND)}. Every provisioning call is funded by the wallet of the account your API key is bound to — no separate invoicing.</p>
      <div class="card">
        <h3>Base URL</h3>
        <div class="baseurl"><span><b>${esc(base)}</b></span><button class="copy" data-copy="${esc(base)}">Copy</button></div>
        <p class="muted" style="margin:12px 0 0">All endpoints below are relative to this base. The <code>/api${''}</code>-prefixed form (<code>${esc(base.replace('/reseller/v1', '/api/reseller/v1'))}</code>) is also accepted. All requests and responses are JSON; send <code>Content-Type: application/json</code> on POST/PUT/DELETE bodies.</p>
      </div>
      <div class="card">
        <h3>Quick start</h3>
        <pre class="code"><code># 1. Check the service is up (no key needed)
curl -s ${esc(base)}/health

# 2. Check your wallet balance
curl -s ${esc(base)}/account -H "Authorization: Bearer YOUR_API_KEY"

# 3. See the full bot price catalog
curl -s "${esc(base)}/pricing?region=EU" -H "Authorization: Bearer YOUR_API_KEY"

# 4. Search a domain, then register it
curl -s "${esc(base)}/domains/search?domain=mysite.com" -H "Authorization: Bearer YOUR_API_KEY"</code></pre>
      </div>
    </section>

    ${whatsNewSection(groups)}

    <section id="auth" class="grp">
      <h2>Authentication</h2>
      <p class="grp-blurb">Every endpoint except <code>/health</code> requires your secret API key. Send it in <b>either</b> header:</p>
      <div class="card">
        <pre class="code"><code>Authorization: Bearer YOUR_API_KEY
# — or —
X-API-Key: YOUR_API_KEY</code></pre>
        <p class="muted" style="margin:12px 0 0">Keep your key secret — it can spend your wallet balance. Keys are issued per account; contact <b>${esc(SUPPORT_HANDLE)}</b> on Telegram to request or rotate one. A missing/invalid key returns <code>401</code>.</p>
      </div>
    </section>

    <section id="billing" class="grp">
      <h2>Billing &amp; Modes</h2>
      <p class="grp-blurb">Provisioning endpoints (marked <span class="tag tag-billed">Wallet-billed</span>) debit your account wallet in USD. DNS operations are free.</p>
      <div class="card">
        <h3>How billing works</h3>
        <ul class="muted" style="margin:0;padding-left:18px">
          <li>Your wallet balance is checked <b>before</b> anything happens. If it can't cover the order price the request is refused with <code>402 insufficient_wallet_balance</code> — no resource is created, no funds move, and the response includes <code>price_usd</code>, <code>wallet_balance_usd</code> and the <code>shortfall_usd</code>. This guard applies in <b>both live and dry-run</b> modes.</li>
          <li>When the balance is sufficient, the price is debited <b>atomically</b> (overdraft-safe) and only then is the resource provisioned.</li>
          <li>If the provider fails after the charge, the amount is <b>automatically refunded</b> and you get <code>502 provisioning_failed</code> with <code>"refunded": true</code>.</li>
          <li>Successful billed responses include <code>charged_usd</code> and your new <code>wallet_balance_usd</code>.</li>
        </ul>
      </div>
      <div class="card">
        <h3>Live vs. dry-run</h3>
        <p class="muted" style="margin:0">Check <code>mode</code> on <code>GET /health</code>. In <b>dry_run</b> mode the API validates input, prices the order and enforces the wallet balance check, but <b>never creates a real resource or charges funds</b> — perfect for integration testing. In <b>live</b> mode calls provision real resources and debit your wallet. An unaffordable order returns <code>402 insufficient_wallet_balance</code> in <b>both</b> modes; only an affordable dry-run returns <code>"mode": "dry_run"</code> with a <code>would_provision</code> preview.</p>
      </div>
    </section>

    ${planChangeGuide(base)}

    ${sections}

    <section id="errors" class="grp">
      <h2>Errors</h2>
      <p class="grp-blurb">Errors return the appropriate HTTP status with a JSON body <code>{ "error": "code", "message": "..." }</code>.</p>
      <div class="card" style="padding:6px 14px">
        <table class="etable">
          <thead><tr><th>HTTP</th><th>error</th><th>Meaning</th></tr></thead>
          <tbody>
            ${ERRORS.map(([s, c, d]) => `<tr><td class="st">${s}</td><td><code>${esc(c)}</code></td><td>${esc(d)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <footer>
      <p>${esc(BRAND)} Reseller API · v1 · Need a key or help? Message <b>${esc(SUPPORT_HANDLE)}</b> on Telegram.</p>
    </footer>
  </main>
</div>

<script>
  // Language tabs — switch ALL request blocks at once
  document.querySelectorAll('.tab').forEach(function(t){
    t.addEventListener('click', function(){
      document.body.setAttribute('data-lang', t.getAttribute('data-lang'));
    });
  });
  // Copy buttons (copies the currently VISIBLE snippet in the block)
  document.querySelectorAll('.copy').forEach(function(btn){
    btn.addEventListener('click', function(){
      var text = btn.getAttribute('data-copy');
      if(!text){
        var scope = btn.closest('.col, .card, .baseurl');
        var code = null;
        if(scope){
          var pres = scope.querySelectorAll('pre code');
          for(var i=0;i<pres.length;i++){ if(pres[i].offsetParent!==null){ code=pres[i]; break; } }
          if(!code) code = scope.querySelector('pre code, b');
        }
        text = code ? code.innerText : '';
      }
      navigator.clipboard.writeText(text).then(function(){
        var old = btn.textContent; btn.textContent = 'Copied'; btn.classList.add('done');
        setTimeout(function(){ btn.textContent = old; btn.classList.remove('done'); }, 1400);
      }).catch(function(){});
    });
  });
  // Mobile menu
  var side = document.getElementById('side'), mb = document.getElementById('menuBtn');
  if(mb){ mb.addEventListener('click', function(){ side.classList.toggle('open'); }); }
  document.querySelectorAll('#side a').forEach(function(a){ a.addEventListener('click', function(){ side.classList.remove('open'); }); });
</script>
</body>
</html>`
}

module.exports = { renderApiDocPage }
