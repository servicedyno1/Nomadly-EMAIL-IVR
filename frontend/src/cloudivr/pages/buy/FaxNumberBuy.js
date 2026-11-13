import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Printer, Search, Loader2, Check } from 'lucide-react';
import { api, money, useApi } from '../../api';
import { cp } from '../../paths';
import { Field, ErrorNote } from '../../ui';

function FaxResults({ numbers, pick, setPick }) {
  if (!numbers.length) return <div className="text-sm text-[#a1a1aa] mt-4" data-testid="fax-buy-no-results">No fax numbers for that search. Try another area code.</div>;
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4" data-testid="fax-buy-results">
      {numbers.map((n, i) => (
        <button key={n.phoneNumber} type="button" onClick={() => setPick(n)} data-testid={`fax-buy-result-${i}`} className={`civr-card text-left p-4 ${pick?.phoneNumber === n.phoneNumber ? 'civr-trace' : ''}`}>
          <div className="flex items-center justify-between"><span className="font-mono text-lg">{n.phoneNumber}</span>{pick?.phoneNumber === n.phoneNumber && <Check className="w-4 h-4 text-[#818cf8]" />}</div>
          <div className="text-xs text-[#a1a1aa] mt-1 truncate">{n.region || 'Any region'}</div>
          <div className="flex gap-2 mt-3"><span className="civr-pill">Fax only</span></div>
        </button>
      ))}
    </div>
  );
}

// Fax purpose: search USA/Canada fax-only numbers and pay monthly from the wallet.
export function FaxNumberBuy({ balance, onBought }) {
  const { data: offer } = useApi('/fax-numbers');
  const nav = useNavigate();
  const [q, setQ] = useState({ country: 'US', areaCode: '' });
  const [res, setRes] = useState(null);
  const [pick, setPick] = useState(null);
  const [autoRenew, setAutoRenew] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  if (offer && !offer.available) return <div className="civr-card p-5 mb-6 text-sm text-[#a1a1aa]" data-testid="fax-buy-unavailable">Fax numbers are not available right now. Please check back soon.</div>;
  const price = offer?.price || 0;
  const search = async (e) => {
    e.preventDefault(); setBusy('search'); setError(null); setPick(null);
    try { setRes(await api(`/fax-numbers/search?country=${q.country}${q.areaCode ? `&areaCode=${q.areaCode}` : ''}`)); } catch (err) { setError(err); setRes(null); } finally { setBusy(''); }
  };
  const buy = async () => {
    setBusy('buy'); setError(null);
    try {
      const d = await api('/fax-numbers', { method: 'POST', body: { phoneNumber: pick.phoneNumber, autoRenew } });
      toast.success(`${d.number.phoneNumber} is your fax number`);
      onBought?.(); nav(cp('/app/fax'));
    } catch (err) { setError(err); toast.error(err.message); } finally { setBusy(''); }
  };
  const short = balance != null && balance < price;
  return (
    <div className="civr-card p-6 mb-6" data-testid="fax-buy-card">
      <div className="flex items-center gap-3"><Printer className="w-6 h-6 text-[#818cf8]" /><div className="font-semibold">Fax · Fax-only number</div></div>
      <p className="text-sm text-[#a1a1aa] mt-2" data-testid="fax-buy-price">{`USA or Canada. Sends and receives faxes only — it can't take calls or texts. ${money(price)}/month, ${offer?.freePages ?? 50} free pages a month, then ${money(offer?.pagePrice ?? 2)} a page.`}</p>
      <form onSubmit={search} className="grid sm:grid-cols-3 gap-4 items-end mt-4" data-testid="fax-buy-search-form">
        <Field label="Country">
          <select className="civr-input" value={q.country} onChange={e => setQ({ ...q, country: e.target.value })} data-testid="fax-buy-country-select">
            {(offer?.countries || [{ code: 'US', name: 'United States' }, { code: 'CA', name: 'Canada' }]).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Area code (optional)">
          <input className="civr-input font-mono" maxLength={3} value={q.areaCode} onChange={e => setQ({ ...q, areaCode: e.target.value.replace(/\D/g, '') })} placeholder="Any (e.g. 212)" data-testid="fax-buy-area-code-input" />
        </Field>
        <button className="civr-btn civr-btn-primary" disabled={busy === 'search'} data-testid="fax-buy-search-button">{busy === 'search' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Search fax numbers</button>
      </form>
      <div className="mt-4"><ErrorNote error={error} testid="fax-buy-error" /></div>
      {res && <FaxResults numbers={res.numbers} pick={pick} setPick={setPick} />}
      {pick && (
        <div className="mt-5 flex flex-wrap items-center gap-4 civr-rise" data-testid="fax-buy-checkout">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoRenew} onChange={e => setAutoRenew(e.target.checked)} data-testid="fax-buy-autorenew" />Renew monthly from my wallet</label>
          <div className="flex-1" />
          {short
            ? <Link to={cp(`/app/wallet?need=${(price - balance).toFixed(2)}`)} className="civr-btn civr-btn-primary" data-testid="fax-buy-topup">{`Top up ${money(price - balance)} to buy`}</Link>
            : <button type="button" className="civr-btn civr-btn-primary" disabled={busy === 'buy'} onClick={buy} data-testid="fax-buy-pay">{busy === 'buy' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{`Pay ${money(price)} from wallet`}</button>}
        </div>
      )}
    </div>
  );
}
