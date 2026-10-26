// node js/tests/test_contacts_import_2026-10.js — smart column matching + .xlsx reading (no DB, no network).
const assert = require('assert')
const zlib = require('zlib')
const ci = require('../contacts-import')
const { parseLeadsFile } = require('../bulk-call-service')

// Minimal .xlsx (shared strings + inline string + numeric phone) built in memory.
function zip(files) {
  const locals = [], centrals = []
  let off = 0
  for (const [name, text] of Object.entries(files)) {
    const data = zlib.deflateRawSync(Buffer.from(text)), n = Buffer.from(name)
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt16LE(n.length, 26)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42)
    locals.push(lh, n, data); centrals.push(ch, n); off += 30 + n.length + data.length
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16)
  return Buffer.concat([...locals, cd, end])
}
const xlsx = zip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Full Name</t></si><si><t>Cell</t></si><si><r><t>Jane </t></r><r><t>Doe</t></r></si><si><t>City</t></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>3</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>14155550100</v></c><c r="C2" t="inlineStr"><is><t>SF &amp; Bay</t></is></c></row>' +
    '<row r="4"><c r="A4" t="inlineStr"><is><t>Bob</t></is></c><c r="B4"><v>4.4770090012300003E11</v></c></row></sheetData></worksheet>',
})

let n = 0
const ok = (name, fn) => { fn(); n++; console.log('✓', name) }

ok('xlsx rows read (shared, rich, inline, numeric, row gaps)', () => {
  const rows = ci.readTable(xlsx, 'a.xlsx')
  assert.deepStrictEqual(rows[0], ['Full Name', 'Cell', 'City'])
  assert.deepStrictEqual(rows[1], ['Jane Doe', '14155550100', 'SF & Bay'])
  assert.deepStrictEqual(rows[3], ['Bob', '447700900123'])
})
ok('xlsx leads: phone + name columns found by header', () => {
  const r = parseLeadsFile(xlsx, 'a.xlsx')
  assert.deepStrictEqual(r.leads, [{ number: '+14155550100', name: 'Jane Doe' }, { number: '+447700900123', name: 'Bob' }])
  assert.deepStrictEqual(r.columns, { phone: 'Cell', name: 'Full Name' })
})
ok('csv with header in any order + first/last name + extra column', () => {
  const rows = ci.readTable('Email;Last name;First name;Mobile;Zip\njo@x.io;Smith;Jo;(415) 555-0101;94107\n')
  const det = ci.detectColumns(rows)
  assert.deepStrictEqual(det.columns.map(c => c.role), ['email', 'last_name', 'first_name', 'phone', 'keep'])
  const { records } = ci.toRecords(rows, det)
  assert.strictEqual(records[0].name, 'Jo Smith')
  assert.deepStrictEqual(records[0].fields, [{ label: 'Zip', value: '94107' }])
})
ok('headerless: phone column found by content, name by text', () => {
  const r = parseLeadsFile('Jane,+14155550100\nBob,4155550101\n')
  assert.deepStrictEqual(r.leads.map(l => [l.number, l.name]), [['+14155550100', 'Jane'], ['+14155550101', 'Bob']])
})
ok('legacy number-per-line + NANP + duplicates + invalid line', () => {
  const r = parseLeadsFile('4065067340\n+14065067340,Dup\nnotaphone\n')
  assert.deepStrictEqual(r.leads.map(l => l.number), ['+14065067340'])
  assert.strictEqual(r.errors.length, 1)
})
ok('quoted csv cells with commas and newlines', () => {
  const rows = ci.readTable('Name,Phone,Notes\n"Doe, Jane",+14155550100,"line1\nline2"\n')
  assert.deepStrictEqual(rows[1], ['Doe, Jane', '+14155550100', 'line1\nline2'])
})
ok('old .xls and binary files are refused with a clear message', () => {
  assert.ok(parseLeadsFile(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), 'a.xls').binary)
  assert.ok(parseLeadsFile(Buffer.from('%PDF\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008'.repeat(20)), 'a.txt').binary)
})
ok('no phone column with a header → one clear error', () => {
  const r = parseLeadsFile('Name,City\nJane,SF\n')
  assert.strictEqual(r.leads.length, 0)
  assert.match(r.errors[0], /No phone number column/)
})
console.log(`\n${n} passed`)
process.exit(0)
