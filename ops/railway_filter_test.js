require('dotenv').config({ path: '/app/backend/.env' })
const TOK = process.env.API_KEY_RAILWAY
const ENV = '889fd56a-720a-4020-884c-034784992666'
const SVC = 'b9c4ad64-7667-4dd3-8b9a-3867ede47885'
async function gql(q, v) { const r = await fetch('https://backboard.railway.app/graphql/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Project-Access-Token': TOK }, body: JSON.stringify({ query: q, variables: v }) }); const j = await r.json(); if (j.errors) console.error(JSON.stringify(j.errors).slice(0,300)); return j.data }
const Q = `query E($e:String!,$f:String,$a:String,$al:Int,$bl:Int!){environmentLogs(environmentId:$e,filter:$f,anchorDate:$a,afterLimit:$al,beforeLimit:$bl){timestamp message}}`
;(async () => {
  const a = new Date(Date.now() - 2*86400e3).toISOString()
  for (const f of [`@service:${SVC} message:`, `message:`, `"message:"`, `@service:${SVC} "message:"`, `WelcomeBonus`, `AutoPromo`, `@service:${SVC} AutoPromo`]) {
    const d = await gql(Q, { e: ENV, f, a, al: 5, bl: 0 })
    const rows = d?.environmentLogs || []
    console.log(`\nFILTER ${JSON.stringify(f)} -> ${rows.length}`)
    rows.slice(0,3).forEach(r => console.log(' ', r.timestamp, String(r.message).replace(/\s+/g,' ').slice(0,140)))
  }
})()
