'use strict'
// Reads contact / lead files (.xlsx, .csv, .tsv, .txt or pasted text) into rows and works out which column holds
// the phone, name, email… (shared by the Telegram bot's Bulk IVR upload and the CloudIVR web Contacts tab).
const zlib = require('zlib')

const MAX_ROWS = 10000
const MAX_COLS = 40
const ROLES = ['phone', 'name', 'first_name', 'last_name', 'email', 'company', 'notes', 'keep', 'skip']

const fail = (code, message) => Object.assign(new Error(message), { code })

// ── .xlsx = a zip of XML parts ──
function unzip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw fail('bad_file', 'This Excel file looks damaged. Open it in Excel or Google Sheets and save it again.')
  const files = {}
  let p = buf.readUInt32LE(eocd + 16)
  for (let k = buf.readUInt16LE(eocd + 10); k > 0 && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; k--) {
    const nameLen = buf.readUInt16LE(p + 28)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen).replace(/^\/+/, '').toLowerCase()
    files[name] = { method: buf.readUInt16LE(p + 10), size: buf.readUInt32LE(p + 20), local: buf.readUInt32LE(p + 42) }
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
  }
  return (name) => {
    const f = files[String(name).replace(/^\/+/, '').toLowerCase()]
    if (!f) return null
    const start = f.local + 30 + buf.readUInt16LE(f.local + 26) + buf.readUInt16LE(f.local + 28)
    const data = buf.subarray(start, start + f.size)
    return (f.method === 8 ? zlib.inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 }) : data).toString('utf8')
  }
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unxml = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()]))
const textOf = (xml) => unxml((String(xml).replace(/<(\w+:)?rPh\b[\s\S]*?<\/(\w+:)?rPh>/g, '')
  .match(/<(?:\w+:)?t\b[^>]*>[\s\S]*?<\/(?:\w+:)?t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''))
const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
// Excel keeps long numbers (phone numbers typed as numbers) as 14155550100 or 1.4155550100E10.
function numText(v) {
  const n = Number(v)
  return Number.isFinite(n) && Math.abs(n) >= 1e6 && Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : v
}

function sheetRows(xml, shared) {
  const rows = []
  const rowRe = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g
  let m
  while ((m = rowRe.exec(xml)) && rows.length <= MAX_ROWS) {
    const r = Number((/\br="(\d+)"/.exec(m[1]) || [])[1])
    while (r && rows.length < r - 1 && rows.length <= MAX_ROWS) rows.push([])
    const row = []
    const cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g
    let c, col = 0
    while ((c = cellRe.exec(m[2] || ''))) {
      const ref = /\br="([A-Z]+)\d*"/.exec(c[1])
      if (ref) col = colIndex(ref[1])
      if (col < MAX_COLS) {
        const t = (/\bt="(\w+)"/.exec(c[1]) || [])[1]
        const body = c[2] || ''
        const v = (/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body) || [])[1]
        let val = ''
        if (t === 's') val = shared[Number(v)] ?? ''
        else if (t === 'inlineStr') val = textOf(body)
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE'
        else if (v != null) val = t === 'str' || t === 'e' ? unxml(v) : numText(unxml(v))
        row[col] = String(val).trim()
      }
      col++
    }
    rows.push(Array.from(row, x => x || ''))
  }
  return rows
}

function readXlsx(buf) {
  const get = unzip(buf)
  const shared = [...(get('xl/sharedStrings.xml') || '').matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(s => textOf(s[1]))
  const book = get('xl/workbook.xml') || ''
  const rels = get('xl/_rels/workbook.xml.rels') || ''
  const targets = {}
  for (const rel of rels.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
    const id = (/\bId="([^"]+)"/.exec(rel[0]) || [])[1], target = (/\bTarget="([^"]+)"/.exec(rel[0]) || [])[1]
    if (id && target) targets[id] = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  }
  const paths = [...book.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)].map(s => targets[(/\br:id="([^"]+)"/.exec(s[0]) || /\bid="([^"]+)"/i.exec(s[0]) || [])[1]]).filter(Boolean)
  if (!paths.length) paths.push('xl/worksheets/sheet1.xml')
  for (const p of paths) {
    const xml = get(p)
    const rows = xml ? sheetRows(xml, shared) : []
    if (rows.some(r => r.some(Boolean))) return rows
  }
  return []
}

// ── text (.csv / .tsv / .txt / pasted) ──
function looksBinary(content) {
  const sample = String(content || '').slice(0, 4000)
  if (!sample) return false
  if (sample.includes('\u0000') || sample.includes('\uFFFD')) return true
  // eslint-disable-next-line no-control-regex
  const bad = (sample.match(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFC]/g) || []).length
  return bad >= 8 && bad / sample.length > 0.1
}

function decodeText(buf) {
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le', 2)
  const s = buf.toString('utf8')
  // Windows-1252 CSVs (accented names) are not valid UTF-8.
  return s.includes('\uFFFD') && !buf.includes(0) ? buf.toString('latin1') : s
}

