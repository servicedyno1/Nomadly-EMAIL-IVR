import React, { useState } from 'react';
import { FlagSelect } from '../../Pickers';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Printer, Search, Loader2, Check } from 'lucide-react';
import { api, money, useApi } from '../../api';
import { cp } from '../../paths';
import { Field, ErrorNote } from '../../ui';
import { WalletPay } from '../../WalletPay';
import { PaperworkNote } from './Paperwork';

function FaxResults({ numbers, pick, setPick }) {
  if (!numbers.length) return <div className="text-sm text-[#a1a1aa] mt-4" data-testid="fax-buy-no-results">No fax numbers for that search. Try another area code.</div>;
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4" data-testid="fax-buy-results">
      {numbers.map((n, i) => (
        <button key={n.phoneNumber} type="button" onClick={() => setPick(n)} data-testid={`fax-buy-result-${i}`} className={`civr-card text-left p-4 ${pick?.phoneNumber === n.phoneNumber ? 'civr-trace' : ''}`}>
          <div className="flex items-center justify-between"><span className="font-mono text-lg">{n.phoneNumber}</span>{pick?.phoneNumber === n.phoneNumber && <Check className="w-4 h-4 text-[#818cf8]" />}</div>
          <div className="text-xs text-[#a1a1aa] mt-1 break-words">{n.region || 'Any region'}</div>
          <div className="flex gap-2 mt-3"><span className="civr-pill">Fax only</span>{n.assigned && <span className="civr-pill" data-testid={`fax-buy-assigned-${i}`}>Exact number assigned when you buy</span>}</div>
        </button>
      ))}
    </div>
  );
}

