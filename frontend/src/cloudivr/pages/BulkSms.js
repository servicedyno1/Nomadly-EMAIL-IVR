import React, { useState } from 'react';
import { MessageSquareText, Wallet, Moon, AlertTriangle } from 'lucide-react';
import { useApi, money } from '../api';
import { PageHeader, ErrorNote, Spinner, TabStrip } from '../ui';
import { ReviewCards } from './bulksms/ReviewCards';
import { Wizard } from './bulksms/Wizard';
import { CampaignList } from './bulksms/CampaignList';
import { SingleText } from './bulksms/SingleText';
import { Inbox } from './bulksms/Inbox';

const TABS = [['campaigns', 'Campaigns'], ['new', 'New campaign'], ['single', 'Single text'], ['inbox', 'Replies']];

// Bulk SMS (USA/Canada) on the shared mobile-number pool — same engine, rules and prices as the bots.
export default function BulkSms() {
  const { data, error, loading, reload } = useApi('/bulksms');
  const [tab, setTab] = useState(null);
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  const active = tab || (data?.campaigns?.length ? 'campaigns' : 'new');
  const p = data.prices, quiet = data.window && !data.window.open, down = !!data.ready?.paused || data.ready?.send === false;
  return (
    <div className="civr-rise" data-testid="bulksms-page">
      <PageHeader title="Bulk SMS" sub={`Text up to ${p.maxVolume.toLocaleString()} USA & Canada mobiles from real mobile numbers — ${money(p.plain)} a text, ${p.discountPct}% off when booked ${p.discountHours} h ahead.`} testid="bulksms-header">
        <span className="civr-pill" data-testid="bulksms-balance"><Wallet className="w-3.5 h-3.5" />{money(data.balance)}</span>
      </PageHeader>
      {down && <Note icon={AlertTriangle} testid="bulksms-pool-down">Sending is paused for a moment — you can still prepare and schedule a campaign.</Note>}
      {quiet && <Note icon={Moon} testid="bulksms-quiet">Quiet hours: texts go out {String(p.quietEnd).padStart(2, '0')}:00–{String(p.quietStart).padStart(2, '0')}:00 recipient time. "Send now" starts at the next open hour.</Note>}
      <ReviewCards reviews={data.reviews} onDone={reload} />
      <TabStrip active={active} className="mb-6" testid="bulksms-tabs">
        {TABS.map(([id, name]) => <button key={id} role="tab" aria-selected={active === id} onClick={() => setTab(id)} data-testid={`bulksms-tab-${id}`} className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors shrink-0 ${active === id ? 'border-[#818cf8] text-[#818cf8]' : 'border-transparent text-[#a1a1aa] hover:text-white'}`}>{name}</button>)}
      </TabStrip>
      {active === 'campaigns' && <CampaignList campaigns={data.campaigns} onNew={() => setTab('new')} onChange={reload} />}
      {active === 'new' && <Wizard data={data} onDone={() => { reload(); setTab('campaigns'); }} />}
      {active === 'single' && <SingleText data={data} onSent={reload} hasReview={!!data.reviews?.length} />}
      {active === 'inbox' && <Inbox />}
      <p className="text-xs text-[var(--c-muted)] mt-10 flex items-center gap-2"><MessageSquareText className="w-3.5 h-3.5" />Every number must have agreed to get your texts. Scam, phishing or prize messages are blocked automatically.</p>
    </div>
  );
}

export const Note = ({ icon: Icon, children, testid }) => (
  <div className="civr-card p-4 mb-4 flex items-start gap-3 text-sm" data-testid={testid}><Icon className="w-4 h-4 mt-0.5 text-[#fbbf24] shrink-0" /><div>{children}</div></div>
);
