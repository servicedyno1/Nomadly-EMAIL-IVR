#!/usr/bin/env node
/* Reseller API grace surfacing + renew (Phase D). Self-contained: seeds its own fixtures and
   mounts the reseller API in-process in dry-run mode (no preview pod / live provider needed). */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') });
process.env.RESELLER_API_LIVE = 'false';
const crypto = require('crypto');
const express = require('express');
const { MongoClient } = require('mongodb');
const { createResellerApi } = require('../reseller-api');

const KEY = 'nmdly_e2e_grace_test_raw_key';
const KEY_ID = 'test-grace-key';
const OWNER = '900900911';
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
let BASE, db, client, server;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { console.log('  ✅ ' + msg); pass++; } else { console.log('  ❌ ' + msg); fail++; } }

async function req(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
}

async function setup() {
  client = new MongoClient(process.env.MONGO_URL); await client.connect();
  db = client.db(process.env.DB_NAME);
  const now = Date.now(), H = 3600000;
  await db.collection('resellerApiKeys').updateOne({ _id: KEY_ID }, { $set: { _id: KEY_ID, keyHash: sha256(KEY), ownerChatId: OWNER, enabled: true, scopes: ['*'] } }, { upsert: true });
  await db.collection('walletOf').updateOne({ _id: OWNER }, { $set: { _id: OWNER, usdIn: 1000, usdOut: 0 } }, { upsert: true });
  const base = { chatId: OWNER, isRDP: true, provider: 'digitalocean-rdp', productId: 'standard-1m', plan: 'Standard — Windows RDP (1 month)', osId: 'ws2022', osType: 'windows', region: 'US', source: 'grace_test' };
  await db.collection('vpsPlansOf').updateOne({ _id: 'e2e-rdp-1' }, { $set: { ...base, _id: 'e2e-rdp-1', vpsId: 'e2e-rdp-1', instanceId: 'rdp-grace-test-0001', status: 'EXPIRED_GRACE',
    end_time: new Date(now - 6 * H), expired_at: new Date(now - 6 * H).toISOString(), grace_until: new Date(now + 42 * H).toISOString() } }, { upsert: true });
  await db.collection('vpsPlansOf').updateOne({ _id: 'e2e-rdp-dead' }, { $set: { ...base, _id: 'e2e-rdp-dead', vpsId: 'e2e-rdp-dead', instanceId: 'rdp-grace-test-0002', status: 'DELETED',
    cancelReason: 'expired_grace', destroy_reason: 'expired_grace', cancelledAt: new Date(now - 2 * H), end_time: new Date(now - 50 * H) } }, { upsert: true });
  const app = express(); app.use(express.json());
  app.use('/reseller/v1', createResellerApi({ getDb: () => db, log: () => {}, notifyAdmin: () => {} }));
  server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  BASE = `http://127.0.0.1:${server.address().port}/reseller/v1`;
}

async function cleanup() {
  await db.collection('resellerApiKeys').deleteOne({ _id: KEY_ID });
  await db.collection('walletOf').deleteOne({ _id: OWNER });
  await db.collection('vpsPlansOf').deleteMany({ _id: { $in: ['e2e-rdp-1', 'e2e-rdp-dead'] } });
  await new Promise(r => server.close(r)); await client.close();
}

(async () => {
  await setup();
  console.log('── Basic reseller endpoints ──');
  let r = await req('GET', '/health');
  ok(r.status === 200, `GET /health -> 200 (got ${r.status})`);
  ok(r.body && r.body.mode === 'dry_run', `health.mode = dry_run (got ${r.body && r.body.mode})`);

  r = await req('GET', '/account');
  ok(r.status === 200, `GET /account -> 200 (got ${r.status})`);
  ok(r.body && (r.body.chatId === OWNER || r.body.ownerChatId === OWNER || r.body.owner_chat_id === OWNER || r.body.id === OWNER), `account owner = test owner`);

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
  ok(r.body && (r.body.dry_run === true || r.body.mode === 'dry_run'), `renew m=1 is a no-charge pre-flight (dry_run=${r.body && r.body.dry_run})`);
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

  await cleanup();
  console.log(`\n${fail === 0 ? '✅' : '❌'} Reseller API grace suite: ${pass} passed / ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
