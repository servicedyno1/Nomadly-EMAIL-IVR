import React, { useEffect, useMemo, useState } from 'react';
import { Flag } from '../Pickers';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Hash, ShoppingCart, ChevronRight, Copy, Plus } from 'lucide-react';
import { useApi, api, day, money, enc } from '../api';
import { PageHeader, Spinner, ErrorNote, Empty, statusPill, useSwitch } from '../ui';
import { cp } from '../paths';
import { ask } from '../confirm';
import { usePrivacy } from '../privacy';
import { useSearch, SearchBox, NoMatches } from '../search';
import { CallerIds } from './number/CallerIds';
import { EsimCard } from './esim/EsimCard';
import { TextingLine, LIVE_TEXTING } from './number/TextingLines';
import { FaxLine } from './number/FaxLines';
import { CapBadges } from '../kinds';
import { NumberActions } from './number/NumberActions';

const on = (f) => !!f?.enabled;

// One-tap on/off right on the card; the server says what to set up first when a feature isn't configured yet.
function QuickSwitch({ num, feature, label, checked, onSaved, testid }) {
  const s = useSwitch({ num, feature, label, checked, onSaved });
  return (
    <button type="button" role="switch" aria-checked={s.value} disabled={s.busy} onClick={() => s.flip(!s.value)} data-testid={testid}
      title={`${label} ${s.value ? 'on' : 'off'} — tap to switch`} className={`civr-pill !min-h-[44px] sm:!min-h-[36px] !px-4 cursor-pointer relative z-10 transition-colors ${s.value ? 'civr-pill-on' : 'text-[#a1a1aa] hover:text-[#f3f4f6] hover:border-[#3f3f46]'}`}>
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
      title={`Fax ${on ? 'on' : 'off'} — tap to switch`} className={`civr-pill !min-h-[44px] sm:!min-h-[36px] !px-4 cursor-pointer relative z-10 transition-colors ${on ? 'civr-pill-on' : 'text-[#a1a1aa] hover:text-[#f3f4f6] hover:border-[#3f3f46]'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-[#818cf8]' : 'bg-[#3f3f46]'}`} />Fax
    </button>
  );
}

