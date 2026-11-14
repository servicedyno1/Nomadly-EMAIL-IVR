import { useEffect, useState } from 'react';
import { api } from '../api';

// The account's saved personal / business details (Settings → profile). Read fresh on each screen, so an
// updated profile is what new orders use; orders already placed keep what they were sent with.
let inflight = null;
export function useSavedAddress(enabled = true) {
  const [p, setP] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let on = true;
    inflight = inflight || api('/profile/legal').catch(() => null).finally(() => { setTimeout(() => { inflight = null; }, 2000); });
    inflight.then(d => { if (on) setP(d?.profile || null); });
    return () => { on = false; };
  }, [enabled]);
  const a = p?.address || {};
  const us = a.countryCode === 'US';
  return {
    profile: p,
    usZip: us && /^\d{5}/.test(a.postalCode || '') ? a.postalCode.slice(0, 5) : '',
    holder: p ? { name: p.fullName || '', business: p.type === 'business' ? p.companyName || '' : '', address: [a.line1, a.line2].filter(Boolean).join(', '), city: a.city || '', state: a.region || '', zip: a.postalCode || '' } : null,
  };
}
