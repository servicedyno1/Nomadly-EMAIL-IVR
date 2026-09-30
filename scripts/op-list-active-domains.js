/**
 * Query OpenProvider for active domains registered 4+ months ago.
 * Usage: node scripts/op-list-active-domains.js
 */
require('dotenv').config()
const axios = require('axios')

const OP_BASE_URL = 'https://api.openprovider.eu'
const OP_USERNAME = process.env.OPENPROVIDER_USERNAME
const OP_PASSWORD = process.env.OPENPROVIDER_PASSWORD

async function authenticate() {
  const res = await axios.post(`${OP_BASE_URL}/v1beta/auth/login`, {
    username: OP_USERNAME,
    password: OP_PASSWORD,
  }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 })

  if (res.data?.code === 0 && res.data?.data?.token) {
    console.log('✅ OpenProvider auth success')
    return res.data.data.token
  }
  throw new Error('OpenProvider auth failed: ' + JSON.stringify(res.data))
}

async function listActiveDomains(token) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  
  // Fetch active domains, sorted by order_date ascending (oldest first)
  const res = await axios.get(`${OP_BASE_URL}/v1beta/domains`, {
    headers,
    params: {
      status: 'ACT',
      limit: 100,
      offset: 0,
      'order_by.order_date': 'asc',
    },
    timeout: 30000,
  })
  
  if (res.data?.code !== 0) {
    throw new Error('Failed to list domains: ' + JSON.stringify(res.data))
  }
  
  const domains = res.data?.data?.results || []
  console.log(`\n📋 Total active domains returned: ${domains.length}`)
  
  // Filter for domains registered 4+ months ago
  const fourMonthsAgo = new Date()
  fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4)
  
  const eligible = domains.filter(d => {
    const orderDate = new Date(d.order_date || d.active_date || d.creation_date)
    return orderDate < fourMonthsAgo
  })
  
  console.log(`\n✅ Domains registered 4+ months ago (before ${fourMonthsAgo.toISOString().slice(0,10)}):`)
  console.log('─'.repeat(80))
  
  eligible.forEach((d, i) => {
    const domainName = d.domain?.name && d.domain?.extension 
      ? `${d.domain.name}.${d.domain.extension}` 
      : d.id || 'unknown'
    const orderDate = d.order_date || d.active_date || 'unknown'
    const expDate = d.expiration_date || 'unknown'
    const ns = (d.name_servers || []).map(n => n.name || n).join(', ')
    console.log(`  ${i+1}. ${domainName}`)
    console.log(`     Status: ${d.status} | Ordered: ${orderDate} | Expires: ${expDate}`)
    console.log(`     NS: ${ns || 'default'}`)
    console.log()
  })
  
  return { all: domains, eligible }
}

async function main() {
  try {
    const token = await authenticate()
    const { all, eligible } = await listActiveDomains(token)
    
    console.log(`\n📊 Summary: ${all.length} total active, ${eligible.length} registered 4+ months ago`)
    
    if (eligible.length > 0) {
      const pick = eligible[0]
      const domainName = pick.domain?.name && pick.domain?.extension 
        ? `${pick.domain.name}.${pick.domain.extension}` 
        : 'unknown'
      console.log(`\n🎯 Recommended test domain: ${domainName}`)
      console.log(`   Ordered: ${pick.order_date}`)
      console.log(`   Expires: ${pick.expiration_date}`)
    }
  } catch (err) {
    console.error('❌ Error:', err.message)
    if (err.response?.data) console.error('Response:', JSON.stringify(err.response.data, null, 2))
  }
}

main()
