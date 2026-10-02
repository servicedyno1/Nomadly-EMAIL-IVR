#!/usr/bin/env node
// Lists, per key, the English text segments still present inside fr/hi/zh values.
// Only inspects string literals / template text (not JS code inside functions).
// Usage: node scripts/i18n_fill/triage_mixed.js <fr|hi|zh> [--min N]
const path = require('path')
const acorn = require('acorn')
const ROOT = path.resolve(__dirname, '../..')
const { isSkipped } = require('./skip.js')
const lang = process.argv[2]
const minIdx = process.argv.indexOf('--min')
const MIN_WORDS = minIdx > 0 ? Number(process.argv[minIdx + 1]) : 2

function leaves(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') return out
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    const fk = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out[fk] = v
    else if (typeof v === 'function') out[fk] = v
    else if (v && typeof v === 'object' && !Array.isArray(v)) leaves(v, fk, out)
  }
  return out
}

// Collect human-visible text pieces from a value (string or function).
function textPieces(v) {
  if (typeof v === 'string') return [v]
  const src = v.toString()
  let ast
  try {
    ast = acorn.parseExpressionAt(`(${src})`, 0, { ecmaVersion: 'latest' })
  } catch (e) {
    try { ast = acorn.parse(`const __f = ${src}`, { ecmaVersion: 'latest' }) } catch (e2) { return [src] }
  }
  const out = []
  ;(function walk(n) {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (n.type === 'Literal' && typeof n.value === 'string') out.push(n.value)
    else if (n.type === 'TemplateElement') out.push(n.value.cooked ?? n.value.raw)
    else if (n.type === 'Property' && !n.computed) { walk(n.value); return } // object keys are lookup names, not copy
    for (const key of Object.keys(n)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue
      walk(n[key])
    }
  })(ast)
  return out
}

const BRANDS = /\b(IVR|SIP|VPS|RDP|VoIP|SMS|MMS|OTP|DNS|SSL|TLS|CF|Cloudflare|HostPanel|cPanel|WHM|Anti-Red|AntiRed|BulkSMS|Bit\.ly|Bitly|Shortit|Nomadly|Smadav|Freedom|Premium|Golden|Starter|Standard|Business|Enterprise|Pro|Plus|Basic|USD|NGN|USDT|BTC|ETH|LTC|BCH|DOGE|TRON|TRX|TRC20|ERC20|PIN|URL|URLs|API|CSV|TXT|MP3|WAV|OGG|OK|ID|IP|IPs|IPv4|IPv6|NS|MX|CNAME|AAAA|SRV|CAA|HTML|PHP|FTP|SSH|GB|MB|KB|TB|CPU|RAM|vCPU|vCPUs|NVMe|SSD|HDD|UI|UX|Linux|Windows|Ubuntu|Debian|CentOS|Telegram|Brevo|Telnyx|Twilio|Contabo|DigitalOcean|Google|Azure|ElevenLabs|OpenAI|eSIM|T-Mobile|Airvoice|AT&T|IONOS|SMTP|Naira|Webhook|Vodafone|Spark|Telstra|Optus|UTC|GMT|WhatsApp|Signal|iOS|Android|Mac|Zoiper|Linphone|Groundwire|Bria|MicroSIP|GitHub|PayPal|Stripe|Visa|Mastercard|Crypto|Email|Gmail|Outlook|Yahoo|QR|PDF|JSON|XML|USA|UK|EU|www|com|net|org|io|app|TTL|rDNS|PTR|SPF|DKIM|DMARC|Honeypot|Marketplace|Administrator|root|admin|Admin|localhost|mailto|include|spf1|all|example|com|sbs|Name|Company|Bank|Amount|Date|Code|Twilio|Main|Account|Console|Hetzner|OVH|Vultr|Linode|AWS|Amazon|Microsoft|Apple|Chrome|Firefox|Safari|Edge|Opera|Brave|Tor|VPN|Proxy|Socks5|HTTP|HTTPS|WebSocket|TCP|UDP|ICMP|Ping|Traceroute|Nmap|Shodan|Censys|GreyNoise|Scanner|Bot|Crawler|Spider|Googlebot|Bingbot|Yandex|Baidu|DuckDuckGo|Ecosia|Qwant|Startpage|Freedom|Enterprise|Standard|Advanced|Ultimate|Basic|Lite|Mini|Micro|Nano|Pico|Standard|Deluxe|Elite|Max|Ultra|Prime|Plus|Pro|Premium|Gold|Silver|Bronze|Platinum|Diamond|Ruby|Emerald|Sapphire|Titanium|Steel|Iron|Copper|Zinc|Nickel|Cobalt|Lithium|Sodium|Potassium|Calcium|Magnesium|Aluminium|Silicon|Phosphorus|Sulfur|Chlorine|Argon|Krypton|Xenon|Radon|Helium|Neon|Hydrogen|Oxygen|Nitrogen|Carbon|Boron|Beryllium|Fluorine|Zoiper|Reseller|Weekly|Monthly|RDP|Windows|Server|Datacenter|Desktop|Workstation|Home|Education|Student|Teacher|Family|Personal|Professional|Small|Medium|Large|Extra|Double|Triple|Quadruple|Single|Multi|Dual|Quad|Octa|Hexa|Penta|Tetra|Tri|Bi|Uni|Mono|Poly|Omni|Pan|Semi|Hemi|Demi|Pseudo|Quasi|Meta|Para|Ortho|Iso|Allo|Hetero|Homo|Auto|Self|Co|Counter|Anti|Pro|Pre|Post|Re|De|Un|Non|In|Im|Il|Ir|Dis|Mis|Over|Under|Out|Up|Down|Off|On|Fore|Back|Ex|Extra|Hyper|Hypo|Super|Supra|Sub|Infra|Inter|Intra|Trans|Ultra|Omni|Ambi|Amphi|Circum|Peri|Epi|Apo|Dia|Cata|Ana|Syn|Sym|Em|En|Endo|Exo|Ecto|Meso|Tele|Macro|Micro|Mega|Giga|Tera|Peta|Exa|Zetta|Yotta|Kilo|Hecto|Deca|Deci|Centi|Milli|Nano|Pico|Femto|Atto|Zepto|Yocto)\b/g

