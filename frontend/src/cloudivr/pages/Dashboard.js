import React from 'react';
import { Link } from 'react-router-dom';
import { Wallet, Hash, Clock, MessageSquare, Megaphone, Bell, ShieldCheck, ArrowRight, ShoppingCart, PhoneOutgoing, Workflow } from 'lucide-react';
import { useApi, money } from '../api';
import { useShell } from '../Shell';
import { useCivrAuth } from '../AuthContext';
import { PageHeader } from '../ui';
import { LogTable } from '../LogTable';

function Stat({ icon: Icon, label, value, to, testid, accent = '#34d399', delay }) {
  const body = (
    <div className={`civr-card ${to ? 'civr-card-link' : ''} p-5 h-full civr-rise ${delay}`} data-testid={testid}>
      <div className="flex items-center justify-between"><span className="civr-label !text-[#777]">{label}</span><Icon className="w-4 h-4" style={{ color: accent }} /></div>
      <div className="font-mono text-3xl mt-4" data-testid={`${testid}-value`}>{value}</div>
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export default function Dashboard() {
  const { summary } = useShell();
  const { account } = useCivrAuth();
  const { data: act } = useApi('/activity?limit=12');
  const s = summary || {};
  return (
    <div data-testid="dashboard-page">
      <PageHeader label="Overview" title={`Hi ${account?.name?.split(' ')[0] || 'there'}`} sub="Your numbers, wallet and live activity at a glance." testid="dashboard-header">
        <Link to="/cloudivr/app/buy" className="civr-btn civr-btn-primary" data-testid="dashboard-buy-number-button"><ShoppingCart className="w-4 h-4" />Buy a number</Link>
      </PageHeader>
      {s.pendingVerification > 0 && (
        <Link to="/cloudivr/app/verification" className="civr-card civr-trace p-5 mb-6 flex items-center gap-4" data-testid="dashboard-verification-alert">
          <ShieldCheck className="w-6 h-6 text-[#fbbf24]" />
          <div className="flex-1"><div className="font-semibold">Finish your number verification</div><div className="text-sm text-[#888]">Your payment is held until the carrier gets your details.</div></div>
          <ArrowRight className="w-4 h-4" />
        </Link>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="col-span-2"><Stat icon={Wallet} label="Wallet" value={money(s.balance)} to="/cloudivr/app/wallet" testid="stat-balance" delay="civr-d1" /></div>
        <Stat icon={Hash} label="Active numbers" value={s.numbers?.active ?? '—'} to="/cloudivr/app/numbers" testid="stat-numbers" accent="#38bdf8" delay="civr-d1" />
        <Stat icon={Clock} label="Minutes used" value={s.minutesUsed ?? '—'} testid="stat-minutes" accent="#a78bfa" delay="civr-d2" />
        <Stat icon={MessageSquare} label="SMS used" value={s.smsUsed ?? '—'} testid="stat-sms" accent="#22d3ee" delay="civr-d2" />
        <Stat icon={Megaphone} label="Live campaigns" value={s.activeCampaigns ?? '—'} to="/cloudivr/app/campaigns" testid="stat-campaigns" accent="#fbbf24" delay="civr-d3" />
      </div>
      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        {[['/cloudivr/app/numbers', Workflow, 'Set up an IVR menu', 'Open a number → IVR tab', 'quick-action-ivr'],
          ['/cloudivr/app/quick-call', PhoneOutgoing, 'Place a Quick IVR call', 'Play a message, transfer on key press', 'quick-action-quick-call'],
          ['/cloudivr/app/inbox', Bell, `Inbox${s.unread ? ` · ${s.unread} new` : ''}`, 'SMS, voicemail and call alerts', 'quick-action-inbox']].map(([to, Icon, t, sub, id]) => (
          <Link key={id} to={to} className="civr-card civr-card-link p-5 flex items-center gap-4" data-testid={id}>
            <Icon className="w-5 h-5 text-[#34d399]" /><div className="flex-1"><div className="font-semibold">{t}</div><div className="text-xs text-[#777]">{sub}</div></div><ArrowRight className="w-4 h-4 text-[#555]" />
          </Link>
        ))}
      </div>
      <div className="civr-card p-5 mt-6">
        <div className="flex items-center justify-between mb-3"><div className="font-display text-2xl font-bold">Recent activity</div><Link to="/cloudivr/app/numbers" className="text-xs text-[#888] hover:text-[#34d399]" data-testid="dashboard-all-numbers-link">All numbers</Link></div>
        <LogTable logs={act?.logs} showNumber testid="dashboard-activity" />
      </div>
    </div>
  );
}
