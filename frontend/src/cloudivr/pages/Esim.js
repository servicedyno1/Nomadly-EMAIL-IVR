import React, { useEffect, useState } from 'react';
import { Loader2, Smartphone, QrCode, Globe2, MessageSquare, Phone, Send, CheckCircle2, Circle } from 'lucide-react';
import { toast } from 'sonner';
import QRCode from 'react-qr-code';
import { api, useApi, when } from '../api';
import { PageHeader, Field, ErrorNote, Spinner, Empty } from '../ui';
import { useShell } from '../Shell';
import { ask } from '../confirm';

const STATUS = { provisioning: ['Creating your eSIM…', 'text-[#fbbf24]'], active: ['Active', 'text-[#34d399]'], suspended: ['Paused · monthly fee due', 'text-[#fbbf24]'], failed: ['Couldn’t be created · refunded', 'text-[#fb7185]'] };

function PlanCard({ p, onBuy }) {
  return (
    <div className="civr-card p-5 flex flex-col" data-testid={`esim-plan-${p.planId.replace(/\W/g, '')}`}>
      <div className="font-semibold">{p.label || p.planId}</div>
      <div className="font-display text-3xl font-bold mt-2">{`$${p.price}`} <span className="text-sm font-normal text-[#a1a1aa]">{`/ ${p.validityDays} days`}</span></div>
      <ul className="text-sm text-[#d4d4d8] mt-3 space-y-1 flex-1">
        {p.data && <li>{`${p.data} data`}</li>}{p.voiceMinutes != null && <li>{`${p.voiceMinutes} minutes of calls`}</li>}{p.sms != null && <li>{p.sms === 'Unlimited' ? 'Unlimited texts' : `${p.sms} texts`}</li>}
        <li className="text-[#a1a1aa]">{`${p.carrier} · renews monthly from your wallet`}</li>
      </ul>
      <button type="button" onClick={() => onBuy(p)} className="civr-btn civr-btn-primary mt-4" data-testid={`esim-plan-buy-${p.planId.replace(/\W/g, '')}`}>Get this eSIM</button>
    </div>
  );
}

