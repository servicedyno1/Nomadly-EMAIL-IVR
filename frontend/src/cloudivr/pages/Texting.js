import React, { useState } from 'react';
import { MessageSquareText, Plus, Landmark } from 'lucide-react';
import { useApi } from '../api';
import { PageHeader, Spinner, ErrorNote, Empty } from '../ui';
import { NewSetup } from './texting/NewSetup';
import { NumberPanel, STATUS } from './texting/NumberPanel';

// Landline to Texting (hosted SMS): text from a number the customer already owns; calls stay with their carrier.
export default function Texting() {
  const { data, error, loading, reload } = useApi('/hosted-sms');
  const [sel, setSel] = useState(null);
  const [adding, setAdding] = useState(false);
  if (loading && !data) return <Spinner />;
  const items = (data?.items || []).filter(x => x.status !== 'cancelled');
  const current = items.find(x => x.id === sel) || (!adding && items[0]) || null;
  const done = (item) => { setAdding(false); setSel(item?.id || null); reload(); };
  return (
    <div data-testid="texting-page">
      <PageHeader label="Landline to Texting" title="Text from your own number" sub="Keep your office or landline number and its calls with your carrier — send and receive texts from it here. US & Canada numbers." testid="texting-header">
        <button type="button" onClick={() => { setAdding(true); setSel(null); }} className="civr-btn civr-btn-primary" data-testid="texting-add-button"><Plus className="w-4 h-4" />Text-enable a number</button>
      </PageHeader>
      <ErrorNote error={error} onRetry={reload} className="mb-6" />
      {data && <Prices data={data} />}
      {adding && <NewSetup data={data} onDone={done} onCancel={() => setAdding(false)} />}
      {!adding && !items.length && <Empty icon={Landmark} title="No text-enabled numbers yet" sub="Bring the number your customers already know. We check it in seconds." testid="texting-empty"><button type="button" onClick={() => setAdding(true)} className="civr-btn civr-btn-primary" data-testid="texting-empty-add">Text-enable a number</button></Empty>}
      {!adding && items.length > 0 && (
        <div className="grid lg:grid-cols-[280px_1fr] gap-6">
          <div className="space-y-2" data-testid="texting-list">{items.map(x => <ListItem key={x.id} x={x} on={current?.id === x.id} onClick={() => setSel(x.id)} />)}</div>
          {current && <NumberPanel key={current.id} item={current} meta={data} onChange={reload} />}
        </div>
      )}
    </div>
  );
}

function Prices({ data }) {
  const cells = [[`$${data.prices.code}`, 'setup with ownership code'], [`$${data.prices.nocode}`, 'setup without code'], [`$${data.monthly}/mo`, 'after activation'], [`$${data.textPrice.toFixed(2)}`, 'per text in the US & Canada · received texts too · other countries priced per country']];
  return (
    <div className="civr-card p-5 mb-6 grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="texting-prices">
      {cells.map(([v, l]) => <div key={l}><div className="font-display text-2xl font-bold">{v}</div><div className="text-xs text-[#a1a1aa] mt-1">{l}</div></div>)}
      <p className="col-span-2 md:col-span-4 text-xs text-[#a1a1aa] flex items-center gap-2"><MessageSquareText className="w-4 h-4 text-[#818cf8]" />Full refund to your wallet if the number isn’t approved.</p>
    </div>
  );
}

function ListItem({ x, on, onClick }) {
  const s = STATUS[x.status] || { label: x.status, tone: '' };
  return (
    <button type="button" onClick={onClick} className={`civr-card w-full text-left p-4 ${on ? 'ring-1 ring-[#818cf8]/60' : ''}`} data-testid={`texting-item-${x.phoneNumber.replace('+', '')}`}>
      <div className="font-mono text-sm" data-no-translate>{x.phoneNumber}</div>
      <div className={`text-xs mt-1 ${s.tone}`}>{s.label}</div>
    </button>
  );
}
