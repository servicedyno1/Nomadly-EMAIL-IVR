#!/usr/bin/env node
/* READ-ONLY Railway query helper for IVR notification RCA */
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

(async () => {
  const Q = `query($id:String!){ deployment(id:$id){ id status createdAt updatedAt staticUrl meta service{ id name } environment{ id name } } }`;
  const r = await gql(Q, { id: DEP });
  console.log(JSON.stringify(r, null, 2));
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