function BuyForm({ plan, onDone, onCancel }) {
  const { refreshSummary } = useShell();
  const [imei, setImei] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = async () => { setBusy(true); setErr(null); try { await api('/esim', { method: 'POST', body: { planId: plan.planId, imei } }); toast.success(`Paid $${plan.price}. Creating your eSIM`); refreshSummary(); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <div className="civr-card p-6 space-y-4" data-testid="esim-buy">
      <div className="font-semibold">{plan.label || plan.planId}</div>
      <Field label="Your phone’s IMEI" hint="Dial *#06# on the phone that will use the eSIM. Use the first IMEI if it shows two."><input className="civr-input font-mono" inputMode="numeric" maxLength={17} value={imei} onChange={e => setImei(e.target.value)} placeholder="15 digits" data-testid="esim-imei-input" /></Field>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={go} disabled={busy || imei.replace(/\D/g, '').length !== 15} className="civr-btn civr-btn-primary" data-testid="esim-pay-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{`Pay $${plan.price} from wallet`}</button>
        <button type="button" onClick={onCancel} className="civr-btn civr-btn-ghost" data-testid="esim-buy-cancel">Cancel</button>
      </div>
      <ErrorNote error={err} testid="esim-buy-error" />
    </div>
  );
}

function QrBlock({ id }) {
  const { data, error } = useApi(`/esim/${id}/qr`);
  const [broken, setBroken] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  return data.qrCode || data.image ? (
    <div className="flex flex-col sm:flex-row gap-4 items-start" data-testid="esim-qr">
      <div className="bg-white p-3 rounded-xl">{data.image && !broken ? <img src={data.image} alt="eSIM install QR code" onError={() => setBroken(true)} className="w-[168px] h-[168px]" data-testid="esim-qr-image" /> : data.qrCode ? <QRCode value={data.qrCode} size={168} /> : <p className="w-[168px] text-sm text-[#52525b]" data-testid="esim-qr-broken">The QR code didn’t load. Reload the page to try again.</p>}</div>
      <p className="text-sm text-[#d4d4d8]">On your phone open Settings → Mobile data (or Cellular) → Add eSIM → Use QR code, and scan this. Keep this page private: the code installs your line.</p>
    </div>
  ) : <p className="text-sm text-[#a1a1aa]">The QR code isn’t ready yet.</p>;
}

function CallsChoice({ item, onChange }) {
  const set = async (to) => { try { const r = await api(`/esim/${item.id}/calls`, { method: 'POST', body: { to } }); toast.success(r.pending && to === 'browser' ? 'Saved. We’ll switch calls to CloudIVR once routing is connected' : 'Saved'); onChange(); } catch (e) { toast.error(e.message); } };
  const opts = [['device', Smartphone, 'Ring on my phone', 'Calls go to the eSIM on your phone.'], ['browser', Globe2, 'Ring in CloudIVR', 'Calls go to the browser phone and your IVR menus.']];
  return (
    <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Where calls ring" data-testid="esim-calls">
      {opts.map(([k, I, t, s]) => { const on = item.callsTo === k; const Mark = on ? CheckCircle2 : Circle; return <button key={k} type="button" role="radio" aria-checked={on} onClick={() => !on && set(k)} className={`civr-card text-left p-3 border-2 transition-colors ${on ? 'border-[#818cf8] bg-[#818cf8]/15' : 'border-transparent opacity-80 hover:opacity-100'}`} data-testid={`esim-calls-${k}`}><div className="flex items-center gap-2 font-semibold text-sm"><I className="w-4 h-4 text-[#818cf8]" />{t}<Mark className={`w-4 h-4 ml-auto ${on ? 'text-[#818cf8]' : 'text-[#52525b]'}`} aria-hidden="true" /></div><div className="text-xs text-[#a1a1aa] mt-1">{s}</div>{on && <div className="text-xs font-semibold text-[#818cf8] mt-1.5" data-testid={`esim-calls-${k}-selected`}>Selected</div>}</button>; })}
    </div>
  );
}

function Texts({ item }) {
  const { data, reload } = useApi(`/esim/${item.id}/messages`);
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => { setBusy(true); try { await api(`/esim/${item.id}/sms`, { method: 'POST', body: { to, text } }); setText(''); reload(); toast.success('Sent'); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  return (
    <div className="space-y-3" data-testid="esim-texts">
      <ul className="space-y-2 max-h-64 overflow-y-auto">{(data?.messages || []).map(m => <li key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.direction === 'inbound' ? 'bg-[#1a1a1a]' : 'bg-[#818cf8]/15 ml-8'}`}><div className="text-xs text-[#a1a1aa] font-mono" data-no-translate>{m.direction === 'inbound' ? m.from : `→ ${m.to}`} · {when(m.at)}</div>{m.body}</li>)}
        {data && !data.messages.length && <li className="text-sm text-[#a1a1aa]">No texts yet. Texts sent to this number also land in your Inbox.</li>}</ul>
      <div className="grid sm:grid-cols-[180px_1fr_auto] gap-2">
        <input className="civr-input font-mono" value={to} onChange={e => setTo(e.target.value)} placeholder="+1 US number" aria-label="Send to (US number)" data-testid="esim-sms-to" />
        <input className="civr-input" value={text} onChange={e => setText(e.target.value)} placeholder="Message" aria-label="Message" data-testid="esim-sms-text" />
        <button type="button" onClick={send} disabled={busy || !to || !text} className="civr-btn civr-btn-primary" data-testid="esim-sms-send"><Send className="w-4 h-4" />Send</button>
      </div>
    </div>
  );
}

function UsageLine({ id }) {
  const { data } = useApi(`/esim/${id}/usage`);
  const u = data?.usage;
  if (!u || u.simulated) return null;
  const mb = u.data && /^gb$/i.test(u.data.unit) && Number(u.data.allowance) < 1;
  const amt = (v) => (mb ? +(Number(v) * 1000).toFixed(1) : v);
  const parts = [u.data && `Data ${amt(u.data.used)} of ${amt(u.data.allowance)} ${mb ? 'MB' : u.data.unit}`, u.voice && `Calls ${u.voice.usedMinutes} of ${u.voice.allowanceMinutes} min`, u.sms && `Texts ${u.sms.used}${u.sms.allowance === 'unlimited' ? ' (unlimited)' : ` of ${u.sms.allowance}`}`].filter(Boolean);
  return <p className="text-xs text-[#a1a1aa]" data-testid={`esim-usage-${id}`}><span>This cycle:</span> {parts.map((x, i) => <span key={x}>{i ? ' · ' : ''}<span>{x}</span></span>)}</p>;
}

function Line({ item, reload }) {
  const [open, setOpen] = useState(item.status === 'active' && !item.linked);
  const [was, setWas] = useState(item.status);
  if (was !== item.status) { setWas(item.status); if (was === 'provisioning' && item.status === 'active') setOpen(true); }
  const [s, tone] = STATUS[item.status] || [item.status, ''];
  const cancel = async () => { if (await ask(`Cancel the eSIM ${item.phoneNumber || ''}? The line stops working and its number can’t be recovered. Monthly fees already paid aren’t refunded.`, { danger: true, ok: 'Cancel eSIM', cancel: 'Keep eSIM', title: 'Cancel this eSIM?' })) act('cancel', 'Cancelled'); };
  const act = async (path, msg) => { try { await api(`/esim/${item.id}/${path}`, { method: 'POST' }); toast.success(msg); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="civr-card p-5 space-y-4" data-testid={`esim-line-${item.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Smartphone className="w-5 h-5 text-[#818cf8]" /><span className="font-mono text-lg" data-no-translate>{item.phoneNumber || 'Number coming'}</span>
        <span className={`text-sm ${tone}`} data-testid={`esim-status-${item.id}`}>{s}</span>
        <span className="text-xs text-[#a1a1aa] ml-auto">{item.price ? `$${item.price}/month · next ${String(item.nextBillAt || '').slice(0, 10) || '—'}` : 'Linked by CloudIVR'}</span>
      </div>
      {item.note && <p className="text-sm text-[#fbbf24]">{item.note}</p>}
      {item.status === 'active' && <>
        <UsageLine id={item.id} />
        <button type="button" onClick={() => setOpen(!open)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`esim-qr-toggle-${item.id}`}><QrCode className="w-4 h-4" />{open ? 'Hide install QR' : 'Show install QR'}</button>
        {open && <QrBlock id={item.id} />}
        <div><div className="text-sm font-semibold mb-2 flex items-center gap-2"><Phone className="w-4 h-4" />Where should calls ring?</div><CallsChoice item={item} onChange={reload} /></div>
        <div><div className="text-sm font-semibold mb-2 flex items-center gap-2"><MessageSquare className="w-4 h-4" />Texts</div><Texts item={item} /></div>
      </>}
      <div className="flex flex-wrap gap-2">
        {item.status === 'suspended' && <button type="button" onClick={() => act('renew', 'Renewed')} className="civr-btn civr-btn-primary civr-btn-sm" data-testid={`esim-renew-${item.id}`}>{`Renew $${item.price}`}</button>}
        {['active', 'suspended'].includes(item.status) && <button type="button" onClick={cancel} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`esim-cancel-${item.id}`}>Cancel eSIM</button>}
      </div>
    </div>
  );
}

export default function Esim() {
  const { data, error, reload } = useApi('/esim');
  const [buying, setBuying] = useState(null);
  const waiting = !!data?.items?.some(x => x.status === 'provisioning');
  useEffect(() => { if (!waiting) return undefined; const t = setInterval(reload, 5000); return () => clearInterval(t); }, [waiting, reload]);
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <div className="space-y-8" data-testid="esim-page">
      <PageHeader label="CloudIVR eSIM" title="A US mobile line, ready in minutes" sub="Get an eSIM with a US number, calls, texts and data. It’s ready right after you pay: scan the QR code and it’s on your phone. Add as many lines as you need." testid="esim-header" />
      {data.items.length > 0 && <div className="space-y-4">{data.items.map(x => <Line key={x.id} item={x} reload={reload} />)}</div>}
      {data.items.length > 0 && !buying && data.plans.length > 0 && <h2 className="font-display text-xl font-bold" data-testid="esim-add-another">Add another eSIM</h2>}
      {buying ? <BuyForm plan={buying} onCancel={() => setBuying(null)} onDone={() => { setBuying(null); reload(); }} /> : (
        data.plans.length ? <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="esim-plans">{data.plans.map(p => <PlanCard key={p.planId} p={p} onBuy={setBuying} />)}</div>
          : <Empty icon={Smartphone} title="eSIM plans are coming soon" sub="We’re adding mobile plans. Check back shortly." testid="esim-empty" />
      )}
    </div>
  );
}