function csvRows(text, delim) {
  const rows = []
  let row = [], cell = '', q = false
  for (let i = 0; i < text.length && rows.length <= MAX_ROWS; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch
    } else if (ch === '"' && !cell.trim()) { q = true; cell = '' } else if (ch === delim) { row.push(cell.trim()); cell = '' } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell.trim()); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row) }
  return rows
}

function textRows(text) {
  const s = String(text || '').replace(/^\uFEFF/, '')
  const sample = s.split(/\r\n|\n|\r/).filter(l => l.trim() && !l.trim().startsWith('#')).slice(0, 50)
  const [delim, hits] = [',', ';', '\t', '|'].map(d => [d, sample.filter(l => l.includes(d)).length]).sort((a, b) => b[1] - a[1])[0]
  return hits ? csvRows(s, delim) : s.split(/\r\n|\n|\r/).slice(0, MAX_ROWS + 1).map(l => [l.trim()])
}

// Any input → rows of trimmed strings (comment lines starting with # dropped).
function readTable(input, fileName = '') {
  let rows
  if (Buffer.isBuffer(input)) {
    const ext = (String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1]
    if (input.length >= 4 && input.readUInt32LE(0) === 0x04034b50) {
      if (ext && !['xlsx', 'xlsm'].includes(ext)) throw fail('unsupported', 'This file type is not supported. Upload an Excel (.xlsx), .csv or .txt file.')
      rows = readXlsx(input)
    } else if (input.length >= 4 && input.readUInt32LE(0) === 0xE011CFD0) {
      throw fail('old_excel', 'This is an old Excel (.xls) file. Open it in Excel or Google Sheets, save it as .xlsx or .csv, then upload it again.')
    } else {
      const text = decodeText(input)
      if (looksBinary(text)) throw fail('binary', 'This file is not a spreadsheet or text file. Upload an Excel (.xlsx), .csv or .txt file.')
      rows = textRows(text)
    }
  } else {
    if (looksBinary(input)) throw fail('binary', 'This file is not a spreadsheet or text file. Upload an Excel (.xlsx), .csv or .txt file.')
    rows = textRows(input)
  }
  rows = rows.map(r => r.slice(0, MAX_COLS).map(c => String(c ?? '').trim())).filter(r => !String(r[0] || '').startsWith('#'))
  while (rows.length && !rows[0].some(Boolean)) rows.shift()
  while (rows.length && !rows[rows.length - 1].some(Boolean)) rows.pop()
  return rows
}

// ── numbers ──
// NANP fix (2026-02 @blacknmilds): a bare 10-digit US/Canada number must become +1…, not +40… (Romania).
function normalizeNumber(raw) {
  let number = String(raw || '').replace(/["'\s]/g, '').replace(/[^\d+]/g, '')
  if (!number.startsWith('+')) {
    if (/^\d{10}$/.test(number)) number = '+1' + number
    else if (/^1\d{10}$/.test(number)) number = '+' + number
    else number = '+' + number.replace(/^0+/, '')
  }
  number = number.replace(/[^+\d]/g, '')
  return /^\+\d{8,15}$/.test(number) ? number : null
}
const DATE = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})$/
const looksPhone = (v) => !!v && /^[\d\s+().\-/]+$/.test(v) && !DATE.test(v.trim()) && !!normalizeNumber(v)
const looksEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

