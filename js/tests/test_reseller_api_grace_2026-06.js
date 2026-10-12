#!/usr/bin/env node
/* Reseller API smoke tests for RDP grace surfacing + renew (Phase D). */
const https = require('https');
const { URL } = require('url');

const BASE = (process.env.REACT_APP_BACKEND_URL || 'https://vault-setup-24.preview.emergentagent.com').replace(/\/$/, '') + '/api/reseller/v1';
const KEY = 'nmdly_e2e_51573577f5db956c5c0cb039';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { console.log('  ✅ ' + msg); pass++; } else { console.log('  ❌ ' + msg); fail++; } }

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const opts = {
      method,
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' }
    };
    const req = https.request(opts, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  console.log('── Basic reseller endpoints ──');
  let r = await req('GET', '/health');
  ok(r.status === 200, `GET /health -> 200 (got ${r.status})`);
  ok(r.body && r.body.mode === 'dry_run', `health.mode = dry_run (got ${r.body && r.body.mode})`);

  r = await req('GET', '/account');
  ok(r.status === 200, `GET /account -> 200 (got ${r.status})`);
  ok(r.body && (r.body.chatId === '5590563715' || r.body.ownerChatId === '5590563715' || r.body.owner_chat_id === '5590563715' || r.body.id === '5590563715'), `account owner = 5590563715`);

  r = await req('GET', '/rdp/plans');
  ok(r.status === 200, `GET /rdp/plans -> 200 (got ${r.status})`);
  const hasPlans = r.body && (Array.isArray(r.body.plans) ? r.body.plans.length > 0 : Array.isArray(r.body) && r.body.length > 0);
  ok(hasPlans, `rdp/plans lists plans`);
  const osOpts = r.body && (r.body.os_options || (r.body.plans && r.body.plans[0] && r.body.plans[0].os_options));
  ok(!!osOpts, `rdp/plans includes os_options`);

  r = await req('GET', '/rdp');
  ok(r.status === 200, `GET /rdp -> 200 (got ${r.status})`);
  const list = r.body && (r.body.rdp || r.body.items || r.body);
  ok(Array.isArray(list) && list.length > 0, `rdp list not empty (len=${Array.isArray(list) ? list.length : 'N/A'})`);

  r = await req('GET', '/rdp/e2e-rdp-1/credentials');
  ok([200, 404].includes(r.status), `GET /rdp/:id/credentials -> 200 or 404 (got ${r.status})`);

  console.log('\n── GET /renewals: grace fields on RDP row ──');
  r = await req('GET', '/renewals');
  ok(r.status === 200, `GET /renewals -> 200 (got ${r.status})`);
  const rows = r.body && (r.body.renewals || r.body.items || r.body.rows || []);
  const rdpRow = Array.isArray(rows) ? rows.find(x => (x.id === 'e2e-rdp-1' || x.vpsId === 'e2e-rdp-1')) : null;
  ok(!!rdpRow, `found e2e-rdp-1 in renewals`);
  if (rdpRow) {
    ok(rdpRow.status === 'grace', `renewals row status='grace' (got ${rdpRow.status})`);
    ok(rdpRow.in_grace === true, `renewals row in_grace=true (got ${rdpRow.in_grace})`);
    ok(!!rdpRow.expired_at, `renewals row has expired_at`);
    ok(!!rdpRow.delete_at, `renewals row has delete_at`);
    ok(typeof rdpRow.days_until_deletion === 'number', `renewals row days_until_deletion is number (got ${rdpRow.days_until_deletion})`);
  }
  const summary = r.body && (r.body.summary || r.body.totals);
  ok(!!summary, `renewals has summary`);
  if (summary) ok(typeof summary.in_grace === 'number' && summary.in_grace >= 1, `summary.in_grace >= 1 (got ${summary.in_grace})`);

  console.log('\n── GET /rdp/:id: grace block ──');
  r = await req('GET', '/rdp/e2e-rdp-1');
  ok(r.status === 200, `GET /rdp/e2e-rdp-1 -> 200 (got ${r.status})`);
  const g = r.body && r.body.grace;
  ok(!!g, `response has grace block`);
  if (g) {
    ok(g.in_grace === true, `grace.in_grace = true (got ${g.in_grace})`);
    ok(!!g.expired_at, `grace.expired_at present`);
    ok(!!g.delete_at, `grace.delete_at present`);
    ok(typeof g.days_remaining === 'number', `grace.days_remaining is number (got ${g.days_remaining})`);
  }

  console.log('\n── GET /rdp/:id: grace-destroyed record ──');
  r = await req('GET', '/rdp/e2e-rdp-dead');
  ok(r.status === 200, `GET /rdp/e2e-rdp-dead -> 200 (got ${r.status})`);
  ok(r.body && r.body.status === 'destroyed', `status='destroyed' (got ${r.body && r.body.status})`);
  ok(r.body && r.body.destroy_reason === 'expired_grace', `destroy_reason='expired_grace' (got ${r.body && r.body.destroy_reason})`);

  console.log('\n── POST /rdp/:id/renew ──');
  // months=1 dry_run
  r = await req('POST', '/rdp/e2e-rdp-1/renew', { months: 1, dry_run: true });
  ok(r.status === 200, `renew m=1 dry_run -> 200 (got ${r.status})`);
  ok(r.body && r.body.mode === 'dry_run', `renew m=1 mode=dry_run (got ${r.body && r.body.mode})`);
  const price1 = r.body && (r.body.price_usd || r.body.price || r.body.total);
  ok(Math.abs((price1 || 0) - 56) < 0.02, `renew m=1 price ~$56 (got ${price1})`);
  ok(r.body && (r.body.sufficient_balance === true || r.body.has_balance === true), `renew m=1 sufficient_balance=true`);

  r = await req('POST', '/rdp/e2e-rdp-1/renew', { months: 2, dry_run: true });
  const price2 = r.body && (r.body.price_usd || r.body.price || r.body.total);
  ok(Math.abs((price2 || 0) - 100.8) < 0.05, `renew m=2 price ~$100.8 (got ${price2})`);

  r = await req('POST', '/rdp/e2e-rdp-1/renew', { months: 3, dry_run: true });
  const price3 = r.body && (r.body.price_usd || r.body.price || r.body.total);
  ok(Math.abs((price3 || 0) - 142.8) < 0.05, `renew m=3 price ~$142.8 (got ${price3})`);

  // clamp: months=99 -> 3
  r = await req('POST', '/rdp/e2e-rdp-1/renew', { months: 99, dry_run: true });
  const priceClamp = r.body && (r.body.price_usd || r.body.price || r.body.total);
  ok(Math.abs((priceClamp || 0) - 142.8) < 0.05, `renew m=99 clamps to 3 (~$142.8, got ${priceClamp})`);

  // months=0 -> 1
  r = await req('POST', '/rdp/e2e-rdp-1/renew', { months: 0, dry_run: true });
  const priceZero = r.body && (r.body.price_usd || r.body.price || r.body.total);
  ok(Math.abs((priceZero || 0) - 56) < 0.05, `renew m=0 clamps to 1 (~$56, got ${priceZero})`);

  // unknown id -> 404
  r = await req('POST', '/rdp/unknown-xyz/renew', { months: 1, dry_run: true });
  ok(r.status === 404, `renew unknown id -> 404 (got ${r.status})`);
  ok(r.body && (r.body.error === 'not_found' || (r.body.code === 'not_found')), `renew unknown -> not_found (got ${JSON.stringify(r.body).slice(0,80)})`);

  // grace-destroyed -> 409
  r = await req('POST', '/rdp/e2e-rdp-dead/renew', { months: 1, dry_run: true });
  ok(r.status === 409, `renew dead -> 409 (got ${r.status})`);
  ok(r.body && (r.body.error === 'already_destroyed' || r.body.code === 'already_destroyed'), `renew dead -> already_destroyed (got ${JSON.stringify(r.body).slice(0,80)})`);

  console.log(`\n${fail === 0 ? '✅' : '❌'} Reseller API grace suite: ${pass} passed / ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
