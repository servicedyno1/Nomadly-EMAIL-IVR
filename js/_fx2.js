const f = require('./multitel/fax'), mt = require('./multitel')
const { PDFDocument, StandardFonts } = require('pdf-lib')
;(async () => {
  const inv = (await mt.api('get', 'inventory')).response.filter(n => /680681101[25]/.test(n.number)).map(n => ({ n: n.number, cfg: n.config, f: n.features, fax: n.fax || n.faxdetect || n.config?.faxdetect }))
  console.log(JSON.stringify(inv).slice(0, 700))
  const doc = await PDFDocument.create(); const pg = doc.addPage([612, 792]); pg.drawText('CloudIVR fax test 2', { x: 60, y: 700, size: 18, font: await doc.embedFont(StandardFonts.Helvetica) })
  console.log('sent', await f.sendFax({ from: '+16806811012', to: '+16806811015', pdf: Buffer.from(await doc.save()) }).catch(e => 'ERR ' + e.message))
  process.exit(0)
})()
