import React, { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Smartphone, MessageSquare } from 'lucide-react';
import { useApi, money } from '../../api';
import { Spinner, ErrorNote, statusPill } from '../../ui';
import { Crumbs } from '../../SectionTabs';
import { CapBadges } from '../../kinds';
import { cp } from '../../paths';
import { renewText } from './RenewPick';
import { LineAutoRenew } from './LineAutoRenew';
import { Line } from '../Esim';
import { MobileLine } from '../number/MobileLines';

// Own page for a USA eSIM or Texting Number, laid out like a regular number's page.
export default function LineDetail() {
  const { id } = useParams();
  const es = useApi('/esim');
  const mob = useApi('/mobile-numbers');
  const esim = es.data?.items?.find(x => x.id === id);
  const item = esim || mob.data?.items?.find(x => x.id === id);
  const reload = esim ? es.reload : mob.reload;
  const waiting = item?.status === 'provisioning' || item?.numberChange?.status === 'pending';
  useEffect(() => { if (!waiting) return undefined; const t = setInterval(reload, 5000); return () => clearInterval(t); }, [waiting, reload]);
  if (es.error && mob.error) return <ErrorNote error={es.error} onRetry={es.reload} />;
  if (!es.data || !mob.data) return <Spinner />;
  if (!item) return <div className="civr-card p-6 text-sm" data-testid="esim-detail-missing">This line isn’t on your account any more. <Link to={cp('/app/numbers')} className="underline font-semibold text-[var(--c-accent)]">Back to My numbers</Link></div>;
  const kind = esim ? 'USA · eSIM on your phone' : 'USA · Texting Number';
  return (
    <div className="space-y-6" data-testid="esim-detail-page">
      <Crumbs testid="esim-detail-breadcrumbs" items={[['Phone numbers'], ['My numbers', cp('/app/numbers')], [item.phoneNumber || 'New line']]} />
      <div className="flex flex-col md:flex-row md:items-start gap-4 justify-between civr-rise">
        <div>
          <div className="civr-label flex items-center gap-1.5" data-testid="esim-detail-kind">{esim ? <Smartphone className="w-3.5 h-3.5" /> : <MessageSquare className="w-3.5 h-3.5" />}{kind}</div>
          <h1 className="font-mono text-4xl sm:text-5xl mt-2" data-no-translate data-testid="esim-detail-phone">{item.phoneNumber || 'Number coming'}</h1>
          <div className="mt-3"><CapBadges caps={['calls', 'texts']} testid="esim-detail-caps" /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={statusPill(item.status)} data-testid="esim-detail-status">{item.status === 'awaiting_imei' ? 'needs IMEI' : item.status}</span>
          <span className="civr-pill" data-testid="esim-detail-expiry">{renewText(item, money)}</span>
        </div>
      </div>
      <LineAutoRenew item={item} reload={reload} testid="esim-detail-autorenew" className="civr-card p-5" />
      {esim ? <Line item={item} reload={reload} noRenew /> : <MobileLine item={item} reload={reload} noRenew />}
    </div>
  );
}
