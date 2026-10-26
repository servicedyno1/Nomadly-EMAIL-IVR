'use strict'
// HTML building blocks for CloudIVR emails: table layout + inline styles so Gmail, Outlook and Apple Mail render alike.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif"
const MONO = "'SFMono-Regular',Menlo,Consolas,monospace"
const C = { ink: '#0f172a', body: '#334155', muted: '#64748b', line: '#e5e7f0', bg: '#eef0f7', night: '#0b0d1a', green: '#22c55e' }
const TONES = {
  brand: { fg: '#4f46e5', bg: '#eef2ff', glow: '#6366f1' },
  ok: { fg: '#15803d', bg: '#dcfce7', glow: '#22c55e' },
  warn: { fg: '#b45309', bg: '#fef3c7', glow: '#f59e0b' },
  bad: { fg: '#b91c1c', bg: '#fee2e2', glow: '#ef4444' },
}
const tone = (t) => TONES[t] || TONES.brand

const p = (html, style = '') => `<p style="margin:0 0 16px;font:16px/1.6 ${FONT};color:${C.body};${style}">${html}</p>`
const small = (html) => `<p style="margin:16px 0 0;font:13px/1.6 ${FONT};color:${C.muted}">${html}</p>`
const h2 = (text) => `<h2 style="margin:28px 0 12px;font:700 18px/1.3 ${FONT};color:${C.ink}">${esc(text)}</h2>`
const b = (s) => `<strong style="color:${C.ink}">${esc(s)}</strong>`
const mono = (s) => `<span style="font-family:${MONO};color:${C.ink}">${esc(s)}</span>`

function button(label, href, t = 'brand') {
  const c = tone(t).fg
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px"><tr><td style="border-radius:999px;background:${c}">`
    + `<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:15px 30px;font:700 16px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:999px">${esc(label)} &rarr;</a></td></tr></table>`
}

const link = (label, href) => `<a href="${esc(href)}" target="_blank" style="color:${TONES.brand.fg};font-weight:600;text-decoration:none">${esc(label)} &rarr;</a>`

// [{ label, value, t }] → tiles, `perRow` per row.
function stats(items, perRow = 3) {
  const list = items.filter(Boolean)
  const rows = []
  for (let i = 0; i < list.length; i += perRow) rows.push(list.slice(i, i + perRow))
  const w = Math.floor(100 / perRow)
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;border-collapse:separate;border-spacing:0 10px">`
    + rows.map(r => `<tr>${r.map((s, j) => `<td width="${w}%" valign="top" style="padding:0 ${j < r.length - 1 ? '10px' : '0'} 0 0"><div style="background:${s.t ? tone(s.t).bg : '#f6f7fb'};border-radius:14px;padding:16px 16px 14px">`
      + `<div style="font:600 11px/1.2 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${s.t ? tone(s.t).fg : C.muted}">${esc(s.label)}</div>`
      + `<div style="font:700 26px/1.2 ${FONT};color:${C.ink};margin-top:8px">${esc(s.value)}</div>${s.sub ? `<div style="font:13px/1.4 ${FONT};color:${C.muted};margin-top:4px">${esc(s.sub)}</div>` : ''}</div></td>`).join('')}${`<td width="${w}%"></td>`.repeat(perRow - r.length)}</tr>`).join('')
    + '</table>'
}

// [{ k, v }] → label / value table (v is plain text unless `html: true`).
function rows(items) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;border:1px solid ${C.line};border-radius:14px;border-collapse:separate;overflow:hidden">`
    + items.filter(Boolean).map((r, i) => `<tr><td style="padding:13px 16px;font:14px/1.4 ${FONT};color:${C.muted};${i ? `border-top:1px solid ${C.line}` : ''}">${esc(r.k)}</td>`
      + `<td align="right" style="padding:13px 16px;font:600 14px/1.4 ${FONT};color:${C.ink};${i ? `border-top:1px solid ${C.line}` : ''}">${r.html ? r.v : esc(r.v)}</td></tr>`).join('')
    + '</table>'
}

