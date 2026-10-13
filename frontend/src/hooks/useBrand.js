import { useEffect, useState } from 'react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';
const FALLBACK = { brandName: 'Nomadly', brandSlug: 'nomadly', botUsername: 'NomadlyBot', accent: '#10d9a0', logoUrl: null, markUrl: null, loaded: false };

let cached = null;
let inflight = null;

function toAbsolute(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${BACKEND_URL}/api${path.startsWith('/') ? path : `/${path}`}`;
}

// Brand (name / wordmark / mark / accent) served by the bot at /api/store/config —
// each deployment (Nomadly, Smadav) resolves its own via CHAT_BOT_BRAND.
export function useBrand() {
  const [brand, setBrand] = useState(cached || FALLBACK);
  useEffect(() => {
    if (cached) return;
    if (!inflight) {
      inflight = fetch(`${BACKEND_URL}/api/store/config`).then(r => r.json()).then(d => {
        cached = {
          ...FALLBACK,
          ...d,
          logoUrl: toAbsolute(d.logoUrl),
          markUrl: toAbsolute(d.markUrl),
          loaded: true,
        };
        return cached;
      }).catch(() => ({ ...FALLBACK, loaded: true }));
    }
    let alive = true;
    inflight.then(b => { if (alive) setBrand(b); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (brand.accent) document.documentElement.style.setProperty('--brand-accent', brand.accent);
  }, [brand.accent]);
  return brand;
}

// <BrandMark /> — square mark image with a letter fallback (never shows another brand's logo)
export function BrandMark({ brand, size = 34, className = '', testId = 'brand-mark' }) {
  const [broken, setBroken] = useState(false);
  if (brand?.markUrl && !broken) {
    return <img src={brand.markUrl} alt={brand.brandName} width={size} height={size} className={className} style={{ borderRadius: Math.round(size * 0.22) }} onError={() => setBroken(true)} data-testid={testId} />;
  }
  return <span className={className} data-testid={`${testId}-letter`} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: Math.round(size * 0.22), background: brand?.accent || '#10d9a0', color: '#0b0f1a', fontWeight: 800 }}>{(brand?.brandName || 'H').charAt(0).toUpperCase()}</span>;
}
