import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, MessageSquare, ShieldCheck, ArrowRight, PlusCircle, Radio } from 'lucide-react';
import { useApi, money } from '../api';
import { useShell } from '../Shell';
import { useCivrAuth } from '../AuthContext';
import { PageHeader, SkeletonPage } from '../ui';
import { cp } from '../paths';
import { GetStarted } from './dashboard/Widgets';
import { PlanHero, mainLines } from './dashboard/PlanHero';
import { Platform } from './dashboard/Platform';
import { Standalone } from './dashboard/Standalone';
import { TopBanner, TrialCard, CallerIdUpsellCard } from './dashboard/Banners';
import { ProductGrid } from './dashboard/ProductGrid';
import { FaxCard } from './dashboard/FaxCard';
import { ForYou, ReviewPrompt } from './dashboard/ForYou';
import { PurposeHome } from './dashboard/PurposeHome';
import { TextingHome } from './dashboard/TextingHome';
import { TaskCards, SetupChecklist } from './dashboard/GuidedHome';

function Chip({ icon: Icon, label, value, to, testid, live }) {
  return (
    <Link to={to} className="flex items-center gap-2 rounded-full border border-[var(--c-border)] px-4 py-2 text-sm hover:border-[var(--c-accent)] transition-colors" data-testid={testid}>
      <Icon className={`w-4 h-4 ${live ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--c-accent)]'}`} /><span className="text-[var(--c-muted)]">{label}</span><span className="font-mono font-semibold" data-testid={`${testid}-value`}>{value}</span>
    </Link>
  );
}

function TopStrip({ s }) {
  return (
    <div className="flex flex-wrap gap-2 mb-6 civr-rise" data-testid="dashboard-top-strip">
      <Chip icon={Wallet} label="Wallet" value={money(s.balance)} to={cp('/app/wallet')} testid="top-strip-wallet-balance" />
      <Chip icon={MessageSquare} label="Unread" value={s.messagesUnread ?? 0} to={cp('/app/messages')} testid="top-strip-unread-messages" />
      <Chip icon={Radio} label="Calling now" value={s.liveCampaigns ?? 0} to={cp('/app/live')} testid="top-strip-calling-status" live={s.liveCampaigns > 0} />
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
  const { data: catalog } = useApi(s && !fresh ? '/catalog' : null);
  const [line, setLine] = useState(null);
  const plan = mainLines(nums?.numbers).find(x => x.phoneNumber === line) || mainLines(nums?.numbers)[0];
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
      <PageHeader label="Home" title={`Hi ${account?.name?.split(' ')[0] || 'there'}`} sub={textingOnly ? 'Your texting numbers and the latest texts from your customers.' : 'Your plan, what it includes, and the services you added.'} testid="dashboard-header">
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
          <TopStrip s={s} />
          {!nums ? <SkeletonPage header={false} cards={1} rows={3} /> : <PlanHero nums={nums.numbers} catalog={catalog} line={plan?.phoneNumber} setLine={setLine} />}
          <Platform line={plan} catalog={catalog} />
          <Standalone summary={s} />
          <div className="mt-10"><ForYou /></div>
          {promos}
          <ReviewPrompt />
        </>
      )}
    </div>
  );
}
