import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';
import {
  TrendingUp, TrendingDown, DollarSign, PiggyBank, ShoppingCart, Receipt, RefreshCw, LogOut,
  Download, Search, Wallet, Gift, BarChart3, Layers, Users, Package, Lock, UserPlus, UserCheck,
  ChevronDown, ChevronRight, Globe, Filter, Scale, Undo2, ShieldCheck, MinusCircle, Percent, Tag,
  Award, Banknote, LayoutDashboard, FileSpreadsheet, ArrowRight,
} from 'lucide-react';
import { BRAND, brandSlug } from '../branding';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';
const API = `${BACKEND_URL}/api/admin/sales`;

const RANGES = [
  { k: 'today', label: 'Today', long: 'Today' },
  { k: '7d', label: '7 Days', long: 'Last 7 days' },
  { k: '30d', label: '30 Days', long: 'Last 30 days' },
  { k: '90d', label: '90 Days', long: 'Last 90 days' },
  { k: '1y', label: '1 Year', long: 'Last 12 months' },
  { k: 'all', label: 'All Time', long: 'All time' },
];
const rangeLong = (k) => (RANGES.find((r) => r.k === k) || RANGES[2]).long;

const TABS = [
  { k: 'overview', label: 'Overview', icon: LayoutDashboard },
  { k: 'trends', label: 'Trends', icon: TrendingUp },
  { k: 'breakdown', label: 'Breakdown', icon: Layers },
  { k: 'records', label: 'Records', icon: Receipt },
];

const C = {
  mint: '#00E599', cyan: '#00C2FF', violet: '#A78BFA', amber: '#FFB800', rose: '#FF3366', slate: '#A1A1AA',
};
const CAT_COLORS = {
  Domains: '#00E599', Hosting: '#00C2FF', VPS: '#A78BFA', 'Cloud Phone': '#FFB800',
  Calls: '#F472B6', SMS: '#22D3EE', 'Digital Products': '#FF8A3D', Subscriptions: '#B4F461',
  Leads: '#E879F9', Marketplace: '#60A5FA', Other: '#A1A1AA',
};
const colorFor = (c) => CAT_COLORS[c] || '#A1A1AA';
const TIER_COLOR = { bronze: '#CD7F32', silver: '#D4D4D8', gold: '#FFB800', platinum: '#A78BFA' };
const LOSS_STRIPE = { background: `repeating-linear-gradient(45deg, ${C.rose} 0 2px, ${C.rose}40 2px 4px)` };

const money = (n, digits = 2) => {
  const v = Number(n) || 0;
  return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtUsd = (n) => money(n, 2);
const fmtUsd0 = (n) => money(n, 0);
const fmtNum = (n) => (Number(n) || 0).toLocaleString('en-US');
const fmtAxis = (v) => { const a = Math.abs(v); return (v < 0 ? '−' : '') + '$' + (a >= 1000 ? (a / 1000).toFixed(0) + 'k' : a); };
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const payoutOf = (s) => (s.eligiblePayout != null ? s.eligiblePayout : (s.payout != null ? s.payout : s.netProfit));
const promoOf = (s) => (s.promoCreditIssued != null ? s.promoCreditIssued : s.bonuses);
const LANG_LABEL = { en: 'English', fr: 'French', zh: 'Chinese', hi: 'Hindi' };

// shared recipe classes — 8px grid (4px half-steps only inside pills), 12px minimum text
const CARD = 'bg-[#121214] border border-white/[0.06] rounded-xl';
const PAD = 'p-4 sm:p-6';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E599]/60';
const INPUT = 'h-11 md:h-10 bg-[#09090B] border border-white/[0.08] rounded-lg text-sm text-[#FAFAFA] placeholder-[#A1A1AA] focus:outline-none focus:border-[#00E599]/70 focus:ring-1 focus:ring-[#00E599]/40 transition-colors';
const TH = 'text-xs text-[#A1A1AA] uppercase tracking-[0.08em] font-semibold';
const BTN = `inline-flex items-center justify-center gap-2 h-11 md:h-10 px-4 rounded-lg text-sm font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`;
const GHOST_BTN = `${BTN} border-white/[0.08] bg-[#121214] text-[#D4D4D8] hover:text-[#FAFAFA] hover:bg-[#18181B]`;
const MINT_BTN = `${BTN} bg-[#00E599]/10 text-[#00E599] border-[#00E599]/25 hover:bg-[#00E599]/20`;
const ICON_BTN = `inline-flex items-center justify-center gap-2 w-11 h-11 md:w-auto md:h-10 md:px-4 rounded-lg text-sm font-medium border border-white/[0.08] bg-[#121214] text-[#D4D4D8] hover:text-[#FAFAFA] hover:bg-[#18181B] transition-colors ${FOCUS}`;
const PILL = 'inline-flex items-center gap-1 font-mono text-xs uppercase tracking-wide px-2 py-1 rounded-full border';
const AXIS_TICK = { fill: '#A1A1AA', fontSize: 12, fontFamily: 'JetBrains Mono' };

const GROUP_STYLE = {
  sale:       { color: '#FF3366', label: 'Sale',       sign: '−', desc: 'Product purchase — money leaving the wallet' },
  deposit:    { color: '#00E599', label: 'Deposit',    sign: '+', desc: 'Real funds the user added to their wallet' },
  bonus:      { color: '#FFB800', label: 'Bonus',      sign: '+', desc: 'Free promotional credit — cannot be withdrawn' },
  refund:     { color: '#00C2FF', label: 'Refund',     sign: '+', desc: 'Money returned to the user for a failed / cancelled service' },
  adjustment: { color: '#A78BFA', label: 'Adjustment', sign: '±', desc: 'Manual correction — over/underpayment credit, savings, etc.' },
};
const SUBGROUP_LABEL = {
  welcome: 'Welcome bonus', 'admin-credit': 'Admin credit', 'first-deposit': 'First-deposit bonus',
  'other-bonus': 'Other bonus', overpayment: 'Overpayment credit', underpayment: 'Underpayment credit',
  savings: 'Savings credit', correction: 'Correction', 'other-adjustment': 'Adjustment',
  'refund-reversal': 'Refund reversal', 'domain-refund': 'Domain refund', 'admin-refund': 'Admin refund',
  refund: 'Refund', crypto: 'Crypto deposit', topup: 'Wallet top-up', deposit: 'Deposit',
};
const groupStyle = (g) => GROUP_STYLE[g] || { color: '#A1A1AA', label: g || 'other', sign: '', desc: '' };
const subgroupLabel = (sg, type) => SUBGROUP_LABEL[sg] || (type || sg || 'other');
const pillStyle = (color) => ({ color, borderColor: `${color}40`, background: `${color}14` });

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const n2 = (v) => (Number(v) || 0).toFixed(2);

