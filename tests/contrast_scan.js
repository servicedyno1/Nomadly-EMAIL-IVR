() => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const bgOf = (el) => { const layers = []; let grad = false; let e = el; while (e && e.nodeType === 1) { const s = getComputedStyle(e); const c = parse(s.backgroundColor); if (s.backgroundImage && s.backgroundImage !== 'none' && s.backgroundImage.includes('gradient')) grad = true; if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } e = e.parentElement; } let base = { r: 255, g: 255, b: 255, a: 1 }; const bodyBg = parse(getComputedStyle(document.body).backgroundColor); if (bodyBg && bodyBg.a > 0) base = blend(bodyBg, base); for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base); return { bg: base, grad }; };
  const sel = (el) => { let e = el; const path = []; while (e && e.nodeType === 1 && path.length < 4) { const t = e.getAttribute('data-testid'); if (t) { path.unshift(`[data-testid="${t}"]`); break; } const cls = (e.className && typeof e.className === 'string') ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : ''; path.unshift(e.tagName.toLowerCase() + cls); e = e.parentElement; } return path.join(' > '); };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const out = []; const seen = new Set();
  const els = document.querySelectorAll('body *');
  for (const el of els) {
    let txt = '';
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') txt = el.value || el.placeholder || '';
    else for (const n of el.childNodes) if (n.nodeType === 3) txt += n.textContent;
    txt = txt.trim(); if (!txt) continue;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) < 0.1) continue;
    let op = 1, e = el; while (e && e.nodeType === 1) { op *= parseFloat(getComputedStyle(e).opacity); e = e.parentElement; } if (op < 0.1) continue;
    let fg = parse(s.color); if (!fg) continue;
    const isPh = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.value && el.placeholder;
    if (isPh) { const p = parse(getComputedStyle(el, '::placeholder').color); if (p) fg = p; }
    const { bg, grad } = bgOf(el);
    fg = blend({ ...fg, a: fg.a * op }, bg);
    const rt = ratio(fg, bg);
    const size = parseFloat(s.fontSize); const bold = parseInt(s.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = (el.disabled || el.closest('[disabled]')) ? 0 : (large ? 3 : 4.5);
    if (rt < need) { const k = sel(el) + '|' + hex(fg) + hex(bg); if (seen.has(k)) continue; seen.add(k); out.push({ sel: sel(el), text: txt.slice(0, 40) + (isPh ? ' (placeholder)' : ''), fg: hex(fg), bg: hex(bg), ratio: Math.round(rt * 100) / 100, size, grad }); }
  }
  return out;
}
