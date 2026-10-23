import React from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useApi, enc, day } from '../api';
import { Spinner, ErrorNote, Locked, statusPill } from '../ui';
import { OverviewTab, ForwardingTab, VoicemailTab, SmsTab, RecordingTab } from './number/SettingsTabs';
import SipTab from './number/SipTab';
import IvrTab from './number/IvrTab';
import LogsTab from './number/LogsTab';
import BillingTab from './number/BillingTab';
import { cp } from '../paths';

const TABS = [
  ['overview', 'Overview', null, OverviewTab], ['forwarding', 'Forwarding', 'callForwarding', ForwardingTab], ['ivr', 'IVR', 'ivr', IvrTab],
  ['voicemail', 'Voicemail', 'voicemail', VoicemailTab], ['sms', 'SMS', null, SmsTab], ['sip', 'SIP', 'sipCredentials', SipTab],
  ['recording', 'Recording', 'callRecording', RecordingTab], ['logs', 'Logs', null, LogsTab], ['billing', 'Billing', null, BillingTab],
];

export default function NumberDetail() {
  const { phone } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi(`/numbers/${enc(phone)}`);
  const tab = params.get('tab') || 'overview';
  const n = data?.number;
  if (loading && !n) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const [, label, gate, Comp] = TABS.find(t => t[0] === tab) || TABS[0];
  return (
    <div data-testid="number-detail-page">
      <Link to={cp('/app/numbers')} className="inline-flex items-center gap-2 text-sm text-[#888] hover:text-[#34d399] mb-6" data-testid="number-detail-back-link"><ArrowLeft className="w-4 h-4" />All numbers</Link>
      <div className="flex flex-col md:flex-row md:items-end gap-4 justify-between mb-8 civr-rise">
        <div>
          <div className="civr-label">{n.countryName || n.country} · {n.type?.replace('_', '-')} · {n.planName}</div>
          <h1 className="font-mono text-4xl sm:text-5xl mt-2" data-testid="number-detail-phone">{n.phoneNumber}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className={statusPill(n.status)} data-testid="number-detail-status">{n.status}</span>
          <span className="civr-pill" data-testid="number-detail-expiry">{n.autoRenew ? 'renews' : 'expires'} {day(n.expiresAt)}</span>
          {n.dryRun && <span className="civr-pill civr-pill-warn">preview</span>}
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-[#1f1f1f] mb-8" role="tablist">
        {TABS.map(([id, name]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setParams({ tab: id }, { replace: true })} data-testid={`number-tab-${id}`}
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors shrink-0 ${tab === id ? 'border-[#34d399] text-[#34d399]' : 'border-transparent text-[#888] hover:text-white'}`}>{name}</button>
        ))}
      </div>
      <div data-testid={`number-tabpanel-${tab}`}>
        {gate && !n.access[gate] ? <Locked feature={label} phone={n.phoneNumber} /> : <Comp num={n} reload={reload} onDeleted={() => nav(cp('/app/numbers'))} />}
      </div>
    </div>
  );
}
