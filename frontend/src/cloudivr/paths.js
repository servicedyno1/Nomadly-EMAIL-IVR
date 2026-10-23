// Where the CloudIVR web app is mounted.
// - On its own domain (cloudivr.net, or any host in REACT_APP_CLOUDIVR_DOMAINS) it owns the site root: /, /login, /app/…
// - On shared hosts (bot admin domain, preview) it lives under /cloudivr.
const DEFAULT_DOMAINS = ['cloudivr.net'];
const norm = (h) => String(h || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').split(':')[0].replace(/^www\./, '');
const extra = String(process.env.REACT_APP_CLOUDIVR_DOMAINS || '').split(',').map(norm).filter(Boolean);
const DOMAINS = new Set([...DEFAULT_DOMAINS, ...extra]);
const HOST = typeof window !== 'undefined' ? norm(window.location.hostname) : '';

export const IS_CIVR_DOMAIN = DOMAINS.has(HOST);
export const CIVR_BASE = IS_CIVR_DOMAIN ? '' : '/cloudivr';

// cp('/app/wallet') → '/app/wallet' on cloudivr.net, '/cloudivr/app/wallet' elsewhere. cp() → app home.
export const cp = (sub = '') => `${CIVR_BASE}${sub}` || '/';
