import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useApi } from '../api';
import { cp } from '../paths';
import { PageHeader, SkeletonPage, ErrorNote, Empty, Locked } from '../ui';
import { FaxLines } from './fax/FaxLines';
import { FaxSend } from './fax/FaxSend';
import { FaxHistory } from './fax/FaxHistory';
import { FaxBatches } from './fax/FaxBatches';

const LIVE = ['queued', 'media.processed', 'sending.started'];

export default function Fax() {
  const { data, error, loading, reload } = useApi('/fax');
  // Refresh while anything is still sending, so statuses move to Delivered / Failed on their own.
  const live = !!data && (data.faxes?.some(f => LIVE.includes(f.status)) || data.batches?.some(b => b.status === 'running'));
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [live, reload]);
  const head = <PageHeader label="Numbers" title="Fax" sub="Send and receive faxes on your Business plan numbers. 50 free pages a month per number (sent + received), then $2 a page from your wallet." testid="fax-header" />;
  if (loading && !data) return <div data-testid="fax-page">{head}<SkeletonPage header={false} cards={2} rows={3} /></div>;
  if (error && !data) return <div data-testid="fax-page">{head}<ErrorNote error={error} onRetry={reload} /></div>;
  const nums = data?.numbers || [];
  const ready = nums.filter(n => n.eligible);
  return (
    <div data-testid="fax-page">
      {head}
      {!nums.length && (
        <Empty icon={Printer} title="No numbers yet" sub="Buy a number on the Business plan to send and receive faxes." testid="fax-empty">
          <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="fax-buy-link">Buy a number</Link>
        </Empty>
      )}
      {nums.length > 0 && !ready.length && <Locked feature="Fax" need="Business" phone={nums[0].phoneNumber} />}
      {ready.length > 0 && (
        <div className="grid lg:grid-cols-5 gap-4 mb-4">
          <div className="lg:col-span-3"><FaxSend numbers={ready} onSent={reload} bulkMax={data?.pricing?.bulkMax} /></div>
          <div className="lg:col-span-2"><FaxLines numbers={ready} reload={reload} /></div>
        </div>
      )}
      <FaxBatches batches={data?.batches || []} reload={reload} />
      {(ready.length > 0 || data?.faxes?.length > 0) && <FaxHistory faxes={data?.faxes || []} reload={reload} />}
    </div>
  );
}
