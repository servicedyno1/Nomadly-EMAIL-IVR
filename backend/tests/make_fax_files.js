// Generates fax test fixtures: 1-page and 3-page PDFs, a PNG and a JPG-ish bad file into /tmp/faxfx
const fs = require('fs')
const { PDFDocument } = require('/app/node_modules/pdf-lib')
;(async () => {
  fs.mkdirSync('/tmp/faxfx', { recursive: true })
  for (const n of [1, 3, 51]) {
    const d = await PDFDocument.create()
    for (let i = 0; i < n; i++) d.addPage([612, 792]).drawText(`TEST_ fax page ${i + 1}`, { x: 50, y: 700, size: 24 })
    fs.writeFileSync(`/tmp/faxfx/p${n}.pdf`, Buffer.from(await d.save()))
  }
  // 1x1 PNG
  fs.writeFileSync('/tmp/faxfx/img.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
  fs.writeFileSync('/tmp/faxfx/bad.txt', 'hello world not a pdf')
  console.log('ok')
})()
