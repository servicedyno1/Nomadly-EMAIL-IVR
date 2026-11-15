import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plane, Search, Copy, Smartphone } from 'lucide-react';
import { api, money, useApi } from '../api';
import { PageHeader, Spinner, ErrorNote, Label } from '../ui';
import { WalletPay } from '../WalletPay';
import { useShell } from '../Shell';
import { track } from '../track';
import { Flag } from '../Pickers';
import { QRCodeSVG } from 'qrcode.react';

const copy = (v) => navigator.clipboard?.writeText(v).then(() => toast.success('Copied'));

// Phone type from the browser: 'ios', 'android' or null (computer / unsure).
const deviceOs = () => {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  return /Android/.test(ua) ? 'android' : null;
};
const lpaOf = (i) => (i.activationCode && /^LPA:/i.test(i.activationCode) ? i.activationCode : i.smdp && i.activationCode ? `LPA:1$${i.smdp}$${i.activationCode}` : null);
// Official one-tap install links (iOS 17.4+, Android 10+ with Google services); Bird's own links win when sent.
export const installLinks = (i) => {
  const lpa = lpaOf(i), q = lpa ? `esim_qrcode_provisioning?carddata=${encodeURIComponent(lpa)}` : null;
  return { ios: i.ios || (q && `https://esimsetup.apple.com/${q}`), android: i.android || (q && `https://esimsetup.android.com/${q}`) };
};

function InstallButtons({ o, links, os }) {
  const btns = [['ios', 'Install on iPhone'], ['android', 'Install on Android']].filter(([k]) => links[k]).sort(([a], [b]) => (b === os) - (a === os));
  return (
    <div className={`flex flex-col ${os ? '' : 'sm:flex-row'} gap-2`}>
      {btns.map(([k, label]) => (
        <a key={k} href={links[k]} target="_blank" rel="noopener noreferrer" className={`civr-btn justify-center w-full ${k === os ? "!min-h-[52px]" : "!min-h-[48px]"} ${os ? '' : 'sm:w-auto'} ${k === os ? 'civr-btn-primary text-base' : 'civr-btn-ghost'}`} data-testid={`travel-esim-${k}-${o.id}`}><Smartphone className="w-4 h-4" />{label}</a>
      ))}
    </div>
  );
}

function Qr({ o, i }) {
  if (!i.qr && i.activationCode && !o.dryRun) return <div className="w-40 h-40 shrink-0 rounded-lg bg-white p-2 grid place-items-center" data-testid={`travel-esim-qr-${o.id}`}><QRCodeSVG value={lpaOf(i) || i.activationCode} size={144} aria-label={`QR code for ${o.name}`} /></div>;
  if (i.qr) return <img src={i.qr} alt={`QR code for ${o.name}`} className="w-40 h-40 shrink-0 rounded-lg bg-white p-2" data-testid={`travel-esim-qr-${o.id}`} />;
  return <div className="w-40 h-40 shrink-0 rounded-lg border border-dashed grid place-items-center text-center p-3 text-xs text-[var(--c-muted)]" data-testid={`travel-esim-qr-missing-${o.id}`}>{o.dryRun ? 'Preview order — no real QR code' : 'QR code is on its way. Refresh in a minute.'}</div>;
}

function Install({ o }) {
  const i = o.install || {};
  const os = useMemo(deviceOs, []);
  const links = o.dryRun ? {} : installLinks(i);
  const buttons = (links.ios || links.android) && <InstallButtons o={o} links={links} os={os} />;
  return (
    <div className="mt-3 space-y-4 min-w-0" data-testid={`travel-esim-install-${o.id}`}>
      {os && buttons}
      <div className="flex flex-col sm:flex-row gap-4 min-w-0">
        <Qr o={o} i={i} />
        <div className="space-y-3 text-sm min-w-0 flex-1">
          <p>{os ? 'Or scan the QR code from another screen.' : 'Scan the QR code with the phone you travel with, or open this page on that phone and tap its install button.'}</p>
          {!os && buttons}
          {i.activationCode && <div className="flex items-center gap-2 min-w-0"><span className="text-[var(--c-muted)] shrink-0">Manual code</span><span className="font-mono truncate min-w-0" data-no-translate data-testid={`travel-esim-code-${o.id}`}>{i.activationCode}</span><button className="civr-btn civr-btn-ghost !px-2 shrink-0 !min-h-[44px] !min-w-[44px]" onClick={() => copy(i.activationCode)} aria-label="Copy activation code" data-testid={`travel-esim-copy-${o.id}`}><Copy className="w-4 h-4" /></button></div>}
          {i.roaming && <p className="text-xs text-[var(--c-muted)]">Turn on data roaming for this eSIM when you arrive.</p>}
          <p className="text-xs text-[var(--c-muted)]" data-testid={`travel-esim-help-${o.id}`}>One-tap install needs iOS 17.4 or later on iPhone, or Android 10 or later with Google services up to date (most Pixel and Samsung phones). If it doesn’t open, use the QR code or the manual code.</p>
        </div>
      </div>
    </div>
  );
}

