// Mobile audit snippet (evaluated in-page by playwright): overflow, input font-size, tap targets, bottom-nav overlap.
() => {
  const vw = document.documentElement.clientWidth;
  const sw = document.documentElement.scrollWidth;
  const offenders = [];
  document.querySelectorAll('body *').forEach(el => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > vw + 1) { let p = el.parentElement, clipped = false; while (p) { const s = getComputedStyle(p); if (['auto', 'scroll', 'hidden', 'clip'].includes(s.overflowX)) { clipped = true; break; } p = p.parentElement; } if (!clipped && getComputedStyle(el).position !== 'fixed') offenders.push((el.getAttribute('data-testid') || el.tagName) + ':' + Math.round(r.right)); } });
  const hscroll = [...document.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return (s.overflowX === 'auto' || s.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 2 && e.offsetParent; }).map(e => (e.getAttribute('data-testid') || e.tagName + '.' + String(e.className).slice(0, 30)) + ' ' + e.scrollWidth + '/' + e.clientWidth);
  const inputs = [...document.querySelectorAll('input,select,textarea')].filter(e => e.offsetParent && !['checkbox', 'radio', 'range', 'hidden', 'file'].includes(e.type)).map(e => [(e.getAttribute('data-testid') || e.name || e.type), parseFloat(getComputedStyle(e).fontSize)]).filter(x => x[1] < 16);
  const small = [...document.querySelectorAll('button, a.civr-btn, [role=button]')].filter(e => { const r = e.getBoundingClientRect(); return e.offsetParent && r.width > 0 && r.height < 44 && r.height > 0; }).map(e => (e.getAttribute('data-testid') || e.textContent.trim().slice(0, 20)) + ':' + Math.round(e.getBoundingClientRect().height));
  const nav = document.querySelector('[data-testid=mobile-bottom-nav]');
  const main = document.querySelector('main');
  return { vw, sw, offenders: offenders.slice(0, 8), hscroll: hscroll.slice(0, 5), smallInputs: inputs, smallBtnCount: small.length, smallBtns: small.slice(0, 12), navVisible: !!(nav && nav.offsetParent), mainPB: main && getComputedStyle(main).paddingBottom, mainPL: main && getComputedStyle(main).paddingLeft };
}
