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
          method: 'GET', path: '/account/webhook', auth: true, billed: false,
          desc: 'Get the push-webhook URL currently registered on your API key and the RDP lifecycle events it receives. Registering a webhook lets you react to expiry/deletion instantly instead of polling GET /renewals.',
          curl: `curl -s ${base}/account/webhook \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "webhook_url": "https://your-app.com/hooks/nomadly",
  "events": ["rdp.grace_start", "rdp.deleted"],
  "delivery": "POST (no signature), auto-retry with backoff"
}`,
        },
        {
          method: 'PUT', path: '/account/webhook', auth: true, billed: false,
          desc: 'Register (or clear) the push-webhook URL for your account. Send {"webhook_url":"https://…"} to set it, or {"webhook_url":null} to clear it. Nomadly then POSTs a JSON body { event, occurred_at, data:{ id, plan, region, … } } to your URL for each RDP lifecycle event: rdp.grace_start (subscription expired → server powered off and a 3-day grace period begins; data also carries expired_at + delete_at) and rdp.deleted (droplet permanently deleted after grace ended unrenewed; data also carries reason:"expired_grace"). Delivery is a plain POST with no signature, retried with backoff, and de-duplicated per server+event so you never get the same event twice. Reply 2xx to acknowledge.',
          params: [['webhook_url', true, 'Your http(s) endpoint URL, or null to clear']],
          curl: `curl -s -X PUT ${base}/account/webhook \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"webhook_url":"https://your-app.com/hooks/nomadly"}'`,
          resp: `{
  "webhook_url": "https://your-app.com/hooks/nomadly",
  "events": ["rdp.grace_start", "rdp.deleted"],
  "delivery": "POST (no signature), auto-retry with backoff"
}

// Example event Nomadly POSTs to your URL:
// { "event": "rdp.grace_start", "occurred_at": "2026-09-24T15:00:00.000Z",
//   "data": { "id": "6631...", "plan": "Standard — Windows RDP (1 month)", "region": "EU",
//             "expired_at": "2026-09-24T15:00:00.000Z", "delete_at": "2026-09-27T15:00:00.000Z" } }`,
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
    { "plan_id": "s-1vcpu-1gb", "name": "1 vCPU / 1 GB", "ram_gb": 1, "disk_gb": 25, "cpu": "Standard", "storage_type": "SSD", "price_usd": 18.00 }
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
          desc: 'Register a domain. Charged to your wallet at the price returned by /domains/search. By default DNS is set to Cloudflare; pass a custom nameserver array to override.',
          params: [
            ['domain', true, 'Domain to register, e.g. mysite.com'],
            ['ns_choice', false, '"cloudflare" (default) or "registrar"'],
            ['nameservers', false, 'Array of custom nameservers — overrides ns_choice'],
          ],
          curl: `curl -s -X POST ${base}/domains/register \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"domain":"mysite.com","ns_choice":"cloudflare"}'`,
          resp: `{
  "mode": "live",
  "product": "domain",
  "action": "register",
  "charged_usd": 12.99,
  "wallet_balance_usd": 129.51,
  "result": {
    "success": true,
    "domain": "mysite.com",
    "registrar": "ConnectReseller",
    "nameservers": ["ada.ns.cloudflare.com", "rob.ns.cloudflare.com"]
  }
}`,
        },
        {
          method: 'GET', path: '/domains', auth: true, billed: false,
          desc: 'List all domains owned by your account (max 500).',
          curl: `curl -s ${base}/domains \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "domains": [
    {
      "domain": "mysite.com",
      "registrar": "ConnectReseller",
      "nameserver_type": "cloudflare",
      "nameservers": ["ada.ns.cloudflare.com", "rob.ns.cloudflare.com"],
      "registered_at": "2026-09-08T10:22:00.000Z",
      "expires_at": "2027-09-08T10:22:00.000Z",
      "dns_records_url": "/dns/mysite.com/records",
      "nameservers_url": "/dns/mysite.com/nameservers"
    }
  ]
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
          method: 'PUT', path: '/dns/:domain/nameservers', auth: true, billed: false,
          desc: 'Replace the domain nameservers. Provide at least two.',
          params: [['nameservers', true, 'Array of ≥ 2 nameserver hostnames']],
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
      id: 'vps', title: 'VPS (Linux)',
      blurb: 'Provision and control Linux virtual servers. Creation is wallet-billed at the plan price (includes markup).',
      endpoints: [
        {
          method: 'GET', path: '/vps/plans', auth: true, billed: false,
          desc: 'List available Linux VPS plans and prices for a region.',
          params: [['region', false, 'Region code — defaults to EU']],
          curl: `curl -s "${base}/vps/plans?region=EU" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "product": "vps",
  "provider": "digitalocean",
  "region": "EU",
  "plans": [
    { "plan_id": "s-1vcpu-1gb", "name": "1 vCPU / 1 GB", "vcpus": 1, "ram_gb": 1, "disk_gb": 25, "cpu": "Standard", "storage_type": "SSD", "price_usd": 18.00 }
  ]
}`,
        },
        {
          method: 'POST', path: '/vps', auth: true, billed: true,
          desc: 'Create a Linux VPS. Returns the instance id, IP and initial root password once provisioned.',
          params: [
            ['plan_id', true, 'A plan_id from GET /vps/plans'],
            ['region', false, 'Region code — defaults to EU'],
            ['hostname', false, 'Optional label/hostname'],
            ['os', false, 'OS image — defaults to ubuntu'],
          ],
          curl: `curl -s -X POST ${base}/vps \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"plan_id":"s-1vcpu-1gb","region":"EU","hostname":"web-01"}'`,
          resp: `{
  "mode": "live",
  "product": "vps",
  "action": "create",
  "charged_usd": 18.00,
  "wallet_balance_usd": 111.51,
  "result": {
    "success": true,
    "id": "b2f1c0a4-…",
    "instance_id": "419287654",
    "ip": "203.0.113.55",
    "status": "provisioning",
    "default_password": "Xy8!kP2q…"
  }
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
          desc: 'Create a Windows RDP server. Same body as POST /vps plus an optional "os" edition. The response includes fast_deploy + eta_minutes so you know whether to expect ~3 or ~45 minutes.',
          params: [
            ['plan_id', true, 'A plan_id from GET /rdp/plans (e.g. standard-1m)'],
            ['region', false, 'Region code — defaults to EU'],
            ['os', false, 'Windows edition: ws2019 | ws2022 | ws2025 — defaults to ws2022'],
            ['hostname', false, 'Optional label/hostname'],
          ],
          curl: `curl -s -X POST ${base}/rdp \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"plan_id":"standard-1m","region":"EU","os":"ws2022"}'`,
          resp: `{ "mode": "live", "product": "rdp", "action": "create", "charged_usd": 48.00,
  "result": { "success": true, "id": "…", "ip": null, "status": "provisioning", "os": "ws2022", "fast_deploy": true, "eta_minutes": 3 } }`,
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
        { method: 'POST', path: '/rdp/:id/renew', auth: true, billed: true, desc: 'Renew (extend) a Windows RDP subscription and, if it had expired, bring it out of the 3-day grace period — the server is powered back on and its scheduled deletion is cancelled. Charged from your wallet at the bundle-discounted rate for the chosen term (1 month = full price, 2 months −10%, 3 months −15%). Returns 409 if the RDP was already permanently deleted after grace (order a new one instead). months defaults to 1 and is clamped to 1–3.', params: [['months', false, 'Renewal term in months: 1 | 2 | 3 — defaults to 1']], curl: `curl -s -X POST ${base}/rdp/ID/renew \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"months":1}'`, resp: `{ "mode": "live", "product": "rdp", "action": "renew", "charged_usd": 56.00,
  "result": { "success": true, "id": "…", "months": 1, "plan": "Standard — Windows RDP (1 month)", "expires_at": "2026-08-01T11:00:00.000Z" } }` },
        { method: 'DELETE', path: '/rdp/:id', auth: true, billed: false, desc: 'Destroy the RDP instance (irreversible).', curl: `curl -s -X DELETE ${base}/rdp/ID -H "Authorization: Bearer YOUR_API_KEY"`, resp: `{ "mode": "live", "id": "…", "destroyed": true }` },
        { method: 'GET', path: '/rdp/:id/credentials', auth: true, billed: false, desc: 'Reveal Administrator credentials (live mode only).', curl: `curl -s ${base}/rdp/ID/credentials -H "Authorization: Bearer YOUR_API_KEY"`, resp: `{ "id": "…", "ip": "203.0.113.80", "username": "Administrator", "password": "…", "mode": "live" }` },
      ],
    },
    {
      id: 'hosting', title: 'cPanel Hosting',
      blurb: 'Sell Anti-Red cPanel hosting plans. Creation is wallet-billed (plan price + domain price when domain_mode=buy).',
      endpoints: [
        {
          method: 'GET', path: '/hosting/plans', auth: true, billed: false,
          desc: 'List the available hosting plans, prices and features.',
          curl: `curl -s ${base}/hosting/plans \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "platform": { "hosting_trial_on": false, "offshore_hosting_on": true, "gold_price_usd": 100 },
  "plans": [
    { "plan_id": "golden-monthly", "name": "Golden Anti-Red HostPanel (1-Month)",
      "tier": "gold", "price_usd": 100, "duration_days": 30,
      "addon_domains": "unlimited", "visitor_captcha_available": true,
      "features": ["Anti-Red protection", "Unlimited addon domains", "Visitor Captcha + Geo", "30 days"] }
  ]
}`,
        },
        {
          method: 'POST', path: '/hosting', auth: true, billed: true,
          desc: 'Create a cPanel hosting account. Use domain_mode "byo" to host a domain you already own, or "buy" to register a new domain in the same call (domain price is added to the charge).',
          params: [
            ['plan_id', true, 'A plan_id from GET /hosting/plans'],
            ['domain', true, 'The primary domain for the account'],
            ['domain_mode', false, '"byo" (default) or "buy"'],
            ['email', false, 'Contact email for the account'],
          ],
          curl: `curl -s -X POST ${base}/hosting \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"plan_id":"golden-monthly","domain":"mysite.com","domain_mode":"byo","email":"client@mysite.com"}'`,
          resp: `{
  "mode": "live",
  "product": "hosting",
  "action": "create",
  "charged_usd": 100,
  "wallet_balance_usd": 42.51,
  "result": {
    "success": true,
    "domain": "mysite.com",
    "plan": "Golden Anti-Red HostPanel (1-Month)",
    "cpanel_username": "mysite01",
    "panel_url": "https://panel.1.hostbay.io",
    "server_ip": "68.183.77.106",
    "nameservers": ["ada.ns.cloudflare.com", "rob.ns.cloudflare.com"],
    "queued": false,
    "credentials_url": "/hosting/mysite01/credentials",
    "note": "Call GET /hosting/{username}/credentials to reveal the panel PIN (live mode only)."
  }
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
    { "username": "mysite01", "domain": "mysite.com",
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
          desc: 'Suspend a hosting account.',
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
          desc: 'Terminate a hosting account (irreversible).',
          curl: `curl -s -X DELETE ${base}/hosting/mysite01 \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "mode": "live", "username": "mysite01", "terminated": true }`,
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
          desc: 'Full account details for one hosting account — plan, price, expiry, addon quota/list, the customer deliverables block (panel URL, cPanel username, server IP, nameservers, credentials_url), and LIVE disk/bandwidth usage read from WHM.',
          curl: `curl -s ${base}/hosting/mysite01 \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "username": "mysite01",
  "domain": "mysite.com",
  "plan": "Golden Anti-Red HostPanel (1-Month)",
  "price_usd": 100,
  "duration_days": 30,
  "suspended": false,
  "expires_at": "2026-10-08T11:00:00.000Z",
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
}`,
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
          desc: 'Renew a hosting account for another term at the exact bot price for its plan. Extends the expiry and unsuspends if needed.',
          curl: `curl -s -X POST ${base}/hosting/mysite01/renew \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "mode": "live", "product": "hosting", "action": "renew", "charged_usd": 100,
  "wallet_balance_usd": 42.51,
  "result": { "success": true, "username": "mysite01", "plan": "Golden Anti-Red HostPanel (1-Month)",
    "new_expiry": "2026-11-08T11:00:00.000Z" }
}`,
        },
        {
          method: 'POST', path: '/hosting/:user/upgrade', auth: true, billed: true,
          desc: 'Upgrade a hosting account to a higher tier. The charge uses the exact bot upgrade quote, applying any loyalty credit for the unused portion of the current cycle.',
          params: [['plan_id', true, 'Target plan_id (e.g. "golden-monthly"). GET the current plan first; a 400 lists the available upgrade targets.']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/upgrade \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"plan_id":"golden-monthly"}'`,
          resp: `{
  "mode": "live", "product": "hosting", "action": "upgrade", "charged_usd": 44.29,
  "wallet_balance_usd": 5.71,
  "result": { "success": true, "username": "mysite01", "plan": "Golden Anti-Red HostPanel (30 Days)" }
}`,
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
      blurb: 'One call returns every product you own that is expiring soon — hosting, domains, VPS and RDP — with days remaining and a status bucket. Poll it to drive renewal reminders / auto-renew.',
      endpoints: [
        {
          method: 'GET', path: '/renewals', auth: true, billed: false,
          desc: 'Unified upcoming-expiry list across hosting + domains + VPS + RDP. Use ?days=N to filter to items expiring within N days (default 30); already-expired items are always included.',
          params: [['days', false, 'Only return items expiring within this many days (default 30)']],
          curl: `curl -s "${base}/renewals?days=30" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{
  "within_days": 30,
  "count": 2,
  "summary": { "expired": 0, "expiring_soon": 1, "upcoming": 1, "in_grace": 1 },
  "renewals": [
    { "product": "hosting", "id": "mysite01", "domain": "mysite.com",
      "plan": "Golden Anti-Red HostPanel (1-Month)",
      "expires_at": "2026-09-11T11:00:00.000Z", "days_until_expiry": 3,
      "status": "expiring_soon", "suspended": false, "auto_renew": true },
    { "product": "rdp", "id": "a1b2c3d4-…", "plan": "Standard — Windows RDP (1 month)", "region": "US",
      "expires_at": "2026-06-14T11:00:00.000Z", "days_until_expiry": -1,
      "status": "grace", "in_grace": true, "expired_at": "2026-06-14T11:00:00.000Z",
      "delete_at": "2026-06-17T11:00:00.000Z", "days_until_deletion": 2 },
    { "product": "vps", "id": "b2f1c0a4-…", "plan": "s-1vcpu-1gb", "region": "EU",
      "expires_at": "2026-10-01T11:00:00.000Z", "days_until_expiry": 23, "status": "upcoming" }
  ]
}`,
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
      blurb: 'Full MySQL management: databases, database users, per-database privileges and remote-access hosts. Requires the Premium (1-Month) or Golden plan (the 7-day trial is blocked with 403 mysql_requires_monthly). FREE.',
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
      blurb: 'The premium Anti-Red / Cloudflare protection layer the HostPanel exposes: protection status, Anti-Red deploy, Cloudflare anti-bot profile, Safe-Browsing / blacklist checks, Visitor Captcha and Geo rules (both Golden-plan only), plus zone analytics. FREE.',
      endpoints: [
        {
          method: 'GET', path: '/hosting/:user/security/status', auth: true, billed: false,
          desc: 'Aggregated security posture: Cloudflare anti-bot settings, Safe-Browsing + blacklist results, JS-challenge state and scanner-signature counts.',
          curl: `curl -s ${base}/hosting/mysite01/security/status \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "username": "mysite01", "domain": "mysite.com", "is_gold": true,
  "antiRed": { "safeBrowsing": { "safe": true }, "blacklist": { "listed": false } },
  "protectionLayers": { "jsChallenge": true, "cloudflareZone": true } }`,
        },
        {
          method: 'POST', path: '/hosting/:user/security/anti-red/deploy', auth: true, billed: false,
          desc: 'Deploy the full Anti-Red protection stack (.htaccess cloaking, JS challenge, JA3 fingerprinting, CF worker) for the primary domain. Read status: GET /security/anti-red/status.',
          curl: `curl -s -X POST ${base}/hosting/mysite01/security/anti-red/deploy \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
          resp: `{ "success": true, "htaccess": true, "jsChallenge": true, "hardenedWorker": { "success": true } }`,
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
          desc: 'Turn the human "Verify your browser" challenge ON/OFF for a domain (Golden plan only — 403 gold_only otherwise; 400 no_cloudflare if the domain isn\u2019t on Cloudflare). Read state for all domains: GET /security/visitor-captcha.',
          params: [['enabled', true, 'boolean'], ['domain', false, 'Target domain (defaults to the primary domain; must belong to the account)']],
          curl: `curl -s -X POST ${base}/hosting/mysite01/security/visitor-captcha \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"enabled":true,"domain":"mysite.com"}'`,
          resp: `{ "success": true, "username": "mysite01", "domain": "mysite.com", "enabled": true }`,
        },
        {
          method: 'GET', path: '/hosting/:user/geo', auth: true, billed: false,
          desc: 'List Cloudflare geo firewall rules (Golden only). Create: POST /geo {countries:[],mode:"block"|"allow",description?}. Delete: DELETE /geo {ruleId}.',
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
      ],
    },
    {
      id: 'hosting-advanced', title: 'Hosting · Advanced Management (full panel parity)',
      blurb: 'The remaining HostPanel operations, exposed for building a full cPanel-like UI: send test email, phpMyAdmin SSO, bulk subdomain import, addon docroot mirror/own, replace primary domain, nameserver status, take a site offline/online, JS-challenge toggle and large-file chunked upload. All FREE; writes are dry-run on a sandbox pod.',
      endpoints: [
        { method: 'POST', path: '/hosting/:user/email/test', auth: true, billed: false, desc: 'Send a test email from a mailbox to verify SMTP.', params: [['from', true, 'Local part (sender mailbox)'], ['to', true, 'Recipient address']], curl: `curl -s -X POST ${base}/hosting/mysite01/email/test \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"from":"info","to":"you@example.com"}'`, resp: `{ "success": true, "messageId": "…", "message": "Test email sent to you@example.com" }` },
        { method: 'GET', path: '/hosting/:user/mysql/phpmyadmin', auth: true, billed: false, desc: 'Mint a one-click phpMyAdmin SSO URL (live mode only; Premium/Gold plans).', curl: `curl -s ${base}/hosting/mysite01/mysql/phpmyadmin \\
  -H "Authorization: Bearer YOUR_API_KEY"`, resp: `{ "status": 1, "url": "https://server:2083/cpsess…/3rdparty/phpMyAdmin/", "expires": 1767225600 }` },
        { method: 'POST', path: '/hosting/:user/subdomains/bulk-create', auth: true, billed: false, desc: 'Create up to 50 subdomains in one call (also creates Cloudflare tunnel CNAMEs).', params: [['subdomains', true, 'Array or comma/newline-separated string'], ['rootdomain', false, 'Defaults to the primary domain']], curl: `curl -s -X POST ${base}/hosting/mysite01/subdomains/bulk-create \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"subdomains":"shop,blog,api"}'`, resp: `{ "results": [ { "subdomain": "shop", "fqdn": "shop.mysite.com", "success": true } ], "summary": { "total": 3, "succeeded": 3, "failed": 0 } }` },
        { method: 'GET', path: '/hosting/:user/domains/docroot-modes', auth: true, billed: false, desc: 'Show whether each addon domain mirrors the primary site or serves its own folder. Change with POST /domains/docroot-mode {domain, mode:"mirror"|"own"}.', curl: `curl -s ${base}/hosting/mysite01/domains/docroot-modes \\
  -H "Authorization: Bearer YOUR_API_KEY"`, resp: `{ "modes": { "blog.com": "own" }, "primary": "mysite.com" }` },
        { method: 'POST', path: '/hosting/:user/domains/set-primary', auth: true, billed: false, desc: 'Promote an existing addon domain to be the account primary (WHM modifyacct + Cloudflare/anti-red redeploy for the new primary, cleanup of the old). Returns 400 needs_attach if the domain is not yet an addon.', params: [['domain', true, 'The addon domain to promote']], curl: `curl -s -X POST ${base}/hosting/mysite01/domains/set-primary \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"domain":"blog.com"}'`, resp: `{ "success": true, "oldDomain": "mysite.com", "newDomain": "blog.com" }` },
        { method: 'GET', path: '/hosting/:user/domains/ns-status', auth: true, billed: false, desc: 'Cloudflare nameserver / zone activation status for a domain.', params: [['domain', true, 'Domain to check']], curl: `curl -s "${base}/hosting/mysite01/domains/ns-status?domain=mysite.com" \\
  -H "Authorization: Bearer YOUR_API_KEY"`, resp: `{ "status": "active", "nameservers": ["ada.ns.cloudflare.com","rob.ns.cloudflare.com"], "zoneId": "…" }` },
        { method: 'GET', path: '/hosting/:user/site-status', auth: true, billed: false, desc: 'Whether the site is online, in maintenance, or suspended. Change with POST /hosting/:user/site-status {action:"take_offline"|"bring_online", mode:"maintenance"|"suspended"}.', curl: `curl -s ${base}/hosting/mysite01/site-status \\
  -H "Authorization: Bearer YOUR_API_KEY"`, resp: `{ "status": "online", "domain": "mysite.com", "plan": "Golden Anti-Red HostPanel (1-Month)", "autoRenew": true }` },
        { method: 'POST', path: '/hosting/:user/security/js-challenge', auth: true, billed: false, desc: 'Enable/disable the JS "verify your browser" challenge for the primary domain (Golden plan only). Read state: GET /security/js-challenge.', params: [['enabled', true, 'boolean']], curl: `curl -s -X POST ${base}/hosting/mysite01/security/js-challenge \\
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
  ['403', 'mysql_requires_monthly', 'MySQL management requires the Premium (1-Month) or Golden plan — the 7-day trial is not eligible.'],
  ['403', 'protected_file', 'An Anti-Red protected file (.htaccess / .user.ini / .antired-challenge.php in public_html) cannot be modified or deleted via the API.'],
  ['409', 'no_cloudflare', 'The domain is not on Cloudflare, so Visitor Captcha cannot be toggled.'],
  ['409', 'no_upgrade_path', 'The account is already on the top tier — no higher plan to upgrade to.'],
  ['409', 'addon_exists / addon_quota_exceeded', 'The addon domain already exists, or the plan addon-domain quota is reached.'],
  ['501', 'not_supported / not_implemented / no_credentials', 'The action is not available in this mode (e.g. live domain renewal is not yet wired; cPanel password not on file for an API addon).'],
  ['502', 'provisioning_failed', 'The provider failed to fulfil the request. Any charge is auto-refunded.'],
  ['500', 'internal_error / auth_error', 'Unexpected server error — safe to retry; contact support if persistent.'],
]

// ── HTML escape ──
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

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
  <div class="ep">
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
    --get:#34d399; --post:#60a5fa; --put:#fbbf24; --delete:#f87171;
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
  .nm-get{color:var(--get)}.nm-post{color:var(--post)}.nm-put{color:var(--put)}.nm-delete{color:var(--delete)}
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
  .m-get{background:var(--get)}.m-post{background:var(--post)}.m-put{background:var(--put)}.m-delete{background:var(--delete)}
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
  .ptable td,.etable td{word-break:break-word}
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
    <a class="nav-group" href="#auth">Authentication</a>
    <a class="nav-group" href="#billing">Billing &amp; Modes</a>
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
