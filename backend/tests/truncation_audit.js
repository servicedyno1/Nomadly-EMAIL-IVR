() => {
  const out = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || ['SVG','PATH','INPUT','TEXTAREA','SELECT','OPTION','IMG','CANVAS','svg','path'].includes(el.tagName)) continue;
    const s = getComputedStyle(el);
    const txt = (el.innerText || '').trim();
    if (!txt) continue;
    const clamp = s.webkitLineClamp && s.webkitLineClamp !== 'none';
    const ell = s.textOverflow === 'ellipsis';
    const hid = s.overflow.includes('hidden') || s.overflowX === 'hidden' || s.overflowY === 'hidden' || s.overflow.includes('clip');
    if ((ell || clamp || hid) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2)) {
      // ignore big containers (scroll areas) - only leaf-ish text nodes
      if (el.children.length > 3 && !ell && !clamp) continue;
      if (el.clientHeight > 200) continue;
      out.push({ tid: el.getAttribute('data-testid') || el.closest('[data-testid]')?.getAttribute('data-testid') || '', kind: ell ? 'ellipsis' : clamp ? 'clamp' : 'hidden', text: txt.slice(0, 70), sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight });
    }
  }
  const hx = document.documentElement.scrollWidth > window.innerWidth + 1 ? document.documentElement.scrollWidth : 0;
  return { hscroll: hx, items: out.slice(0, 25) };
}
