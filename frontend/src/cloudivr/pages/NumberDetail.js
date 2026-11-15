import React, { useRef, useState } from 'react';
import { Flag } from '../Pickers';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { SetupIntentBanner } from './buy/setupIntent';
import { ArrowLeft, Lock, Bot, Plus, RefreshCw, Check, ChevronRight } from 'lucide-react';
import { useApi, enc, day } from '../api';
import { Spinner, ErrorNote, Locked, statusPill, Toggle, useSwitch } from '../ui';
import { CapBadges } from '../kinds';
import { OverviewTab, ForwardingTab, VoicemailTab, SmsTab, RecordingTab } from './number/SettingsTabs';
import SipTab from './number/SipTab';
import { Capacity } from './number/Capacity';
import IvrTab from './number/IvrTab';
import LogsTab from './number/LogsTab';
import BillingTab from './number/BillingTab';
import HoursTab from './number/HoursTab';
import MissedTextBackTab from './number/MissedTextBackTab';
import AiAgentTab from './number/AiAgentTab';
import BrowserRingTab from './number/BrowserRingTab';
import RingGroupTab from './number/RingGroupTab';
import TextTriggersTab from './number/TextTriggersTab';
import { cp } from '../paths';
import { useShell } from '../Shell';
import { planFor } from '../PlanFeatures';
import { usePrivacy } from '../privacy';
import { confirmLeave } from '../guard';
import { ReachChip } from '../SmsReach';
import { SetupGuide } from './number/SetupGuide';
import { Crumbs } from '../SectionTabs';
import { NumberRegistration } from './number/NumberRegistration';

// Tabs in 5 groups. Group → [id, label, sub-tabs]; sub-tab → [id, label, access gate, component]. Tab ids are unchanged (old ?tab= links work).
const GROUPS = [
  ['overview', 'Overview', [['overview', 'Overview', null, OverviewTab]]],
  ['answering', 'Answering', [
    ['forwarding', 'Forwarding', 'callForwarding', ForwardingTab], ['ivr', 'Keypad menu', 'ivr', IvrTab], ['ai', 'AI agent', 'aiAgent', AiAgentTab],
    ['ringgroup', 'Ring group', 'ringGroup', RingGroupTab], ['browser', 'Browser ring', 'browserRing', BrowserRingTab], ['voicemail', 'Voicemail', 'voicemail', VoicemailTab],
    ['hours', 'Hours', null, HoursTab], ['sip', 'Softphone (SIP)', 'sipCredentials', SipTab],
  ]],
  ['texting', 'Texting', [['sms', 'SMS', null, SmsTab], ['textback', 'Missed-call text', null, MissedTextBackTab], ['triggers', 'Text Triggers', 'textTriggers', TextTriggersTab]]],
  ['recordings', 'Recordings', [['recording', 'Recording', 'callRecording', RecordingTab], ['logs', 'Call log', null, LogsTab]]],
  ['billing', 'Billing', [['billing', 'Billing', null, BillingTab]]],
];
const TABS = GROUPS.flatMap(([gid, , tabs]) => tabs.map(t => [...t, gid]));
export const TAB_LABEL = Object.fromEntries(TABS.map(t => [t[0], t[1]]));

// What answers this number right now → [group, label, tab].
export const answering = (f = {}) => (f.aiAgent?.enabled ? ['answering', 'AI agent', 'ai'] : f.ivr?.enabled ? ['answering', 'Keypad menu', 'ivr']
  : (f.ringGroup?.enabled && f.ringGroup?.members?.length) ? ['answering', 'Ring group', 'ringgroup'] : (f.callForwarding?.enabled && f.callForwarding?.forwardTo) ? ['answering', 'Forwarding', 'forwarding'] : null);

// Tabs that can be switched on and off right from the list → [switch name, how to read its state].
const SW = {
  forwarding: ['callForwarding', f => f.callForwarding?.enabled], ivr: ['ivr', f => f.ivr?.enabled], ai: ['aiAgent', f => f.aiAgent?.enabled],
  ringgroup: ['ringGroup', f => f.ringGroup?.enabled], browser: ['browserRing', f => f.browserRing?.enabled], voicemail: ['voicemail', f => f.voicemail?.enabled],
  hours: ['hours', f => f.hours?.enabled], sms: ['texting', f => f.texting?.enabled], textback: [null, f => f.missedTextBack?.enabled],
  triggers: ['textTriggers', f => f.textTriggers?.enabled], recording: ['recording', f => f.recording],
};

