// =============================================================================
// Regression test: VPS/RDP that report a stale "running" status after their
// DigitalOcean droplet was deleted must be reconciled to terminal "destroyed".
//
// Bug (reported 2026-10-12): GET /vps/:id returned status:"running",
// provision_state:"active", renewable:true even though the nested live-check
// already showed a DO 404 (droplet gone). Root cause: `status: live?.status ||
// rec.status` fell back to the stale record status, and the live-check catch
// dropped the 404 code.
//
// Fully self-contained & prod-safe: mounts the REAL reseller-api router with an
// in-memory fake DB and a STUBBED DigitalOcean provider (getInstance simulated
// to 404 / 500 / healthy). NO network, NO production DB contact.
//
// Run: node js/tests/reseller_vps_gone_reconcile_2026-10.js
// =============================================================================
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') });
process.env.VPS_DEFAULT_PROVIDER = 'digitalocean';
delete process.env.RESELLER_API_LIVE; // force dry-run (no prod mutations)

const express = require('express');
const fetch = require('node-fetch');
const doSvc = require('../digitalocean-service');
const rdpSvc = require('../digitalocean-rdp-service');
const { createResellerApi } = require('../reseller-api');

const OWNER = '999999';
const keyDoc = { _id: 'test-key', ownerChatId: OWNER, label: 'local', enabled: true };
const records = {};
const writes = [];
function mkRec(id, over = {}) {
  records[id] = { _id: id, vpsId: id, chatId: OWNER, isRDP: false, instanceId: 'do-608485955', host: '164.92.181.246', status: 'RUNNING', provisionState: 'active', plan: 'NVMe AMD 1vCPU/1GB/25GB', region: 'EU', osType: 'linux', osId: 'ubuntu-24-04-x64', hostname: 'vps-mv5migjhex', deleted: false, ...over };
}
const emptyCursor = { limit: () => emptyCursor, toArray: async () => [] };
function collection(name) {
  if (name === 'resellerApiKeys') return { findOne: async () => keyDoc, updateOne: async () => ({}) };
  if (name === 'vpsPlansOf') return {
    findOne: async (q) => { const id = q && (q.$or ? (q.$or[0].vpsId || q.$or[1]._id) : q._id); return records[id] || null; },
    updateOne: async (q, upd) => { const id = q && q._id; writes.push({ id, set: (upd && upd.$set) || {} }); if (records[id]) Object.assign(records[id], (upd && upd.$set) || {}); return {}; },
    find: () => emptyCursor,
  };
  return { findOne: async () => null, insertOne: async () => ({}), updateOne: async () => ({}), find: () => emptyCursor, distinct: async () => [], findOneAndUpdate: async () => null };
}
const app = express(); app.use(express.json());
app.use('/reseller/v1', createResellerApi({ getDb: () => ({ collection }), log: () => {}, notifyAdmin: () => {} }));