// ── column matching ──
const norm = (h) => String(h || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const EXACT = {
  phone: 'phone phonenumber phoneno number numbers mobile mobilenumber mobilephone mobileno cell cellphone cellnumber tel telephone telefone telefono contactnumber whatsapp msisdn numero numerodetelephone portable handy celular movil lead leads to destination primaryphone',
  name: 'name fullname contact contactname customer customername client clientname nom nombre displayname leadname person',
  first_name: 'first firstname givenname fname prenom forename',
  last_name: 'last lastname surname familyname lname apellido',
  email: 'email emailaddress mail courriel correo',
  company: 'company companyname business businessname organization organisation org employer entreprise societe empresa firm',
  notes: 'notes note comment comments remarks remark description memo',
}
const EXACT_MAP = Object.fromEntries(Object.entries(EXACT).flatMap(([role, words]) => words.split(' ').map(w => [w, role])))
function headerRole(h) {
  const n = norm(h)
  if (!n) return null
  if (EXACT_MAP[n]) return EXACT_MAP[n]
  if (n.includes('mail')) return 'email'
  if (/phone|mobile|cell|whatsapp|^tel|tel$|number$|^num/.test(n)) return 'phone'
  if (/first|given|prenom/.test(n)) return 'first_name'
  if (/last|surname|family/.test(n)) return 'last_name'
  if (/compan|business|organi|employer|firm/.test(n)) return 'company'
  if (/note|comment|remark/.test(n)) return 'notes'
  if (/name/.test(n)) return 'name'
  return null
}

// Guesses whether row 1 is a header and the role of every column. Returns { hasHeader, columns: [{ index, header, role, samples }] }.
function detectColumns(rows) {
  const first = rows[0] || []
  const hasHeader = first.some(c => /[a-z]/i.test(c)) && !first.some(looksPhone) && !first.some(looksEmail)
  const data = rows.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + 200)
  const width = Math.min(MAX_COLS, Math.max(first.length, ...data.map(r => r.length), 0))
  const stats = Array.from({ length: width }, (_, i) => {
    const vals = data.map(r => r[i] || '').filter(Boolean)
    const share = (fn) => (vals.length ? vals.filter(fn).length / vals.length : 0)
    return { filled: vals.length, phone: share(looksPhone), email: share(looksEmail), text: share(v => /[a-z]/i.test(v) && !looksEmail(v)), samples: vals.slice(0, 3) }
  })
  const roles = stats.map((s, i) => (hasHeader ? headerRole(first[i]) : null))
  // One phone column: the best phone-looking column among the "phone" headers, else the best by content.
  const best = (idx, key) => idx.reduce((b, i) => (b < 0 || stats[i][key] > stats[b][key] ? i : b), -1)
  const all = stats.map((_, i) => i)
  let phone = best(all.filter(i => roles[i] === 'phone'), 'phone')
  if (phone < 0 || stats[phone].phone < 0.5) { const byContent = best(all, 'phone'); if (byContent >= 0 && stats[byContent].phone > (phone < 0 ? 0 : stats[phone].phone)) phone = byContent }
  if (!hasHeader && phone < 0 && width) phone = 0
  roles.forEach((r, i) => { if (r === 'phone' && i !== phone) roles[i] = 'keep' })
  if (phone >= 0) roles[phone] = 'phone'
  if (!hasHeader) {
    const email = best(all.filter(i => i !== phone), 'email')
    if (email >= 0 && stats[email].email >= 0.5) roles[email] = 'email'
    const name = all.find(i => !roles[i] && stats[i].text >= 0.5)
    if (name != null) roles[name] = 'name'
  }
  const seen = new Set()
  const columns = stats.map((s, i) => {
    let role = roles[i] || (s.filled || (hasHeader && first[i]) ? 'keep' : 'skip')
    if (!['keep', 'skip'].includes(role)) { if (seen.has(role)) role = 'keep'; seen.add(role) }
    return { index: i, header: (hasHeader && first[i]) || `Column ${i + 1}`, role, samples: s.samples }
  })
  return { hasHeader, columns }
}

// eslint-disable-next-line no-control-regex
const clip = (v, n) => String(v || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)

// Rows + column roles → contacts. Rows without a valid phone are reported in `invalid`; repeats of a number keep the first.
function toRecords(rows, { hasHeader, columns }) {
  const roleOf = (role) => columns.find(c => c.role === role)?.index
  const at = { phone: roleOf('phone'), name: roleOf('name'), first: roleOf('first_name'), last: roleOf('last_name'), email: roleOf('email'), company: roleOf('company'), notes: roleOf('notes') }
  const keep = columns.filter(c => c.role === 'keep').slice(0, 20)
  const records = [], invalid = [], seen = new Set()
  let dupes = 0
  rows.forEach((r, i) => {
    if (hasHeader && i === 0) return
    if (!r.some(Boolean)) return
    const raw = at.phone != null ? r[at.phone] || '' : ''
    const phone = at.phone != null ? normalizeNumber(raw) : null
    if (!phone) { invalid.push({ row: i + 1, value: clip(raw || r.filter(Boolean).join(', '), 30).replace(/[<>&]/g, '') }); return }
    if (seen.has(phone)) { dupes++; return }
    seen.add(phone)
    const name = at.name != null ? r[at.name] : [r[at.first], r[at.last]].filter(Boolean).join(' ')
    const email = clip(r[at.email], 120)
    records.push({
      row: i + 1, phone, name: clip(name, 80), email: looksEmail(email) ? email : '', company: clip(r[at.company], 120),
      notes: String(r[at.notes] || '').trim().slice(0, 2000),
      fields: keep.map(c => ({ label: clip(c.header, 40), value: clip(r[c.index], 200) })).filter(f => f.label && f.value),
    })
  })
  return { records, invalid, dupes }
}

// Bulk IVR leads from any file/text: { leads: [{ number, name }], errors, columns: { phone, name } | null }.
function parseLeads(input, fileName) {
  const rows = readTable(input, fileName)
  const det = detectColumns(rows)
  const { records, invalid } = toRecords(rows, det)
  const head = (role) => det.columns.find(c => c.role === role)?.header || null
  const nameCol = head('name') || [head('first_name'), head('last_name')].filter(Boolean).join(' + ') || null
  return {
    leads: records.map(r => ({ number: r.phone, name: r.name.replace(/[^\x20-\x7E\u00A0-\uFFFC]/g, '').slice(0, 60) || null })),
    errors: det.columns.some(c => c.role === 'phone') ? invalid.map(x => `Line ${x.row}: Invalid number "${x.value}"`) : ['No phone number column found. Add a column called Phone with numbers in it.'],
    columns: det.hasHeader ? { phone: head('phone'), name: nameCol } : null,
  }
}

module.exports = { readTable, detectColumns, toRecords, parseLeads, normalizeNumber, looksBinary, ROLES, MAX_ROWS }
