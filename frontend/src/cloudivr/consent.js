// Cookie & browser-storage consent for the CloudIVR site and app.
// necessary (always): sign-in + security cookies, language, private mode, unsaved drafts, this choice.
// preferences: display choices kept on this device (text-call setup and text size, dismissed tips).
// statistics: anonymous usage analytics + session replays (PostHog, gated in public/index.html).
// marketing: the referral link that brought you here, kept until you sign up.
// Without consent optional values live only for the tab session (sessionStorage) — features keep working, nothing stays.
const KEY = 'civr.consent';
const VERSION = 1;
export const OPTIONAL = ['preferences', 'statistics', 'marketing'];
const GROUP_KEYS = { preferences: [/^civr\.channelCard\./, /^civr_relay_/, /^civr\.relayPrefs$/], marketing: [/^civr\.ref$/] };

export function readConsent() {
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && c.v === VERSION ? c : null; } catch (_) { return null; }
}
export const allowed = (cat) => !!readConsent()?.[cat];

const keysOf = (store, res) => { const out = []; for (let i = 0; i < store.length; i++) { const k = store.key(i); if (res.some(r => r.test(k))) out.push(k); } return out; };

// Moves a group's saved values between this browser (localStorage) and this tab session.
function move(res, keep) {
  try {
    const [from, to] = keep ? [sessionStorage, localStorage] : [localStorage, sessionStorage];
    for (const k of keysOf(from, res)) { to.setItem(k, from.getItem(k)); from.removeItem(k); }
  } catch (_) { /* storage blocked */ }
}

function dropCookies(re) {
  const host = window.location.hostname.replace(/^www\./, '');
  for (const name of document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(n => re.test(n))) {
    document.cookie = `${name}=; Max-Age=0; path=/`;
    document.cookie = `${name}=; Max-Age=0; path=/; domain=.${host}`;
  }
}

function statistics(on) {
  const ph = window.posthog;
  try {
    if (on) {
      ph?.set_config?.({ persistence: 'localStorage+cookie', disable_session_recording: false });
      ph?.opt_in_capturing?.();
      ph?.startSessionRecording?.();
    } else {
      ph?.opt_out_capturing?.();
      ph?.stopSessionRecording?.();
      ph?.set_config?.({ persistence: 'memory', disable_session_recording: true });
      dropCookies(/^ph_/);
      for (const k of keysOf(localStorage, [/^ph_/])) localStorage.removeItem(k);
    }
  } catch (_) { /* analytics not loaded */ }
}

export function saveConsent(choice) {
  const c = { v: VERSION, necessary: true, ...Object.fromEntries(OPTIONAL.map(k => [k, !!choice[k]])), at: new Date().toISOString() };
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (_) { /* storage blocked */ }
  move(GROUP_KEYS.preferences, c.preferences);
  move(GROUP_KEYS.marketing, c.marketing);
  statistics(c.statistics);
  return c;
}

// Optional values: kept on this device only with consent for `cat`, otherwise just for this tab session.
export function remember(cat, key, value) { try { (allowed(cat) ? localStorage : sessionStorage).setItem(key, value); } catch (_) { /* storage blocked */ } }
export function recall(key) { try { return localStorage.getItem(key) ?? sessionStorage.getItem(key); } catch (_) { return null; } }
export function forget(key) { try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch (_) { /* storage blocked */ } }

// "Cookie settings" links reopen the banner.
let opener = null;
export const openCookieSettings = () => opener?.();
export const onOpenCookieSettings = (fn) => { opener = fn; return () => { if (opener === fn) opener = null; }; };