function NumberCard({ n, i, caps, pv, onSaved, reload }) {
  const copy = async () => { try { await navigator.clipboard.writeText(n.phoneNumber); toast.success('Number copied'); } catch (_) { toast.error('Couldn’t copy — long-press the number instead.'); } };
  const href = cp(`/app/numbers/${enc(n.phoneNumber)}`);
  const switches = [n.access?.callForwarding, n.access?.ivr, true, n.plan === 'business' && n.status === 'active' && n.capabilities?.fax].filter(Boolean).length;
  return (
    <div className="civr-card p-5 civr-rise flex flex-col" data-testid={`number-card-${i}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={href} className="font-mono text-xl inline-flex items-center gap-1.5 min-h-[44px] -my-2 hover:text-[var(--c-accent)] transition-colors" data-testid={`number-card-${i}-phone`} aria-label={`Open ${n.phoneNumber}`}>{pv.phone(n.phoneNumber)}</Link>
          <div className="text-[13px] text-[var(--c-muted)] mt-1" data-testid={`number-card-${i}-country`}><span className="inline-block align-[-2px] mr-1.5"><Flag code={n.country} /></span>{n.countryName || n.country} · {n.planName} {money(n.planPrice)} · {n.autoRenew ? 'renews' : 'expires'} {day(n.expiresAt)}</div>
        </div>
        <span className={statusPill(n.status)} data-testid={`number-card-${i}-status`}>{n.status}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <CapBadges caps={caps} testid={`number-card-${i}-caps`} />
        {on(n.features.voicemail) && <span className="civr-pill">Voicemail</span>}
        {n.features.recording && <span className="civr-pill">Recording</span>}
        {n.isSubNumber && <span className="civr-pill" data-testid={`number-card-${i}-extra`}>Extra on {pv.phone(n.parentNumber)}</span>}
        {n.dryRun && <span className="civr-pill civr-pill-warn">Preview</span>}
        {n.registration?.status === 'pending' && <span className="civr-pill civr-pill-warn" title="The carrier is checking your documents. The number goes live once they approve them." data-testid={`number-card-${i}-registration`}>Awaiting carrier approval</span>}
        {n.features?.texting?.available && !n.features.texting.enabled && <Link to={`${href}?tab=sms`} className="text-[13px] text-[var(--c-accent)] hover:underline relative z-10 ml-1 min-h-[32px] inline-flex items-center" data-testid={`number-card-${i}-add-texting`}>+ Add texting</Link>}
      </div>
      {switches > 0 && <div className="mt-4 flex flex-wrap items-center gap-1.5" aria-label="Quick switches" data-testid={`number-card-${i}-switches`}>
        {n.access?.callForwarding && <QuickSwitch num={n} feature="callForwarding" label="Forwarding" checked={on(n.features.callForwarding)} onSaved={onSaved} testid={`number-card-${i}-switch-forwarding`} />}
        {n.access?.ivr && <QuickSwitch num={n} feature="ivr" label="IVR" checked={on(n.features.ivr)} onSaved={onSaved} testid={`number-card-${i}-switch-ivr`} />}
        <QuickSwitch num={n} feature="hours" label="Hours" checked={on(n.features.hours)} onSaved={onSaved} testid={`number-card-${i}-switch-hours`} />
        {n.plan === 'business' && n.status === 'active' && n.capabilities?.fax && <FaxSwitch n={n} reload={reload} testid={`number-card-${i}-switch-fax`} />}
      </div>}
      <div className="flex items-center gap-1 mt-auto pt-4">
        <Link to={href} className="civr-btn civr-btn-ghost civr-btn-sm mr-auto" data-testid={`number-card-${i}-link`}>Settings<ChevronRight className="w-4 h-4" /></Link>
        <NumberActions n={n} reload={reload} testid={`number-card-${i}`} />
        <IconBtn icon={Copy} label="Copy number" onClick={copy} testid={`number-card-${i}-copy-button`} />
        {!n.isSubNumber && n.status === 'active' && !n.replacedBy && <Link to={cp(`/app/buy?extra=${enc(n.phoneNumber)}`)} className="relative z-10 w-9 h-9 rounded-lg flex items-center justify-center text-[var(--c-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-surface-2)] transition-colors" aria-label="Add another number that shares this plan" title="Add another number that shares this plan" data-testid={`number-card-${i}-add-extra`}><Plus className="w-4 h-4" /></Link>}
      </div>
    </div>
  );
}

// What a calling number can do right now.
const lineCaps = (n) => [...(n.features?.fax?.line ? ['fax'] : n.capabilities?.voice !== false ? ['calls'] : []), ...(n.capabilities?.sms && n.features?.texting?.enabled && n.features.texting.available ? ['texts'] : [])];
const FILTERS = [['all', 'All'], ['calls', 'Calls'], ['texts', 'Texts'], ['fax', 'Fax']];
const BUY = { calls: 'calls', texts: 'texting', fax: 'fax' };

export default function Numbers() {
  const { data, error, loading, setData, reload } = useApi('/numbers');
  const { data: mob, reload: reloadMob } = useApi('/mobile-numbers');
  const { data: es, reload: reloadEs } = useApi('/esim');
  const { data: hs } = useApi('/hosted-sms');
  const { data: fx } = useApi('/fax-numbers');
  const [params, setParams] = useSearchParams();
  const pv = usePrivacy();
  const nums = data?.numbers || [];
  const waiting = !!mob?.items?.some(x => x.status === 'provisioning');
  useEffect(() => { if (!waiting) return undefined; const t = setInterval(reloadMob, 5000); return () => clearInterval(t); }, [waiting, reloadMob]);
  // Every number the account owns in one list, whatever it was bought as.
  const items = useMemo(() => [
    ...(data?.numbers || []).map((n, i) => ({ key: n.phoneNumber, type: 'line', n, i, caps: lineCaps(n), words: [n.phoneNumber, n.countryName, n.country, n.planName, n.status, n.type?.replace('_', '-'), n.isSubNumber ? 'Extra' : ''] })),
    ...(es?.items || []).filter(x => x.status !== 'failed').map(x => ({ key: `e-${x.id}`, type: 'esim', x, caps: ['calls', 'texts'], words: [x.phoneNumber, 'USA eSIM', x.status] })),
    ...(mob?.items || []).map(x => ({ key: `m-${x.id}`, type: 'mobile', x, caps: ['calls', 'texts'], words: [x.phoneNumber, 'USA texting', x.status] })),
    ...(hs?.items || []).filter(t => LIVE_TEXTING.includes(t.status)).map(t => ({ key: `h-${t.id}`, type: 'hosted', t, caps: ['texts'], words: [t.phoneNumber, 'landline texting', t.status] })),
    ...(fx?.numbers || []).filter(n => n.status !== 'released').map(n => ({ key: `f-${n.phoneNumber}`, type: 'fax', f: n, caps: ['fax'], words: [n.phoneNumber, 'fax', n.country, n.status] })),
  ], [data, es, mob, hs, fx]);
  const s = useSearch(items, it => it.words);
  const show = FILTERS.some(f => f[0] === params.get('show')) ? params.get('show') : 'all';
  const list = s.list.filter(it => show === 'all' || it.caps.includes(show));
  const count = (id) => (id === 'all' ? items.length : items.filter(it => it.caps.includes(id)).length);
  // A switch reply carries the fresh number: swap it in without re-fetching the whole list.
  const onSaved = (d) => { if (d?.number) setData(x => ({ ...x, numbers: (x?.numbers || []).map(n => (n.phoneNumber === d.number.phoneNumber ? d.number : n)) })); };
  return (
    <div data-testid="numbers-page" className="pb-20 lg:pb-0">
      <PageHeader label="Phone numbers" title="My numbers" sub="Every number you own. Badges show what each one does." testid="numbers-header">
        <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="numbers-buy-button"><ShoppingCart className="w-4 h-4" />Get a number</Link>
      </PageHeader>
      <ErrorNote error={error} />
      {loading ? <Spinner /> : !items.length ? (
        <Empty icon={Hash} title="No numbers yet" sub="Say what it’s for (calls, calls + texting or fax), pick a number and pay. Most numbers are live in about a minute." testid="numbers-empty">
          <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="numbers-empty-buy-button">Get your first number</Link>
        </Empty>
      ) : (
        <>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="civr-seg flex gap-1" role="tablist" aria-label="Show numbers that do" data-testid="numbers-filter">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={show === id} onClick={() => setParams(id === 'all' ? {} : { show: id }, { replace: true })} data-testid={`numbers-filter-${id}`}
                className={`civr-seg-btn inline-flex items-center gap-2 min-h-[40px] px-4 rounded-full text-sm font-medium transition-colors ${show === id ? 'civr-seg-on' : 'text-[var(--c-muted)] hover:text-[var(--c-text)]'}`}>{label}<span className="text-xs opacity-70" data-testid={`numbers-filter-${id}-count`}>{count(id)}</span></button>
            ))}
          </div>
          <SearchBox s={s} placeholder="Search numbers" testid="numbers-search" className="flex-1 min-w-[200px] max-w-md" />
        </div>
        <NoMatches s={s} testid="numbers-no-matches" />
        {!list.length && !s.q && <div className="civr-card p-5 text-sm flex flex-wrap items-center gap-3" data-testid="numbers-filter-empty"><span className="flex-1 min-w-[200px] text-[var(--c-muted)]">{`None of your numbers ${show === 'fax' ? 'take faxes' : show === 'texts' ? 'can text' : 'take calls'} yet.`}</span><Link to={cp(`/app/buy?purpose=${BUY[show]}`)} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="numbers-filter-empty-buy">Get one</Link></div>}
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 items-start" data-testid="numbers-list">
          {list.map(it => (it.type === 'line' ? <NumberCard key={it.key} n={it.n} i={it.i} caps={it.caps} pv={pv} onSaved={onSaved} reload={reload} />
            : it.type === 'esim' ? <EsimCard key={it.key} item={it.x} reload={reloadEs} />
            : it.type === 'mobile' ? <EsimCard key={it.key} item={it.x} reload={reloadMob} mobile />
            : it.type === 'hosted' ? <TextingLine key={it.key} t={it.t} pv={pv} />
            : <FaxLine key={it.key} n={it.f} pv={pv} />))}
        </div>
        </>
      )}
      {nums.some(n => n.status === 'active') && <CallerIds />}
    </div>
  );
}
