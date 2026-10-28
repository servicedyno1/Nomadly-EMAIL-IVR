// X (Twitter) conversion tracking for the CloudIVR site and app — loaded on every visit (owner's choice).
// Page views: sent once when the pixel loads (twq 'config').
// Sign-ups: sent once per new account (email or Google) when X_SIGNUP_EVENT_ID is filled in.
export const X_PIXEL_ID = 'ri2qd';
// X Ads → Tools → Events manager → your "Sign up" event → its ID (looks like 'tw-ri2qd-xxxxx'). Empty = not sent.
export const X_SIGNUP_EVENT_ID = '';

const NEW_ACCOUNT_MS = 10 * 60 * 1000;

export function loadXPixel() {
  if (typeof window === 'undefined' || window.twq) return;
  !function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);
  },s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
  a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
  window.twq('config', X_PIXEL_ID);
}

// Fires the sign-up conversion for an account created in the last few minutes, once per account and browser.
export function trackXSignup(account) {
  if (!X_SIGNUP_EVENT_ID || !account?.id || !account.createdAt || typeof window.twq !== 'function') return;
  if (Date.now() - new Date(account.createdAt).getTime() > NEW_ACCOUNT_MS) return;
  const key = `civr.xSignup.${account.id}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (_) { /* storage blocked */ }
  window.twq('event', X_SIGNUP_EVENT_ID, { conversion_id: `signup-${account.id}` });
}
