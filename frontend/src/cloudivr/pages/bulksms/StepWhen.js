import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Zap, Clock, CalendarDays, MessageCircleReply, Loader2 } from 'lucide-react';
import { api, money } from '../../api';
import { WalletPay } from '../../WalletPay';

const hh = (h) => `${String(h).padStart(2, '0')}:00 UTC`;
const days = () => Array.from({ length: 14 }, (_, i) => new Date(Date.now() + i * 864e5).toISOString().slice(0, 10));

// Step 4 — now / later today / a scheduled day (cheaper 24 h+ ahead), optional paid replies, booking summary, pay from wallet.
export function StepWhen({ campaign, prices, onBack, onDone }) {
  const [w, setW] = useState(null);
  const [day, setDay] = useState(null);
  const [av, setAv] = useState(null);
  const [booking, setBooking] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api(`/bulksms/campaigns/${campaign.id}/when`).then(setW).catch(e => toast.error(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (day) api(`/bulksms/availability?date=${day}&campaignId=${campaign.id}`).then(setAv).catch(e => toast.error(e.message)); }, [day, campaign.id]);
  const replies = async (on) => { setW(await api(`/bulksms/campaigns/${campaign.id}/replies`, { method: 'POST', body: { on } })); };
  const book = async (body) => { setBusy(true); try { setBooking((await api(`/bulksms/campaigns/${campaign.id}/book`, { method: 'POST', body })).booking); } catch (e) { toast.error(e.message); load(); } finally { setBusy(false); } };
  const pay = async () => { setBusy(true); try { await api(`/bulksms/bookings/${booking.id}/pay`, { method: 'POST' }); toast.success('Booked — we\'ll post progress in your inbox'); onDone(); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  if (!w) return <div className="py-10 text-center text-[var(--c-muted)]"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;
  if (booking) return (
    <div className="space-y-4" data-testid="bulksms-booking">
      <h3 className="font-semibold text-lg">Booking #{booking.code}</h3>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-[var(--c-muted)]">Starts</dt><dd data-testid="bulksms-booking-start">{booking.date} · {hh(booking.hour)}</dd></div>
        <div><dt className="text-[var(--c-muted)]">Done by about</dt><dd>{new Date(booking.end).toISOString().slice(11, 16)} UTC</dd></div>
        <div><dt className="text-[var(--c-muted)]">Texts</dt><dd>{booking.volume.toLocaleString()} × {money(booking.unit)}</dd></div>
        <div><dt className="text-[var(--c-muted)]">Total</dt><dd className="text-lg font-semibold" data-testid="bulksms-booking-price">{money(booking.price)}{booking.discountPct ? <span className="civr-pill civr-pill-ok ml-2">−{booking.discountPct}%</span> : null}</dd></div>
      </dl>
      {booking.replyFee > 0 && <p className="text-xs text-[var(--c-muted)]">Includes {money(booking.replyFee)} for replies in your inbox.</p>}
      <p className="text-xs text-[var(--c-muted)]">This slot is held for {booking.holdMinutes} minutes.</p>
      <WalletPay price={booking.price} onWallet={pay} busy={busy} crypto={false} label="Pay from wallet" testid="bulksms-pay" />
      <button type="button" className="civr-btn civr-btn-ghost" onClick={() => setBooking(null)} data-testid="bulksms-booking-change"><ArrowLeft className="w-4 h-4" />Pick another time</button>
    </div>
  );
  return (
    <div className="space-y-5" data-testid="bulksms-when">
      <h3 className="font-semibold text-lg">When should it go out?</h3>
      <div className="grid sm:grid-cols-3 gap-3">
        <Option icon={Zap} title="Send now" price={w.now?.price} sub={w.now ? `Starts ${hh(w.now.hour)}` : 'No room this hour'} disabled={!w.now || busy} onClick={() => book({ now: true })} testid="bulksms-when-now" />
        <Option icon={Clock} title="Later today" price={w.later?.price} sub={w.later ? `Starts ${hh(w.later.hour)}` : 'Nothing left today'} disabled={!w.later || busy} onClick={() => book({ date: new Date().toISOString().slice(0, 10), hour: w.later.hour })} testid="bulksms-when-later" />
        <Option icon={CalendarDays} title="Schedule" price={w.schedule?.price} sub={`${w.schedule?.pct || prices.discountPct}% off ${w.schedule?.minHours || prices.discountHours} h+ ahead`} onClick={() => setDay(days()[1])} testid="bulksms-when-schedule" />
      </div>
      {day && (
        <div className="rounded-lg border border-[#262626] p-4 space-y-3" data-testid="bulksms-when-day">
          <div className="flex flex-wrap gap-2">{days().slice(1).map(d => <button key={d} type="button" onClick={() => setDay(d)} className={`civr-btn civr-btn-sm ${d === day ? 'civr-btn-primary' : ''}`} data-testid={`bulksms-day-${d}`}>{new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</button>)}</div>
          {!av ? <Loader2 className="w-4 h-4 animate-spin" /> : !av.slots.length || av.dayFree < campaign.parts ? (
            <p className="text-sm text-[#fbbf24]" data-testid="bulksms-day-full">That day is full.{av.next && <> Next free day: <button type="button" className="underline" onClick={() => setDay(av.next)}>{av.next}</button></>}</p>
          ) : <div className="flex flex-wrap gap-2">{av.slots.map(s => <button key={s.hour} type="button" disabled={busy} onClick={() => book({ date: day, hour: s.hour })} className="civr-btn civr-btn-sm" data-testid={`bulksms-hour-${s.hour}`}>{hh(s.hour)} <span className="text-[var(--c-muted)]">· {s.free.toLocaleString()} free</span></button>)}</div>}
        </div>
      )}
      <label className="flex items-start gap-2 text-sm cursor-pointer" data-testid="bulksms-when-replies"><input type="checkbox" className="mt-1" checked={!!w.replyFee} onChange={e => replies(e.target.checked)} data-testid="bulksms-replies-toggle" /><span><MessageCircleReply className="w-4 h-4 inline mr-1" />Get replies in your inbox and answer them <b>+{money(prices.replyFee)}</b><span className="block text-xs text-[var(--c-muted)]">STOP and HELP are always handled for you.</span></span></label>
      <button type="button" className="civr-btn civr-btn-ghost" onClick={onBack} data-testid="bulksms-when-back"><ArrowLeft className="w-4 h-4" />Back</button>
    </div>
  );
}

const Option = ({ icon: Icon, title, price, sub, disabled, onClick, testid }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="civr-card p-4 text-left transition-colors hover:border-[#818cf8] disabled:opacity-50 disabled:cursor-not-allowed" data-testid={testid}>
    <Icon className="w-5 h-5 text-[#818cf8]" /><div className="font-semibold mt-2">{title}</div>
    {price != null && <div className="text-lg">{money(price)}</div>}<div className="text-xs text-[var(--c-muted)] mt-1">{sub}</div>
  </button>
);
