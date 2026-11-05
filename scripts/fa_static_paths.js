// Prints JSON list of en.js string paths whose value does not depend on env vars (safe to bake as fixed Persian text).
const { execFileSync } = require('child_process')
const dump = env => JSON.parse(execFileSync('node', ['-e', `
require('dotenv').config({path:'/app/backend/.env'});
${env ? "for (const k of Object.keys(process.env)) { const v = process.env[k]; process.env[k] = /^-?\\d+(\\.\\d+)?$/.test(v) ? String(Number(v) + 7) : v + 'Q' }" : ''}
const {en}=require('/app/js/lang/en.js'); const out={};
(function w(o,p){for(const k in o){const v=o[k];if(typeof v==='string')out[p.concat(k).join('\\u241f')]=v;else if(v&&typeof v==='object'&&!Array.isArray(v))w(v,p.concat(k))}})(en,[]);
process.stdout.write(JSON.stringify(out))`], { cwd: '/app/js', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).toString())
const a = dump(false), b = dump(true)
console.log(JSON.stringify(Object.keys(a).filter(k => a[k] === b[k])))
