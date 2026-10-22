require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios')
const { createShortUrlApi, getLinklyWorkspaceId } = require('../cuttly.js')
const { getAnalyticsCapability } = require('../shortener-analytics.js')
const H = () => ({ Authorization: `Bearer ${process.env.LINKLY_API_KEY}` })
;(async () => {
  const ws = await getLinklyWorkspaceId(); console.log('workspace:', ws)
  const short = await createShortUrlApi('https://example.com/?nomadly_direct_test=1')
  console.log('short link:', short, '| matches linkly.link:', /^https:\/\/linkly\.link\/\w+$/.test(short))
  const r = await axios.get(short, { maxRedirects: 0, validateStatus: () => true, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130' } })
  console.log('redirect:', r.status, '->', r.headers.location)
  console.log('analytics capability:', JSON.stringify(getAnalyticsCapability(short)))
  // bad key → readable error
  const saved = process.env.LINKLY_API_KEY; process.env.LINKLY_API_KEY = 'invalid-key-for-test'
  try { await createShortUrlApi('https://example.com') } catch (e) { console.log('bad key error:', e.message) }
  process.env.LINKLY_API_KEY = ''
  try { await createShortUrlApi('https://example.com') } catch (e) { console.log('missing key error:', e.message) }
  process.env.LINKLY_API_KEY = saved
  // cleanup: find + delete the test link
  const list = await axios.get(`https://api.linklyhq.com/api/v1/workspace/${ws}/list_links?search=nomadly_direct_test`, { headers: H(), validateStatus: () => true })
  const ids = (list.data?.links || []).filter(l => /nomadly_direct_test/.test(l.url)).map(l => l.id)
  for (const id of ids) { const d = await axios.delete(`https://api.linklyhq.com/api/v1/workspace/${ws}/links/${id}`, { headers: H(), validateStatus: () => true }); console.log('deleted', id, d.status) }
  if (!ids.length) console.log('cleanup list status', list.status, '(will retry cleanup later)', JSON.stringify(list.data).slice(0,150))
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
