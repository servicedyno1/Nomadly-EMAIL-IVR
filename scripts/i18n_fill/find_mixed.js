#!/usr/bin/env node
// Detects "mixed-language" values: target-script text containing leftover English words.
// Usage: node scripts/i18n_fill/find_mixed.js <zh|hi|fr> [--all]
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const lang = process.argv[2]
const { isSkipped } = require('./skip.js')

function leaves(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') return out
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    const fk = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out[fk] = v
    else if (typeof v === 'function') out[fk] = v.toString()
    else if (v && typeof v === 'object' && !Array.isArray(v)) leaves(v, fk, out)
  }
  return out
}

// Strip things that legitimately contain Latin letters
function stripNeutral(s) {
  return s
    .replace(/<\/?[a-z]+[^>]*>/gi, ' ')          // html tags
    .replace(/\$\{[^}]*\}/g, ' ')                // template placeholders
    .replace(/^\([^)]*\)\s*=>\s*/s, ' ')          // arrow fn params
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\/[a-z_]+/g, ' ')                  // slash commands
    .replace(/[@#]\w+/g, ' ')
    .replace(/\b(IVR|SIP|VPS|RDP|VoIP|SMS|MMS|OTP|DNS|SSL|TLS|CF|Cloudflare|HostPanel|cPanel|WHM|Anti-Red|BulkSMS|Bit\.ly|Bitly|Nomadly|Smadav|USD|NGN|USDT|BTC|ETH|LTC|BCH|DOGE|TRON|TRC20|ERC20|PIN|URL|URLs|API|CSV|TXT|MP3|WAV|OGG|OK|ID|IP|IPs|IPv4|NS|MX|CNAME|TXT|AAAA|SRV|CAA|A|HTML|PHP|FTP|SSH|GB|MB|KB|TB|CPU|RAM|UI|UX|Pro|Plus|Basic|Premium|Golden|Linux|Windows|Ubuntu|Debian|CentOS|Telegram|Brevo|Telnyx|Twilio|Contabo|DigitalOcean|Google|Azure|ElevenLabs|OpenAI|Wikipedia|eSIM|T-Mobile|Airvoice|AT&T|IONOS|SMTP|Naira|aira|Webhook|webhook|Vodafone|Spark|Telstra|Optus|Max|Min|AM|PM|UTC|GMT|WhatsApp|Signal|iOS|Android|Mac|Zoiper|Linphone|Groundwire|Bria|MicroSIP|GitHub|PayPal|Stripe|Visa|Mastercard|Bank|Card|Crypto|Email|Emails|Gmail|Outlook|Yahoo|QR|PDF|JSON|XML|UA|US|UK|USA|CA|AU|NZ|EU|ok|vs|www|com|net|org|io|app|TTL|rDNS|PTR|SPF|DKIM|DMARC|EDGE|RPC|X|Y|Z|N\/A|USPS|UPS|FedEx|DHL|Ship|Mail)\b/g, ' ')
    .replace(/\b[A-Z]{2,}\b/g, ' ')              // other all-caps acronyms
    .replace(/[0-9]+(st|nd|rd|th|x|s|m|h|d|ms|min|sec|GB|MB)\b/g, ' ')
}

const en = leaves(require(path.join(ROOT, 'js/lang/en.js')).en)
const tgt = leaves(require(path.join(ROOT, `js/lang/${lang}.js`))[lang])
const scriptRe = lang === 'zh' ? /[\u4e00-\u9fff]/ : lang === 'hi' ? /[\u0900-\u097f]/ : null
const enWords = /\b(the|a|an|to|your|you|please|is|are|was|not|and|or|for|with|from|this|that|will|can|cannot|select|tap|enter|type|send|upload|found|valid|invalid|file|number|numbers|again|try|contact|support|instead|ready|proceed|change|choose|save|saved|delete|deleted|received|as|of|in|on|by|at|be|has|have|only|more|new|use|used|using|per|set|setup|start|started|failed|error|success|successfully|please|now|here|below|above|all|any|no|yes|ok|done|next|back|cancel|skip|confirm|minutes|min|hours|days|week|month|year|balance|wallet|top|up|refund|refunded|payment|paid|pay|price|plan|domain|order|call|calls|caller|message|messages|audio|voice|greeting|template|templates|preset|presets|option|options|key|keys|press|pressed|wait|waiting|loading|processing|checking|searching|generating|downloading|saving|creating|removing|adding|updating|deleting|list|lists|contacts|emails|email|address|addresses|session|expired|reason|blocked|locked|available|unavailable|required|allowed|maximum|minimum|total|remaining|left|limit|rate|fee|cost|charge|charged|credit|credited|billed|billing|active|inactive|paused|resumed|enabled|disabled|on|off)\b/i

const hits = []
for (const [k, v] of Object.entries(tgt)) {
  if (isSkipped(k, lang)) continue
  if (/parse_mode$/.test(k)) continue
  if (!(k in en)) continue
  const cleaned = stripNeutral(v)
  if (scriptRe) {
    // zh/hi: flag if target script present AND english words remain
    if (!/[a-zA-Z]{3,}/.test(cleaned)) continue
    if (!scriptRe.test(v) && v === en[k]) continue // pure untranslated handled elsewhere
    if (!enWords.test(cleaned) && !/[a-z]{4,}\s+[a-z]{3,}/i.test(cleaned)) continue
    hits.push([k, v])
  } else {
    // fr: flag if value differs from en but still has >=2 common English words in a row
    if (v === en[k]) continue
    const m = cleaned.match(/\b(the|your|you|please|is|are|not|and|or|for|with|from|this|will|can|cannot|select|tap|enter|type|send|upload|found|valid|invalid|again|try|instead|ready|proceed|change|choose|save|saved|delete|deleted|received|only|more|new|use|used|using|per|set|start|failed|error|successfully|now|here|below|above|all|any|yes|done|next|back|cancel|skip|confirm|minutes|hours|days|week|month|year|balance|wallet|top|up|refund|refunded|payment|paid|pay|price|plan|order|call|calls|caller|message|messages|audio|voice|greeting|template|templates|preset|presets|option|options|key|keys|press|pressed|wait|waiting|loading|processing|checking|searching|generating|downloading|saving|creating|removing|adding|updating|deleting|list|lists|contacts|emails|email|address|addresses|session|expired|reason|blocked|locked|available|unavailable|required|allowed|maximum|minimum|total|remaining|left|limit|rate|fee|cost|charge|charged|credit|credited|billed|billing|active|inactive|paused|resumed|enabled|disabled|off|been|has|have|was|were|been|into|onto|which|what|when|where|who|how|why|than|then|them|they|their|there|these|those|some|such|very|just|also|about|after|before|between|under|over|each|every|other|another|same|different|number|numbers|file|should|would|could|may|might|must|shall|do|does|did|doing|get|got|make|made|take|taken|give|given|go|going|come|coming|see|seen|know|known|think|want|need|needs|needed|let|keep|put|bring|hold|turn|show|shown|run|move|live|believe|happen|happened|happens|offer|provide|provided|include|includes|continue|allow|lead|understand|follow|stop|create|created|speak|read|spend|grow|open|walk|win|teach|hear|cut|reach|kill|raise|pass|sell|decide|return|explain|hope|develop|carry|break|receive|agree|die|remain|suppose|require|suggest|report|pull|love|hate|like|share|wish|ensure|verify|verified|check|checked|checks|click|clicks|tapping|typing|pick|picked|picking|too|few|many|much|most|less|least|both|either|neither|first|last|previous|current|currently|already|still|yet|soon|later|earlier|today|tomorrow|yesterday|always|never|often|sometimes|usually|once|twice|again|anytime|anywhere|everywhere|somewhere|nowhere)\b/gi)
    if (!m || m.length < 2) continue
    hits.push([k, v])
  }
}
console.log(`# ${lang}: ${hits.length} mixed-language values`)
for (const [k, v] of hits) console.log(`${k} = ${v.replace(/\n/g, '\\n').slice(0, 160)}`)
