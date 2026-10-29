import React, { useEffect, useRef, useState } from 'react';
import './np.css';
import { useTheme, ThemeButton } from '../../theme';

// Marks <html> with the public-site look + light/dark (shared setting with the app) so portals follow it too.
export function useSiteLook() {
  const { theme } = useTheme();
  React.useEffect(() => {
    const d = document.documentElement;
    d.dataset.civrNp = '1'; d.dataset.civrNpTheme = theme; d.style.colorScheme = theme;
    return () => { delete d.dataset.civrNp; delete d.dataset.civrNpTheme; d.style.colorScheme = ''; };
  }, [theme]);
}

export const SiteThemeButton = ({ testid }) => <ThemeButton testid={testid} className="civr-l-navlink w-11 h-11 !p-0 grid place-items-center rounded-full shrink-0" />;

// Shared building blocks for the landing page.

export const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Button label that slides up to a copy of itself on hover.
export const Slide = ({ children }) => <span className="civr-l-slide"><span>{children}</span><span aria-hidden="true">{children}</span></span>;

// [ref, inView] — true once the element scrolls into view. `once=false` flips back when it leaves (used to pause mock animations).
export function useInView({ once = true, rootMargin = '0px 0px -8% 0px', threshold = 0.12 } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return undefined; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); if (once) io.disconnect(); } else if (!once) setInView(false); }, { rootMargin, threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [once, rootMargin, threshold]);
  return [ref, inView];
}

// Fades and rises when scrolled into view; `delay` (ms) staggers siblings. Reduced motion → shown at once (CSS).
export function Reveal({ as: Tag = 'div', delay = 0, className = '', style, children, ...rest }) {
  const [ref, inView] = useInView();
  return <Tag ref={ref} className={`civr-reveal ${inView ? 'in' : ''} ${className}`} style={delay ? { ...style, transitionDelay: `${delay}ms` } : style} {...rest}>{children}</Tag>;
}

// Counts up to the number inside `value` when it scrolls into view, keeping prefix/suffix ("$50", "60 s", "1,240").
// The final value is rendered from the first paint (crawlers, reduced motion, elements already on screen); the
// count-up only runs for elements that start below the fold and scroll in later.
export function CountUp({ value, duration = 1100, className = '' }) {
  const m = String(value).match(/^([^\d]*)(\d[\d,]*)(.*)$/);
  const target = m ? Number(m[2].replace(/,/g, '')) : null;
  const ref = useRef(null);
  const [n, setN] = useState(target);
  useEffect(() => { setN(target); }, [target]);
  useEffect(() => {
    const el = ref.current;
    if (!el || target == null || reducedMotion() || typeof IntersectionObserver === 'undefined') return undefined;
    let armed = false, raf;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) { armed = true; return; }
      if (!armed) { io.disconnect(); return; }
      io.disconnect();
      const t0 = performance.now();
      const tick = (t) => { const p = Math.min(1, (t - t0) / duration); setN(Math.round(target * (1 - (1 - p) ** 3))); if (p < 1) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [target, duration]);
  if (target == null) return <span ref={ref} className={className}>{value}</span>;
  return <span ref={ref} className={className} data-no-translate>{m[1]}{Number(n).toLocaleString('en-US')}{m[3]}</span>;
}

// The landing page's "voice" motif: a thin 7-bar waveform, still when idle and moving only while `on`.
export const Wave = ({ on = false, className = '' }) => <span className={`civr-l-wave ${on && !reducedMotion() ? 'on' : ''} ${className}`} aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span>;

// Steps 0 … n-1 every `ms` while `run` is true (mock animations stop when scrolled away or motion is reduced).
export function useStep(run, n, ms) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!run || reducedMotion()) return undefined;
    const t = setInterval(() => setI(x => (x + 1) % n), ms);
    return () => clearInterval(t);
  }, [run, n, ms]);
  return i;
}

// Text that types itself out while `run` is true; restarts when `text` changes.
export function useTyped(run, text, cps = 28) {
  const [k, setK] = useState(0);
  useEffect(() => {
    setK(0);
    if (!run || reducedMotion()) { setK(text.length); return undefined; }
    const t = setInterval(() => setK(x => (x >= text.length ? x : x + 1)), 1000 / cps);
    return () => clearInterval(t);
  }, [run, text, cps]);
  return text.slice(0, k);
}

export function SectionHead({ label, title, sub, testid }) {
  return (
    <Reveal className="max-w-3xl" data-testid={testid}>
      <div className="civr-l-eyebrow">{label}</div>
      <h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl mt-4">{title}</h2>
      {sub && <p className="text-base md:text-lg civr-l-muted mt-4 max-w-2xl">{sub}</p>}
    </Reveal>
  );
}

// "BTC, LTC, ETH, USDT and more" from the catalog's coin list.
export const coinList = (c) => {
  const s = [...new Set((c?.coins || []).map(x => x.replace(/\s*\(.*\)/, '')))];
  return s.length > 4 ? `${s.slice(0, 4).join(', ')} and more` : s.join(', ');
};
export const andList = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');

// Which plans include a feature, e.g. "Every plan", "Pro and up", "Business plan only".
export function planBadge(plans, key) {
  const ps = [...(plans || [])].sort((a, b) => a.price - b.price);
  if (!ps.length) return null;
  const ok = key ? ps.filter(p => p.access?.[key]) : ps;
  if (ok.length === ps.length) return 'Every plan';
  return ok.length === 1 ? `${ok[0].name} plan only` : `${ok[0].name} and up`;
}