function stripNeutral(s) {
  return s
    .replace(/<\/?[a-z]+[^>]*>/gi, ' ')
    .replace(/\$\{[^}]*\}/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ')
    .replace(/\/[a-z_]+\b/g, ' ')
    .replace(/[@#]\w+/g, ' ')
    .replace(/\[[A-Za-z ]+\]/g, ' ')              // [Name] style variables
    .replace(/\b[A-Z]{2,}\d*\b/g, ' ')
    .replace(/\b[a-z]+\d+[a-z0-9]*\b/g, ' ')      // ns1, trc20...
    .replace(/\d+(st|nd|rd|th|x|s|m|h|d|ms|min|sec)\b/g, ' ')
}

// Words that are legitimately fine in a French string (shared vocabulary) — don't flag runs made only of these.
const FR_OK = new Set(['email', 'confirmation', 'session', 'support', 'active', 'audio', 'menu', 'trial', 'premium', 'golden', 'total', 'plan', 'plans', 'option', 'options', 'message', 'messages', 'contact', 'contacts', 'support', 'service', 'services', 'client', 'date', 'minutes', 'minute', 'simple', 'via', 'standard', 'transaction', 'transactions', 'description', 'information', 'instance', 'configuration', 'console', 'format', 'important', 'note', 'pour', 'par', 'sur', 'des', 'les', 'une', 'est', 'vous', 'votre', 'vos', 'avec', 'dans', 'pas', 'plus', 'tout', 'tous', 'cette', 'mode', 'type', 'nom', 'action', 'actions', 'section', 'solution', 'question', 'attention', 'budget', 'crypto', 'wallet', 'maintenance', 'admin', 'administrateur'])

const en = leaves(require(path.join(ROOT, 'js/lang/en.js')).en)
const tgt = leaves(require(path.join(ROOT, `js/lang/${lang}.js`))[lang])
const scriptRe = lang === 'zh' ? /[\u4e00-\u9fff]/ : lang === 'hi' ? /[\u0900-\u097f]/ : null
const COMMON_EN = /^(the|a|an|to|your|you|please|is|are|was|were|not|and|or|for|with|from|this|that|will|can|cannot|select|tap|enter|type|send|upload|found|valid|invalid|file|number|numbers|again|try|contact|support|instead|ready|proceed|change|choose|save|saved|delete|deleted|received|as|of|in|on|by|at|be|has|have|only|more|new|use|used|using|per|set|setup|start|started|failed|error|success|successfully|now|here|below|above|all|any|no|yes|done|next|back|cancel|skip|confirm|minutes|min|hours|days|week|month|year|balance|wallet|top|up|refund|refunded|payment|paid|pay|price|plan|domain|order|call|calls|caller|message|messages|audio|voice|greeting|template|templates|preset|presets|option|options|key|keys|press|pressed|wait|waiting|loading|processing|checking|searching|generating|downloading|saving|creating|removing|adding|updating|deleting|list|lists|contacts|emails|email|address|addresses|session|expired|reason|blocked|locked|available|unavailable|required|allowed|maximum|minimum|total|remaining|left|limit|rate|fee|cost|charge|charged|credit|credited|billed|billing|active|inactive|paused|resumed|enabled|disabled|off|been|into|which|what|when|where|who|how|why|than|then|them|they|their|there|these|those|some|such|very|just|also|about|after|before|between|under|over|each|every|other|another|same|different|should|would|could|may|might|must|do|does|did|get|got|make|made|take|give|go|see|know|want|need|needs|needed|let|keep|put|show|shown|run|open|check|checked|click|pick|too|few|many|much|most|less|least|both|either|first|last|previous|current|currently|already|still|yet|soon|later|today|tomorrow|always|never|once|if|it|its|we|our|us|me|my|i|he|she|his|her|out|down|like|via|while|until|within|without|through|during|against|along|around|because|but|so|though|although|unless|whether|yet|nor|per|free|trial|upgrade|renew|renewal|renewed|expire|expires|expiring|expiry|removed|remove|added|add|update|updated|create|created|connect|connected|connection|disconnect|disconnected|install|installed|reinstall|reset|restart|reboot|stop|stopped|running|online|offline|status|details|detail|summary|info|help|menu|home|main|settings|profile|account|accounts|user|users|password|username|login|logout|sign|register|registered|registration|verify|verified|verification|confirmed|confirmation|complete|completed|completing|pending|progress|finished|finish|ok|okay|sorry|thanks|thank|welcome|hello|hi|hey|dear|good|bad|great|best|better|worse|worst|high|low|higher|lower|fast|slow|quick|slowly|quickly|easy|hard|easily|hardly|simple|complex|simply|really|actually|probably|possibly|maybe|perhaps|certainly|definitely|absolutely|exactly|approximately|roughly|nearly|almost|quite|rather|pretty|fairly|somewhat|slightly|extremely|highly|deeply|strongly|weakly|barely|scarcely|merely|solely|purely|entirely|completely|totally|fully|partly|partially|mostly|mainly|largely|generally|usually|normally|typically|commonly|rarely|seldom|hardly|occasionally|sometimes|often|frequently|regularly|constantly|continuously|permanently|temporarily|immediately|instantly|directly|indirectly|automatically|manually|successfully|unsuccessfully|properly|correctly|incorrectly|wrongly|safely|securely|privately|publicly|openly|secretly|quietly|loudly|clearly|obviously|apparently|evidently|seemingly|supposedly|allegedly|reportedly|officially|unofficially|formally|informally|legally|illegally|physically|mentally|emotionally|financially|economically|politically|socially|culturally|historically|traditionally|originally|initially|finally|eventually|ultimately|lastly|firstly|secondly|thirdly|additionally|furthermore|moreover|however|nevertheless|nonetheless|otherwise|therefore|thus|hence|consequently|accordingly|meanwhile|afterwards|beforehand|subsequently|previously|formerly|recently|lately|newly|freshly|anew|afresh|again|twice|thrice|ever|forever|whenever|wherever|whatever|whoever|whichever|however|anyway|anyhow|anywhere|anytime|anyone|anybody|anything|everyone|everybody|everything|everywhere|someone|somebody|something|somewhere|nobody|nothing|nowhere|none|neither|each|either|both|all|several|various|numerous|countless|multiple|single|double|triple|half|quarter|third|whole|entire|full|empty|partial|complete|incomplete|finished|unfinished|ready|unready|prepared|unprepared|willing|unwilling|able|unable|capable|incapable|possible|impossible|likely|unlikely|certain|uncertain|sure|unsure|clear|unclear|obvious|subtle|visible|invisible|hidden|shown|known|unknown|familiar|unfamiliar|common|uncommon|rare|usual|unusual|normal|abnormal|regular|irregular|standard|nonstandard|typical|atypical|ordinary|extraordinary|special|general|specific|particular|exact|approximate|precise|imprecise|accurate|inaccurate|correct|incorrect|right|wrong|true|false|real|fake|genuine|counterfeit|original|copy|duplicate|unique|identical|similar|different|same|other|another|else|extra|additional|further|more|less|fewer|most|least|many|few|much|little|large|small|big|tiny|huge|enormous|massive|giant|miniature|microscopic|gift|gifted|skipped|rate|rates|cleaned|line|subject)$/i

const hits = []
for (const [k, v] of Object.entries(tgt)) {
  if (isSkipped(k, lang) || !(k in en)) continue
  const pieces = textPieces(v)
  const segs = []
  for (const p of pieces) {
    const cleaned = stripNeutral(p).replace(BRANDS, ' ')
    const re = /[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*)*/g
    let m
    while ((m = re.exec(cleaned))) {
      const words = m[0].split(/\s+/).filter(w => w.length >= 2)
      if (lang === 'fr') {
        // French: flag only if ≥MIN_WORDS words are common-English words (not shared vocab)
        const enWords = words.filter(w => COMMON_EN.test(w) && !FR_OK.has(w.toLowerCase()) && /^[a-zA-Z]+$/.test(w))
        if (enWords.length >= MIN_WORDS) segs.push(m[0].trim())
      } else {
        // zh/hi: any run of ≥MIN_WORDS Latin words where at least one is a common English word
        if (words.length >= MIN_WORDS && words.some(w => COMMON_EN.test(w))) segs.push(m[0].trim())
        else if (words.length === 1 && COMMON_EN.test(words[0]) && words[0].length >= 4 && MIN_WORDS <= 1) segs.push(m[0].trim())
      }
    }
  }
  if (segs.length) hits.push([k, [...new Set(segs)]])
}
console.log(`# ${lang}: ${hits.length} values with English segments`)
for (const [k, segs] of hits) console.log(`${k}\n    ${segs.map(s => JSON.stringify(s)).join('\n    ')}`)
