import React from 'react';
import { Link } from 'react-router-dom';
import { Wallet, Hash, Clock, MessageSquare, ShieldCheck, ArrowRight, PlusCircle, Radio } from 'lucide-react';
import { useApi, money } from '../api';
import { useShell } from '../Shell';
import { useCivrAuth } from '../AuthContext';
import { PageHeader, SkeletonPage } from '../ui';
import { cp } from '../paths';
import { GetStarted, YourNumbers } from './dashboard/Widgets';
import { TopBanner, TrialCard, CallerIdUpsellCard } from './dashboard/Banners';
import { ProductGrid } from './dashboard/ProductGrid';
import { FaxCard } from './dashboard/FaxCard';
import { ForYou, ReviewPrompt } from './dashboard/ForYou';
import { PurposeHome } from './dashboard/PurposeHome';
import { TextingHome } from './dashboard/TextingHome';
import { TaskCards, SetupChecklist } from './dashboard/GuidedHome';

function Stat({ icon: Icon, label, value, to, testid, delay, title }) {
  const body = (
    <div className={`civr-card ${to ? 'civr-card-link' : ''} p-6 h-full civr-rise ${delay}`} data-testid={testid} title={title}>
      <div className="flex items-start justify-between gap-2"><span className="civr-label !text-[var(--c-muted)] !tracking-[.12em] leading-snug min-w-0 break-words">{label}</span><Icon className="w-4 h-4 shrink-0 text-[var(--c-accent)]" /></div>
      <div className="font-mono text-3xl mt-4" data-testid={`${testid}-value`}>{value}</div>
      {title && <div className="text-xs text-[var(--c-muted)] mt-1">This month</div>}
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

function Stats({ s }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-4" data-testid="home-overview">
      <div className="col-span-2"><Stat icon={Wallet} label="Wallet" value={money(s.balance)} to={cp('/app/wallet')} testid="stat-balance" delay="civr-d1" /></div>
      <Stat icon={Hash} label="Active numbers" value={s.numbers?.active ?? '—'} to={cp('/app/numbers')} testid="stat-numbers" delay="civr-d1" />
      <Stat icon={Radio} label="Calling now" value={s.liveCampaigns ?? 0} to={cp('/app/live')} testid="stat-live" delay="civr-d2" />
      <Stat icon={MessageSquare} label="Unread messages" value={s.messagesUnread ?? 0} to={cp('/app/messages')} testid="stat-unread" delay="civr-d2" />
      <Stat icon={Clock} label="Minutes" title="Minutes used this month" value={s.minutesUsed ?? '—'} testid="stat-minutes" delay="civr-d3" />
    </div>
  );
}

function Guided({ nums }) {
  return (
    <div className="grid lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-8"><TaskCards nums={nums} /></div>
      <div className="lg:col-span-4 lg:mt-11"><SetupChecklist nums={nums} /></div>
    </div>
  );
}

export default function Dashboard() {
  const { summary: s } = useShell();
  const { account } = useCivrAuth();
  // Texting-only accounts (Landline to Texting, no calling/mobile number) keep the texting home.
  const fresh = !!s && !((s.numbers?.total || 0) - (s.numbers?.texting || 0));
  const { data: nums } = useApi(s && !fresh ? '/numbers' : null);
  const { data: hosted } = useApi(fresh ? '/hosted-sms' : null);
  const textingOnly = fresh && hosted?.items?.some(x => !['rejected', 'cancelled'].includes(x.status));
  // One promo at a time (first that applies wins) + one announcement; everything else is a slim strip lower down.
  const promos = !textingOnly && (
    <>
      <div className="civr-promo-slot" data-testid="dashboard-promo-slot"><TrialCard /><TopBanner /><CallerIdUpsellCard /></div>
      <FaxCard numbers={nums?.numbers} />
    </>
  );
  return (
    <div data-testid="dashboard-page">
      <PageHeader label="Home" title={`Hi ${account?.name?.split(' ')[0] || 'there'}`} sub={textingOnly ? 'Your texting numbers and the latest texts from your customers.' : 'Your numbers, calls and wallet at a glance, and every product you can add.'} testid="dashboard-header">
        {s && !fresh && <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="dashboard-buy-number-button"><PlusCircle className="w-4 h-4" />Get a number</Link>}
        {textingOnly && <Link to={cp('/app/texting?add=1')} className="civr-btn civr-btn-primary" data-testid="dashboard-add-texting-button">Add a number</Link>}
      </PageHeader>
      {s?.pendingVerification > 0 && (
        <Link to={cp('/app/verification')} className="civr-card civr-trace p-6 mb-6 flex items-center gap-4" data-testid="dashboard-verification-alert">
          <ShieldCheck className="w-6 h-6 text-[#fbbf24]" />
          <div className="flex-1"><div className="font-semibold">Finish your number verification</div><div className="text-sm text-[#a1a1aa]">Your payment is held until the carrier gets your details.</div></div>
          <ArrowRight className="w-4 h-4" />
        </Link>
      )}
      {!s || (fresh && !hosted) ? <SkeletonPage header={false} cards={3} rows={3} /> : textingOnly ? <TextingHome items={hosted.items} balance={s.balance} /> : fresh ? <><PurposeHome />{promos}<Guided nums={[]} /><ProductGrid /><div className="mt-8"><GetStarted balance={s.balance} /></div></> : (
        <>
          <Stats s={s} />
          <div className="mt-8"><PurposeHome /></div>
          <Guided nums={nums?.numbers} />
          <div className="mt-6"><ForYou /></div>
          {promos}
          <YourNumbers nums={nums?.numbers} balance={s.balance} />
          <ProductGrid />
          <ReviewPrompt />
        </>
      )}
    </div>
  );
}
