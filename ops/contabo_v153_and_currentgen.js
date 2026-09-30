require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios'); const { v4: uuidv4 } = require('uuid')
const RTOK = process.env.API_KEY_RAILWAY
const PROJ='c23ac3d9-51c5-4242-8776-eed4e3801abe',ENV='889fd56a-720a-4020-884c-034784992666',SVC='b9c4ad64-7667-4dd3-8b9a-3867ede47885'
const AUTH_URL='https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token', API_BASE='https://api.contabo.com/v1'
async function rv(){const r=await fetch('https://backboard.railway.app/graphql/v2',{method:'POST',headers:{'Content-Type':'application/json','Project-Access-Token':RTOK},body:JSON.stringify({query:`query V($p:String!,$e:String!,$s:String!){variables(projectId:$p,environmentId:$e,serviceId:$s)}`,variables:{p:PROJ,e:ENV,s:SVC}})});return (await r.json()).data.variables}
;(async()=>{const v=await rv();const p=new URLSearchParams({client_id:v.CONTABO_CLIENT_ID,client_secret:v.CONTABO_CLIENT_SECRET,username:v.CONTABO_API_USER,password:v.CONTABO_API_PASSWORD,grant_type:'password'});
const tr=await axios.post(AUTH_URL,p.toString(),{headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:15000});const tok=tr.data.access_token;
const get=async(path,qp)=>(await axios.get(`${API_BASE}${path}`,{headers:{Authorization:`Bearer ${tok}`,'x-request-id':uuidv4()},params:qp,timeout:30000})).data;

// 1) The running instance (confirmed orderable product)
const inst=await get('/compute/instances/203508080');
const i=inst.data?.[0]||inst.data;
console.log('=== Running instance 203508080 (confirmed orderable) ===');
console.log(JSON.stringify({productId:i.productId,cpuCores:i.cpuCores,ramMb:i.ramMb,diskMb:i.diskMb,osType:i.osType,region:i.region,status:i.status,imageId:i.imageId,name:i.name,displayName:i.displayName},null,1));

// 2) Full products list — print every Cloud VPS entry with full priceItem
const prods=await get('/products',{size:400});
const cloud=(prods.data||[]).filter(e=>/Cloud VPS/i.test(e.priceItem?.name||''));
console.log('\n=== ALL Cloud VPS priceItems (name | itemId | nvmeProductId | USD | keys) ===');
for(const e of cloud){
  const pi=e.priceItem; const usd=(pi.price||[]).find(x=>x.currency==='USD')?.amount;
  console.log(`  ${pi.name} | ${pi.itemId} | nvme=${pi.nvmeProductId} | $${usd}`);
}
// 3) Dump full raw of the V153 product entry + one "(2026)" entry to see spec fields
const v153=cloud.find(e=>e.priceItem?.itemId==='V153'||e.priceItem?.nvmeProductId==='V153');
console.log('\n=== Raw priceItem containing V153 ===');
console.log(JSON.stringify(v153,null,1)?.slice(0,1500));
})().catch(e=>{console.error('ERR',e?.response?.status,JSON.stringify(e?.response?.data||e.message))})
