() => {
  const vw = window.innerWidth;
  const res = { hscroll: document.documentElement.scrollWidth - vw, spills: [], tall: [], squashed: [], offscreen: [] };
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const clipped = (el, stop) => { for (let p = el.parentElement; p && p !== stop; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX)) return true; } return false; };
  const name = el => (el.getAttribute('data-testid') || el.tagName.toLowerCase() + ':' + (el.textContent || '').trim().slice(0, 30));
  document.querySelectorAll('button, a, select, input, textarea, .civr-pill, img, table').forEach(el => {
    if (!vis(el)) return;
    if (el.closest('[data-sonner-toaster]')) return;
    const r = el.getBoundingClientRect();
    const fixed = (() => { for (let p = el; p; p = p.parentElement) { const pos = getComputedStyle(p).position; if (pos === 'fixed' || pos === 'sticky') return true; } return false; })();
    if (!fixed && !clipped(el, document.body) && (r.right > vw + 1 || r.left < -1)) res.offscreen.push(`${name(el)} [${Math.round(r.left)},${Math.round(r.right)}]`);
    const card = el.closest('.civr-card');
    if (card && card !== el && !clipped(el, card)) {
      const c = card.getBoundingClientRect();
      if (r.right > c.right + 1 || r.left < c.left - 1) res.spills.push(`${name(el)} by ${Math.round(Math.max(r.right - c.right, c.left - r.left))}px in ${card.getAttribute('data-testid') || 'card'}`);
    }
    if (el.classList.contains('civr-btn')) {
      const sm = el.classList.contains('civr-btn-sm');
      if (r.height > (sm ? 44 : 50)) res.tall.push(`${name(el)} h=${Math.round(r.height)} w=${Math.round(r.width)}`);
      el.querySelectorAll(':scope > svg').forEach(s => { const sr = s.getBoundingClientRect(); if (sr.width > 0 && sr.width < 12) res.squashed.push(`${name(el)} svg w=${sr.width}`); });
    }
  });
  return res;
}
