import React from 'react';
import { Link } from 'react-router-dom';
import { Wallet, Hash, Clock, MessageSquare, Megaphone, Bell, ShieldCheck, ArrowRight, ShoppingCart, PhoneOutgoing, Workflow } from 'lucide-react';
import { useApi, money } from '../api';
import { useShell } from '../Shell';
import { useCivrAuth } from '../AuthContext';
import { PageHeader, Spinner } from '../ui';
import { LogTable } from '../LogTable';
import { cp } from '../paths';
import { GetStarted, YourNumbers } from './dashboard/Widgets';
import { CouponBanner, ChannelCard } from './dashboard/Banners';

function Stat({ icon: Icon, label, value, to, testid, accent = '#34d399', delay }) {
  const body = (
    <div className={`civr-card ${to ? 'civr-card-link' : ''} p-6 h-full civr-rise ${delay}`} data-testid={testid}>
      <div className="flex items-start justify-between gap-2"><span className="civr-label !text-[#a1a1aa] !tracking-[.12em] whitespace-nowrap truncate">{label}</span><Icon className="w-4 h-4 shrink-0" style={{ color: accent }} /></div>
      <div className="font-mono text-3xl mt-4" data-testid={`${testid}-value`}>{value}</div>
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

function Stats({ s }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
      <div className="col-span-2"><Stat icon={Wallet} label="Wallet" value={money(s.balance)} to={cp('/app/wallet')} testid="stat-balance" delay="civr-d1" /></div>
      <Stat icon={Hash} label="Numbers" value={s.numbers?.active ?? '—'} to={cp('/app/numbers')} testid="stat-numbers" accent="#38bdf8" delay="civr-d1" />
      <Stat icon={Clock} label="Minutes" value={s.minutesUsed ?? '—'} testid="stat-minutes" accent="#a78bfa" delay="civr-d2" />
      <Stat icon={MessageSquare} label="SMS" value={s.smsUsed ?? '—'} testid="stat-sms" accent="#22d3ee" delay="civr-d2" />
      <Stat icon={Megaphone} label="Campaigns" value={s.activeCampaigns ?? '—'} to={cp('/app/campaigns')} testid="stat-campaigns" accent="#fbbf24" delay="civr-d3" />
    </div>
  );
}

function QuickActions({ unread }) {
  const items = [[cp('/app/numbers'), Workflow, 'Set up a keypad menu', 'Open a number → Keypad menu tab', 'quick-action-ivr'],
    [cp('/app/quick-call'), PhoneOutgoing, 'Place a Quick IVR call', 'Play a message, transfer on key press', 'quick-action-quick-call'],
    [cp('/app/inbox'), Bell, `Inbox${unread ? ` · ${unread} new` : ''}`, 'SMS, voicemail and call alerts', 'quick-action-inbox']];
  return (
    <div className="grid lg:grid-cols-3 gap-4 mt-6">
      {items.map(([to, Icon, t, sub, id]) => (
        <Link key={id} to={to} className="civr-card civr-card-link p-6 flex items-center gap-4" data-testid={id}>
          <Icon className="w-5 h-5 text-[#34d399]" /><div className="flex-1"><div className="font-semibold">{t}</div><div className="text-xs text-[#a1a1aa]">{sub}</div></div><ArrowRight className="w-4 h-4 text-[#a1a1aa]" />
        </Link>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { summary: s } = useShell();
  const { account } = useCivrAuth();
  const fresh = !!s && !s.numbers?.total;
  const { data: act } = useApi(s && !fresh ? '/activity?limit=12' : null);
  const { data: nums } = useApi(s && !fresh ? '/numbers' : null);
  return (
    <div data-testid="dashboard-page">
      <PageHeader label="Overview" title={`Hi ${account?.name?.split(' ')[0] || 'there'}`} sub={fresh ? 'Three quick steps and your number is live.' : 'Your numbers, wallet and live activity at a glance.'} testid="dashboard-header">
        {s && !fresh && <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="dashboard-buy-number-button"><ShoppingCart className="w-4 h-4" />Buy a number</Link>}
      </PageHeader>
      <ChannelCard />
      <CouponBanner />
      {s?.pendingVerification > 0 && (
        <Link to={cp('/app/verification')} className="civr-card civr-trace p-6 mb-6 flex items-center gap-4" data-testid="dashboard-verification-alert">
          <ShieldCheck className="w-6 h-6 text-[#fbbf24]" />
          <div className="flex-1"><div className="font-semibold">Finish your number verification</div><div className="text-sm text-[#a1a1aa]">Your payment is held until the carrier gets your details.</div></div>
          <ArrowRight className="w-4 h-4" />
        </Link>
      )}
      {!s ? <Spinner /> : fresh ? <GetStarted balance={s.balance} /> : (
        <>
          <Stats s={s} />
          <YourNumbers nums={nums?.numbers} balance={s.balance} />
          <QuickActions unread={s.unread} />
          <div className="civr-card p-6 mt-6">
            <div className="font-display text-2xl font-bold mb-4">Recent activity</div>
            <LogTable logs={act?.logs} showNumber testid="dashboard-activity" />
          </div>
        </>
      )}
    </div>
  );
}