const PORT = 5073, BASE = `http://127.0.0.1:${PORT}/reseller/v1`;
const H = { Authorization: 'Bearer test', 'Content-Type': 'application/json' };
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ' :: ' + d : ''}`); } };

const err404 = () => { const e = new Error('DO GET /droplets/608485955 failed (404): The resource you were accessing could not be found.'); e.status = 404; throw e; };
const err500 = () => { const e = new Error('DO GET /droplets/608485955 failed (500): internal'); e.status = 500; throw e; };
let cancelCalled = false;
doSvc.cancelInstance = async () => { cancelCalled = true; };
let rdpCancelCalled = false;
rdpSvc.cancelInstance = async () => { rdpCancelCalled = true; };

const server = app.listen(PORT, async () => {
  try {
    console.log('\n[A] droplet 404 -> GET reconciles to terminal "destroyed"');
    mkRec('925ab306'); writes.length = 0; doSvc.getInstance = err404;
    let r = await fetch(`${BASE}/vps/925ab306`, { headers: H }); let j = await r.json();
    check('HTTP 200', r.status === 200, `got ${r.status}`);
    check('status === "destroyed"', j.status === 'destroyed', `got ${j.status}`);
    check('provision_state === "destroyed"', j.provision_state === 'destroyed', `got ${j.provision_state}`);
    check('renewable === false', j.renewable === false, `got ${j.renewable}`);
    check('renew_blocked_reason === "already_destroyed"', j.renew_blocked_reason === 'already_destroyed', `got ${j.renew_blocked_reason}`);
    check('destroy_reason === "provider_gone"', j.destroy_reason === 'provider_gone', `got ${j.destroy_reason}`);
    check('live.error still surfaced (404)', !!(j.live && /404/.test(j.live.error || '')), JSON.stringify(j.live));
    const w = writes.find(x => x.id === '925ab306');
    check('DB reconcile write happened', !!w, JSON.stringify(writes));
    check('  write set status=destroyed, deleted=true, autoRenew=false', !!w && w.set.status === 'destroyed' && w.set.deleted === true && w.set.autoRenew === false, JSON.stringify(w && w.set));
    check('  write cancels renewal (_autoRenewAttempted=true)', !!w && w.set._autoRenewAttempted === true);

    console.log('\n[B] transient 500 -> status stays running, renewable true, no reconcile');
    mkRec('tran500'); writes.length = 0; doSvc.getInstance = err500;
    r = await fetch(`${BASE}/vps/tran500`, { headers: H }); j = await r.json();
    check('status NOT destroyed', j.status !== 'destroyed', `got ${j.status}`);
    check('renewable === true', j.renewable === true, `got ${j.renewable}`);
    check('no reconcile write', writes.filter(x => x.id === 'tran500').length === 0, JSON.stringify(writes));

    console.log('\n[C] healthy droplet -> status from live, renewable true');
    mkRec('healthy'); writes.length = 0; doSvc.getInstance = async () => ({ mainIp: '164.92.181.246', status: 'active' });
    r = await fetch(`${BASE}/vps/healthy`, { headers: H }); j = await r.json();
    check('status === "active"', j.status === 'active', `got ${j.status}`);
    check('renewable === true', j.renewable === true, `got ${j.renewable}`);

    console.log('\n[D] DELETE on already-destroyed -> idempotent, provider not re-called');
    mkRec('gone-del', { status: 'destroyed', deleted: true }); cancelCalled = false;
    r = await fetch(`${BASE}/vps/gone-del`, { method: 'DELETE', headers: H }); j = await r.json();
    check('HTTP 200', r.status === 200, `got ${r.status}`);
    check('destroyed === true', j.destroyed === true, JSON.stringify(j));
    check('already_destroyed === true', j.already_destroyed === true, JSON.stringify(j));
    check('provider cancelInstance NOT called', cancelCalled === false);

    // ───────────────── RDP (same fix via isInstanceGone) ─────────────────
    console.log('\n[E] RDP: droplet gone (stale "active" + isInstanceGone=true) -> reconciled to "destroyed"');
    mkRec('rdp-gone', { isRDP: true, provider: 'digitalocean-rdp', instanceId: 'rdp-abc123', osType: 'windows', status: 'active', hostname: null });
    writes.length = 0;
    rdpSvc.getInstance = async () => ({ status: 'active', mainIp: '164.92.181.246', agentOnline: false }); // stale (DB status), no 404
    rdpSvc.isInstanceGone = async () => true; // DO confirms droplet is 404
    r = await fetch(`${BASE}/rdp/rdp-gone`, { headers: H }); j = await r.json();
    check('HTTP 200', r.status === 200, `got ${r.status}`);
    check('status === "destroyed"', j.status === 'destroyed', `got ${j.status}`);
    check('provision_state === "destroyed"', j.provision_state === 'destroyed', `got ${j.provision_state}`);
    check('renewable === false', j.renewable === false, `got ${j.renewable}`);
    check('destroy_reason === "provider_gone"', j.destroy_reason === 'provider_gone', `got ${j.destroy_reason}`);
    check('DB reconcile write happened', !!writes.find(x => x.id === 'rdp-gone'), JSON.stringify(writes));

    console.log('\n[F] RDP: droplet still exists (isInstanceGone=false) -> stays active, renewable');
    mkRec('rdp-ok', { isRDP: true, provider: 'digitalocean-rdp', instanceId: 'rdp-def456', osType: 'windows', status: 'active' });
    writes.length = 0;
    rdpSvc.getInstance = async () => ({ status: 'active', mainIp: '1.2.3.4', agentOnline: true });
    rdpSvc.isInstanceGone = async () => false;
    r = await fetch(`${BASE}/rdp/rdp-ok`, { headers: H }); j = await r.json();
    check('status === "active"', j.status === 'active', `got ${j.status}`);
    check('renewable === true', j.renewable === true, `got ${j.renewable}`);
    check('not reconciled to destroyed', !writes.some(x => x.id === 'rdp-ok' && x.set.status === 'destroyed'), JSON.stringify(writes));

    console.log('\n[G] RDP: DELETE on already-destroyed -> idempotent, provider not re-called');
    mkRec('rdp-del', { isRDP: true, provider: 'digitalocean-rdp', instanceId: 'rdp-ghi789', osType: 'windows', status: 'destroyed', deleted: true }); rdpCancelCalled = false;
    r = await fetch(`${BASE}/rdp/rdp-del`, { method: 'DELETE', headers: H }); j = await r.json();
    check('HTTP 200', r.status === 200, `got ${r.status}`);
    check('already_destroyed === true', j.already_destroyed === true, JSON.stringify(j));
    check('provider cancelInstance NOT called', rdpCancelCalled === false);

    console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
  } catch (e) { console.error('TEST ERROR', e); fail++; }
  finally { server.close(); process.exit(fail === 0 ? 0 : 1); }
});
