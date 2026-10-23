// Collects every user-facing English string of the CloudIVR web app (UI + API messages + catalogue data)
// into /app/scripts/civr_strings.json for scripts/civr_i18n_translate.py. Run: node scripts/civr_i18n_extract.js
const fs = require('fs')
const path = require('path')
const parser = require('/app/frontend/node_modules/@babel/parser')

const ROOT = '/app'
const UI = path.join(ROOT, 'frontend/src/cloudivr')
const API = path.join(ROOT, 'js/cloudivr-web')
const out = new Set()

const SKIP_ATTR = new Set(['className', 'data-testid', 'key', 'type', 'href', 'to', 'src', 'id', 'role', 'value', 'name', 'autoComplete', 'inputMode', 'accept', 'target', 'rel', 'dir', 'testid', 'prefix', 'by', 'method', 'tone', 'align', 'mode', 'kind', 'path', 'lang', 'htmlFor', 'style', 'pattern', 'action', 'icon', 'sizes', 'preload'])
const SKIP_CALL = /^(api|useApi|cp|appPath|require|log|notifyAdmin|localStorage\.\w+|sessionStorage\.\w+|querySelector|querySelectorAll|createIndex|collection|includes|startsWith|endsWith|split|replace|join|getItem|setItem|removeItem|test|match|indexOf|createElement|addEventListener|removeEventListener|getAttribute|setAttribute|hasAttribute|closest|fetch|toLocaleString|toLocaleDateString|padStart|get|set|has|params\.get|find|findOne|updateOne|insertOne|countDocuments|aggregate|distinct|deleteOne|deleteMany|updateMany|findOneAndUpdate|router\.\w+|r\.\w+|res\.\w+|app\.\w+|db\.\w+|crypto\.\w+|downloadFile|navigator\.\w+|setParams|nav|sendMail)$/
const STATUS = new Set(['active', 'running', 'completed', 'paused', 'scheduled', 'created', 'cancelled', 'failed', 'pending', 'preview', 'renews', 'expires', 'voice', 'sms', 'fax', 'transferred', 'credited', 'waiting', 'suspended', 'expired', 'released', 'collecting', 'answered', 'verification', 'awaiting_payment', 'underpaid', 'activating', 'notCalled', 'calling', 'forward', 'message', 'voicemail', 'submenu', 'transfer', 'missed', 'inbound', 'outbound', 'local', 'mobile', 'national', 'none', 'on', 'off', 'open', 'closed', 'done', 'empty'])
const KEEP = new Set(['PREVIEW-MODE-DO-NOT-SEND-FUNDS', 'Des numéros qui', ', routent et appellent pour vous.', 'Números que', ', enrutan y llaman por ti.', '{0} Reply in {1}{2}.', 'CloudIVR', 'CLOUD', 'IVR', 'SIP', 'SMS', 'OTP', 'USD', 'UDP', 'TCP', 'TLS', 'PDF', 'CSV', 'Telegram', 'Starter', 'Pro', 'Business', 'Zoiper', 'Linphone', 'MicroSIP', 'Google', 'DynoPay'])
// A className list: every token looks like a utility class (has - : [ / or is a bare utility word).
const UTIL = new Set(['flex', 'grid', 'block', 'hidden', 'inline', 'relative', 'absolute', 'fixed', 'sticky', 'truncate', 'underline', 'uppercase', 'lowercase', 'capitalize', 'italic', 'shrink', 'grow', 'border', 'rounded', 'shadow', 'ring', 'transition', 'container', 'contents', 'invisible', 'visible', 'static', 'isolate', 'outline', 'antialiased', 'civr'])
const isClassList = (s) => s.split(/\s+/).filter(t => !/^\{\d+\}$/.test(t)).every(t => /^!?[a-z0-9]/.test(t) && (/[-:\[\/]/.test(t) || UTIL.has(t)) && !/[A-Z]/.test(t))

function norm(s) { return String(s).replace(/\s+/g, ' ').trim() }
function keep(s, { single = true } = {}) {
  s = norm(s)
  if (!s || !/[A-Za-z]/.test(s) || s.length > 600) return
  if (KEEP.has(s)) return
  if (/^\/(month|min|mo|year|SMS)\b/.test(s)) { out.add(s); return }
  if (/^(https?:|\/|#|\.|\$\{|data:|mailto:)/.test(s) || /\.(js|css|png|svg|mp3|json)$/.test(s)) return
  if (isClassList(s)) return
  if (!/\s/.test(s)) {
    if (STATUS.has(s)) { out.add(s); return }
    if (!single || !/^[A-Z][a-zA-Z'’-]+[.!?…:]?$/.test(s)) return
    if (/^[A-Z][a-z]+[A-Z]/.test(s)) return // camelCase identifiers
  }
  out.add(s)
}

function calleeName(n) {
  if (!n) return ''
  if (n.type === 'Identifier') return n.name
  if (n.type === 'MemberExpression') return `${calleeName(n.object)}.${n.property.name || ''}`.replace(/^.*\.(\w+\.\w+)$/, '$1')
  return ''
}
function skipByParent(stack, node) {
  for (let i = stack.length - 1; i >= 0; i--) {
    const p = stack[i]
    if (p.type === 'ImportDeclaration' || p.type === 'ExportAllDeclaration') return true
    if (p.type === 'JSXAttribute') return SKIP_ATTR.has(p.name.name)
    if (p.type === 'CallExpression') {
      const c = calleeName(p.callee), last = c.split('.').pop()
      if (SKIP_CALL.test(c) || SKIP_CALL.test(last)) return true
      return false
    }
    if (p.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(p.operator)) return true
    if (p.type === 'SwitchCase') return (stack[i + 1] || node) === p.test
    if (p.type === 'TaggedTemplateExpression') return true
    if (p.type === 'MemberExpression' && p.computed) return true
    if (['JSXExpressionContainer', 'ReturnStatement', 'ArrowFunctionExpression', 'VariableDeclarator', 'ObjectProperty', 'ArrayExpression', 'ConditionalExpression', 'LogicalExpression', 'NewExpression', 'AssignmentExpression'].includes(p.type)) {
      if (p.type === 'ObjectProperty' && stack[i + 1] === p.key) return true
      continue
    }
  }
  return false
}

function walk(node, stack, file) {
  if (!node || typeof node.type !== 'string') return
  if (node.type === 'JSXText') keep(node.value)
  else if (node.type === 'StringLiteral' && !skipByParent(stack, node)) {
    const parent = stack[stack.length - 1]
    if (!(parent && parent.type === 'ObjectProperty' && parent.key === node)) keep(node.value)
  } else if (node.type === 'TemplateLiteral' && !skipByParent(stack, node)) {
    const pat = node.quasis.map((q, i) => (q.value.cooked || '') + (i < node.expressions.length ? `{${i}}` : '')).join('')
    const lit = pat.replace(/\{\d+\}/g, '')
    if (/[A-Za-z]{2}/.test(lit) && (/\s/.test(lit.trim()) || /[A-Z]/.test(lit))) keep(pat, { single: false })
  }
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'extra' || k === 'leadingComments' || k === 'trailingComments') continue
    const v = node[k]
    if (Array.isArray(v)) v.forEach(c => walk(c, [...stack, node], file))
    else if (v && typeof v.type === 'string') walk(v, [...stack, node], file)
  }
}

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) return d.name === 'i18n' ? [] : files(p)
    return /\.js$/.test(d.name) ? [p] : []
  })
}

