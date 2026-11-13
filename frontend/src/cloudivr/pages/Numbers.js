import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Hash, ShoppingCart, ChevronRight, Copy, PhoneOutgoing, Plus } from 'lucide-react';
import { useApi, api, day, money, enc } from '../api';
import { PageHeader, Spinner, ErrorNote, Empty, statusPill, useSwitch } from '../ui';
import { cp } from '../paths';
import { ask } from '../confirm';
import { usePrivacy } from '../privacy';
import { useSearch, SearchBox, NoMatches } from '../search';
import { useShell } from '../Shell';
import { DIAL_FROM } from '../Softphone';
import { CallerIds } from './number/CallerIds';
import { MobileLines } from './number/MobileLines';
import { TextingLines, LIVE_TEXTING } from './number/TextingLines';
import { FaxLines } from './number/FaxLines';

const on = (f) => !!f?.enabled;

// One-tap on/off right on the card; the server says what to set up first when a feature isn't configured yet.
function QuickSwitch({ num, feature, label, checked, onSaved, testid }) {
  const s = useSwitch({ num, feature, label, checked, onSaved });
  return (
    <button type="button" role="switch" aria-checked={s.value} disabled={s.busy} onClick={() => s.flip(!s.value)} data-testid={testid}
      title={`${label} ${s.value ? 'on' : 'off'} — tap to switch`} className={`civr-pill !min-h-[32px] !px-3 cursor-pointer relative z-10 transition-colors ${s.value ? 'civr-pill-on' : 'text-[#a1a1aa] hover:text-[#f3f4f6] hover:border-[#3f3f46]'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.value ? 'bg-[#818cf8]' : 'bg-[#3f3f46]'}`} />{label}
    </button>
  );
}

const IconBtn = ({ icon: Icon, label, onClick, testid }) => (
  <button type="button" onClick={onClick} aria-label={label} title={label} data-testid={testid} className="relative z-10 w-9 h-9 rounded-lg flex items-center justify-center text-[#a1a1aa] hover:text-[#f3f4f6] hover:bg-[#1f1f1f] transition-colors"><Icon className="w-4 h-4" /></button>
);