// One setting in the list: open it, or flip it on/off on the spot. "Saved" shows next to the switch after each change.
function FeatureRow({ n, id, name, gate, active, onOpen, reload }) {
  const [feature, read] = SW[id] || [];
  const locked = !!gate && !n.access[gate];
  const on = !!read?.(n.features || {});
  const canSwitch = !!feature && !locked && n.status === 'active' && (id !== 'sms' || !!n.capabilities?.sms);
  const [saved, setSaved] = useState(false);
  const timer = useRef(null);
  const sw = useSwitch({ num: n, feature, label: name, checked: on, reload, onSaved: () => { setSaved(true); clearTimeout(timer.current); timer.current = setTimeout(() => setSaved(false), 2500); } });
  return (
    <div className={`flex items-center gap-2 pl-4 pr-3 min-h-[52px] border-b last:border-0 border-[var(--c-border)] transition-colors ${active ? 'bg-[var(--c-accent-soft)]' : 'hover:bg-[var(--c-card-hover)]'}`} data-testid={`number-row-${id}`}>
      <button type="button" role="tab" aria-selected={active} onClick={onOpen} className="flex-1 min-w-0 min-h-[52px] text-left flex items-center gap-2" data-testid={`number-tab-${id}`}>
        <span className={`text-sm font-medium ${active ? 'text-[var(--c-accent)]' : ''}`}>{name}</span>
        {locked && <Lock className="w-3 h-3 text-[#fbbf24]" aria-label="Needs a higher plan" data-testid={`number-tab-${id}-lock`} />}
        {!canSwitch && !locked && read && <span className={`civr-pill !min-h-[22px] !py-0 !px-2 !text-[11px] ${on ? 'civr-pill-ok' : ''}`} data-testid={`number-row-${id}-state`}>{on ? 'On' : 'Off'}</span>}
      </button>
      {saved && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-500" role="status" data-testid={`number-row-${id}-saved`}><Check className="w-3.5 h-3.5" />Saved</span>}
      {canSwitch ? <Toggle checked={sw.value} disabled={sw.busy} onChange={sw.flip} testid={`number-row-${id}-switch`} label={name} /> : <ChevronRight className="w-4 h-4 text-[var(--c-muted)]" aria-hidden="true" />}
    </div>
  );
}

export default function NumberDetail() {
  const { phone } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi(`/numbers/${enc(phone)}`);
  const { catalog } = useShell();
  const pv = usePrivacy();
  const tab = params.get('tab') || 'overview';
  const n = data?.number;
  if (loading && !n) return <Spinner />;
  if (error) return (
    <div data-testid="number-detail-error">
      <Link to={cp('/app/numbers')} className="inline-flex items-center gap-2 min-h-[44px] text-sm text-[#a1a1aa] hover:text-[#818cf8] mb-3" data-testid="number-detail-error-back-link"><ArrowLeft className="w-4 h-4" />All numbers</Link>
      <h1 className="font-display text-3xl font-extrabold mb-4">Number not available</h1>
      <ErrorNote error={error} />
    </div>
  );
  const [, label, gate, Comp, gid] = TABS.find(t => t[0] === tab) || TABS[0];
  const visible = () => true;
  const subTabs = (GROUPS.find(g => g[0] === gid) || GROUPS[0])[2].filter(visible);
  const badge = answering(n.features);
  const go = async (id) => { if (id !== tab && await confirmLeave()) { setParams({ tab: id }, { replace: true }); if (window.matchMedia?.('(max-width: 1023px)').matches) setTimeout(() => document.querySelector('[data-number-panel]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); } };
  const caps = [...(n.features?.fax?.line ? ['fax'] : n.capabilities?.voice !== false ? ['calls'] : []), ...(n.capabilities?.sms && n.features?.texting?.enabled && n.features.texting.available ? ['texts'] : [])];
  const regWait = ['needs_details', 'pending'].includes(n.registration?.status);
  const main = n.status === 'active' && !n.isSubNumber && !n.replacedBy;
  return (
    <div data-testid="number-detail-page">
      <Crumbs testid="number-breadcrumbs" items={[['Phone numbers'], ['My numbers', cp('/app/numbers')], [pv.phone(n.phoneNumber), tab !== 'overview' ? cp(`/app/numbers/${enc(n.phoneNumber)}`) : undefined], ...(tab !== 'overview' ? [[TAB_LABEL[tab] || label]] : [])]} />
      {n.status === 'active' && !regWait && params.get('prep') !== 'menu' && <SetupIntentBanner phone={n.phoneNumber} />}
      <div className="flex flex-col md:flex-row md:items-start gap-4 justify-between mb-8 civr-rise">
        <div>
          <div className="civr-label flex items-center gap-1.5" data-testid="number-detail-country"><Flag code={n.country} />{n.countryName || n.country} · {n.type?.replace('_', '-')} · {n.planName}</div>
          <h1 className="font-mono text-4xl sm:text-5xl mt-2" data-testid="number-detail-phone">{pv.phone(n.phoneNumber)}</h1>
          <div className="mt-3"><CapBadges caps={caps} testid="number-detail-caps" /></div>
          <div className="mt-3"><Capacity capacity={n.capacity} testid="number-detail-capacity" /></div>
          <NumberRegistration n={n} reload={reload} />
          {caps.includes('texts') && <div className="mt-3"><ReachChip phone={n.phoneNumber} testid="number-sms-reach" /></div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {regWait ? <span className="civr-pill civr-pill-warn" data-testid="number-detail-status">{n.registration.status === 'pending' ? 'waiting for carrier' : 'waiting for details'}</span>
            : <span className={statusPill(n.status)} data-testid="number-detail-status">{n.status}</span>}
          <span className="civr-pill" data-testid="number-detail-expiry">{n.autoRenew ? 'renews' : 'expires'} {day(n.expiresAt)}</span>
          {n.dryRun && <span className="civr-pill civr-pill-warn">preview</span>}
          {n.replacedBy ? <span className="civr-pill civr-pill-warn" data-testid="number-detail-old-pill">{`Old number · until ${day(n.releaseAt)}`}</span>
            : n.status === 'active' && <button type="button" onClick={async () => { if (await confirmLeave()) setParams({ tab: 'billing', replace: '1' }, { replace: true }); }} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="number-detail-replace">Replace number</button>}
        </div>
      </div>
      {!regWait && <SetupGuide n={n} />}
      <div className="civr-seg civr-scroll-x flex gap-1 overflow-x-auto mb-4" role="tablist" aria-label="Settings groups" data-testid="number-groups">
        {GROUPS.map(([id, name, tabs]) => {
          const first = (badge && badge[0] === id && tabs.some(t => t[0] === badge[2]) ? badge[2] : null) || tabs.filter(visible)[0]?.[0];
          const active = gid === id;
          return (
            <button key={id} type="button" role="tab" aria-selected={active} onClick={() => go(active ? tab : first)} data-testid={`number-group-${id}`}
              className={`civr-seg-btn shrink-0 inline-flex items-center gap-2 min-h-[40px] px-4 rounded-full text-sm font-medium transition-colors ${active ? 'civr-seg-on' : 'text-[#a1a1aa] hover:text-[var(--c-text,#f4f4f5)]'}`}>
              {name}{badge && badge[0] === id && <span className="civr-pill civr-pill-ok !text-[11px] !py-0 !px-2" data-testid={`number-group-${id}-badge`}>{badge[1]}</span>}
            </button>
          );
        })}
      </div>
      {tab === 'overview' && n.status === 'active' && (
        <div className="flex flex-wrap gap-2 mb-6" data-testid="number-quick-actions">
          {n.access?.aiAgent && <button type="button" onClick={() => go('ai')} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="number-quick-assign-ai"><Bot className="w-4 h-4" />Assign an AI agent</button>}
          {main && <Link to={cp(`/app/buy?extra=${enc(n.phoneNumber)}`)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="number-quick-add-extra"><Plus className="w-4 h-4" />Add an extra number</Link>}
          {!n.replacedBy && <button type="button" onClick={() => go('billing')} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="number-quick-renew"><RefreshCw className="w-4 h-4" />Renew or change plan</button>}
        </div>
      )}
      <div className={subTabs.length > 1 ? 'grid lg:grid-cols-[300px_minmax(0,1fr)] gap-6 items-start' : ''}>
        {subTabs.length > 1 && (
          <div className="civr-card !p-0 overflow-hidden lg:sticky lg:top-20" role="tablist" aria-orientation="vertical" aria-label="Settings" data-testid="number-tabstrip">
            {subTabs.map(([id, name, g]) => <FeatureRow key={id} n={n} id={id} name={name} gate={g} active={tab === id} onOpen={() => go(id)} reload={reload} />)}
          </div>
        )}
        <div data-number-panel className="scroll-mt-20 min-w-0" data-testid={`number-tabpanel-${TABS.some(t => t[0] === tab) ? tab : TABS[0][0]}`}>
          {gate && !n.access[gate] ? <Locked feature={label} phone={n.phoneNumber} need={planFor(catalog?.plans, gate)?.name} /> : <Comp key={tab === 'forwarding' ? `forwarding:${n.features?.callForwarding?.mode}` : tab} num={n} reload={reload} onDeleted={() => nav(cp('/app/numbers'))} />}
        </div>
      </div>
    </div>
  );
}
