# Hosting capabilities: what customers can run (verified 2026-10-10)

Use this before promising customers or resellers anything about WordPress, PHP, React/Vue/Vite/Next.js or Node.js.

## How it was verified (read-only)
- WHM API on the production WHM (68.183.77.106, via WHM_API_URL), called from the droplet using the app-main env:
  `version`, `php_get_installed_versions`, `php_get_system_default_version`, `ea4_get_currently_installed_packages`, `listpkgs`, `get_featurelist_data?featurelist=default`.
- Code: `js/anti-red-service.js` (generateHtaccessRules ~L275, deployHtaccess ~L379-440), `js/whm-service.js` (PLAN_MYSQL_LIMITS), HostPanel (`frontend/src/components/panel/*`, `js/cpanel-routes.js`).

## Server facts
- cPanel & WHM 11.138.0.15.
- PHP: ea-php82 (system default) and ea-php83. No other versions.
- EA4 packages: 83 installed. NONE match node / passenger / ruby / python, so there is no Node.js runtime and no Passenger.
- All 3 Anti-Red packages use featurelist `default`. It enables mysql, phpmyadmin, filemanager, cron, multiphp, autossl, wp-toolkit (+ deluxe, site-import), passengerapps and ssh.
  But HASSHELL = n (no shell), and passengerapps is useless without Passenger + Node packages.
- Package quotas: Weekly 3000 MB, Premium Monthly 5000 MB, Golden 10000 MB. WHM MAXSQL = unlimited, but OUR code enforces the limits in `PLAN_MYSQL_LIMITS`: Weekly 0, Premium Monthly 5, Golden unlimited.
- Customers use OUR HostPanel (React panel + `js/cpanel-routes.js` proxy), not the native cPanel UI. The HostPanel has File Manager (upload + zip extract), Databases (MySQL users/DBs, phpMyAdmin) and so on. It has NO WordPress installer and NO Node.js app manager.

## Capability matrix
| Stack | Status | Notes |
|---|---|---|
| HTML5 / static sites | YES, all plans | Upload files or a .zip to public_html. The entry file must be index.html or index.php. |
| PHP | YES, all plans | PHP 8.2 / 8.3. MySQL only on Premium Monthly (5 DBs) and Golden (unlimited); Weekly has 0 DBs. |
| WordPress | PARTIAL, manual install only | Needs MySQL, so monthly plans only. No one-click installer in the HostPanel. See caveat A (permalinks). |
| React / Vite / Vue / Next.js static export | PARTIAL, static build only | Upload the build output (build/ or dist/). The home page works; deep links and refresh 404 unless the app is in a `.../build` folder. See caveat B. |
| Node.js server apps (Express, Next.js SSR/API routes/ISR, Nuxt SSR) | NO | No Node runtime, no Passenger, no shell. |

Marketing note: a "Web Apps: React, Next.js, Vite, Vue" claim is only true for STATIC builds (with caveat B). A Node.js icon or claim is NOT true today.

## Caveats (root cause in our code)
`deployHtaccess` OVERWRITES `/public_html/.htaccess` on every anti-red (re)deploy. It runs on plan changes, panel file delete/extract/save, heartbeat repairs, reseller anti-red/deploy and so on. It keeps ONLY:
1. the `# php -- BEGIN/END cPanel-generated handler` block,
2. a `# --- CORS headers ... </IfModule>` section,
3. a static-build rewrite matching `RewriteRule ^(.*)$ <path>/build/` (it regenerates `RewriteRule ^$ <path>/index.html` plus a !-f/!-d fallback to `<path>/$1`).

Everything else is dropped. That means:
- **A. WordPress at the site root:** the `# BEGIN WordPress ... # END WordPress` block is lost, so pretty permalinks (/sample-post/) return 404 after each redeploy. Re-saving Settings → Permalinks only fixes it until the next redeploy. WordPress in a subfolder is unaffected, because its own .htaccess isn't touched.
- **B. SPA routing:** a root-level `FallbackResource /index.html` or `RewriteRule . /index.html [L]`, or a Vite `dist/` rewrite, is lost, so deep links 404.
- Any other custom root .htaccess rules (redirects, headers, auth) are also lost.

## Roadmap (not started; do in this order)
1. **Preserve user .htaccess rules (small, high value).** In deployHtaccess, also carry over the `# BEGIN WordPress ... # END WordPress` block and a documented user block (e.g. `# BEGIN Custom Rules ... # END Custom Rules`). Generalise the build-path match to `build|dist` or detect `FallbackResource`.
   Place the preserved blocks AFTER the anti-red rules, so scanner cloaking still runs first. Add tests for WordPress, Vite dist, CRA build and a custom block, plus a heartbeat-repair regression. Document the custom block in ai-support.js and the HostPanel help.
2. **One-click WordPress (monthly plans only).** Option a: WP Toolkit is already enabled in the featurelist; check its CLI/API on the WHM before using it. Option b: our own flow: create a DB + user via the existing panel MySQL code, then download + extract latest.zip, write wp-config.php with salts, and run the install.
   Check anti-red compatibility: the JS challenge vs /wp-admin, /wp-login.php, /wp-json, xmlrpc.php, wp-cron, and the honeypot /wp-* paths (`js/anti-red-service.js` ~L1667 and the scanner prefixes in `js/_index.js` ~L34 are only on the Node server, not the cPanel sites). Weekly plan: block it, or offer an upgrade.
3. **Node.js app hosting (big: server-wide change on the shared WHM).** Install ea-nodejs20/22 + ea-ruby27-mod_passenger (+ ea-apache24-mod_env) through EasyApache 4. Use cPanel Application Manager (UAPI PassengerApps::register_application / ensure_deps; the passengerapps feature is already on).
   Then add a HostPanel "Node.js app" tab (app root, startup file, env vars, npm install, restart). Consider per-plan limits and memory. Next.js SSR needs `next start` behind Passenger. Test with the tunnel + CF worker + anti-red. Back up the server / take a snapshot first.
