// Helpers for the SIP sales page (cloudivr.net/sip). Plans, prices and the SIP server come from the live catalogue.

export const DEFAULT_SIP_DOMAIN = 'sip.cloudivr.net';
export const sipDomain = (c) => c?.sipDomain || DEFAULT_SIP_DOMAIN;

// Sellable plans, cheapest first.
export const byPrice = (plans) => [...(plans || [])].filter(p => p.available !== false).sort((a, b) => a.price - b.price);

// Plans that include SIP logins (Pro and up today).
export const sipPlans = (c) => byPrice(c?.plans).filter(p => p.access?.sipCredentials);

// The plan the page pushes: the recommended plan when it includes SIP, otherwise the cheapest SIP plan.
export const sipPick = (c) => { const s = sipPlans(c); return s.find(p => p.recommended) || s[0] || null; };

export const andNames = (plans) => {
  const n = (plans || []).map(p => p.name);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0] || '';
};

// Free SIP apps + desk phones shown in "Works with your phone app". Steps match the in-app SIP guide.
export const SIP_APPS = [
  { id: 'zoiper', name: 'Zoiper', where: 'Windows, Mac, Linux, iPhone and Android', how: 'Settings → Accounts → Add account → "Yes, I have a SIP account". Put the username, password and server, then Next.' },
  { id: 'microsip', name: 'MicroSIP', where: 'Windows', how: 'Menu → Add account. SIP server and domain = the server, username + password, then Save.' },
  { id: 'linphone', name: 'Linphone', where: 'Windows, Mac, Linux, iPhone and Android', how: 'Use a SIP account → enter username, password and domain, transport UDP. Tap Login.' },
  { id: 'desk', name: 'Desk phones', where: 'Any phone that takes a SIP account', how: 'In the phone’s settings, add a SIP account with the server, username and password, then save.' },
];
