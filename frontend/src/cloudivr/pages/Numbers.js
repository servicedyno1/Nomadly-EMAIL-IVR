import React from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Hash, ShoppingCart, ChevronRight, Copy, PhoneOutgoing } from 'lucide-react';
import { useApi, day, money, enc } from '../api';
import { PageHeader, Spinner, ErrorNote, Empty, statusPill, useSwitch } from '../ui';
import { cp } from '../paths';
import { usePrivacy } from '../privacy';
import { useSearch, SearchBox, NoMatches } from '../search';
import { useShell } from '../Shell';
import { DIAL_FROM } from '../Softphone';
import { CallerIds } from './number/CallerIds';

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

function NumberCard({ n, i, pv, onSaved }) {
  const { openPhone } = useShell();
  const copy = async () => { try { await navigator.clipboard.writeText(n.phoneNumber); toast.success('Number copied'); } catch (_) { toast.error('Couldn’t copy — long-press the number instead.'); } };
  const call = () => { window.dispatchEvent(new CustomEvent(DIAL_FROM, { detail: { from: n.phoneNumber } })); openPhone(); };
  const canCall = n.status === 'active' && (n.access?.sipCredentials || n.access?.ivrOutbound);
  return (
    <div className={`civr-card civr-card-link relative p-6 civr-rise civr-d${(i % 4) + 1}`} data-testid={`number-card-${i}`}>
      <Link to={cp(`/app/numbers/${enc(n.phoneNumber)}`)} className="absolute inset-0 rounded-[14px]" aria-label={`Open ${n.phoneNumber}`} data-testid={`number-card-${i}-link`} />
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-xl" data-testid={`number-card-${i}-phone`}>{pv.phone(n.phoneNumber)}</div>
          <div className="text-xs text-[#a1a1aa] mt-1">{n.countryName || n.country} · {n.type?.replace('_', '-')}</div>
        </div>
        <span className={statusPill(n.status)} data-testid={`number-card-${i}-status`}>{n.status}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-6">
        <span className="civr-pill">{n.planName} · {money(n.planPrice)}</span>
        {on(n.features.voicemail) && <span className="civr-pill civr-pill-on">Voicemail</span>}
        {n.features.recording && <span className="civr-pill civr-pill-on">Recording</span>}
        {n.isSubNumber && <span className="civr-pill" data-testid={`number-card-${i}-extra`}>Extra on {pv.phone(n.parentNumber)}</span>}
        {n.dryRun && <span className="civr-pill civr-pill-warn">Preview</span>}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3" data-testid={`number-card-${i}-switches`}>
        {n.access?.callForwarding && <QuickSwitch num={n} feature="callForwarding" label="Forwarding" checked={on(n.features.callForwarding)} onSaved={onSaved} testid={`number-card-${i}-switch-forwarding`} />}
        {n.access?.ivr && <QuickSwitch num={n} feature="ivr" label="IVR" checked={on(n.features.ivr)} onSaved={onSaved} testid={`number-card-${i}-switch-ivr`} />}
        <QuickSwitch num={n} feature="hours" label="Hours" checked={on(n.features.hours)} onSaved={onSaved} testid={`number-card-${i}-switch-hours`} />
      </div>
      <div className="flex items-center justify-between mt-5 text-xs text-[#a1a1aa]">
        <span>{n.autoRenew ? 'Renews' : 'Expires'} {day(n.expiresAt)}</span>
        <div className="flex items-center gap-0.5 -mr-2">
          <IconBtn icon={Copy} label="Copy number" onClick={copy} testid={`number-card-${i}-copy-button`} />
          {canCall && <IconBtn icon={PhoneOutgoing} label="Call from this number" onClick={call} testid={`number-card-${i}-call-button`} />}
          <span className="w-9 h-9 flex items-center justify-center"><ChevronRight className="w-4 h-4" /></span>
        </div>
      </div>
    </div>
  );
}

export default function Numbers() {
  const { data, error, loading, setData } = useApi('/numbers');
  const pv = usePrivacy();
  const nums = data?.numbers || [];
  const s = useSearch(nums, n => [n.phoneNumber, n.countryName, n.country, n.planName, n.status, n.type?.replace('_', '-'), n.isSubNumber ? 'Extra' : '']);
  // A switch reply carries the fresh number: swap it in without re-fetching the whole list.
  const onSaved = (d) => { if (d?.number) setData(x => ({ ...x, numbers: (x?.numbers || []).map(n => (n.phoneNumber === d.number.phoneNumber ? d.number : n)) })); };
  return (
    <div data-testid="numbers-page">
      <PageHeader label="Numbers" title="My numbers" sub="Each number answers your callers. Switch forwarding, the keypad menu or hours on and off here, or open a number for everything else." testid="numbers-header">
        <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="numbers-buy-button"><ShoppingCart className="w-4 h-4" />Buy a number</Link>
      </PageHeader>
      <ErrorNote error={error} />
      {loading ? <Spinner /> : !nums.length ? (
        <Empty icon={Hash} title="No numbers yet" sub="Pick a country, choose a number and a plan — most numbers are live in about a minute." testid="numbers-empty">
          <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="numbers-empty-buy-button">Buy your first number</Link>
        </Empty>
      ) : (
        <>
        <SearchBox s={s} placeholder="Search numbers" testid="numbers-search" className="mb-4 max-w-md" />
        <NoMatches s={s} testid="numbers-no-matches" />
        <div className="grid md:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-4 gap-4">
          {s.list.map((n, i) => <NumberCard key={n.phoneNumber} n={n} i={i} pv={pv} onSaved={onSaved} />)}
        </div>
        </>
      )}
      {nums.some(n => n.status === 'active') && <CallerIds />}
    </div>
  );
}