function bullets(items, t = 'brand') {
  const c = tone(t)
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px">`
    + items.filter(Boolean).map(s => `<tr><td valign="top" style="padding:5px 12px 5px 0"><div style="width:22px;height:22px;border-radius:999px;background:${c.bg};color:${c.fg};font:700 13px/22px ${FONT};text-align:center">&#10003;</div></td>`
      + `<td style="padding:5px 0;font:15px/1.5 ${FONT};color:${C.body}">${esc(s)}</td></tr>`).join('')
    + '</table>'
}

// [{ title, text }] → numbered steps.
function steps(items) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0">`
    + items.map((s, i) => `<tr><td valign="top" width="44" style="padding:10px 0"><div style="width:32px;height:32px;border-radius:10px;background:${C.night};color:#ffffff;font:700 15px/32px ${FONT};text-align:center">${i + 1}</div></td>`
      + `<td style="padding:10px 0;${i < items.length - 1 ? `border-bottom:1px solid ${C.line}` : ''}"><div style="font:700 16px/1.4 ${FONT};color:${C.ink}">${esc(s.title)}</div><div style="font:15px/1.55 ${FONT};color:${C.body};margin-top:2px">${esc(s.text)}</div></td></tr>`).join('')
    + '</table>'
}

function callout(html, t = 'brand', title) {
  const c = tone(t)
  return `<div style="margin:20px 0;background:${c.bg};border-left:4px solid ${c.fg};border-radius:12px;padding:16px 18px">`
    + (title ? `<div style="font:700 15px/1.4 ${FONT};color:${c.fg};margin-bottom:4px">${esc(title)}</div>` : '')
    + `<div style="font:15px/1.55 ${FONT};color:${C.body}">${html}</div></div>`
}

const quote = (text) => `<div style="margin:16px 0;padding:18px 20px;background:#f6f7fb;border-radius:14px;font:italic 16px/1.6 Georgia,serif;color:${C.ink}">&ldquo;${esc(text)}&rdquo;</div>`

// Whole email. `base` = site origin (logo), `foot` = { why, settings: [label, href], off: [label, href] | null, support: [label, href] | null }
function layout({ lang = 'en', preheader = '', eyebrow, title, t = 'brand', body, base = '', foot }) {
  const c = tone(t)
  const logo = base ? `<img src="${esc(base)}/civr/brand/parrot-icon-128.png" width="34" height="34" alt="" style="display:block;border:0;border-radius:8px">` : ''
  const links = [foot.settings, foot.off, foot.support].filter(Boolean).map(([l, h]) => `<a href="${esc(h)}" target="_blank" style="color:${C.muted};text-decoration:underline">${esc(l)}</a>`).join(' &nbsp;&middot;&nbsp; ')
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>`
    + `<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">`
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}"><tr><td align="center" style="padding:28px 12px 40px">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">`
    // hero
    + `<tr><td style="background:${C.night};border-radius:22px 22px 0 0;padding:28px 32px 36px;background-image:radial-gradient(circle at 90% 0%, ${c.glow}55 0%, transparent 55%)">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${logo ? `<td style="padding-right:10px">${logo}</td>` : ''}<td style="font:800 20px/1 ${FONT};letter-spacing:.02em;color:#ffffff">CLOUD<span style="color:${C.green}">IVR</span></td></tr></table>`
    + (eyebrow ? `<div style="margin-top:28px"><span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${c.glow}33;color:#ffffff;font:700 11px/1 ${FONT};letter-spacing:.12em;text-transform:uppercase">${esc(eyebrow)}</span></div>` : '')
    + `<h1 style="margin:16px 0 0;font:800 32px/1.15 ${FONT};letter-spacing:-.01em;color:#ffffff">${esc(title)}</h1></td></tr>`
    // body
    + `<tr><td style="background:#ffffff;padding:32px 32px 28px;border-radius:0 0 22px 22px">${body}</td></tr>`
    // footer
    + `<tr><td style="padding:24px 24px 0;text-align:center;font:12px/1.7 ${FONT};color:${C.muted}">`
    + `<div style="font:800 13px/1 ${FONT};letter-spacing:.04em;color:${C.ink};margin-bottom:10px">CLOUD<span style="color:#16a34a">IVR</span></div>`
    + `<div>${esc(foot.why)}</div><div style="margin-top:6px">${links}</div></td></tr>`
    + '</table></td></tr></table></body></html>'
}

module.exports = { esc, p, small, h2, b, mono, button, link, stats, rows, bullets, steps, callout, quote, layout }
