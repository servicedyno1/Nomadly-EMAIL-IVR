/**
 * White-label brand config for the FRONTEND (single source of truth for the UI).
 * ---------------------------------------------------------------------------
 * Values are read at build time from REACT_APP_BRAND_* env vars (frontend/.env)
 * and fall back to the current brand, so nothing changes until you override
 * them. To rebrand the web UI, set these vars and rebuild/restart the frontend.
 * The bot/back end has a matching config in js/branding.js. See /app/BRANDING.md.
 */
const E = process.env;

export const BRAND = {
  // Primary brand (bot + analytics)
  name: E.REACT_APP_BRAND_NAME || 'Nomadly',
  botName: E.REACT_APP_BRAND_BOT_NAME || 'NomadlyBot',
  botUsername: (E.REACT_APP_BRAND_BOT_USERNAME || 'Nomadlybot').replace(/^@/, ''),
  tagline: E.REACT_APP_BRAND_TAGLINE || 'Bot Analytics',
  poweredBy: E.REACT_APP_BRAND_POWERED_BY || 'Speechcue',
  supportHandle: E.REACT_APP_BRAND_SUPPORT || '@onarrival1',
  primaryColor: E.REACT_APP_BRAND_COLOR || '#34d399',

  // Sub-brands (set all three to the same value to fully unify the branding)
  panelName: E.REACT_APP_BRAND_PANEL_NAME || 'HostBay',
  phoneName: E.REACT_APP_BRAND_PHONE_NAME || 'Speechcue',

  // Domains
  panelDomain: (E.REACT_APP_PANEL_DOMAIN || 'panel.hostbay.io').toLowerCase(),

  // Logo / favicon — set a hosted image URL to show your logo (no code change needed)
  logoUrl: E.REACT_APP_BRAND_LOGO_URL || '',
  faviconUrl: E.REACT_APP_BRAND_FAVICON_URL || '',
};

// lowercase, filesystem/url-safe slug for filenames etc.
export const brandSlug = (BRAND.name || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Runtime override: the bot serves its live brand at /api/branding (driven by the
// deployed .env — e.g. CHAT_BOT_BRAND=Smadav on app-wl). We merge that over the
// build-time defaults at load so the UI is correct even if the build baked the
// wrong brand. Never throws; silently keeps build-time values on any failure.
export async function applyRuntimeBranding(timeoutMs = 2500) {
  const base = (process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');
  const url = `${base}/api/branding`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return BRAND;
    const b = await res.json();
    if (b && typeof b === 'object') {
      if (b.name) BRAND.name = b.name;
      if (b.botName) BRAND.botName = b.botName;
      if (b.tagline) BRAND.tagline = b.tagline;
      if (b.logoUrl) BRAND.logoUrl = b.logoUrl;
      if (b.primaryColor) BRAND.primaryColor = b.primaryColor;
      if (b.supportHandle) BRAND.supportHandle = b.supportHandle;
      if (b.panelDomain) BRAND.panelDomain = String(b.panelDomain).toLowerCase();
    }
  } catch (_) { /* keep build-time defaults */ }
  return BRAND;
}

export default BRAND;