for (const f of [...files(UI), ...files(API)]) {
  if (/domain-guard|voicemail-delivery/.test(f)) continue
  const src = fs.readFileSync(f, 'utf8')
  const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator'], errorRecovery: true })
  walk(ast.program, [], f)
}

// Catalogue data shown in the UI (plans, countries, templates, voices).
process.env.WEB_CLOUDIVR_DRY_RUN = process.env.WEB_CLOUDIVR_DRY_RUN || 'true'
const numbers = require(path.join(API, 'numbers.js'))
const outbound = require(path.join(API, 'outbound.js'))
const c = numbers.catalog()
for (const p of c.plans) { p.features.forEach(x => keep(x)); p.webFeatures.forEach(x => keep(x.label)) }
c.countries.forEach(x => keep(x.name))
Object.values(c.typeNames).forEach(x => keep(x))
const t = outbound.templates()
t.categories.forEach(x => keep(x.name)); t.templates.forEach(x => keep(x.name))
Object.values(t.smart).forEach(s => { keep(s.label); s.hint && keep(s.hint); (s.presets || []).forEach(x => keep(x, { single: false })) })
for (const m of fs.readFileSync(path.join(ROOT, 'js/tts-service.js'), 'utf8').matchAll(/desc:\s*'([^']+)'/g)) keep(m[1])
for (const m of fs.readFileSync(path.join(ROOT, 'js/ivr-templates.js'), 'utf8').matchAll(/name:\s*'([^']+)'/g)) keep(m[1])
out.add('{0} new'); keep('Voicemail'); keep('Sales'); keep('Support'); keep('Billing'); keep('Operator'); keep('My phone')

const list = [...out].sort()
fs.writeFileSync('/app/scripts/civr_strings.json', JSON.stringify(list, null, 1))
console.log(`${list.length} strings → /app/scripts/civr_strings.json`)
