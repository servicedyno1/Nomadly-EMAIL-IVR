#!/usr/bin/env python3
"""Apply the droplet-native custom-domain patches to a checkout (used for the WhiteLabel branch).
Usage: python3 apply_droplet_patches.py /opt/nomadly/app-wl"""
import sys, os, re

root = sys.argv[1]
J = lambda p: os.path.join(root, 'js', p)

def patch(path, subs):
    s = open(path, encoding='utf-8').read()
    for old, new, expect in subs:
        n = s.count(old)
        if expect is not None and n != expect:
            raise SystemExit(f'{path}: expected {expect} match(es) for anchor starting {old[:60]!r}, found {n}')
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8').write(s)
    print('patched', path)

P1 = "r.recordType === 'CNAME' && r.recordContent && r.recordContent.includes('.up.railway.app')"

# _index.js: predicates, import, webhook IP pin
patch(J('_index.js'), [
    (P1, 'isShortenerDnsRecord(r)', None),
    ("!(r.type === 'CNAME' && r.content && r.content.includes('.up.railway.app'))", '!isShortenerDnsRecord(r)', None),
    ("const { saveDomainInServerRailway, saveDomainInServerRender, getExistingRailwayDNS } = require('./rl-save-domain-in-server.js')",
     "const { saveDomainInServerRailway, saveDomainInServerRender, getExistingRailwayDNS, isShortenerDnsRecord } = require('./rl-save-domain-in-server.js')", 1),
    ("""      await bot.setWebHook(webhookUrl, {
        allowed_updates: JSON.stringify(['message', 'callback_query', 'my_chat_member'])
      })
      log('✅ Telegram webhook set successfully')
      log(`📡 Webhook URL: ${webhookUrl}`)""",
     """      // TELEGRAM_WEBHOOK_IP pins delivery to a fixed IP (Telegram caches DNS for hours after a host move)
      const webhookOpts = {
        allowed_updates: JSON.stringify(['message', 'callback_query', 'my_chat_member'])
      }
      const pinnedIp = (process.env.TELEGRAM_WEBHOOK_IP || '').trim()
      if (pinnedIp) webhookOpts.ip_address = pinnedIp
      await bot.setWebHook(webhookUrl, webhookOpts)
      log('✅ Telegram webhook set successfully')
      log(`📡 Webhook URL: ${webhookUrl}${pinnedIp ? ` (pinned ip ${pinnedIp})` : ''}`)""", 1),
])

patch(J('cpanel-routes.js'), [
    ("r.type === 'CNAME' && r.content?.includes('.up.railway.app')", "require('./rl-save-domain-in-server').isShortenerDnsRecord(r)", 1),
])
patch(J('cr-register-domain-&-create-cpanel.js'), [
    ("r.type === 'CNAME' && r.content && r.content.includes('.up.railway.app')", "require('./rl-save-domain-in-server').isShortenerDnsRecord(r)", 1),
])

OLD_ASC = """const addShortenerCNAME = async (domainName, cnameTarget, db, txtHost, txtValue) => {
  try {
    const meta = await getDomainMeta(domainName, db)

    if ((meta?.nameserverType === 'cloudflare' || meta?.cfZoneId) && meta?.cfZoneId) {
      // 1. Check for A/AAAA conflicts at root
      const conflict = await checkDNSConflict(domainName, 'CNAME', '', db)
      if (conflict.hasConflict && conflict.conflictingRecords?.length > 0) {
        log(`[addShortenerCNAME] ${domainName}: removing ${conflict.conflictingRecords.length} conflicting A/AAAA record(s) before CNAME`)
        for (const rec of conflict.conflictingRecords) {
          const delResult = await cfService.deleteDNSRecord(meta.cfZoneId, rec.id)
          if (delResult.success) {
            log(`[addShortenerCNAME] Deleted ${rec.type} ${rec.name} → ${rec.content}`)
          } else {
            log(`[addShortenerCNAME] Warning: failed to delete ${rec.type} ${rec.name} → ${rec.content}`)
          }
        }
      }

      // 1b. Also check for existing CNAME records at root that point elsewhere
      // This handles domains that were previously linked to a different shortener/service
      const cfRecords = await cfService.listDNSRecords(meta.cfZoneId)
      const existingCNAME = cfRecords.filter(r => r.name === domainName && r.type === 'CNAME')
      let cnameAlreadyCorrect = false
      for (const rec of existingCNAME) {
        if (rec.content !== cnameTarget) {
          log(`[addShortenerCNAME] ${domainName}: removing existing CNAME → ${rec.content} before adding shortener CNAME`)
          const delResult = await cfService.deleteDNSRecord(meta.cfZoneId, rec.id)
          if (delResult.success) {
            log(`[addShortenerCNAME] Deleted existing CNAME ${rec.name} → ${rec.content}`)
          } else {
            log(`[addShortenerCNAME] Warning: failed to delete existing CNAME ${rec.name} → ${rec.content}`)
          }
        } else {
          log(`[addShortenerCNAME] ${domainName}: CNAME already points to ${cnameTarget}`)
          cnameAlreadyCorrect = true
        }
      }

      // 2. Add the CNAME (proxied for CF CNAME flattening at root)
      if (!cnameAlreadyCorrect) {
        const result = await cfService.createDNSRecord(meta.cfZoneId, 'CNAME', domainName, cnameTarget, 300, true)
        if (!result.success && !result.alreadyExists) {
          const errMsg = result.errors?.map(e => e.message || e.code).join(', ') || 'Cloudflare DNS add failed'
          return { error: errMsg }
        }
        log(`[addShortenerCNAME] ${domainName}: CNAME → ${cnameTarget} added (proxied)`)
      }"""