// Whole-dashboard summary (KPIs, funnel, trends, breakdowns, top lists) — built from the loaded overview.
function summaryCsv(data, range) {
  const s = data.summary || {};
  const u = data.userStats || {};
  const f = data.funnel || {};
  const rows = [['Section', 'Item', 'Value', 'Profit', 'Orders'], ['Period', rangeLong(range), '', '', '']];
  [['Gross revenue', s.grossRevenue], ['Profit', s.netProfit], ['Eligible payout (all-time)', payoutOf(s)],
    ['Average order value', s.avgOrderValue], ['Wallet deposits', s.deposits], ['Promo credit issued', promoOf(s)],
    ['Refunds', s.refunds], ['Adjustments', s.adjustments], ['List sales', s.grossListSales],
    ['Loyalty discounts', s.loyaltyDiscounts], ['Coupon discounts', s.couponDiscounts],
  ].forEach(([k, v]) => rows.push(['Summary', k, n2(v), '', '']));
  rows.push(['Summary', 'Orders', s.orders || 0, '', '']);
  [['Total bot users', u.totalUsers], ['New users', u.newUsers], ['Paying users', u.purchasedUsers],
    ['Funnel: joined', f.joined], ['Funnel: deposited', f.deposited], ['Funnel: purchased', f.purchased],
  ].forEach(([k, v]) => rows.push(['Users', k, v || 0, '', '']));
  (data.byCategory || []).forEach((c) => rows.push(['Category', c.category, n2(c.revenue), n2(c.profit), c.orders]));
  (data.byTier || []).forEach((t) => rows.push(['Membership tier', t.tierName, n2(t.revenue), n2(t.profit), t.orders]));
  (data.weekly || []).forEach((w) => rows.push(['Weekly', w.label, n2(w.revenue), n2(w.netProfit != null ? w.netProfit : w.profit), w.orders]));
  (data.timeseries || []).forEach((d) => rows.push(['Daily', d.date, n2(d.revenue), n2(d.netProfit), d.orders != null ? d.orders : '']));
  (data.topProducts || []).forEach((p) => rows.push(['Top product', p.product, n2(p.revenue), n2(p.profit), p.orders]));
  (data.topCustomers || []).forEach((c) => rows.push(['Top customer', c.name || `User ${c.chatId}`, n2(c.revenue), n2(c.profit), c.orders]));
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

function useDebounced(fn, ms = 400) {
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  return (v) => { clearTimeout(t.current); t.current = setTimeout(() => fn(v), ms); };
}

// ─────────────────────────────────────────────────────────────
// Login gate
// ─────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      localStorage.setItem('salesToken', data.token);
      onLogin(data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-root min-h-screen flex items-center justify-center bg-[#09090B] px-4 bg-[radial-gradient(900px_500px_at_50%_-10%,rgba(0,229,153,0.06),transparent)]">
      <div className="grain-overlay" aria-hidden="true" />
      <form onSubmit={submit} className="w-full max-w-md p-8 sm:p-10 bg-[#121214] border border-white/[0.08] rounded-2xl shadow-[0_0_60px_rgba(0,229,153,0.05)] animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both">
        <div className="w-12 h-12 rounded-xl bg-[#00E599]/10 border border-[#00E599]/20 flex items-center justify-center mb-6">
          <Lock className="w-5 h-5 text-[#00E599]" aria-hidden="true" />
        </div>
        <h1 className="font-heading text-2xl font-bold text-[#FAFAFA] tracking-tight">Sales &amp; Profit</h1>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#A1A1AA] mt-2 mb-8">{BRAND.name} · Admin Analytics</p>
        <label htmlFor="sales-password" className="block text-[#D4D4D8] text-xs uppercase tracking-[0.08em] font-medium mb-2">Dashboard password</label>
        <input id="sales-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus
          data-testid="sales-password-input" className={`w-full px-4 font-mono ${INPUT} h-12 md:h-12`} placeholder="••••••••••" />
        {error && <p className="text-[#FF3366] text-sm mt-4" role="alert" data-testid="sales-login-error">{error}</p>}
        <button type="submit" disabled={loading || !password} data-testid="sales-login-btn"
          className={`mt-6 w-full h-12 bg-[#FAFAFA] text-[#09090B] font-heading font-bold rounded-lg hover:bg-[#E4E4E7] disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${FOCUS}`}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Building blocks
// ─────────────────────────────────────────────────────────────
function SectionHeading({ title, hint, testid }) {
  return (
    <div className="flex items-center gap-4 pt-4" data-testid={testid}>
      <h3 className="font-mono text-xs tracking-[0.2em] uppercase text-[#D4D4D8] shrink-0">{title}</h3>
      {hint && <span className="text-xs text-[#A1A1AA] hidden sm:inline">{hint}</span>}
      <span className="h-px flex-1 bg-white/[0.08]" aria-hidden="true" />
    </div>
  );
}

function CardTitle({ icon: Icon, color = C.mint, children, aside, className = 'mb-4' }) {
  return (
    <div className={`flex items-center justify-between flex-wrap gap-2 ${className}`}>
      <h4 className="font-heading text-base font-semibold tracking-tight flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4" style={{ color }} aria-hidden="true" />}
        {children}
      </h4>
      {aside}
    </div>
  );
}

function DeltaBadge({ delta }) {
  if (delta == null) return null;
  const up = delta >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-xs font-medium px-2 py-1 rounded ${up ? 'text-[#00E599] bg-[#00E599]/10' : 'text-[#FF3366] bg-[#FF3366]/10'}`}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      {up ? '+' : '−'}{Math.abs(delta)}%
      <span className="sr-only">{up ? 'up' : 'down'} vs previous period</span>
    </span>
  );
}

// Money value that never relies on colour alone: negatives get a minus icon + screen-reader text.
function Money({ value, tone = 'text-[#FAFAFA]', digits = 2, className = '', testid }) {
  const neg = (Number(value) || 0) < 0;
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${neg ? 'text-[#FF3366]' : tone} ${className}`} data-testid={testid}>
      {neg && <MinusCircle className="w-4 h-4 shrink-0" aria-hidden="true" />}
      {money(value, digits)}
      {neg && <span className="sr-only">(negative)</span>}
    </span>
  );
}

function Kpi({ icon: Icon, label, value, accent = 'mint', delta, sub, testid, footnote }) {
  return (
    <div className={`${CARD} ${PAD} hover:border-white/[0.14] transition-colors duration-300`} data-testid={testid}>
      <div className="flex items-start justify-between gap-2 mb-4">
        <span className="text-xs text-[#D4D4D8] font-medium uppercase tracking-[0.08em]">{label}</span>
        <Icon className="w-4 h-4 shrink-0" style={{ color: C[accent] }} aria-hidden="true" />
      </div>
      <div className="font-mono text-xl sm:text-2xl font-semibold tracking-tight" data-testid={testid ? `${testid}-value` : undefined}>{value}</div>
      <div className="flex items-center flex-wrap gap-2 mt-2 min-h-[24px]">
        <DeltaBadge delta={delta} />
        {sub && <span className="text-[#A1A1AA] text-xs">{sub}</span>}
      </div>
      {footnote && <div className="mt-2 text-[#A1A1AA] text-xs" data-testid={testid ? `${testid}-footnote` : undefined}>{footnote}</div>}
    </div>
  );
}

function StatGrid({ cols, className = '', testid, children }) {
  return (
    <div className={`grid ${cols} gap-px bg-white/[0.06] border border-white/[0.06] rounded-xl overflow-hidden ${className}`} data-testid={testid}>
      {children}
    </div>
  );
}