// Fax purpose: search fax-only numbers (15 countries) and pay monthly from the wallet.
export function FaxNumberBuy({ balance, onBought }) {
  const { data: offer } = useApi('/fax-numbers');
  const nav = useNavigate();
  const [q, setQ] = useState({ country: 'US', type: 'local', areaCode: '' });
  const [res, setRes] = useState(null);
  const [pick, setPick] = useState(() => {
    try { const p = JSON.parse(sessionStorage.getItem('civr.faxPick') || 'null'); return p && Date.now() - p.at < 2 * 3600000 ? p : null; } catch (_) { return null; }
  });
  const [autoRenew, setAutoRenew] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  if (offer && !offer.available) return <div className="civr-card p-5 mb-6 text-sm text-[#a1a1aa]" data-testid="fax-buy-unavailable">Fax numbers are not available right now. Please check back soon.</div>;
  const price = offer?.price || 0;
  const country = offer?.countries?.find(c => c.code === q.country);
  const types = country?.types || [];
  const t = types.find(x => x.type === q.type) || types[0];
  const paperwork = t?.paperwork === 'name_address' ? { level: 1, businessOnly: t.businessOnly, address: t.address } : null;
  const search = async (e) => {
    e.preventDefault(); setBusy('search'); setError(null); setPick(null);
    try { setRes(await api(`/fax-numbers/search?country=${q.country}&type=${t?.type || 'local'}${country?.areaCodes && q.areaCode ? `&areaCode=${q.areaCode}` : ''}`)); } catch (err) { setError(err); setRes(null); } finally { setBusy(''); }
  };
  const buy = async () => {
    setBusy('buy'); setError(null);
    try {
      const d = await api('/fax-numbers', { method: 'POST', body: { phoneNumber: pick.phoneNumber, autoRenew } });
      sessionStorage.removeItem('civr.faxPick');
      toast.success(d.number.status === 'pending_registration' ? `${d.number.phoneNumber} is waiting for the carrier’s approval` : `${d.number.phoneNumber} is your fax number`);
      onBought?.(); nav(cp('/app/fax'));
    } catch (err) { setError(err); toast.error(err.message); } finally { setBusy(''); }
  };
  const short = balance != null && balance < price;
  return (
    <div className="civr-card p-6" data-testid="fax-buy-card">
      <p className="text-sm text-[#a1a1aa] flex gap-2" data-testid="fax-buy-price"><Printer className="w-4 h-4 mt-0.5 shrink-0 text-[#818cf8]" />{!offer ? 'Loading fax prices…' : `${offer.countries?.length || 15} countries. Sends and receives faxes only — it can't take calls or texts. ${money(price)}/month, ${offer.freePages} free pages a month, then ${money(offer.pagePrice)} a page.`}</p>
      <form onSubmit={search} className="grid sm:grid-cols-3 gap-4 items-end mt-4" data-testid="fax-buy-search-form">
        <Field label="Country">
          <FlagSelect code={q.country}><select className="civr-input w-full" value={q.country} onChange={e => { setQ({ country: e.target.value, type: 'local', areaCode: '' }); setRes(null); setPick(null); }} data-testid="fax-buy-country-select">
            {(offer?.countries || []).map(c => <option key={c.code} value={c.code}>{c.name}{c.types.some(x => x.paperwork !== 'none') ? ' · name + address' : ''}</option>)}
          </select></FlagSelect>
        </Field>
        {types.length > 1 ? (
          <Field label="Number type">
            <select className="civr-input w-full" value={t?.type} onChange={e => { setQ({ ...q, type: e.target.value }); setRes(null); setPick(null); }} data-testid="fax-buy-type-select">
              {types.map(x => <option key={x.type} value={x.type}>{x.label}{x.paperwork !== 'none' ? ' · name + address' : ''}</option>)}
            </select>
          </Field>
        ) : country?.areaCodes ? (
          <Field label="Area code (optional)">
            <input className="civr-input font-mono" maxLength={3} value={q.areaCode} onChange={e => setQ({ ...q, areaCode: e.target.value.replace(/\D/g, '') })} placeholder="Any (e.g. 212)" data-testid="fax-buy-area-code-input" />
          </Field>
        ) : <div />}
        <button className="civr-btn civr-btn-primary" disabled={busy === 'search'} data-testid="fax-buy-search-button">{busy === 'search' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Search fax numbers</button>
      </form>
      {paperwork && <div className="mt-4"><PaperworkNote paperwork={paperwork} country={q.country} countryName={country.name} /><p className="text-xs text-[var(--c-muted)]" data-testid="fax-buy-approval-note">You pay now. The carrier approves the number within a few days, and your month starts once it’s live. If the carrier says no, the number is released and you get a full refund. <Link to={cp('/app/settings')} className="text-[#818cf8] underline underline-offset-2" data-testid="fax-buy-legal-link">Edit legal details</Link></p></div>}
      <div className="mt-4"><ErrorNote error={error} testid="fax-buy-error" /></div>
      {res?.nearbyOnly && <div className="text-sm text-[#a1a1aa] mt-4" data-testid="fax-buy-nearby-note">{`No fax numbers in area code ${res.areaCode} right now — these are nearby numbers.`}</div>}
      {pick && !res && <div className="civr-card p-4 mt-4 text-sm flex items-center gap-2" data-testid="fax-buy-picked-note"><Check className="w-4 h-4 text-[#818cf8]" />{`${pick.phoneNumber} from your search is selected.`}</div>}
      {res && <FaxResults numbers={res.numbers} pick={pick} setPick={setPick} />}
      {pick && (
        <div className="mt-5 flex flex-wrap items-center gap-4 civr-rise" data-testid="fax-buy-checkout">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoRenew} onChange={e => setAutoRenew(e.target.checked)} data-testid="fax-buy-autorenew" />Renew monthly from my wallet</label>
          <div className="flex-1" />
          <div className="basis-full"><WalletPay price={price} onWallet={buy} busy={busy === 'buy'} testid="fax-buy-paybox" walletTestid="fax-buy-pay" /></div>
        </div>
      )}
    </div>
  );
}