NEW_ASC = """const addShortenerCNAME = async (domainName, cnameTarget, db, txtHost, txtValue) => {
  try {
    const meta = await getDomainMeta(domainName, db)
    // Droplet/Render hand us an IPv4 → apex A record; Railway hands us a hostname → apex CNAME.
    const isIPv4 = /^(25[0-5]|2[0-4]\\d|1?\\d?\\d)(\\.(25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}$/.test(String(cnameTarget || '').trim())
    const recType = isIPv4 ? 'A' : 'CNAME'

    if ((meta?.nameserverType === 'cloudflare' || meta?.cfZoneId) && meta?.cfZoneId) {
      // 1. Check for A/AAAA conflicts at root
      const conflict = await checkDNSConflict(domainName, 'CNAME', '', db)
      if (conflict.hasConflict && conflict.conflictingRecords?.length > 0) {
        log(`[addShortenerCNAME] ${domainName}: removing ${conflict.conflictingRecords.length} conflicting A/AAAA record(s) before ${recType}`)
        for (const rec of conflict.conflictingRecords) {
          if (recType === 'A' && rec.type === 'A' && rec.content === cnameTarget) continue
          const delResult = await cfService.deleteDNSRecord(meta.cfZoneId, rec.id)
          if (delResult.success) {
            log(`[addShortenerCNAME] Deleted ${rec.type} ${rec.name} → ${rec.content}`)
          } else {
            log(`[addShortenerCNAME] Warning: failed to delete ${rec.type} ${rec.name} → ${rec.content}`)
          }
        }
      }

      // 1b. Also check for existing root records of our type that point elsewhere (and stale
      // apex CNAMEs when we are adding an A record). Handles domains previously linked to a
      // different shortener host (e.g. the old Railway CNAME).
      const cfRecords = await cfService.listDNSRecords(meta.cfZoneId)
      const existingSame = cfRecords.filter(r => r.name === domainName && (r.type === recType || (recType === 'A' && r.type === 'CNAME')))
      let cnameAlreadyCorrect = false
      for (const rec of existingSame) {
        if (rec.type !== recType || rec.content !== cnameTarget) {
          log(`[addShortenerCNAME] ${domainName}: removing existing ${rec.type} → ${rec.content} before adding shortener ${recType}`)
          const delResult = await cfService.deleteDNSRecord(meta.cfZoneId, rec.id)
          if (delResult.success) {
            log(`[addShortenerCNAME] Deleted existing ${rec.type} ${rec.name} → ${rec.content}`)
          } else {
            log(`[addShortenerCNAME] Warning: failed to delete existing ${rec.type} ${rec.name} → ${rec.content}`)
          }
        } else {
          log(`[addShortenerCNAME] ${domainName}: ${recType} already points to ${cnameTarget}`)
          cnameAlreadyCorrect = true
        }
      }

      // 2. Add the record (proxied — CF terminates TLS at the edge)
      if (!cnameAlreadyCorrect) {
        const result = await cfService.createDNSRecord(meta.cfZoneId, recType, domainName, cnameTarget, 300, true)
        if (!result.success && !result.alreadyExists) {
          const errMsg = result.errors?.map(e => e.message || e.code).join(', ') || 'Cloudflare DNS add failed'
          return { error: errMsg }
        }
        log(`[addShortenerCNAME] ${domainName}: ${recType} → ${cnameTarget} added (proxied)`)
      }"""

patch(J('domain-service.js'), [
    (OLD_ASC, NEW_ASC, 1),
    ("""    // Non-CF domains: use generic addDNSRecord (OP/CR don't have CNAME flattening at root)
    const result = await addDNSRecord(domainName, 'CNAME', cnameTarget, '', db)""",
     """    // Non-CF domains: use generic addDNSRecord (OP/CR don't have CNAME flattening at root)
    const result = await addDNSRecord(domainName, recType, cnameTarget, '', db)""", 1),
])

left = 0
for f in ['_index.js', 'domain-service.js', 'shortener-reconciler.js', 'cpanel-routes.js', 'cr-register-domain-&-create-cpanel.js']:
    for i, line in enumerate(open(J(f), encoding='utf-8'), 1):
        if '.up.railway.app' in line and 'includes(' in line and not line.strip().startswith(('//', '*')):
            print('LEFTOVER', f, i, line.strip()[:100]); left += 1
print('done; leftover predicates:', left)
