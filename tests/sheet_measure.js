// Measures the open modal (dialog/alertdialog aria-modal) for bottom-sheet checks.
() => {
  const d = [...document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"]')].filter(e => e.getBoundingClientRect().height > 0).pop();
  if (!d) return null;
  const r = d.getBoundingClientRect(); const cs = getComputedStyle(d); const be = getComputedStyle(d, '::before');
  return { testid: d.getAttribute('data-testid'), role: d.getAttribute('role'), inCivr: !!d.closest('.civr'), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, vw: innerWidth, radius: cs.borderRadius, overflowY: cs.overflowY, maxH: cs.maxHeight, handle: be.content, handleW: be.width, scrollH: d.scrollHeight, clientH: d.clientHeight };
}
