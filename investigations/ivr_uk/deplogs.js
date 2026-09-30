#!/usr/bin/env node
/* READ-ONLY Railway deployment log puller */
const fs = require('fs');
const path = require('path');
const https = require('https');

const TOKEN = fs.readFileSync(path.resolve(__dirname, '../../backend/.env'), 'utf8')
  .match(/API_KEY_RAILWAY\s*=\s*"?([^"\n]+)"?/)[1].trim();

function gql(query, variables) {
  const body = JSON.stringify({ query, variables });
  return new Promise((resolve, reject) => {
    const req = https.request('https://backboard.railway.com/graphql/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Project-Access-Token': TOKEN, 'Content-Length': Buffer.byteLength(body) }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(new Error(d.slice(0, 500))) } }); });
    req.on('error', reject); req.write(body); req.end();
  });
}

const DEP = process.argv[2] || 'ece8976d-d1a7-43b6-b937-9e6633b51b6e';
const FILTER = process.argv[3] || '';
const LIMIT = parseInt(process.argv[4] || '5000', 10);
const OUT = process.argv[5] || '/app/investigations/ivr_uk/deploy_logs.jsonl';

(async () => {
  const Q = `query($id:String!,$f:String,$l:Int){ deploymentLogs(deploymentId:$id, filter:$f, limit:$l){ timestamp message severity } }`;
  const r = await gql(Q, { id: DEP, f: FILTER, l: LIMIT });
  if (r.errors) { console.error('ERRORS', JSON.stringify(r.errors).slice(0, 600)); process.exit(1); }
  const logs = r.data.deploymentLogs || [];
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, logs.map(l => JSON.stringify(l)).join('\n'));
  console.log(`[railway] pulled ${logs.length} lines (filter="${FILTER}") -> ${OUT}`);
  if (logs.length) { console.log('  first', logs[0].timestamp); console.log('  last ', logs[logs.length - 1].timestamp); }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
