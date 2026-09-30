#!/usr/bin/env node
// Fetch Nomadly Railway MONGO_URL, connect, report prod data (no password printed).
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const TOK = process.env.API_KEY_RAILWAY
const PROJ = process.env.RAILWAY_PROD_PROJECT_ID || 'c23ac3d9-51c5-4242-8776-eed4e3801abe'
const ENV  = process.env.RAILWAY_PROD_ENVIRONMENT_ID || '889fd56a-720a-4020-884c-034784992666'

async function gql(q, v) {
  const r = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Project-Access-Token': TOK },
    body: JSON.stringify({ query: q, variables: v }),
  })
  return (await r.json()).data
}

;(async () => {
  const pd = await gql(`query P($id:String!){project(id:$id){services{edges{node{id name}}}}}`, { id: PROJ })
  const svc = pd.project.services.edges.map(e=>e.node).find(s=>s.name==='Nomadly-EMAIL-IVR')
  const d = await gql(`query V($p:String!,$e:String!,$s:String!){variables(projectId:$p,environmentId:$e,serviceId:$s)}`,
    { p: PROJ, e: ENV, s: svc.id })
  const url = d.variables.MONGO_URL
  const dbName = d.variables.DB_NAME || process.env.DB_NAME || 'test'
  console.log('host:', url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@'))
  console.log('DB_NAME on Railway:', d.variables.DB_NAME || '(not set → falls back to '+ (process.env.DB_NAME||'test') +')')
  // Save full url to a gitignored temp for the deploy step
  require('fs').writeFileSync('/tmp/railway_mongo_url.txt', url, { mode: 0o600 })

  const c = new MongoClient(url, { serverSelectionTimeoutMS: 12000 })
  await c.connect()
  const db = c.db(dbName)
  const cols = (await db.listCollections().toArray()).map(x=>x.name).sort()
  console.log('DB:', dbName, '| collections:', cols.length)
  const check = ['users','orders','wallets','transactions','domains','hostingPlans','hosting_plans','phoneNumbers','shortLinks','vpsPlansOf','walletLedger']
  for (const n of cols) {
    if (check.includes(n)) {
      console.log('   ', n, '=', await db.collection(n).estimatedDocumentCount())
    }
  }
  // top 12 collections by count
  const counts = []
  for (const n of cols) counts.push([n, await db.collection(n).estimatedDocumentCount()])
  counts.sort((a,b)=>b[1]-a[1])
  console.log('   top collections:', counts.slice(0,12).map(([n,c2])=>`${n}:${c2}`).join(', '))
  await c.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
