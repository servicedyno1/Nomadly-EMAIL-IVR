// TEMP diagnostic v2 — with a REAL file present, determine correct ABSOLUTE-path
// params for extract/rename/move/copy on live namea3a5. User-authorized. Cleans up.
require('../config-setup')
const cp = require('../cpanel-proxy')
const user = 'namea3a5', host = process.env.WHM_HOST, HOME = `/home/${user}`
const ZIP_B64 = 'UEsDBBQAAAAIADk5NF27IaNVIgAAACAAAAAJAAAAaGVsbG8udHh0y8hUSCvKz1XIK48vSy3KTKtUSK0oKUpMLlEoKMpPSuUCAFBLAQIUAxQAAAAIADk5NF27IaNVIgAAACAAAAAJAAAAAAAAAAAAAACAAQAAAABoZWxsby50eHRQSwUGAAAAAAEAAQA3AAAASQAAAAAA'
const P = 'public_html/nwprobe2'
const AP = `${HOME}/${P}`
const fileop = (params) => cp.api2ViaWhmRoot(user, 'Fileman', 'fileop', { doubledecode: 0, ...params }, host)
const list = async (dir) => { const r = await cp.uapiViaWhmRoot(user, 'Fileman', 'list_files', { dir, types: 'dir|file' }, host); return Array.isArray(r.data) ? r.data.map(f => f.file) : `ERR(${JSON.stringify(r.errors)})` }
const d0 = (r) => JSON.stringify({ status: r.status, err: r.errors, dest: Array.isArray(r.data) && r.data[0] ? r.data[0].dest : undefined, src: Array.isArray(r.data) && r.data[0] ? r.data[0].src : undefined })

;(async () => {
  await fileop({ op: 'trash', sourcefiles: AP }).catch(() => {})
  console.log('mkdir:', (await cp.api2ViaWhmRoot(user, 'Fileman', 'mkdir', { path: 'public_html', name: 'nwprobe2' }, host)).status)
  // create a real file via session save
  const sv = await cp.uapiViaSession(user, 'Fileman', 'save_file_content', { dir: P, file: 't.txt', content: 'hello-move-test' }, 'POST', host)
  console.log('save t.txt:', sv.status, sv.errors || sv.via)
  // upload zip via session multipart
  const up = await cp.uploadFileViaSession(user, P, 'nw_verify.zip', Buffer.from(ZIP_B64, 'base64'), host)
  console.log('upload zip (session):', up.status, up.errors || up.via)
  console.log('dir after setup:', await list(P))

  console.log('\n=== EXTRACT abs src + abs dest (=dir, no destDir) ===')
  const ex = await fileop({ op: 'extract', sourcefiles: `${AP}/nw_verify.zip`, destfiles: AP })
  console.log('resp', d0(ex)); console.log('dir now:', await list(P))

  console.log('\n=== RENAME abs (t.txt -> t_renamed.txt full path) ===')
  const rn = await fileop({ op: 'rename', sourcefiles: `${AP}/t.txt`, destfiles: `${AP}/t_renamed.txt` })
  console.log('resp', d0(rn)); console.log('dir now:', await list(P))

  console.log('\n=== MOVE variant 1: destfiles = DIR (abs) ===')
  await cp.api2ViaWhmRoot(user, 'Fileman', 'mkdir', { path: P, name: 'sub' }, host)
  const mv1 = await fileop({ op: 'move', sourcefiles: `${AP}/t_renamed.txt`, destfiles: `${AP}/sub` })
  console.log('resp', d0(mv1)); console.log('sub now:', await list(`${P}/sub`), '| dir now:', await list(P))

  console.log('\n=== MOVE variant 2: destfiles = DIR/FILENAME (abs) — move it back ===')
  const mv2 = await fileop({ op: 'move', sourcefiles: `${AP}/sub/t_renamed.txt`, destfiles: `${AP}/t_renamed.txt` })
  console.log('resp', d0(mv2)); console.log('dir now:', await list(P), '| sub now:', await list(`${P}/sub`))

  console.log('\n=== COPY variant: destfiles = DIR (abs) — copy sub? actually copy t_renamed into sub ===')
  const cpv = await fileop({ op: 'copy', sourcefiles: `${AP}/t_renamed.txt`, destfiles: `${AP}/sub` })
  console.log('resp', d0(cpv)); console.log('sub now:', await list(`${P}/sub`), '| dir now:', await list(P))

  console.log('\n=== CLEANUP ===')
  console.log('trash:', (await fileop({ op: 'trash', sourcefiles: AP })).status)
  process.exit(0)
})().catch(e => { console.error('EXC', e.message); process.exit(1) })
