// Remove a hosting domain's worker routes + web DNS, but only when no other live account still uses it.
const cfService = require('./cf-service')
const { log } = require('console')

const escapeRx = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Live = not deleted, not a failed provisioning record, not terminated on WHM.
function liveOwnerQuery(domain, excludeId) {
  const rx = new RegExp('^' + escapeRx(domain) + '$', 'i')
  return {
    ...(excludeId !== undefined ? { _id: { $ne: excludeId } } : {}),
    deleted: { $ne: true }, provisionState: { $ne: 'failed' }, terminatedOnWhm: { $ne: true },
    $or: [{ domain: rx }, { addonDomains: rx }, { addonDomains: { $elemMatch: { domain: rx } } }],
  }
}

// excludeId: the account being torn down (whole-account cancel/delete). Omit it when a domain is
// detached from a still-live account — its DB row is updated before this runs.
async function teardownHostingDomain({ col, domain, excludeId, tag = 'Hosting' }) {
  const d = String((domain && domain.domain) || domain || '').toLowerCase()
  if (!d) return { domain: d, skipped: 'empty' }
  const inUse = await col.findOne(liveOwnerQuery(d, excludeId), { projection: { _id: 1 } })
  if (inUse) {
    log(`[${tag}] DNS teardown SKIPPED for ${d}: still used by live account ${inUse._id}`)
    return { domain: d, skipped: 'in_use', by: inUse._id }
  }
  const zone = await cfService.getZoneByName(d)
  if (!zone) return { domain: d, skipped: 'no_zone' }
  const antiRedService = require('./anti-red-service')
  await antiRedService.removeWorkerRoutes(d, zone.id).catch(() => {})
  await cfService.cleanupAllHostingRecords(zone.id, d).catch(() => {})
  return { domain: d, removed: true }
}

module.exports = { teardownHostingDomain, liveOwnerQuery }