function StatCell({ icon: Icon, label, value, sub, accent = 'slate', testid, breakdown }) {
  return (
    <div className={`bg-[#121214] ${PAD} flex flex-col gap-2`} data-testid={testid}>
      <span className="flex items-center gap-2 text-xs text-[#D4D4D8] font-medium uppercase tracking-[0.08em]">
        <Icon className="w-4 h-4" style={{ color: C[accent] }} aria-hidden="true" /> {label}
      </span>
      <span className="font-mono text-lg font-semibold text-[#FAFAFA]">{value}</span>
      {sub && <span className="text-[#A1A1AA] text-xs">{sub}</span>}
      {breakdown && breakdown.length > 0 && (
        <div className="mt-1 space-y-1" data-testid={testid ? `${testid}-breakdown` : undefined}>
          {breakdown.map((b) => (
            <div key={b.label} className="flex items-center justify-between gap-2 text-xs font-mono">
              <span className="text-[#A1A1AA] flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: b.color }} aria-hidden="true" /> {b.label}
              </span>
              <span className="text-[#D4D4D8] tabular-nums">{b.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChartLegend({ items, testid }) {
  return (
    <ul className="flex items-center flex-wrap gap-4 text-xs text-[#D4D4D8]" aria-label="Chart legend" data-testid={testid}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm" style={i.swatch || { background: i.color }} aria-hidden="true" />
          {i.icon && <i.icon className="w-3 h-3" style={{ color: i.color }} aria-hidden="true" />}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

const TOOLTIP_BOX = 'bg-[#121214]/95 backdrop-blur-xl border border-white/[0.1] rounded-lg shadow-2xl px-4 py-3 text-xs font-mono space-y-1';
const PromoNote = ({ wb }) => (wb > 0 ? <div className="text-[#A1A1AA]">+ {fmtUsd(wb)} promo credit issued · not in profit</div> : null);

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload || {};
  return (
    <div className={TOOLTIP_BOX}>
      <div className="text-[#D4D4D8] font-medium">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} aria-hidden="true" />
          <span className="text-[#A1A1AA]">{p.dataKey === 'netProfit' ? 'Profit' : 'Revenue'}:</span>
          <Money value={p.value} />
        </div>
      ))}
      <PromoNote wb={d.welcomeBonuses} />
    </div>
  );
}

function CategoryTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="text-[#FAFAFA] font-medium">{d.category}</div>
      <div className="text-[#A1A1AA]">Revenue: <Money value={d.revenue} /></div>
      <div className="text-[#A1A1AA]">Profit: <Money value={d.profit} tone="text-[#00E599]" /></div>
      <div className="text-[#A1A1AA]">Orders: <span className="text-[#FAFAFA]">{d.orders}</span></div>
    </div>
  );
}

function WeeklyTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const net = d.netProfit != null ? d.netProfit : d.profit;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="text-[#FAFAFA] font-medium">{d.label} · {net < 0 ? 'Loss week' : 'Profit week'}</div>
      <div className="text-[#A1A1AA]">Profit: <Money value={net} tone="text-[#00E599]" /></div>
      <div className="text-[#A1A1AA]">Revenue: <Money value={d.revenue} /></div>
      <div className="text-[#A1A1AA]">Orders: <span className="text-[#FAFAFA]">{d.orders}</span></div>
      <PromoNote wb={d.welcomeBonuses} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Conversion funnel — joined → deposited → purchased
// ─────────────────────────────────────────────────────────────
const FUNNEL_STAGES = [
  { key: 'joined', label: 'Joined the bot', icon: Users, color: C.cyan, sub: 'received welcome bonus' },
  { key: 'deposited', label: 'Deposited funds', icon: Wallet, color: C.amber, sub: 'funded their wallet' },
  { key: 'purchased', label: 'Made a purchase', icon: ShoppingCart, color: C.mint, sub: 'bought a product' },
];

function FunnelStep({ conv, from, extra }) {
  if (extra > 0) {
    return (
      <div className="font-mono text-xs mt-2 flex items-center flex-wrap gap-1 text-[#00E599]">
        <ArrowRight className="w-3 h-3" aria-hidden="true" />All continued · +{fmtNum(extra)} bought with promo credit only (no deposit)
      </div>
    );
  }
  return (
    <div className="font-mono text-xs mt-2 flex items-center flex-wrap gap-2">
      <span className="text-[#00E599] flex items-center gap-1"><ArrowRight className="w-3 h-3" aria-hidden="true" />{conv}% continued</span>
      <span className="text-[#A1A1AA]" aria-hidden="true">·</span>
      <span className="text-[#FF3366] flex items-center gap-1"><TrendingDown className="w-3 h-3" aria-hidden="true" />{Math.round((100 - conv) * 10) / 10}% dropped off</span>
      <span className="text-[#A1A1AA] hidden sm:inline">from {from}</span>
    </div>
  );
}

function ConversionFunnel({ funnel }) {
  if (!funnel) return null;
  const counts = { joined: funnel.joined || 0, deposited: funnel.deposited || 0, purchased: funnel.purchased || 0 };
  const pct = (n) => (counts.joined > 0 ? Math.round((n / counts.joined) * 1000) / 10 : 0);
  return (
    <div className={`${CARD} ${PAD} h-full`} data-testid="sales-funnel">
      <CardTitle icon={Filter}>Conversion Funnel</CardTitle>
      <div className="space-y-6">
        {FUNNEL_STAGES.map((s, i) => {
          const count = counts[s.key];
          const p = pct(count);
          const prev = i > 0 ? counts[FUNNEL_STAGES[i - 1].key] : null;
          const conv = i === 0 ? null : (prev > 0 ? Math.round((count / prev) * 1000) / 10 : 0);
          return (
            <div key={s.key} data-testid={`funnel-stage-${s.key}`}>
              <div className="flex items-center justify-between gap-2 text-sm mb-2">
                <span className="flex items-center gap-2 text-[#D4D4D8]">
                  <s.icon className="w-4 h-4" style={{ color: s.color }} aria-hidden="true" /> {s.label}
                  <span className="text-[#A1A1AA] text-xs hidden sm:inline">· {s.sub}</span>
                </span>
                <span className="font-mono tabular-nums text-[#A1A1AA] text-xs shrink-0">
                  <span className="text-sm font-semibold" style={{ color: s.color }} data-testid={`funnel-count-${s.key}`}>{fmtNum(count)}</span> · {p}%
                </span>
              </div>
              <div className="relative w-full h-8 bg-[#1F1F22] rounded-md overflow-hidden" role="img" aria-label={`${s.label}: ${fmtNum(count)} users, ${p}% of joined`}>
                <div className="absolute left-0 top-0 h-full rounded-md transition-all duration-1000 ease-out"
                  style={{ width: `${count > 0 ? Math.max(p, 3) : 0}%`, background: s.color, opacity: 0.9 }} />
              </div>
              {i > 0 && <FunnelStep conv={conv} from={FUNNEL_STAGES[i - 1].label.toLowerCase()} extra={count - prev} />}
            </div>
          );
        })}
      </div>
      {counts.joined === 0 && <div className="text-[#A1A1AA] text-sm mt-4">No users joined in this period.</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Shared filter controls (Records tab)
// ─────────────────────────────────────────────────────────────
function SearchField({ id, label, placeholder, onChange, testid }) {
  return (
    <div className="relative w-full sm:w-64">
      <label htmlFor={id} className="sr-only">{label}</label>
      <Search className="w-4 h-4 text-[#A1A1AA] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
      <input id={id} type="search" placeholder={placeholder} data-testid={testid}
        onChange={(e) => onChange(e.target.value)} className={`w-full pl-10 pr-3 ${INPUT}`} />
    </div>
  );
}

function SelectField({ id, label, value, onChange, options, testid }) {
  return (
    <div className="w-full sm:w-auto">
      <label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} value={value} data-testid={testid} onChange={(e) => onChange(e.target.value)}
        className={`w-full sm:w-auto px-3 ${INPUT}`}>
        {options.map((o) => <option key={o.k} value={o.k}>{o.label}</option>)}
      </select>
    </div>
  );
}

const FilterBar = ({ children }) => <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 mb-4">{children}</div>;

function Pager({ page, pages, total, noun, onPage, testidPrefix }) {
  if (!pages) return null;
  return (
    <nav className="flex items-center justify-between flex-wrap gap-4 mt-4" aria-label={`${noun} pages`}>
      <span className="text-[#A1A1AA] font-mono text-xs" data-testid={`${testidPrefix}-page-info`}>{fmtNum(total)} {noun}{pages > 1 ? ` · page ${page}/${pages}` : ''}</span>
      {pages > 1 && <div className="flex items-center gap-2">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid={`${testidPrefix}-prev-btn`} className={GHOST_BTN}>Prev</button>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid={`${testidPrefix}-next-btn`} className={GHOST_BTN}>Next</button>
      </div>}
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────
// Expanded per-user order history (drill-down)
// ─────────────────────────────────────────────────────────────
function walletRowsFor(p) {
  return [
    { key: 'deposits', label: 'Deposits', value: p.deposits, color: GROUP_STYLE.deposit.color, sign: '+', hint: 'Real funds the user added (crypto, top-up, admin credit)',
      sub: [{ label: 'Crypto / top-up', value: (p.deposits || 0) - (p.adminCredit || 0) }, { label: 'Admin credit (manual)', value: p.adminCredit || 0 }].filter((s) => s.value > 0) },
    { key: 'bonuses', label: 'Bonuses', value: p.bonuses, color: GROUP_STYLE.bonus.color, sign: '+', hint: 'Promotional store credit — not counted in profit',
      sub: [{ label: 'Welcome bonus', value: p.welcomeBonus || 0 }, { label: 'First-deposit bonus', value: p.firstDepositBonus || 0 }, { label: 'Other bonus', value: p.otherBonus || 0 }].filter((s) => s.value > 0) },
    { key: 'refunds', label: 'Refunds received', value: p.refunds, color: GROUP_STYLE.refund.color, sign: '+', hint: 'Money returned for failed / cancelled services' },
    { key: 'adjustments', label: 'Adjustments', value: p.adjustments, color: GROUP_STYLE.adjustment.color, sign: '±', hint: 'Manual corrections (overpayment credit, savings, etc.)' },
    { key: 'spent', label: 'Total spent', value: p.totalSpent, color: C.rose, sign: '−', hint: 'Product purchases — money leaving the wallet' },
  ];
}

function walletPills(p) {
  const pills = [];
  if (p.bonusRemaining > 0) pills.push({ label: 'Bonus-only wallet', color: C.amber, icon: Gift });
  if (p.deposits > 0) pills.push({ label: 'Real depositor', color: C.mint, icon: ShieldCheck });
  if (p.refunds > 0) pills.push({ label: 'Has refunds', color: C.cyan, icon: Undo2 });
  if (p.adjustments !== 0) pills.push({ label: 'Manually adjusted', color: C.violet, icon: Scale });
  if (p.balance < 0) pills.push({ label: 'Negative balance', color: C.rose, icon: MinusCircle });
  return pills;
}

const Fact = ({ label, children }) => (
  <div>
    <div className="text-[#A1A1AA] text-xs uppercase tracking-[0.08em] font-medium">{label}</div>
    <div className="mt-1">{children}</div>
  </div>
);

function WalletComposition({ p, chatId }) {
  const pills = walletPills(p);
  return (
    <div className="lg:col-span-2 bg-[#121214] border border-white/[0.06] rounded-lg p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[#A1A1AA] text-xs uppercase tracking-[0.08em] font-medium">Wallet Balance</div>
          <Money value={p.balance} className="font-mono text-2xl font-semibold mt-1" />
          {p.bonusRemaining > 0 && (
            <div className="mt-2 flex items-center gap-1 font-mono text-xs text-[#FFB800]" data-testid={`bonus-note-${chatId}`}>
              <Gift className="w-3 h-3" aria-hidden="true" /> incl. {fmtUsd(p.bonusRemaining)} welcome bonus (unspent)
            </div>
          )}
          {p.bonusRemaining === 0 && p.welcomeBonus > 0 && (
            <div className="mt-2 flex items-center gap-1 font-mono text-xs text-[#A1A1AA]">
              <Gift className="w-3 h-3" aria-hidden="true" /> {fmtUsd(p.welcomeBonus)} welcome bonus received (spent or superseded by deposits)
            </div>
          )}
        </div>
        {pills.length > 0 && (
          <div className="flex flex-wrap gap-2 max-w-full" data-testid={`wallet-status-${chatId}`}>
            {pills.map((s) => (
              <span key={s.label} className={PILL} style={pillStyle(s.color)}><s.icon className="w-3 h-3" aria-hidden="true" />{s.label}</span>
            ))}
          </div>
        )}
      </div>
      <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-2" data-testid={`wallet-composition-${chatId}`}>
        {walletRowsFor(p).map((r) => (
          <div key={r.key}>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="flex items-center gap-2 text-[#D4D4D8]" title={r.hint}>
                <span className="w-2 h-2 rounded-full" style={{ background: r.color }} aria-hidden="true" />{r.label}
              </span>
              <span className="font-mono tabular-nums" style={{ color: r.value ? r.color : '#A1A1AA' }}>{r.key === 'adjustments' ? ((r.value || 0) < 0 ? '−' : '+') : r.sign}{fmtUsd(Math.abs(r.value || 0))}</span>
            </div>
            {r.sub && r.sub.length > 0 && r.value > 0 && (
              <div className="ml-4 mt-1 space-y-1">
                {r.sub.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-2 text-xs font-mono text-[#A1A1AA]">
                    <span>↳ {s.label}</span><span className="tabular-nums">{fmtUsd(s.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function OrdersTable({ orders }) {
  if (!orders.length) return <div className="text-[#A1A1AA] text-sm py-2">No purchases yet — this user has joined but hasn't ordered anything.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[560px]">
        <caption className="sr-only">Order history</caption>
        <thead>
          <tr className={`${TH} border-b border-white/[0.06]`}>
            <th className="text-left py-2 px-2">Date</th><th className="text-left py-2 px-2">Category</th>
            <th className="text-left py-2 px-2">Product</th><th className="text-right py-2 px-2">Amount</th>
            <th className="text-right py-2 px-2">Profit</th><th className="text-left py-2 px-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-b border-white/[0.04] last:border-0">
              <td className="py-2 px-2 text-[#D4D4D8] whitespace-nowrap font-mono text-xs">{fmtDate(o.date)}</td>
              <td className="py-2 px-2"><span className="inline-flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: colorFor(o.category) }} aria-hidden="true" />{o.category}</span></td>
              <td className="py-2 px-2 text-[#D4D4D8] max-w-[180px] truncate">{o.product}</td>
              <td className="py-2 px-2 text-right font-mono"><Money value={o.amountUsd} /></td>
              <td className="py-2 px-2 text-right font-mono"><Money value={o.profit} tone="text-[#00E599]" /></td>
              <td className="py-2 px-2"><span className={PILL} style={pillStyle(o.status === 'completed' ? C.mint : C.slate)}>{o.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WalletActivity({ items }) {
  if (!items.length) return null;
  return (
    <div>
      <h5 className="text-sm font-heading font-semibold text-[#FAFAFA] mb-2 flex items-center gap-2">
        <Wallet className="w-4 h-4 text-[#00C2FF]" aria-hidden="true" /> Wallet Activity
        <span className="text-[#A1A1AA] font-normal font-mono text-xs">({items.length})</span>
      </h5>
      <div className="space-y-1">
        {items.map((o) => {
          const st = groupStyle(o.group);
          const isNegative = o.group === 'refund' && o.amountUsd < 0;
          const sign = o.group === 'adjustment' ? (o.amountUsd >= 0 ? '+' : '−') : (isNegative ? '−' : st.sign);
          return (
            <div key={o.id} className="flex items-center justify-between gap-4 py-2 border-b border-white/[0.04] last:border-0 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span className={PILL} style={pillStyle(st.color)} title={st.desc}>{st.label}</span>
                <span className="text-[#D4D4D8] truncate" title={o.type}>{subgroupLabel(o.subgroup, o.type)}</span>
                {o.status && o.status !== 'completed' && <span className={PILL} style={pillStyle(C.slate)}>{o.status}</span>}
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <span className="text-[#A1A1AA] font-mono text-xs whitespace-nowrap">{fmtDate(o.date)}</span>
                <span className="font-mono tabular-nums" style={{ color: isNegative ? C.rose : st.color }}>{sign}{fmtUsd(Math.abs(o.amountUsd))}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UserOrderHistory({ authFetch, chatId }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const res = await authFetch(`/users/${chatId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load');
        if (alive) setDetail(json);
      } catch (err) { if (alive) setError(err.message); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [authFetch, chatId]);

  if (loading) return <div className="text-[#A1A1AA] text-sm p-4 font-mono">Loading order history…</div>;
  if (error) return <div className="text-[#FF3366] text-sm p-4" role="alert">{error}</div>;
  if (!detail) return null;
  const p = detail.profile || {};
  const tx = detail.transactions || [];
  const orders = tx.filter((t) => t.group === 'sale');

  return (
    <div id={`user-detail-${chatId}`} className="bg-[#09090B] border-t border-white/[0.06] px-4 py-6 space-y-6 shadow-inner" data-testid={`user-detail-${chatId}`}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <WalletComposition p={p} chatId={chatId} />
        <div className="bg-[#121214] border border-white/[0.06] rounded-lg p-4 space-y-4">
          <Fact label="Orders"><span className="font-mono text-lg font-semibold text-[#FAFAFA]">{p.orders}</span></Fact>
          <Fact label="Total spent"><Money value={p.totalSpent} tone="text-[#00E599]" className="font-mono text-lg font-semibold" /></Fact>
          <Fact label="Joined"><span className="font-mono text-sm text-[#D4D4D8]">{fmtDate(p.joinedAt)}</span></Fact>
        </div>
      </div>
      <div>
        <h5 className="text-sm font-heading font-semibold text-[#FAFAFA] mb-2 flex items-center gap-2">
          <Package className="w-4 h-4 text-[#FFB800]" aria-hidden="true" /> Order History
          <span className="text-[#A1A1AA] font-normal font-mono text-xs">({orders.length})</span>
        </h5>
        <OrdersTable orders={orders} />
      </div>
      <WalletActivity items={tx.filter((t) => t.group !== 'sale')} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Records: Bot Users
// ─────────────────────────────────────────────────────────────
const USER_SORTS = [
  { k: 'joinedAt', label: 'Newest joined' }, { k: 'spent', label: 'Top spenders' }, { k: 'orders', label: 'Most orders' },
  { k: 'balance', label: 'Wallet balance' }, { k: 'lastOrder', label: 'Recent order' },
];

function BalanceTags({ u }) {
  const tags = [];
  if (u.bonusRemaining > 0) tags.push({ k: 'bonus', label: 'Bonus', icon: Gift, color: C.amber, title: `Wallet is unspent promotional credit — ${fmtUsd(u.bonusRemaining)} welcome bonus, no real deposits yet` });
  const plain = u.balance > 0 && u.deposits === 0 && !u.bonusRemaining;
  if (plain && u.refunds > 0) tags.push({ k: 'refund', label: 'Refund', icon: Undo2, color: C.cyan, title: `Balance includes ${fmtUsd(u.refunds)} in refunds` });
  if (plain && u.adjustments !== 0) tags.push({ k: 'adjustment', label: 'Adjusted', icon: Scale, color: C.violet, title: `Balance includes ${fmtUsd(u.adjustments)} in admin adjustments` });
  if (!tags.length) return null;
  return (
    <div className="mt-1 flex items-center justify-end gap-1 flex-wrap">
      {tags.map((t) => (
        <span key={t.k} className={PILL} style={pillStyle(t.color)} title={t.title} data-testid={`${t.k}-tag-${u.chatId}`}>
          <t.icon className="w-3 h-3" aria-hidden="true" />{t.label}
        </span>
      ))}
    </div>
  );
}

function UserRow({ u, isOpen, onToggle, authFetch }) {
  const name = u.name ? `@${u.name}` : `User ${u.chatId}`;
  return (
    <>
      <tr onClick={onToggle} data-testid={`user-row-${u.chatId}`}
        className={`border-b border-white/[0.04] cursor-pointer hover:bg-white/[0.02] transition-colors ${isOpen ? 'bg-white/[0.02]' : ''}`}>
        <td className="py-2 px-2">
          <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(); }} aria-expanded={isOpen}
            aria-controls={`user-detail-${u.chatId}`} aria-label={`${isOpen ? 'Hide' : 'Show'} order history for ${name}`}
            data-testid={`user-expand-${u.chatId}`}
            className={`w-11 h-11 md:w-8 md:h-8 inline-flex items-center justify-center rounded-md text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-white/[0.06] ${FOCUS}`}>
            {isOpen ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
          </button>
        </td>
        <td className="py-3 px-2">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-md bg-[#00C2FF]/10 border border-[#00C2FF]/20 text-[#00C2FF] font-mono text-xs flex items-center justify-center shrink-0 font-medium" aria-hidden="true">
              {(u.name || String(u.chatId)).slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[#FAFAFA]">{name}</div>
              {u.hasPurchased && <div className="font-mono text-xs uppercase tracking-wide text-[#00E599] flex items-center gap-1"><UserCheck className="w-3 h-3" aria-hidden="true" /> Customer</div>}
            </div>
          </div>
        </td>
        <td className="py-3 px-2 font-mono text-xs text-[#D4D4D8]">{u.chatId}</td>
        <td className="py-3 px-2 text-[#D4D4D8] whitespace-nowrap font-mono text-xs">{fmtDate(u.joinedAt)}</td>
        <td className="py-3 px-2 text-[#D4D4D8]"><span className="inline-flex items-center gap-1 text-xs"><Globe className="w-3 h-3 text-[#A1A1AA]" aria-hidden="true" />{LANG_LABEL[u.lang] || u.lang || '—'}</span></td>
        <td className="py-3 px-2 text-right font-mono"><Money value={u.balance} /><BalanceTags u={u} /></td>
        <td className="py-3 px-2 text-right font-mono tabular-nums text-[#D4D4D8]">{u.orders}</td>
        <td className="py-3 px-2 text-right font-mono">{u.totalSpent ? <Money value={u.totalSpent} tone="text-[#00E599]" /> : <span className="text-[#A1A1AA]">—</span>}</td>
        <td className="py-3 px-2 text-[#D4D4D8] whitespace-nowrap font-mono text-xs">{u.lastOrderDate ? fmtDate(u.lastOrderDate) : '—'}</td>
      </tr>
      {isOpen && (
        <tr><td colSpan={9} className="p-0"><UserOrderHistory authFetch={authFetch} chatId={u.chatId} /></td></tr>
      )}
    </>
  );
}

function BotUsers({ authFetch, range, tick }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('joinedAt');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);
  const onSearch = useDebounced((v) => { setPage(1); setSearch(v); });

  useEffect(() => { setPage(1); }, [range]);
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const q = new URLSearchParams({ range, page: String(page), limit: '25', sort, dir: 'desc', search });
        const res = await authFetch(`/users?${q.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load');
        if (alive) setData(json);
      } catch (err) { if (alive) setError(err.message); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [authFetch, range, page, sort, search, tick]);

  const rows = data?.rows || [];
  return (
    <div className={`${CARD} ${PAD}`} data-testid="sales-bot-users">
      <CardTitle icon={Users} color={C.cyan} aside={data && <span className="text-[#A1A1AA] font-mono text-xs" data-testid="user-total">{fmtNum(data.totalUsers)} joined</span>}>Bot Users</CardTitle>
      <FilterBar>
        <SearchField id="user-search" label="Search bot users" placeholder="Search name or chat ID…" onChange={onSearch} testid="user-search" />
        <SelectField id="user-sort" label="Sort bot users" value={sort} onChange={(v) => { setPage(1); setSort(v); }} options={USER_SORTS} testid="user-sort" />
      </FilterBar>
      {error && <div className="text-[#FF3366] text-sm mb-4" role="alert" data-testid="user-error">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[840px]">
          <caption className="sr-only">Bot users — select a row to see order history</caption>
          <thead>
            <tr className={`${TH} border-b border-white/[0.06]`}>
              <th className="w-12 py-3 px-2"><span className="sr-only">Expand</span></th>
              <th className="text-left py-3 px-2">User</th><th className="text-left py-3 px-2">Chat ID</th>
              <th className="text-left py-3 px-2">Joined</th><th className="text-left py-3 px-2">Lang</th>
              <th className="text-right py-3 px-2">Balance</th><th className="text-right py-3 px-2">Orders</th>
              <th className="text-right py-3 px-2">Spent</th><th className="text-left py-3 px-2">Last Order</th>
            </tr>
          </thead>
          <tbody className={loading ? 'opacity-50' : ''} aria-busy={loading}>
            {rows.map((u) => (
              <UserRow key={u.chatId} u={u} authFetch={authFetch} isOpen={expanded === u.chatId}
                onToggle={() => setExpanded(expanded === u.chatId ? null : u.chatId)} />
            ))}
            {data && !rows.length && <tr><td colSpan={9} className="text-center text-[#A1A1AA] py-8">No bot users match your search.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={data?.page} pages={data?.pages} total={data?.total} noun="users" onPage={setPage} testidPrefix="user" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Records: Transactions (+ server-side CSV export)
// ─────────────────────────────────────────────────────────────
const TXN_GROUPS = [
  { k: '', label: 'All types' }, { k: 'sale', label: 'Sales' }, { k: 'deposit', label: 'Deposits' },
  { k: 'bonus', label: 'Bonuses' }, { k: 'refund', label: 'Refunds' }, { k: 'adjustment', label: 'Adjustments' },
];
const STATUS_COLOR = (s) => (s === 'completed' ? C.mint : (s === 'refunded' || s === 'reversed' ? C.rose : C.slate));

function TxnRow({ r }) {
  const st = groupStyle(r.group);
  const isNegative = r.group === 'sale' || r.amountUsd < 0;
  const sign = r.group === 'adjustment' ? (r.amountUsd >= 0 ? '+' : '−') : (isNegative ? '−' : '+');
  return (
    <tr className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
      <td className="py-3 px-2 font-mono text-xs text-[#D4D4D8]">{r.id}</td>
      <td className="py-3 px-2 text-[#D4D4D8] whitespace-nowrap font-mono text-xs">{r.date ? new Date(r.date).toLocaleDateString() : '—'}</td>
      <td className="py-3 px-2">
        <span className="inline-flex items-center gap-2">
          <span className={PILL} style={pillStyle(st.color)} title={st.desc}>{st.label}</span>
          {r.group === 'sale'
            ? <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: colorFor(r.category) }} aria-hidden="true" />{r.category}</span>
            : <span className="text-[#D4D4D8] text-xs">{subgroupLabel(r.subgroup, r.type)}</span>}
        </span>
      </td>
      <td className="py-3 px-2 text-[#D4D4D8] max-w-[200px] truncate">{r.product}</td>
      <td className="py-3 px-2 text-right font-mono tabular-nums" style={{ color: r.group === 'sale' ? '#FAFAFA' : st.color }}>{sign}{fmtUsd(Math.abs(r.amountUsd))}</td>
      <td className="py-3 px-2 text-right font-mono">{r.group === 'sale' ? <Money value={r.profit} tone="text-[#00E599]" /> : <span className="text-[#A1A1AA]">—</span>}</td>
      <td className="py-3 px-2"><span className={PILL} style={pillStyle(STATUS_COLOR(r.status))}>{r.status}</span></td>
    </tr>
  );
}

function Transactions({ authFetch, range, tick, categories }) {
  const [txns, setTxns] = useState(null);
  const [filters, setFilters] = useState({ group: 'sale', category: '', status: '', search: '' });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const setFilter = (k, v) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };
  const onSearch = useDebounced((v) => setFilter('search', v));

  useEffect(() => { setPage(1); }, [range]);
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const q = new URLSearchParams({ range, page: String(page), limit: '25', ...filters });
        const res = await authFetch(`/transactions?${q.toString()}`);
        const json = await res.json();
        if (alive && res.ok) setTxns(json);
      } catch (err) { /* surfaced by the overview banner */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [authFetch, range, page, filters, tick]);

  const exportCsv = async () => {
    setExporting(true); setExportError('');
    try {
      const res = await authFetch(`/export.csv?${new URLSearchParams({ range, ...filters }).toString()}`);
      if (!res.ok) throw new Error('Export failed — please try again');
      downloadBlob(await res.blob(), `${brandSlug}-transactions-${range}.csv`);
    } catch (err) { setExportError(err.message); }
    finally { setExporting(false); }
  };

  const catOptions = [{ k: '', label: 'All categories' }, ...categories.map((c) => ({ k: c.category, label: c.category }))];
  return (
    <div className={`${CARD} ${PAD}`} data-testid="sales-transactions">
      <CardTitle icon={Receipt} aside={
        <button onClick={exportCsv} disabled={exporting} data-testid="sales-export-btn" className={MINT_BTN}>
          <Download className="w-4 h-4" aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      }>Transactions</CardTitle>
      {exportError && <div className="text-[#FF3366] text-sm mb-4" role="alert" data-testid="sales-export-error">{exportError}</div>}
      <FilterBar>
        <SearchField id="txn-search" label="Search transactions" placeholder="Search id, user, product…" onChange={onSearch} testid="txn-search" />
        <SelectField id="txn-group" label="Transaction type" value={filters.group} onChange={(v) => setFilter('group', v)} options={TXN_GROUPS} testid="txn-group" />
        <SelectField id="txn-category" label="Category" value={filters.category} onChange={(v) => setFilter('category', v)} options={catOptions} testid="txn-category" />
      </FilterBar>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <caption className="sr-only">Transactions</caption>
          <thead>
            <tr className={`${TH} border-b border-white/[0.06]`}>
              <th className="text-left py-3 px-2">Transaction</th><th className="text-left py-3 px-2">Date</th>
              <th className="text-left py-3 px-2">Category</th><th className="text-left py-3 px-2">Product</th>
              <th className="text-right py-3 px-2">Amount</th><th className="text-right py-3 px-2">Profit</th>
              <th className="text-left py-3 px-2">Status</th>
            </tr>
          </thead>
          <tbody className={loading ? 'opacity-50' : ''} aria-busy={loading}>
            {(txns?.rows || []).map((r) => <TxnRow key={r.id} r={r} />)}
            {txns && !txns.rows.length && <tr><td colSpan={7} className="text-center text-[#A1A1AA] py-8">No transactions match your filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={txns?.page} pages={txns?.pages} total={txns?.total} noun="transactions" onPage={setPage} testidPrefix="txn" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Tab panels
// ─────────────────────────────────────────────────────────────
function OverviewPanel({ data }) {
  const s = data.summary;
  const d = data.deltas || {};
  const u = data.userStats || {};
  const payout = payoutOf(s);
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="sales-kpis">
        <Kpi icon={DollarSign} label="Gross Revenue" value={<Money value={s.grossRevenue} />} accent="mint" delta={d.grossRevenue} sub="vs prev period" testid="kpi-revenue" />
        <Kpi icon={PiggyBank} label="Profit" value={<Money value={s.netProfit} />} accent="cyan" delta={d.netProfit} sub="revenue − cost" footnote="excludes bonuses" testid="kpi-profit" />
        <Kpi icon={Banknote} label="Eligible Payout" value={<Money value={payout} />} accent="violet" sub="all-time · safe to withdraw" footnote="since first sale · excludes deposits & bonuses" testid="kpi-eligible-payout" />
        <Kpi icon={ShoppingCart} label="Orders" value={fmtNum(s.orders)} accent="amber" delta={d.orders} sub={`AOV ${fmtUsd(s.avgOrderValue)}`} testid="kpi-orders" />
      </div>

      <SectionHeading title="Users & conversion" hint="Joined → deposited → purchased" testid="section-users" />
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <div className="xl:col-span-3"><ConversionFunnel funnel={data.funnel} /></div>
        <StatGrid cols="grid-cols-1 sm:grid-cols-3 xl:grid-cols-1" className="xl:col-span-2" testid="sales-user-kpis">
          <StatCell icon={Users} label="Total Bot Users" value={fmtNum(u.totalUsers)} accent="cyan" sub="joined the bot" testid="kpi-total-users" />
          <StatCell icon={UserPlus} label="New Users" value={fmtNum(u.newUsers)} accent="mint" sub="in selected range" testid="kpi-new-users" />
          <StatCell icon={UserCheck} label="Paying Users" value={fmtNum(u.purchasedUsers)} accent="violet" sub="made a purchase" testid="kpi-paying-users" />
        </StatGrid>
      </div>

      <SectionHeading title="Wallet flow" hint="Customer funds moving in and out — not profit" testid="section-wallet" />
      <StatGrid cols="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" testid="wallet-flow-strip">
        <StatCell icon={Wallet} label="Wallet Deposits" value={fmtUsd(s.deposits)} sub="customer funds — NOT profit/payout" accent="mint" testid="kpi-deposits"
          breakdown={[
            { label: 'Crypto / top-up', value: fmtUsd(s.cashDeposits != null ? s.cashDeposits : ((s.deposits || 0) - (s.adminCredits || 0))), color: C.mint },
            ...(s.adminCredits ? [{ label: 'Admin credit (manual)', value: fmtUsd(s.adminCredits), color: C.violet }] : []),
          ]} />
        <StatCell icon={Gift} label="Promo Credit Issued" value={fmtUsd(promoOf(s))} sub="signup credit · NOT counted in profit" accent="amber" testid="kpi-bonuses"
          breakdown={[
            { label: 'Welcome bonus', value: fmtUsd(s.welcomeBonuses || 0), color: C.amber },
            ...(s.firstDepositBonuses ? [{ label: 'First-deposit bonus', value: fmtUsd(s.firstDepositBonuses), color: C.mint }] : []),
            ...(s.otherBonuses ? [{ label: 'Other bonuses', value: fmtUsd(s.otherBonuses), color: C.slate }] : []),
          ]} />
        <StatCell icon={Undo2} label="Refunds" value={fmtUsd(s.refunds)} sub="returned to users" accent="rose" testid="kpi-refunds" />
        <StatCell icon={Scale} label="Adjustments" value={<Money value={s.adjustments || 0} />} sub="over/under/corrections" accent="violet" testid="kpi-adjustments" />
      </StatGrid>
    </>
  );
}

function TrendsPanel({ data }) {
  const weekly = data.weekly || [];
  return (
    <>
      <div className={`${CARD} ${PAD}`} data-testid="sales-timeseries">
        <CardTitle icon={TrendingUp} aside={<ChartLegend testid="legend-timeseries" items={[{ label: 'Revenue', color: '#FAFAFA' }, { label: 'Profit', color: C.mint }]} />}>Revenue &amp; Profit</CardTitle>
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <AreaChart data={data.timeseries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#FAFAFA" stopOpacity={0.14} /><stop offset="95%" stopColor="#FAFAFA" stopOpacity={0} /></linearGradient>
                <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.mint} stopOpacity={0.3} /><stop offset="95%" stopColor={C.mint} stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={(v) => (v || '').slice(5)} minTickGap={24} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} tickFormatter={fmtAxis} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<TrendTooltip />} />
              <Area type="monotone" dataKey="revenue" stroke="#FAFAFA" strokeWidth={1.5} fill="url(#gRev)" />
              <Area type="monotone" dataKey="netProfit" stroke={C.mint} strokeWidth={2} fill="url(#gProfit)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={`${CARD} ${PAD}`} data-testid="sales-weekly">
        <CardTitle icon={BarChart3} className="mb-2" aside={<ChartLegend testid="legend-weekly" items={[
          { label: 'Profit week', color: C.mint, icon: TrendingUp },
          { label: 'Loss week', color: C.rose, icon: TrendingDown, swatch: LOSS_STRIPE },
        ]} />}>Weekly Profit</CardTitle>
        <p className="text-xs text-[#A1A1AA] mb-4">Revenue − cost · excludes bonuses · loss weeks are striped</p>
        {weekly.length ? (
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={weekly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <pattern id="lossStripe" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill={C.rose} fillOpacity="0.3" />
                    <rect width="3" height="6" fill={C.rose} />
                  </pattern>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} minTickGap={12} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={AXIS_TICK} tickFormatter={fmtAxis} axisLine={false} tickLine={false} width={56} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={<WeeklyTooltip />} />
                <Bar dataKey="netProfit" radius={[4, 4, 0, 0]} maxBarSize={48}>
                  {weekly.map((w, i) => <Cell key={i} fill={(w.netProfit || 0) < 0 ? 'url(#lossStripe)' : C.mint} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-[#A1A1AA] text-sm py-12 text-center">No weekly data in this period.</div>
        )}
      </div>
    </>
  );
}

function CategoryCards({ cats }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className={`lg:col-span-3 ${CARD} ${PAD}`} data-testid="sales-by-category">
        <CardTitle icon={Layers} color={C.violet}>Profit by Category</CardTitle>
        {cats.length ? (
          <div style={{ width: '100%', height: Math.max(240, cats.length * 40) }}>
            <ResponsiveContainer>
              <BarChart data={cats} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} tickFormatter={fmtAxis} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="category" tick={{ fill: '#D4D4D8', fontSize: 12 }} width={112} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={<CategoryTooltip />} />
                <Bar dataKey="profit" radius={[0, 4, 4, 0]} barSize={16}>
                  {cats.map((c) => <Cell key={c.category} fill={colorFor(c.category)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="text-[#A1A1AA] text-sm py-12 text-center">No sales in this period.</div>}
      </div>
      <div className={`lg:col-span-2 ${CARD} ${PAD}`} data-testid="sales-category-detail">
        <CardTitle icon={Receipt} color={C.violet}>Category Detail</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[320px]">
            <caption className="sr-only">Revenue, profit and orders by category</caption>
            <thead>
              <tr className={`${TH} border-b border-white/[0.06]`}>
                <th className="text-left py-2 px-2">Category</th><th className="text-right py-2 px-2">Revenue</th>
                <th className="text-right py-2 px-2">Profit</th><th className="text-right py-2 px-2">Orders</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.category} className="border-b border-white/[0.04] last:border-0">
                  <td className="py-2 px-2"><span className="inline-flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: colorFor(c.category) }} aria-hidden="true" />{c.category}</span></td>
                  <td className="text-right font-mono py-2 px-2"><Money value={c.revenue} digits={0} /></td>
                  <td className="text-right font-mono py-2 px-2"><Money value={c.profit} digits={0} tone="text-[#00E599]" /></td>
                  <td className="text-right font-mono tabular-nums py-2 px-2 text-[#D4D4D8]">{c.orders}</td>
                </tr>
              ))}
              {!cats.length && <tr><td colSpan={4} className="text-center text-[#A1A1AA] py-8">No sales in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function WaterfallRow({ icon: Icon, color, label, value, strong }) {
  return (
    <div className={`flex items-center justify-between gap-4 ${strong ? 'border-t border-white/[0.08] pt-4' : ''}`}>
      <span className={`flex items-center gap-2 ${strong ? 'text-[#FAFAFA]' : 'text-[#D4D4D8]'}`}>
        {Icon && <Icon className="w-4 h-4" style={{ color }} aria-hidden="true" />}{label}
      </span>
      <span className={`tabular-nums ${strong ? 'font-semibold' : ''}`} style={{ color: color || '#FAFAFA' }}>{value}</span>
    </div>
  );
}

function PricingCards({ data }) {
  const s = data.summary;
  const tiers = data.byTier || [];
  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4" data-testid="sales-pricing">
      <div className={`${CARD} xl:col-span-2 ${PAD}`} data-testid="revenue-waterfall">
        <CardTitle icon={Percent}>Revenue after Discounts</CardTitle>
        <div className="space-y-4 font-mono text-sm">
          <WaterfallRow label="List sales" value={fmtUsd(s.grossListSales || 0)} />
          <WaterfallRow icon={Award} color={C.violet} label="Loyalty discounts" value={`−${fmtUsd(s.loyaltyDiscounts || 0)}`} />
          <WaterfallRow icon={Tag} color={C.amber} label="Coupon discounts" value={`−${fmtUsd(s.couponDiscounts || 0)}`} />
          {s.upgradeCredits > 0 && <WaterfallRow icon={Tag} color={C.amber} label="Upgrade credits" value={`−${fmtUsd(s.upgradeCredits)}`} />}
          <WaterfallRow strong color={C.mint} label="Net revenue" value={fmtUsd(s.grossRevenue || 0)} />
        </div>
        <p className="text-[#A1A1AA] text-xs mt-4 leading-relaxed">Discounts come out of profit — supplier cost is based on the full list price.</p>
      </div>
      <div className={`${CARD} xl:col-span-3 ${PAD}`} data-testid="sales-by-tier">
        <CardTitle icon={Users}>Sales by Membership Tier</CardTitle>
        {tiers.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono min-w-[440px]">
              <caption className="sr-only">Sales by membership tier</caption>
              <thead>
                <tr className={TH}>
                  <th className="text-left py-2">Tier</th><th className="text-right py-2">Orders</th><th className="text-right py-2">Net Rev</th>
                  <th className="text-right py-2">Discount</th><th className="text-right py-2">Profit</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((tr) => (
                  <tr key={tr.tier} className="border-t border-white/[0.06]">
                    <td className="py-2 text-[#FAFAFA]"><span className="inline-flex items-center gap-2"><Award className="w-4 h-4" style={{ color: TIER_COLOR[tr.tier] || C.slate }} aria-hidden="true" />{tr.tierName}</span></td>
                    <td className="py-2 text-right text-[#D4D4D8] tabular-nums">{tr.orders}</td>
                    <td className="py-2 text-right"><Money value={tr.revenue} /></td>
                    <td className="py-2 text-right text-[#A78BFA] tabular-nums">{tr.discount > 0 ? '−' + fmtUsd(tr.discount) : '—'}</td>
                    <td className="py-2 text-right"><Money value={tr.profit} tone="text-[#00E599]" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-[#A1A1AA] text-sm py-8 text-center">No sales yet — tier &amp; discount breakdown appears once customers start buying.</div>
        )}
      </div>
    </div>
  );
}

function TopList({ title, icon, color, items, empty, testid, render }) {
  return (
    <div className={`${CARD} ${PAD}`} data-testid={testid}>
      <CardTitle icon={icon} color={color}>{title}</CardTitle>
      <ol className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-center justify-between gap-4 py-2 border-b border-white/[0.04] last:border-0">
            {render(it, i)}
            <div className="text-right shrink-0 font-mono text-sm">
              <div><Money value={it.revenue} /></div>
              <div className="text-xs"><Money value={it.profit} tone="text-[#00E599]" /></div>
            </div>
          </li>
        ))}
      </ol>
      {!items.length && <div className="text-[#A1A1AA] text-sm py-4">{empty}</div>}
    </div>
  );
}

const Rank = ({ i }) => <span className="w-8 h-8 rounded-md bg-white/[0.04] border border-white/[0.06] font-mono text-xs flex items-center justify-center text-[#D4D4D8] shrink-0" aria-hidden="true">{i + 1}</span>;

function BreakdownPanel({ data }) {
  return (
    <>
      <SectionHeading title="By category" hint="Where profit comes from" testid="section-category" />
      <CategoryCards cats={data.byCategory || []} />
      <SectionHeading title="Pricing & membership" hint="Discounts and loyalty tiers" testid="section-pricing" />
      <PricingCards data={data} />
      <SectionHeading title="Top sellers" hint="Best products and customers in this period" testid="section-top" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopList title="Top Products" icon={Package} color={C.amber} items={data.topProducts || []} empty="No sales in this period." testid="sales-top-products"
          render={(p, i) => (
            <div className="min-w-0 flex items-center gap-2"><Rank i={i} />
              <div className="min-w-0"><div className="truncate text-sm">{p.product}</div><div className="text-xs text-[#A1A1AA]">{p.category} · {p.orders} orders</div></div>
            </div>
          )} />
        <TopList title="Top Customers" icon={Users} color={C.cyan} items={data.topCustomers || []} empty="No customers in this period." testid="sales-top-customers"
          render={(c, i) => (
            <div className="min-w-0 flex items-center gap-2"><Rank i={i} />
              <div className="min-w-0"><div className="truncate text-sm">{c.name || `User ${c.chatId}`}</div><div className="text-xs text-[#A1A1AA]">{c.orders} orders</div></div>
            </div>
          )} />
      </div>
    </>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-4" data-testid="sales-loading" aria-busy="true" aria-label="Loading sales data">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${CARD} h-32 animate-pulse`} />)}
      </div>
      <div className={`${CARD} h-72 animate-pulse`} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Header, tabs and range controls
// ─────────────────────────────────────────────────────────────
function DesktopTabs({ tab, onTab }) {
  return (
    <div role="tablist" aria-label="Dashboard sections" className="flex items-center gap-1">
      {TABS.map((t) => {
        const on = t.k === tab;
        return (
          <button key={t.k} role="tab" id={`tab-${t.k}`} aria-selected={on} aria-controls={`panel-${t.k}`}
            onClick={() => onTab(t.k)} data-testid={`tab-${t.k}`}
            className={`relative inline-flex items-center gap-2 h-14 px-4 text-sm font-medium transition-colors ${FOCUS} ${on ? 'text-[#FAFAFA]' : 'text-[#A1A1AA] hover:text-[#FAFAFA]'}`}>
            <t.icon className="w-4 h-4" style={on ? { color: C.mint } : undefined} aria-hidden="true" /> {t.label}
            <span className={`absolute left-4 right-4 bottom-0 h-0.5 rounded-full bg-[#00E599] transition-opacity ${on ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

function MobileTabBar({ tab, onTab }) {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#09090B]/95 backdrop-blur-xl border-t border-white/[0.08] pb-[env(safe-area-inset-bottom)]" aria-label="Dashboard sections" data-testid="mobile-tab-bar">
      <div role="tablist" className="grid grid-cols-4">
        {TABS.map((t) => {
          const on = t.k === tab;
          return (
            <button key={t.k} role="tab" aria-selected={on} aria-controls={`panel-${t.k}`} onClick={() => onTab(t.k)} data-testid={`mobile-tab-${t.k}`}
              className={`relative flex flex-col items-center justify-center gap-1 h-16 text-xs font-medium transition-colors ${FOCUS} ${on ? 'text-[#00E599]' : 'text-[#A1A1AA]'}`}>
              <span className={`absolute top-0 left-1/4 right-1/4 h-0.5 rounded-full ${on ? 'bg-[#00E599]' : 'bg-transparent'}`} aria-hidden="true" />
              <t.icon className="w-5 h-5" aria-hidden="true" /> {t.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function RangeSegmented({ range, onRange }) {
  return (
    <div role="group" aria-label="Date range" className="inline-flex items-center gap-1 p-1 bg-[#121214] border border-white/[0.06] rounded-lg" data-testid="sales-range-selector">
      {RANGES.map((r) => {
        const on = range === r.k;
        return (
          <button key={r.k} onClick={() => onRange(r.k)} aria-pressed={on} data-testid={`range-${r.k}`}
            className={`h-8 px-3 rounded-md font-mono text-xs whitespace-nowrap transition-colors ${FOCUS} ${on ? 'bg-[#FAFAFA] text-[#09090B] font-semibold' : 'text-[#D4D4D8] hover:text-[#FAFAFA] hover:bg-white/[0.04]'}`}>
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

function RangeSelect({ range, onRange }) {
  return (
    <>
      <label htmlFor="range-select" className="sr-only">Date range</label>
      <select id="range-select" value={range} onChange={(e) => onRange(e.target.value)} data-testid="range-select-mobile"
        className={`w-[120px] px-3 font-mono text-xs ${INPUT}`}>
        {RANGES.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}
      </select>
    </>
  );
}

function Header({ tab, onTab, range, onRange, onRefresh, onLogout, loading }) {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-2xl bg-[#09090B]/85 border-b border-white/[0.06]" data-testid="sales-header">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-2">
        <div className="flex items-center gap-4 min-w-0">
          <div className="hidden sm:flex w-10 h-10 rounded-lg bg-[#00E599] items-center justify-center shrink-0">
            <DollarSign className="w-5 h-5 text-[#09090B]" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="font-heading text-base font-bold tracking-tight leading-tight truncate">Sales &amp; Profit</h1>
            <p className="font-mono text-xs text-[#A1A1AA] leading-tight truncate" data-testid="sales-brand-name">{BRAND.name}<span className="hidden sm:inline"> · {BRAND.tagline}</span></p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="lg:hidden"><RangeSelect range={range} onRange={onRange} /></div>
          <a href="/" data-testid="sales-admin-home-link" className={`hidden md:inline-flex items-center h-10 px-4 rounded-lg text-sm text-[#D4D4D8] hover:text-[#FAFAFA] hover:bg-white/[0.04] transition-colors ${FOCUS}`}>Admin Home</a>
          <button onClick={onRefresh} data-testid="sales-refresh-btn" aria-label="Refresh data" className={ICON_BTN}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /><span className="hidden md:inline">Refresh</span>
          </button>
          <button onClick={onLogout} data-testid="sales-logout-btn" aria-label="Log out" className={`${ICON_BTN} hover:!text-[#FF3366] hover:border-[#FF3366]/30`}>
            <LogOut className="w-4 h-4" aria-hidden="true" /><span className="hidden md:inline">Logout</span>
          </button>
        </div>
      </div>
      <div className="hidden md:block border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-4">
          <DesktopTabs tab={tab} onTab={onTab} />
          <div className="hidden lg:block"><RangeSegmented range={range} onRange={onRange} /></div>
        </div>
      </div>
    </header>
  );
}

function PanelHeader({ tab, range, lastUpdated, loading, action }) {
  const t = TABS.find((x) => x.k === tab);
  return (
    <div className="flex items-start sm:items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="font-heading text-xl sm:text-2xl font-bold tracking-tight" data-testid="sales-panel-title">{t.label}</h2>
        <p className="text-sm text-[#A1A1AA] mt-1" data-testid="sales-updated-at">
          {rangeLong(range)}{lastUpdated && ` · Updated ${lastUpdated.toLocaleTimeString()}`}{loading && ' · refreshing…'}
        </p>
      </div>
      {action}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main dashboard
// ─────────────────────────────────────────────────────────────
const initialTab = () => { const h = window.location.hash.replace('#', ''); return TABS.some((t) => t.k === h) ? h : 'overview'; };
const initialRange = () => { const r = sessionStorage.getItem('salesRange'); return RANGES.some((x) => x.k === r) ? r : '30d'; };

function Dashboard({ token, onLogout }) {
  const [tab, setTab] = useState(initialTab);
  const [range, setRange] = useState(initialRange);
  const [tick, setTick] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const authFetch = useCallback(async (path) => {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { onLogout(); throw new Error('Session expired — please log in again'); }
    return res;
  }, [token, onLogout]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const res = await authFetch(`/overview?range=${range}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load');
        if (alive) { setData(json); setLastUpdated(new Date()); }
      } catch (err) { if (alive) setError(err.message); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [authFetch, range, tick]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const changeTab = (k) => {
    setTab(k);
    window.history.replaceState(null, '', `#${k}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const changeRange = (k) => { setRange(k); sessionStorage.setItem('salesRange', k); };
  const refresh = () => setTick((t) => t + 1);
  const exportSummary = () => downloadBlob(new Blob([summaryCsv(data, range)], { type: 'text/csv;charset=utf-8' }), `${brandSlug}-sales-summary-${range}.csv`);

  const summaryAction = data && tab !== 'records' ? (
    <button onClick={exportSummary} data-testid="sales-export-summary-btn" aria-label="Export summary CSV" className={`${GHOST_BTN} w-11 px-0 sm:w-auto sm:px-4`}>
      <FileSpreadsheet className="w-4 h-4" aria-hidden="true" /><span className="hidden sm:inline">Export summary</span>
    </button>
  ) : null;

  let body = null;
  if (tab === 'records') {
    body = (
      <>
        <BotUsers authFetch={authFetch} range={range} tick={tick} />
        <Transactions authFetch={authFetch} range={range} tick={tick} categories={data?.byCategory || []} />
      </>
    );
  } else if (loading && !data) {
    body = <PanelSkeleton />;
  } else if (data?.summary) {
    const Panel = { overview: OverviewPanel, trends: TrendsPanel, breakdown: BreakdownPanel }[tab];
    body = <Panel data={data} />;
  }

  return (
    <div className="app-root min-h-screen bg-[#09090B] text-[#FAFAFA]">
      <div className="grain-overlay" aria-hidden="true" />
      <Header tab={tab} onTab={changeTab} range={range} onRange={changeRange} onRefresh={refresh} onLogout={onLogout} loading={loading} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-24 md:pb-12">
        <section key={tab} id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} data-testid={`panel-${tab}`}
          className="space-y-6 animate-in fade-in duration-300">
          <PanelHeader tab={tab} range={range} lastUpdated={lastUpdated} loading={loading && !!data} action={summaryAction} />
          {error && <div className="bg-[#FF3366]/10 border border-[#FF3366]/25 text-[#FF3366] rounded-xl px-4 py-3 text-sm" role="alert" data-testid="sales-error">{error}</div>}
          {body}
        </section>
      </main>
      <MobileTabBar tab={tab} onTab={changeTab} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
export default function SalesDashboard() {
  const [token, setToken] = useState(() => localStorage.getItem('salesToken'));
  useEffect(() => { document.title = `${BRAND.name} — Sales & Profit`; }, []);
  const logout = useCallback(() => { localStorage.removeItem('salesToken'); setToken(null); }, []);
  if (!token) return <Login onLogin={setToken} />;
  return <Dashboard token={token} onLogout={logout} />;
}
