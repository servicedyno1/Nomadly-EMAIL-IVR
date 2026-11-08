import React from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';
import { useApi, enc, day } from '../api';
import { Spinner, ErrorNote, Locked, statusPill, TabStrip } from '../ui';
import { OverviewTab, ForwardingTab, VoicemailTab, SmsTab, FaxTab, RecordingTab } from './number/SettingsTabs';
import SipTab from './number/SipTab';
import IvrTab from './number/IvrTab';
import LogsTab from './number/LogsTab';
import BillingTab from './number/BillingTab';
import HoursTab from './number/HoursTab';
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

// Tabs in 4 groups + Overview. Group → [id, label, sub-tabs]; sub-tab → [id, label, access gate, component].
const GROUPS = [
  ['overview', 'Overview', [['overview', 'Overview', null, OverviewTab]]],
  ['calls', 'Calls', [
    ['forwarding', 'Forwarding', 'callForwarding', ForwardingTab], ['ringgroup', 'Ring group', 'ringGroup', RingGroupTab], ['browser', 'Browser ring', 'browserRing', BrowserRingTab],
    ['ivr', 'Keypad menu', 'ivr', IvrTab], ['ai', 'AI voice agent', 'aiAgent', AiAgentTab], ['hours', 'Hours', null, HoursTab],
  ]],
  ['messages', 'Messages', [
    ['voicemail', 'Voicemail', 'voicemail', VoicemailTab], ['recording', 'Recording', 'callRecording', RecordingTab], ['sms', 'SMS', null, SmsTab], ['fax', 'Fax', null, FaxTab], ['triggers', 'Text Triggers', 'textTriggers', TextTriggersTab],
  ]],
  ['connect', 'Connect', [['sip', 'SIP', 'sipCredentials', SipTab]]],
  ['account', 'Account', [['logs', 'Logs', null, LogsTab], ['billing', 'Billing', null, BillingTab]]],
];
const TABS = GROUPS.flatMap(([gid, , tabs]) => tabs.map(t => [...t, gid]));

// What answers this number right now — shown as a badge on the group that controls it.
const answering = (f = {}) => (f.fax?.line ? ['messages', 'Fax line on', 'fax'] : f.aiAgent?.enabled ? ['calls', 'AI agent', 'ai'] : f.ivr?.enabled ? ['calls', 'Keypad menu', 'ivr']
  : (f.ringGroup?.enabled && f.ringGroup?.members?.length) ? ['calls', 'Ring group', 'ringgroup'] : (f.callForwarding?.enabled && f.callForwarding?.forwardTo) ? ['calls', 'Forwarding', 'forwarding'] : null);

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
  const visible = (t) => t[0] !== 'fax' || n.capabilities?.fax;
  const subTabs = (GROUPS.find(g => g[0] === gid) || GROUPS[0])[2].filter(visible);
  const badge = answering(n.features);
  const go = async (id) => { if (id !== tab && await confirmLeave()) setParams({ tab: id }, { replace: true }); };
  return (
    <div data-testid="number-detail-page">
      <Link to={cp('/app/numbers')} className="inline-flex items-center gap-2 min-h-[44px] text-sm text-[#a1a1aa] hover:text-[#818cf8] mb-3" data-testid="number-detail-back-link"><ArrowLeft className="w-4 h-4" />All numbers</Link>
      <div className="flex flex-col md:flex-row md:items-start gap-4 justify-between mb-8 civr-rise">
        <div>
          <div className="civr-label">{n.countryName || n.country} · {n.type?.replace('_', '-')} · {n.planName}</div>
          <h1 className="font-mono text-4xl sm:text-5xl mt-2" data-testid="number-detail-phone">{pv.phone(n.phoneNumber)}</h1>
          {n.capabilities?.sms !== false && <div className="mt-3"><ReachChip phone={n.phoneNumber} testid="number-sms-reach" /></div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={statusPill(n.status)} data-testid="number-detail-status">{n.status}</span>
          <span className="civr-pill" data-testid="number-detail-expiry">{n.autoRenew ? 'renews' : 'expires'} {day(n.expiresAt)}</span>
          {n.dryRun && <span className="civr-pill civr-pill-warn">preview</span>}
          {n.replacedBy ? <span className="civr-pill civr-pill-warn" data-testid="number-detail-old-pill">{`Old number · until ${day(n.releaseAt)}`}</span>
            : n.status === 'active' && <button type="button" onClick={async () => { if (await confirmLeave()) setParams({ tab: 'billing', replace: '1' }, { replace: true }); }} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="number-detail-replace">Replace number</button>}
        </div>
      </div>
      <SetupGuide n={n} />
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
      {subTabs.length > 1 && (
        <TabStrip active={tab} testid="number-tabstrip" className="mb-6">
          {subTabs.map(([id, name, g]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => go(id)} data-testid={`number-tab-${id}`}
              className={`inline-flex items-center gap-1 px-2.5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors shrink-0 ${tab === id ? 'border-[#818cf8] text-[#818cf8]' : 'border-transparent text-[#a1a1aa] hover:text-white'}`}>{name}{g && !n.access[g] && <Lock className="w-3 h-3 text-[#fbbf24]" aria-label="Needs a higher plan" data-testid={`number-tab-${id}-lock`} />}</button>
          ))}
        </TabStrip>
      )}
      <div data-testid={`number-tabpanel-${TABS.some(t => t[0] === tab) ? tab : TABS[0][0]}`}>
        {gate && !n.access[gate] ? <Locked feature={label} phone={n.phoneNumber} need={planFor(catalog?.plans, gate)?.name} /> : <Comp num={n} reload={reload} onDeleted={() => nav(cp('/app/numbers'))} />}
      </div>
    </div>
  );
}