// Fax line on/off right on the card (Business + fax-capable numbers). Warns when it would silence calls.
function FaxSwitch({ n, reload, testid }) {
  const [busy, setBusy] = useState(false);
  const on = n.features.fax?.line === true;
  const f = n.features || {};
  const voiceRouting = f.aiAgent?.enabled ? 'AI agent' : f.ivr?.enabled ? 'keypad menu (IVR)' : (f.ringGroup?.enabled && f.ringGroup?.members?.length) ? 'ring group' : (f.callForwarding?.enabled && f.callForwarding?.forwardTo) ? 'call forwarding' : null;
  const flip = async () => {
    const enabled = !on;
    const warn = enabled && voiceRouting;
    const ok = await ask(warn
      ? `This number takes calls with your ${voiceRouting}. A number can take calls or receive faxes — not both. If you turn the fax line on, callers will hear fax tones instead of your ${voiceRouting} until you switch it back to voice.`
      : enabled ? `Turn on the fax line for ${n.phoneNumber}? It will receive faxes and voice calls to it stop until you switch back.` : `Switch ${n.phoneNumber} back to voice? It stops receiving faxes.`,
      { ok: enabled ? 'Turn on fax line' : 'Back to voice', cancel: warn ? 'Keep taking calls' : 'Cancel', title: warn ? 'This stops your calls' : 'Fax line', danger: !!warn });
    if (!ok) return;
    setBusy(true);
    try { await api('/fax/line', { method: 'PATCH', body: { phone: n.phoneNumber, enabled, confirm: true } }); toast.success(enabled ? 'Fax line on — faxes arrive in your Inbox and email' : 'Back on voice'); reload?.(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <button type="button" role="switch" aria-checked={on} disabled={busy} onClick={flip} data-testid={testid}
      title={`Fax ${on ? 'on' : 'off'} — tap to switch`} className={`civr-pill !min-h-[32px] !px-3 cursor-pointer relative z-10 transition-colors ${on ? 'civr-pill-on' : 'text-[#a1a1aa] hover:text-[#f3f4f6] hover:border-[#3f3f46]'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-[#818cf8]' : 'bg-[#3f3f46]'}`} />Fax
    </button>
  );
}

function NumberCard({ n, i, pv, onSaved, reload }) {
  const { openPhone } = useShell();
  const copy = async () => { try { await navigator.clipboard.writeText(n.phoneNumber); toast.success('Number copied'); } catch (_) { toast.error('Couldn’t copy — long-press the number instead.'); } };
  const call = () => { window.dispatchEvent(new CustomEvent(DIAL_FROM, { detail: { from: n.phoneNumber } })); openPhone(); };
  const canCall = n.status === 'active' && (n.access?.sipCredentials || n.access?.ivrOutbound);
  const href = cp(`/app/numbers/${enc(n.phoneNumber)}`);
  const switches = [n.access?.callForwarding, n.access?.ivr, true, n.plan === 'business' && n.status === 'active' && n.capabilities?.fax].filter(Boolean).length;
  return (
    <div className={`civr-card p-6 civr-rise civr-d${(i % 4) + 1} flex flex-col`} data-testid={`number-card-${i}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={href} className="font-mono text-xl inline-flex items-center gap-1.5 min-h-[44px] -my-2 hover:text-[var(--c-accent,#818cf8)] transition-colors" data-testid={`number-card-${i}-phone`} aria-label={`Open ${n.phoneNumber}`}>{pv.phone(n.phoneNumber)}</Link>
          <div className="text-xs text-[#a1a1aa] mt-1">{n.countryName || n.country} · {n.type?.replace('_', '-')}</div>
        </div>
        <span className={statusPill(n.status)} data-testid={`number-card-${i}-status`}>{n.status}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-5">
        <span className="civr-pill">{n.planName} · {money(n.planPrice)}</span>
        {on(n.features.voicemail) && <span className="civr-pill civr-pill-on">Voicemail</span>}
        {n.features.recording && <span className="civr-pill civr-pill-on">Recording</span>}
        {n.isSubNumber && <span className="civr-pill" data-testid={`number-card-${i}-extra`}>Extra on {pv.phone(n.parentNumber)}</span>}
        {n.dryRun && <span className="civr-pill civr-pill-warn">Preview</span>}
      </div>
      <div className="mt-5 pt-4 border-t border-[var(--c-border,#1f1f1f)]" data-testid={`number-card-${i}-switches`}>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#a1a1aa] mb-2">Quick switches{switches ? '' : ' · none'}</div>
        <div className="flex flex-wrap gap-1.5">
          {n.access?.callForwarding && <QuickSwitch num={n} feature="callForwarding" label="Forwarding" checked={on(n.features.callForwarding)} onSaved={onSaved} testid={`number-card-${i}-switch-forwarding`} />}
          {n.access?.ivr && <QuickSwitch num={n} feature="ivr" label="IVR" checked={on(n.features.ivr)} onSaved={onSaved} testid={`number-card-${i}-switch-ivr`} />}
          <QuickSwitch num={n} feature="hours" label="Hours" checked={on(n.features.hours)} onSaved={onSaved} testid={`number-card-${i}-switch-hours`} />
          {n.plan === 'business' && n.status === 'active' && n.capabilities?.fax && <FaxSwitch n={n} reload={reload} testid={`number-card-${i}-switch-fax`} />}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mt-auto pt-5 text-xs text-[#a1a1aa]">
        <span className="whitespace-nowrap">{n.autoRenew ? 'Renews' : 'Expires'} {day(n.expiresAt)}</span>
        <div className="flex items-center gap-0.5 -mr-2">
          {!n.isSubNumber && n.status === 'active' && !n.replacedBy && <Link to={cp(`/app/buy?extra=${enc(n.phoneNumber)}`)} className="civr-btn civr-btn-ghost civr-btn-sm !h-9" title="Add another number that shares this plan" data-testid={`number-card-${i}-add-extra`}><Plus className="w-4 h-4" />Add number</Link>}
          <IconBtn icon={Copy} label="Copy number" onClick={copy} testid={`number-card-${i}-copy-button`} />
          {canCall && <IconBtn icon={PhoneOutgoing} label="Call from this number" onClick={call} testid={`number-card-${i}-call-button`} />}
          <Link to={href} className="civr-btn civr-btn-ghost civr-btn-sm !h-9 ml-1" data-testid={`number-card-${i}-link`}>Open<ChevronRight className="w-4 h-4" /></Link>
        </div>
      </div>
    </div>
  );
}

export default function Numbers() {
  const { data, error, loading, setData, reload } = useApi('/numbers');
  const { data: mob } = useApi('/mobile-numbers');
  const { data: hs } = useApi('/hosted-sms');
  const { data: fx } = useApi('/fax-numbers');
  const pv = usePrivacy();
  const nums = data?.numbers || [];
  const s = useSearch(nums, n => [n.phoneNumber, n.countryName, n.country, n.planName, n.status, n.type?.replace('_', '-'), n.isSubNumber ? 'Extra' : '']);
  // A switch reply carries the fresh number: swap it in without re-fetching the whole list.
  const onSaved = (d) => { if (d?.number) setData(x => ({ ...x, numbers: (x?.numbers || []).map(n => (n.phoneNumber === d.number.phoneNumber ? d.number : n)) })); };
  return (
    <div data-testid="numbers-page" className="pb-20 lg:pb-0">
      <PageHeader label="Phone numbers" title="My numbers" sub="Every number you own, grouped by what it does. Open a Business Line to change forwarding, menus or hours." testid="numbers-header">
        <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="numbers-buy-button"><ShoppingCart className="w-4 h-4" />Get a number</Link>
      </PageHeader>
      <ErrorNote error={error} />
      {loading ? <Spinner /> : !nums.length && (mob?.items?.length || fx?.numbers?.some(n => n.status !== 'released') || hs?.items?.some(t => LIVE_TEXTING.includes(t.status))) ? null : !nums.length ? (
        <Empty icon={Hash} title="No numbers yet" sub="Pick a country, choose a number and a plan — most numbers are live in about a minute." testid="numbers-empty">
          <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="numbers-empty-buy-button">Get your first number</Link>
        </Empty>
      ) : (
        <>
        <SearchBox s={s} placeholder="Search numbers" testid="numbers-search" className="mb-4 max-w-md" />
        <NoMatches s={s} testid="numbers-no-matches" />
        <div className="grid md:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-4 gap-4">
          {s.list.map((n, i) => <NumberCard key={n.phoneNumber} n={n} i={i} pv={pv} onSaved={onSaved} reload={reload} />)}
        </div>
        </>
      )}
      <MobileLines />
      <TextingLines />
      <FaxLines />
      {nums.some(n => n.status === 'active') && <CallerIds />}
    </div>
  );
}
