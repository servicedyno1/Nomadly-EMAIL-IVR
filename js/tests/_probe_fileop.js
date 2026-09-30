// TEMP diagnostic — determines correct cPanel API2 fileop params for extract/
// move/rename/copy on live namea3a5. User explicitly authorized testing this
// (upload zip → extract → verify). Cleans up after itself.
require('../config-setup')
const cp = require('../cpanel-proxy')

const user = 'namea3a5'
const host = process.env.WHM_HOST
const HOME = `/home/${user}`
const ZIP_B64 = 'UEsDBBQAAAAIADk5NF27IaNVIgAAACAAAAAJAAAAaGVsbG8udHh0y8hUSCvKz1XIK48vSy3KTKtUSK0oKUpMLlEoKMpPSuUCAFBLAQIUAxQAAAAIADk5NF27IaNVIgAAACAAAAAJAAAAAAAAAAAAAACAAQAAAABoZWxsby50eHRQSwUGAAAAAAEAAQA3AAAASQAAAAAA'

const fileop = (params) => cp.api2ViaWhmRoot(user, 'Fileman', 'fileop', { doubledecode: 0, ...params }, host)
const list = async (dir) => {
  const r = await cp.uapiViaWhmRoot(user, 'Fileman', 'list_files', { dir, types: 'dir|file' }, host)
  return Array.isArray(r.data) ? r.data.map(f => f.file || f.fullname) : `(status ${r.status} ${JSON.stringify(r.errors)})`
}
const showData = (r) => JSON.stringify({ status: r.status, via: r.via, errors: r.errors, d0: Array.isArray(r.data) ? r.data[0] : r.data })

;(async () => {
  console.log('HOME=', HOME)
  // 0) fresh probe dir
  await fileop({ op: 'trash', sourcefiles: `${HOME}/public_html/nwprobe` }).catch(() => {})
  const mk = await cp.api2ViaWhmRoot(user, 'Fileman', 'mkdir', { path: 'public_html', name: 'nwprobe' }, host)
  console.log('mkdir nwprobe:', mk.status, mk.errors || '')

  // upload zip into nwprobe
  const up = await cp.uploadFileAsRoot(user, 'public_html/nwprobe', 'nw_verify.zip', Buffer.from(ZIP_B64, 'base64'), host)
  console.log('upload zip:', up.status, up.errors || up.via || '')
  console.log('nwprobe after upload:', await list('public_html/nwprobe'))

  // === EXTRACT test: ABSOLUTE source + ABSOLUTE dest ===
  console.log('\n=== EXTRACT (absolute src+dest → HOME/public_html/nwprobe) ===')
  const ex = await fileop({ op: 'extract', sourcefiles: `${HOME}/public_html/nwprobe/nw_verify.zip`, destfiles: `${HOME}/public_html/nwprobe` })
  console.log('extract resp:', showData(ex))
  console.log('nwprobe after extract:', await list('public_html/nwprobe'))
  console.log('nested nwprobe/public_html?:', await list('public_html/nwprobe/public_html'))

  // === RENAME test: ABSOLUTE ===
  console.log('\n=== RENAME (absolute hello.txt -> hi_renamed.txt) ===')
  const rn = await fileop({ op: 'rename', sourcefiles: `${HOME}/public_html/nwprobe/hello.txt`, destfiles: `${HOME}/public_html/nwprobe/hi_renamed.txt` })
  console.log('rename resp:', showData(rn))
  console.log('nwprobe after rename:', await list('public_html/nwprobe'))

  // === MOVE test: ABSOLUTE (make a subdir, move file into it) ===
  console.log('\n=== MOVE (absolute hi_renamed.txt -> nwprobe/sub/) ===')
  await cp.api2ViaWhmRoot(user, 'Fileman', 'mkdir', { path: 'public_html/nwprobe', name: 'sub' }, host)
  const mv = await fileop({ op: 'move', sourcefiles: `${HOME}/public_html/nwprobe/hi_renamed.txt`, destfiles: `${HOME}/public_html/nwprobe/sub` })
  console.log('move resp:', showData(mv))
  console.log('nwprobe after move:', await list('public_html/nwprobe'))
  console.log('nwprobe/sub after move:', await list('public_html/nwprobe/sub'))

  // === COPY test: ABSOLUTE (copy back to nwprobe) ===
  console.log('\n=== COPY (absolute sub/hi_renamed.txt -> nwprobe) ===')
  const cpr = await fileop({ op: 'copy', sourcefiles: `${HOME}/public_html/nwprobe/sub/hi_renamed.txt`, destfiles: `${HOME}/public_html/nwprobe` })
  console.log('copy resp:', showData(cpr))
  console.log('nwprobe after copy:', await list('public_html/nwprobe'))

  // cleanup
  console.log('\n=== CLEANUP ===')
  const del = await fileop({ op: 'trash', sourcefiles: `${HOME}/public_html/nwprobe` })
  console.log('cleanup trash nwprobe:', del.status, del.errors || '')
  process.exit(0)
})().catch(e => { console.error('PROBE EXCEPTION:', e.message); process.exit(1) })
