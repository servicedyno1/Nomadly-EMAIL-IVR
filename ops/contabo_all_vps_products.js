require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios'); const { v4: uuidv4 } = require('uuid')
const RTOK = process.env.API_KEY_RAILWAY
const PROJ='c23ac3d9-51c5-4242-8776-eed4e3801abe',ENV='889fd56a-720a-4020-884c-034784992666',SVC='b9c4ad64-7667-4dd3-8b9a-3867ede47885'
const AUTH_URL='https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token', API_BASE='https://api.contabo.com/v1'
async function rv(){const r=await fetch('https://backboard.railway.app/graphql/v2',{method:'POST',headers:{'Content-Type':'application/json','Project-Access-Token':RTOK},body:JSON.stringify({query:`query V($p:String!,$e:String!,$s:String!){variables(projectId:$p,environmentId:$e,serviceId:$s)}`,variables:{p:PROJ,e:ENV,s:SVC}})});return (await r.json()).data.variables}
;(async()=>{const v=await rv();const p=new URLSearchParams({client_id:v.CONTABO_CLIENT_ID,client_secret:v.CONTABO_CLIENT_SECRET,username:v.CONTABO_API_USER,password:v.CONTABO_API_PASSWORD,grant_type:'password'});
const tr=await axios.post(AUTH_URL,p.toString(),{headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:15000});const tok=tr.data.access_token;
const prods=(await axios.get(`${API_BASE}/products`,{headers:{Authorization:`Bearer ${tok}`,'x-request-id':uuidv4()},params:{size:400},timeout:30000})).data;
const rows=(prods.data||[]).map(p=>({name:p.priceItem?.name||'',itemId:p.priceItem?.itemId,nvme:p.priceItem?.nvmeProductId,usd:(p.priceItem?.price||[]).find(x=>x.currency==='USD')?.amount}));
// Print anything that looks like a Cloud VPS (not Storage/VDS/Dedicated)
console.log('# ALL Cloud VPS entries (name | itemId | nvmeProductId | USD):');
rows.filter(r=>/Cloud VPS/i.test(r.name)).sort((a,b)=>a.name.localeCompare(b.name)).forEach(r=>console.log(`  ${r.name} | ${r.itemId} | nvme=${r.nvme} | $${r.usd}`));
console.log('\n# Entries with itemId V1[3-9]x (possible current gen):');
rows.filter(r=>/^V1[3-9]\d$/.test(r.itemId||'')).forEach(r=>console.log(`  ${r.name} | ${r.itemId} | nvme=${r.nvme} | $${r.usd}`));
})().catch(e=>{console.error('ERR',e?.response?.status,JSON.stringify(e?.response?.data||e.message))})
