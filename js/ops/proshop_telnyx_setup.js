// PROSHOP: create its OWN Telnyx SIP connection, Call Control app and Messaging profile on the
// shared (Nomadly) Telnyx account. Idempotent by name. Writes IDs + SIP creds to the app-proshop shared dir.
const fs = require('fs')
const crypto = require('crypto')
const axios = require('axios')
const env = f => Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')] }))
const M = env('/opt/nomadly/shared/app-main/backend.env')
const OUT = '/opt/nomadly/shared/app-proshop/telnyx_ids.json'
const H = { headers: { Authorization: `Bearer ${M.TELNYX_API_KEY}` } }
const T = 'https://api.telnyx.com/v2'
const SELF = 'https://proshopivr.xyz'
const OVP = '2897375459551478845' // same outbound voice profile as Nomadly's SIP + CCA
const NAME = 'PROSHOP Cloud Phone'
const saved = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {}

;(async () => {
  const sipUser = saved.sipUser || 'proshopphone'
  const sipPass = saved.sipPass || crypto.randomBytes(18).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 20) + 'Ps9'
  const conns = (await axios.get(`${T}/credential_connections`, { ...H, params: { 'filter[connection_name][contains]': NAME, 'page[size]': 20 } })).data.data
  let sip = conns.find(c => c.connection_name === `${NAME} SIP`)
  if (!sip) {
    sip = (await axios.post(`${T}/credential_connections`, {
      active: true, connection_name: `${NAME} SIP`, user_name: sipUser, password: sipPass,
      webhook_event_url: `${SELF}/telnyx/voice-webhook`, webhook_api_version: '2',
      anchorsite_override: 'Latency', sip_uri_calling_preference: 'unrestricted', dtmf_type: 'RFC 2833',
      default_on_hold_comfort_noise_enabled: true,
      inbound: { ani_number_format: 'E.164-national', dnis_number_format: 'e164', codecs: ['G722', 'G711U', 'G711A', 'G729'], default_routing_method: 'sequential', sip_compact_headers_enabled: true },
      outbound: { outbound_voice_profile_id: OVP, localization: 'US', instant_ringback_enabled: true, t38_reinvite_source: 'customer' },
    }, H)).data.data
    console.log('created SIP connection', sip.id)
  } else console.log('SIP connection exists', sip.id)

  const apps = (await axios.get(`${T}/call_control_applications`, { ...H, params: { 'page[size]': 50 } })).data.data
  let cca = apps.find(a => a.application_name === `${NAME} Voice`)
  if (!cca) {
    cca = (await axios.post(`${T}/call_control_applications`, {
      application_name: `${NAME} Voice`, active: true, webhook_event_url: `${SELF}/telnyx/voice-webhook`, webhook_api_version: '2',
      anchorsite_override: 'Latency', dtmf_type: 'RFC 2833', first_command_timeout: false, first_command_timeout_secs: 30,
      inbound: { sip_subdomain_receive_settings: 'from_anyone', codecs: ['G722', 'G711A', 'G711U'] },
      outbound: { outbound_voice_profile_id: OVP },
    }, H)).data.data
    console.log('created Call Control app', cca.id)
  } else console.log('Call Control app exists', cca.id)

  const mps = (await axios.get(`${T}/messaging_profiles`, { ...H, params: { 'page[size]': 50 } })).data.data
  let mp = mps.find(p => p.name === `${NAME} SMS`)
  if (!mp) {
    mp = (await axios.post(`${T}/messaging_profiles`, {
      name: `${NAME} SMS`, enabled: true, webhook_url: `${SELF}/telnyx/sms-webhook`, webhook_api_version: '2',
      whitelisted_destinations: ['AU', 'BR', 'CA', 'DE', 'FR', 'GB', 'GH', 'IN', 'KE', 'MX', 'NG', 'PH', 'PT', 'US', 'ZA'],
    }, H)).data.data
    console.log('created Messaging profile', mp.id)
  } else console.log('Messaging profile exists', mp.id)

  fs.writeFileSync(OUT, JSON.stringify({ sipConnectionId: sip.id, callControlAppId: cca.id, messagingProfileId: mp.id, sipUser, sipPass }, null, 2), { mode: 0o600 })
  console.log('saved ids → telnyx_ids.json')
})().catch(e => { console.error('ERR', e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 500)); process.exit(1) })
