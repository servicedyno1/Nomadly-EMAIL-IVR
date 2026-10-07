// Throwaway droplet for the live plan-change test: node _live_droplet.js create|get <id>|destroy <id>
require('dotenv').config({ path: '/app/backend/.env' })
process.env.NODE_ENV = 'test'
const d = require('../digitalocean-service')
;(async () => {
  const [cmd, id] = process.argv.slice(2)
  if (cmd === 'create') {
    const r = await d.apiRequest('POST', '/droplets', { name: `plan-change-test-${Date.now().toString(36)}`, region: 'fra1', size: 's-1vcpu-1gb', image: 'ubuntu-24-04-x64', tags: ['nomadly-plan-change-test'] })
    console.log(JSON.stringify({ id: r.droplet.id, status: r.droplet.status }))
  } else if (cmd === 'get') {
    const r = await d.apiRequest('GET', `/droplets/${id}`)
    const x = r.droplet
    console.log(JSON.stringify({ id: x.id, name: x.name, status: x.status, size: x.size_slug, disk: x.disk, ip: (x.networks.v4.find(n => n.type === 'public') || {}).ip_address, tags: x.tags }))
  } else if (cmd === 'destroy') {
    const r = await d.apiRequest('GET', `/droplets/${id}`)
    if (!(r.droplet.tags || []).includes('nomadly-plan-change-test')) throw new Error('refusing: not a test droplet')
    await d.apiRequest('DELETE', `/droplets/${id}`)
    console.log('destroyed', id)
  }
})().catch(e => { console.error(e.message); process.exit(1) })
