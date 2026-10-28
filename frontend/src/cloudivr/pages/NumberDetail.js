import React from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';
import { useApi, enc, day } from '../api';
import { Spinner, ErrorNote, Locked, statusPill, TabStrip } from '../ui';
import { OverviewTab, ForwardingTab, VoicemailTab, SmsTab, RecordingTab } from './number/SettingsTabs';
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

// Tabs grouped (overview · what callers get · messages · account); a thin divider separates each group.
const TABS = [
  ['overview', 'Overview', null, OverviewTab, 0],
  ['forwarding', 'Forwarding', 'callForwarding', ForwardingTab, 1], ['ringgroup', 'Ring group', 'ringGroup', RingGroupTab, 1], ['browser', 'Browser ring', 'browserRing', BrowserRingTab, 1], ['hours', 'Hours', null, HoursTab, 1], ['ivr', 'Keypad menu', 'ivr', IvrTab, 1], ['ai', 'AI voice agent', 'aiAgent', AiAgentTab, 1],
  ['voicemail', 'Voicemail', 'voicemail', VoicemailTab, 1], ['recording', 'Recording', 'callRecording', RecordingTab, 1],
  ['sms', 'SMS', null, SmsTab, 2], ['triggers', 'Text Triggers', 'textTriggers', TextTriggersTab, 2],
  ['sip', 'SIP', 'sipCredentials', SipTab, 3], ['logs', 'Logs', null, LogsTab, 3], ['billing', 'Billing', null, BillingTab, 3],
];

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
  if (error) return <ErrorNote error={error} />;
  const [, label, gate, Comp] = TABS.find(t => t[0] === tab) || TABS[0];
  return (
    <div data-testid="number-detail-page">
      <Link to={cp('/app/numbers')} className="inline-flex items-center gap-2 min-h-[44px] text-sm text-[#a1a1aa] hover:text-[#818cf8] mb-3" data-testid="number-detail-back-link"><ArrowLeft className="w-4 h-4" />All numbers</Link>
      <div className="flex flex-col md:flex-row md:items-start gap-4 justify-between mb-8 civr-rise">
        <div>
          <div className="civr-label">{n.countryName || n.country} · {n.type?.replace('_', '-')} · {n.planName}</div>
          <h1 className="font-mono text-4xl sm:text-5xl mt-2" data-testid="number-detail-phone">{pv.phone(n.phoneNumber)}</h1>
          {n.capabilities?.sms !== false && <div className="mt-3"><ReachChip phone={n.phoneNumber} testid="number-sms-reach" /></div>}
        </div>
        <div className="flex items-center gap-2">
          <span className={statusPill(n.status)} data-testid="number-detail-status">{n.status}</span>
          <span className="civr-pill" data-testid="number-detail-expiry">{n.autoRenew ? 'renews' : 'expires'} {day(n.expiresAt)}</span>
          {n.dryRun && <span className="civr-pill civr-pill-warn">preview</span>}
        </div>
      </div>
      <TabStrip active={tab} testid="number-tabstrip">
        {TABS.map(([id, name, gate, , g], i) => (
          <React.Fragment key={id}>
          {i > 0 && g !== TABS[i - 1][4] && <span aria-hidden="true" className="w-px h-5 self-center bg-[#2a2a2a] mx-1 shrink-0" data-testid={`number-tab-divider-${g}`} />}
          <button role="tab" aria-selected={tab === id} onClick={async () => { if (id !== tab && await confirmLeave()) setParams({ tab: id }, { replace: true }); }} data-testid={`number-tab-${id}`}
            className={`inline-flex items-center gap-1 px-2.5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors shrink-0 ${tab === id ? 'border-[#818cf8] text-[#818cf8]' : 'border-transparent text-[#a1a1aa] hover:text-white'}`}>{name}{gate && !n.access[gate] && <Lock className="w-3 h-3 text-[#fbbf24]" aria-label="Needs a higher plan" data-testid={`number-tab-${id}-lock`} />}</button>
          </React.Fragment>
        ))}
      </TabStrip>
      <div data-testid={`number-tabpanel-${tab}`}>
        {gate && !n.access[gate] ? <Locked feature={label} phone={n.phoneNumber} need={planFor(catalog?.plans, gate)?.name} /> : <Comp num={n} reload={reload} onDeleted={() => nav(cp('/app/numbers'))} />}
      </div>
    </div>
  );
}
