import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

// Today's personal offer, shared by every component on the page (one request, refreshed on dismiss/use).
let cache = null;
let cacheAt = 0;
let inflight = null;
const subs = new Set();
const load = () => {
  inflight = inflight || api('/offers/current').then(d => { cache = d.offer; cacheAt = Date.now(); subs.forEach(f => f(cache)); return cache; }).catch(() => null).finally(() => { inflight = null; });
  return inflight;
};

export function useOffer() {
  const [offer, setOffer] = useState(cache);
  useEffect(() => { subs.add(setOffer); if (!cache || Date.now() - cacheAt > 60000) load(); return () => subs.delete(setOffer); }, []);
  const reload = useCallback(() => load(), []);
  const dismiss = useCallback(async () => {
    if (cache) { cache = { ...cache, dismissed: true }; subs.forEach(f => f(cache)); }
    await api('/offers/dismiss', { method: 'POST' }).catch(() => {});
  }, []);
  return { offer, reload, dismiss };
}