function MyEsims({ orders, codes }) {
  if (!orders.length) return null;
  return (
    <div data-testid="travel-esim-orders"><Label>Your travel eSIMs</Label>
      <div className="space-y-3">{orders.map(o => (
        <div key={o.id} className="civr-card p-5" data-testid={`travel-esim-order-${o.id}`}>
          <div className="flex flex-wrap items-center gap-3"><span className="flex-1 min-w-0"><span className="font-semibold inline-flex items-center gap-2"><Flag code={o.code || codes[o.zone]} />{o.name}</span>{o.phoneNumber && <span className="block text-xs font-mono text-[var(--c-muted)]" data-no-translate data-testid={`travel-esim-phone-${o.id}`}>{`eSIM number ${o.phoneNumber}`}</span>}<span className="block text-xs text-[var(--c-muted)]" data-testid={`travel-esim-date-${o.id}`}>{`Bought ${new Date(o.createdAt).toLocaleDateString()} · valid ${o.days} days after you first connect`}{o.dryRun ? ' · preview order (not real)' : ''}</span></span><span className={`civr-pill ${o.status === 'active' ? 'civr-pill-ok' : o.status === 'failed' ? 'civr-pill-bad' : 'civr-pill-warn'}`} data-testid={`travel-esim-status-${o.id}`}>{o.status === 'active' ? 'Ready to install' : o.status === 'failed' ? 'Failed · refunded' : 'Preparing…'}</span><span className="font-mono">{money(o.price)}</span></div>
          {o.status === 'active' && <Install o={o} />}
        </div>
      ))}</div>
    </div>
  );
}

export default function TravelEsim() {
  const plans = useApi('/travel-esim/plans');
  const mine = useApi('/travel-esim/orders');
  const { refreshSummary } = useShell();
  const [q, setQ] = useState('');
  const [zone, setZone] = useState(null);
  const [all, setAll] = useState(false);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const zones = useMemo(() => (plans.data?.zones || []).filter(z => z.zone.toLowerCase().includes(q.trim().toLowerCase())), [plans.data, q]);
  if (!plans.data) return plans.error ? <ErrorNote error={plans.error} onRetry={plans.reload} /> : <Spinner />;
  const buy = async () => {
    setBusy(true); setErr(null);
    try { const d = await api('/travel-esim/orders', { method: 'POST', body: { offerId: pick.id } }); toast.success(d.status === 'active' ? 'Your eSIM is ready' : 'Order placed — preparing your eSIM'); track('travel_esim_paid', { zone: zone?.zone, gb: pick.gb, days: pick.days, price: pick.price }); setPick(null); setZone(null); mine.reload(); refreshSummary(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-8" data-testid="travel-esim-page">
      <PageHeader label="Phone numbers" title="Travel eSIM" sub={`Mobile data in ${plans.data.zones.length} countries. Buy before you fly, install with a QR code, and you're online when you land. Paid from your wallet.`} testid="travel-esim-header" />
      <MyEsims orders={mine.data?.orders || []} codes={Object.fromEntries((plans.data?.zones || []).map(z => [z.zone, z.code]))} />
      <div>
        <Label>Where are you going?</Label>
        <div className="relative max-w-md mb-4"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-muted)]" /><input className="civr-input w-full !pl-9" placeholder="Search a country" value={q} onChange={e => { setQ(e.target.value); setZone(null); setPick(null); }} data-testid="travel-esim-search-input" /></div>
        {!zone && <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2" data-testid="travel-esim-zones">{(all ? zones : zones.slice(0, 40)).map(z => (
          <button key={z.zone} type="button" onClick={() => { setZone(z); track('travel_esim_zone', { zone: z.zone }); }} className="civr-card p-3 text-left flex items-center justify-between transition-transform duration-200 hover:-translate-y-0.5" data-testid={`travel-esim-zone-${z.zone.replace(/\W+/g, '-').toLowerCase()}`}><span className="font-medium flex items-center gap-2"><Flag code={z.code} />{z.zone}</span><span className="text-xs text-[var(--c-muted)]">from {money(z.from)}</span></button>
        ))}{!zones.length && <p className="text-sm text-[var(--c-muted)]" data-testid="travel-esim-no-match">No plans for that country yet.</p>}</div>}
        {!zone && !all && zones.length > 40 && <p className="text-sm text-[var(--c-muted)] mt-3" data-testid="travel-esim-more-hint">{`Showing 40 of ${zones.length} countries. Type a country name above, or `}<button type="button" className="underline text-[var(--c-text)]" onClick={() => setAll(true)} data-testid="travel-esim-show-all">show all {zones.length}</button>.</p>}
        {zone && (
          <div className="space-y-4" data-testid="travel-esim-plans">
            <button type="button" className="text-sm underline" onClick={() => { setZone(null); setPick(null); }} data-testid="travel-esim-back">← All countries</button>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{zone.offers.map(o => (
              <button key={o.id} type="button" onClick={() => setPick(o)} aria-pressed={pick?.id === o.id} className={`civr-card p-5 text-left ${pick?.id === o.id ? '!border-[var(--c-accent)]' : ''}`} data-testid={`travel-esim-plan-${o.id}`}>
                <div className="flex items-center gap-2 text-[var(--c-muted)] text-xs">{zone.code ? <Flag code={zone.code} /> : <Plane className="w-3.5 h-3.5" />}{zone.zone}</div>
                <div className="font-display text-2xl font-bold mt-2">{o.gb} GB</div>
                <div className="text-sm text-[var(--c-muted)]">{o.days} days{o.speed === 'reduced' ? ' · reduced speed' : ''}</div>
                <div className="font-mono text-lg mt-3">{money(o.price)}</div>
              </button>
            ))}</div>
            {pick && <div className="civr-card p-5 space-y-3" data-testid="travel-esim-checkout"><div className="font-semibold">{`${zone.zone} · ${pick.gb} GB for ${pick.days} days`}</div><WalletPay price={pick.price} onWallet={buy} busy={busy} testid="travel-esim-pay" walletTestid="travel-esim-pay-button" /></div>}
          </div>
        )}
      </div>
      <ErrorNote error={err} testid="travel-esim-error" />
    </div>
  );
}
