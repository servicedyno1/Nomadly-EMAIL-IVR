import React from 'react';
import { Link } from 'react-router-dom';
import { Wallet, Hash, Clock, MessageSquare, ShieldCheck, ArrowRight, PlusCircle, Radio, ChevronDown } from 'lucide-react';
import { useApi, money } from '../api';
import { useShell } from '../Shell';
import { useCivrAuth } from '../AuthContext';
import { PageHeader, SkeletonPage } from '../ui';
import { cp } from '../paths';
import { GetStarted, YourNumbers } from './dashboard/Widgets';
import { TopBanner, TrialCard, CallerIdUpsellCard } from './dashboard/Banners';
import { ProductGrid } from './dashboard/ProductGrid';
import { ForYou, ReviewPrompt } from './dashboard/ForYou';
import { PurposeHome } from './dashboard/PurposeHome';
import { TextingHome } from './dashboard/TextingHome';
import { TaskCards, SetupChecklist } from './dashboard/GuidedHome';
import { NextStep } from './dashboard/NextStep';

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
  const live = (s.liveCampaigns || 0) > 0;
  return (
    <div className={`grid grid-cols-2 ${live ? 'lg:grid-cols-6' : 'lg:grid-cols-5'} gap-4`} data-testid="home-overview">
      <div className="col-span-2"><Stat icon={Wallet} label="Wallet" value={money(s.balance)} to={cp('/app/wallet')} testid="stat-balance" delay="civr-d1" /></div>
      <Stat icon={Hash} label="Numbers" value={s.numbers?.active ?? '—'} to={cp('/app/numbers')} testid="stat-numbers" delay="civr-d1" />
      {live && <Stat icon={Radio} label="Calling now" value={s.liveCampaigns} to={cp('/app/live')} testid="stat-live" delay="civr-d2" />}
      <Stat icon={MessageSquare} label="Unread" value={s.messagesUnread ?? 0} to={cp('/app/messages')} testid="stat-unread" delay="civr-d2" />
      <Stat icon={Clock} label="Minutes" title="Minutes used this month" value={s.minutesUsed ?? '—'} testid="stat-minutes" delay="civr-d3" />
    </div>
  );
}

// Secondary content stays one tap away instead of filling the home screen.
function More({ children }) {
  return (
    <details className="civr-more mt-10" data-testid="dashboard-more">
      <summary className="flex items-center justify-between gap-3 py-3 border-t border-[var(--c-border)]" data-testid="dashboard-more-toggle">
        <span><span className="font-semibold">Do more with CloudIVR</span><span className="block text-sm text-[var(--c-muted)]">Step-by-step guides, ideas and every product you can add</span></span>
        <ChevronDown className="civr-more-chevron w-5 h-5 text-[var(--c-muted)] transition-transform" />
      </summary>
      <div className="pt-4 space-y-6">{children}</div>
    </details>
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
      <div className="civr-promo-slot mt-6" data-testid="dashboard-promo-slot">{!fresh && <TrialCard />}<TopBanner /><CallerIdUpsellCard /></div>
    </>
  );
  return (
    <div data-testid="dashboard-page">
      <PageHeader label="Home" title={`Hi ${account?.name?.split(' ')[0] || 'there'}`} sub={textingOnly ? 'Your texting numbers and the latest texts from your customers.' : fresh ? 'Pick what you need and we’ll set it up with you.' : 'Your numbers, calls and wallet at a glance.'} testid="dashboard-header">
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
      {!s || (fresh && !hosted) ? <SkeletonPage header={false} cards={3} rows={3} /> : textingOnly ? <TextingHome items={hosted.items} balance={s.balance} /> : fresh ? <><TrialCard /><PurposeHome /><div className="mt-8"><GetStarted balance={s.balance} /></div>{promos}<Guided nums={[]} /><More><ProductGrid /></More></> : (
        <>
          <Stats s={s} />
          <NextStep s={s} nums={nums?.numbers} />
          {promos}
          <YourNumbers nums={nums?.numbers} balance={s.balance} />
          <div className="mt-6 max-w-xl"><SetupChecklist nums={nums?.numbers} /></div>
          <More>
            <TaskCards nums={nums?.numbers} />
            <ForYou />
            <ProductGrid />
            <ReviewPrompt />
          </More>
        </>
      )}
    </div>
  );
}
