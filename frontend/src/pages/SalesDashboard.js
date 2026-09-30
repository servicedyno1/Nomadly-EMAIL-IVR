import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';
import {
  TrendingUp, TrendingDown, DollarSign, PiggyBank, CalendarDays, ShoppingCart,
  Receipt, RefreshCw, LogOut, Download, Search, Wallet, Gift, BarChart3,
  Layers, Users, Package, Lock, UserPlus, UserCheck, ChevronDown, ChevronRight,
  Globe, Filter, Scale, Undo2, ShieldCheck, MinusCircle, Percent, Tag, Award, Banknote,
} from 'lucide-react';
import { BRAND, brandSlug } from '../branding';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';
const API = `${BACKEND_URL}/api/admin/sales`;

const RANGES = [
  { k: 'today', label: 'Today' },
  { k: '7d', label: '7 Days' },
  { k: '30d', label: '30 Days' },
  { k: '90d', label: '90 Days' },
  { k: '1y', label: '1 Year' },
  { k: 'all', label: 'All Time' },
];

const CAT_COLORS = {
  Domains: '#00E599', Hosting: '#00C2FF', VPS: '#A78BFA', 'Cloud Phone': '#FFB800',
  Calls: '#F472B6', SMS: '#22D3EE', 'Digital Products': '#FF8A3D', Subscriptions: '#B4F461',
  Leads: '#E879F9', Marketplace: '#60A5FA', Other: '#71717A',
};
const colorFor = (c) => CAT_COLORS[c] || '#71717A';

const fmtUsd = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUsd0 = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtNum = (n) => (Number(n) || 0).toLocaleString('en-US');

// shared recipe classes (Obsidian & Electric Mint)
const CARD = 'bg-[#121214] border border-white/[0.06] rounded-xl';
const INPUT = 'bg-[#09090B] border border-white/[0.08] rounded-lg text-sm text-[#FAFAFA] placeholder-[#71717A] focus:outline-none focus:border-[#00E599]/70 focus:ring-1 focus:ring-[#00E599]/40 transition-colors';
const TH = 'text-[11px] text-[#71717A] uppercase tracking-[0.1em] font-semibold';
const GHOST_BTN = 'inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-white/[0.08] bg-[#121214] text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-[#18181B] transition-colors';

function Eyebrow({ children }) {
  return (
    <div className="flex items-center gap-4 pt-2">
      <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#71717A]">{children}</span>
      <span className="h-px flex-1 bg-white/[0.06]" />
    </div>
  );
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
      <form
        onSubmit={submit}
        className="w-full max-w-md p-8 sm:p-10 bg-[#121214] border border-white/[0.08] rounded-2xl shadow-[0_0_60px_rgba(0,229,153,0.05)] animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both"
      >
        <div className="w-11 h-11 rounded-xl bg-[#00E599]/10 border border-[#00E599]/20 flex items-center justify-center mb-6">
          <Lock className="w-5 h-5 text-[#00E599]" />
        </div>
        <h1 className="font-heading text-2xl font-bold text-[#FAFAFA] tracking-tight">Sales &amp; Profit</h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[#71717A] mt-1.5 mb-8">{BRAND.name} · Admin Analytics</p>

        <label className="block text-[#A1A1AA] text-xs uppercase tracking-[0.08em] font-medium mb-2">Dashboard password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          data-testid="sales-password-input"
          className={`w-full px-4 py-3 font-mono ${INPUT}`}
          placeholder="••••••••••"
        />
        {error && <p className="text-[#FF3366] text-sm mt-3" data-testid="sales-login-error">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password}
          data-testid="sales-login-btn"
          className="mt-6 w-full bg-[#FAFAFA] text-[#09090B] font-heading font-bold rounded-lg py-3 hover:bg-[#E4E4E7] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// KPI card
// ─────────────────────────────────────────────────────────────
const KPI_TINTS = {
  mint: 'text-[#00E599]',
  cyan: 'text-[#00C2FF]',
  violet: 'text-[#A78BFA]',
  amber: 'text-[#FFB800]',
  rose: 'text-[#FF3366]',
  slate: 'text-[#A1A1AA]',
};

function Kpi({ icon: Icon, label, value, accent = 'mint', delta, sub, testid, footnote, valueClassName }) {
  return (
    <div className={`${CARD} p-5 hover:border-white/[0.14] transition-colors duration-300`} data-testid={testid}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] text-[#A1A1AA] font-medium uppercase tracking-[0.08em]">{label}</span>
        <Icon className={`w-4 h-4 ${KPI_TINTS[accent]} opacity-80`} />
      </div>
      <div className={`font-mono text-2xl lg:text-[26px] font-semibold tracking-tight ${valueClassName || 'text-[#FAFAFA]'}`}>{value}</div>
      <div className="flex items-center gap-2 mt-2.5 min-h-[20px]">
        {delta != null && (
          <span className={`inline-flex items-center gap-1 font-mono text-[11px] font-medium px-1.5 py-0.5 rounded ${delta >= 0 ? 'text-[#00E599] bg-[#00E599]/10' : 'text-[#FF3366] bg-[#FF3366]/10'}`}>
            {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(delta)}%
          </span>
        )}
        {sub && <span className="text-[#71717A] text-xs">{sub}</span>}
      </div>
      {footnote && (
        <div className="mt-1.5 text-[#71717A] font-mono text-[10.5px]" data-testid={testid ? `${testid}-footnote` : undefined}>
          {footnote}
        </div>
      )}
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, sub, accent = 'slate', testid, breakdown }) {
  return (
    <div className="p-5 flex flex-col gap-1.5" data-testid={testid}>
      <span className="flex items-center gap-2 text-[11px] text-[#A1A1AA] font-medium uppercase tracking-[0.08em]">
        <Icon className={`w-3.5 h-3.5 ${KPI_TINTS[accent]}`} /> {label}
      </span>
      <span className="font-mono text-lg font-semibold text-[#FAFAFA]">{value}</span>
      {sub && <span className="text-[#71717A] text-xs">{sub}</span>}
      {breakdown && breakdown.length > 0 && (
        <div className="mt-1 space-y-0.5" data-testid={testid ? `${testid}-breakdown` : undefined}>
          {breakdown.map((b) => (
            <div key={b.label} className="flex items-center justify-between gap-2 text-[10.5px] font-mono">
              <span className="text-[#71717A] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: b.color || '#71717A' }} /> {b.label}
              </span>
              <span className="text-[#A1A1AA] tabular-nums">{b.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TOOLTIP_BOX = 'bg-[#121214]/95 backdrop-blur-xl border border-white/[0.1] rounded-lg shadow-2xl px-3.5 py-2.5 text-xs font-mono';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const wb = d && d.welcomeBonuses ? d.welcomeBonuses : 0;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="text-[#A1A1AA] mb-1.5 font-medium">{label}</div>
      {payload.map((p) => {
        const nice = p.dataKey === 'netProfit' ? 'profit' : p.dataKey;
        const neg = (p.value ?? 0) < 0;
        return (
          <div key={p.dataKey} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-[#71717A] capitalize">{nice}:</span>
            <span className={`font-medium ${neg ? 'text-[#FF3366]' : 'text-[#FAFAFA]'}`}>{fmtUsd(p.value)}</span>
          </div>
        );
      })}
      {wb > 0 && (
        <div className="text-[#71717A] mt-0.5 text-[10.5px]">+ {fmtUsd(wb)} promo credit issued · not in profit</div>
      )}
    </div>
  );
}

function CategoryTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="text-[#FAFAFA] font-medium mb-1">{d.category}</div>
      <div className="text-[#71717A]">Revenue: <span className="text-[#FAFAFA]">{fmtUsd(d.revenue)}</span></div>
      <div className="text-[#71717A]">Profit: <span className="text-[#00E599]">{fmtUsd(d.profit)}</span></div>
      <div className="text-[#71717A]">Orders: <span className="text-[#FAFAFA]">{d.orders}</span></div>
    </div>
  );
}

function WeeklyTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const wb = d.welcomeBonuses || 0;
  const net = d.netProfit != null ? d.netProfit : d.profit;
  const negative = net < 0;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="text-[#FAFAFA] font-medium mb-1">{d.label}</div>
      <div className="text-[#71717A]">Profit: <span className={negative ? 'text-[#FF3366]' : 'text-[#00E599]'}>{fmtUsd(net)}</span></div>
      <div className="text-[#71717A]">Revenue: <span className="text-[#FAFAFA]">{fmtUsd(d.revenue)}</span></div>
      <div className="text-[#71717A]">Orders: <span className="text-[#FAFAFA]">{d.orders}</span></div>
      {wb > 0 && (
        <div className="text-[#71717A] mt-0.5 text-[10.5px]">+ {fmtUsd(wb)} promo credit issued · not in profit</div>
      )}
    </div>
  );
}

const AXIS_TICK = { fill: '#71717A', fontSize: 11, fontFamily: 'JetBrains Mono' };
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const LANG_LABEL = { en: 'English', fr: 'French', zh: 'Chinese', hi: 'Hindi' };

// Colour + label + sign hint for every wallet-activity group/subgroup, so
// deposits, bonuses, refunds and adjustments read at a glance in both the
// per-user Wallet Activity list and the composition panel.
const GROUP_STYLE = {
  sale:       { color: '#FF3366', label: 'Sale',       sign: '−', desc: 'Product purchase — money leaving the wallet' },
  deposit:    { color: '#00E599', label: 'Deposit',    sign: '+', desc: 'Real funds the user added to their wallet' },
  bonus:      { color: '#FFB800', label: 'Bonus',      sign: '+', desc: 'Free promotional credit — cannot be withdrawn' },
  refund:     { color: '#00C2FF', label: 'Refund',     sign: '+', desc: 'Money returned to the user for a failed / cancelled service' },
  adjustment: { color: '#A78BFA', label: 'Adjustment', sign: '±', desc: 'Manual correction — over/underpayment credit, savings, etc.' },
};
const SUBGROUP_LABEL = {
  welcome:            'Welcome bonus',
  'admin-credit':     'Admin credit',
  'first-deposit':    'First-deposit bonus',
  'other-bonus':      'Other bonus',
  overpayment:        'Overpayment credit',
  underpayment:       'Underpayment credit',
  savings:            'Savings credit',
  correction:         'Correction',
  'other-adjustment': 'Adjustment',
  'refund-reversal':  'Refund reversal',
  'domain-refund':    'Domain refund',
  'admin-refund':     'Admin refund',
  refund:             'Refund',
  crypto:             'Crypto deposit',
  topup:              'Wallet top-up',
  deposit:            'Deposit',
};
const groupStyle = (g) => GROUP_STYLE[g] || { color: '#71717A', label: g || 'other', sign: '', desc: '' };
const subgroupLabel = (sg, type) => SUBGROUP_LABEL[sg] || (type || sg || 'other');
const TIER_BADGE = { bronze: '🥉', silver: '🥈', gold: '🥇', platinum: '💎' };

// ─────────────────────────────────────────────────────────────
// Conversion funnel — joined → deposited → purchased (where users drop off)
// ─────────────────────────────────────────────────────────────
function ConversionFunnel({ funnel }) {
  if (!funnel) return null;
  const { joined = 0, deposited = 0, purchased = 0 } = funnel;
  const stages = [
    { key: 'joined', label: 'Joined the bot', count: joined, icon: Users, color: '#00C2FF', text: 'text-[#00C2FF]', sub: 'received welcome bonus' },
    { key: 'deposited', label: 'Deposited funds', count: deposited, icon: Wallet, color: '#FFB800', text: 'text-[#FFB800]', sub: 'funded their wallet' },
    { key: 'purchased', label: 'Made a purchase', count: purchased, icon: ShoppingCart, color: '#00E599', text: 'text-[#00E599]', sub: 'bought a product' },
  ];
  const pct = (n) => (joined > 0 ? Math.round((n / joined) * 1000) / 10 : 0);

  return (
    <div className={`${CARD} p-5 sm:p-6 h-full`} data-testid="sales-funnel">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-5">
        <h2 className="font-heading font-semibold tracking-tight flex items-center gap-2">
          <Filter className="w-4 h-4 text-[#00E599]" /> Conversion Funnel
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#71717A]">Joined → Deposited → Purchased</span>
      </div>
      <div className="space-y-5">
        {stages.map((s, i) => {
          const p = pct(s.count);
          const prev = i > 0 ? stages[i - 1].count : null;
          const stepConv = i === 0 ? null : (prev > 0 ? Math.round((s.count / prev) * 1000) / 10 : 0);
          const Icon = s.icon;
          return (
            <div key={s.key} data-testid={`funnel-stage-${s.key}`}>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="flex items-center gap-2 text-[#A1A1AA]">
                  <Icon className={`w-4 h-4 ${s.text}`} /> {s.label}
                  <span className="text-[#71717A] text-xs hidden sm:inline">· {s.sub}</span>
                </span>
                <span className="font-mono tabular-nums text-[#71717A] text-xs">
                  <span className={`text-sm font-semibold ${s.text}`} data-testid={`funnel-count-${s.key}`}>{fmtNum(s.count)}</span> · {p}%
                </span>
              </div>
              <div className="relative w-full h-9 bg-[#1F1F22] rounded-md overflow-hidden">
                <div
                  className="absolute left-0 top-0 h-full rounded-md transition-all duration-1000 ease-out"
                  style={{ width: `${s.count > 0 ? Math.max(p, 3) : 0}%`, background: s.color, opacity: 0.9 }}
                />
              </div>
              {i > 0 && (
                <div className="font-mono text-[11px] mt-2 pl-0.5 flex items-center gap-2">
                  <span className="text-[#00E599]/90">{stepConv}% continued</span>
                  <span className="text-[#3F3F46]">·</span>
                  <span className="text-[#FF3366]/90 flex items-center gap-0.5">
                    <TrendingDown className="w-3 h-3" />{Math.round((100 - stepConv) * 10) / 10}% dropped off
                  </span>
                  <span className="text-[#71717A] hidden sm:inline">from {stages[i - 1].label.toLowerCase()}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {joined === 0 && <div className="text-[#71717A] text-sm mt-4">No users joined in this period.</div>}
    </div>
  );
}

const USER_SORTS = [
  { k: 'joinedAt', label: 'Newest joined' },
  { k: 'spent', label: 'Top spenders' },
  { k: 'orders', label: 'Most orders' },
  { k: 'balance', label: 'Wallet balance' },
  { k: 'lastOrder', label: 'Recent order' },
];

// ─────────────────────────────────────────────────────────────
// Expanded per-user order history (drill-down)
// ─────────────────────────────────────────────────────────────
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

  if (loading) return <div className="text-[#71717A] text-sm py-4 px-4 font-mono">Loading order history…</div>;
  if (error) return <div className="text-[#FF3366] text-sm py-4 px-4">{error}</div>;
  if (!detail) return null;

  const p = detail.profile || {};
  const orders = (detail.transactions || []).filter((t) => t.group === 'sale');
  const other = (detail.transactions || []).filter((t) => t.group !== 'sale');

  // Wallet composition breakdown — money that flowed in vs out. Explains why
  // the current balance is what it is (deposits + bonuses + refunds + adjustments − spent).
  const walletRows = [
    { key: 'deposits',    label: 'Deposits',            value: p.deposits,    color: GROUP_STYLE.deposit.color,    sign: '+', hint: 'Real funds the user added (crypto, top-up, admin credit)',
      sub: [
        { label: 'Crypto / top-up',       value: (p.deposits || 0) - (p.adminCredit || 0) },
        { label: 'Admin credit (manual)', value: p.adminCredit || 0 },
      ].filter((s) => s.value > 0),
    },
    { key: 'bonuses',     label: 'Bonuses',             value: p.bonuses,     color: GROUP_STYLE.bonus.color,      sign: '+', hint: 'Promotional store credit — not counted in profit',
      sub: [
        { label: 'Welcome bonus',        value: p.welcomeBonus || 0 },
        { label: 'First-deposit bonus',  value: p.firstDepositBonus || 0 },
        { label: 'Other bonus',          value: p.otherBonus || 0 },
      ].filter((s) => s.value > 0),
    },
    { key: 'refunds',     label: 'Refunds received',    value: p.refunds,     color: GROUP_STYLE.refund.color,     sign: '+', hint: 'Money returned for failed / cancelled services' },
    { key: 'adjustments', label: 'Adjustments',         value: p.adjustments, color: GROUP_STYLE.adjustment.color, sign: '±', hint: 'Manual corrections (overpayment credit, savings, etc.)' },
    { key: 'spent',       label: 'Total spent',         value: p.totalSpent,  color: '#FF3366',                    sign: '−', hint: 'Product purchases — money leaving the wallet' },
  ];
  // status pills — instantly communicates "what kind of wallet is this?"
  const statusPills = [];
  if (p.bonusRemaining > 0) statusPills.push({ label: 'Bonus-only wallet', color: '#FFB800', icon: Gift });
  if (p.deposits > 0)       statusPills.push({ label: 'Real depositor', color: '#00E599', icon: ShieldCheck });
  if (p.refunds > 0)        statusPills.push({ label: 'Has refunds', color: '#00C2FF', icon: Undo2 });
  if (p.adjustments !== 0)  statusPills.push({ label: 'Manually adjusted', color: '#A78BFA', icon: Scale });
  if (p.balance < 0)        statusPills.push({ label: 'Negative balance', color: '#FF3366', icon: MinusCircle });

  return (
    <div className="bg-[#09090B] border-t border-white/[0.06] px-4 py-5 space-y-5 shadow-inner" data-testid={`user-detail-${chatId}`}>
      {/* Wallet composition — Balance + full component breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* balance headline (2/3 width on desktop) */}
        <div className="lg:col-span-2 bg-[#121214] border border-white/[0.05] rounded-lg p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[#71717A] text-[10px] uppercase tracking-[0.08em] font-medium">Wallet Balance</div>
              <div className={`font-mono text-2xl font-semibold tabular-nums mt-1 ${p.balance < 0 ? 'text-[#FF3366]' : 'text-[#FAFAFA]'}`}>{fmtUsd(p.balance)}</div>
              {p.bonusRemaining > 0 && (
                <div className="mt-1.5 flex items-center gap-1 font-mono text-[11px] text-[#FFB800]" data-testid={`bonus-note-${chatId}`}>
                  <Gift className="w-3 h-3" />
                  <span>incl. {fmtUsd(p.bonusRemaining)} welcome bonus (unspent)</span>
                </div>
              )}
              {p.bonusRemaining === 0 && p.welcomeBonus > 0 && (
                <div className="mt-1.5 flex items-center gap-1 font-mono text-[11px] text-[#71717A]">
                  <Gift className="w-3 h-3" />
                  <span>{fmtUsd(p.welcomeBonus)} welcome bonus received (spent or superseded by deposits)</span>
                </div>
              )}
            </div>
            {statusPills.length > 0 && (
              <div className="flex flex-wrap gap-1.5 max-w-full" data-testid={`wallet-status-${chatId}`}>
                {statusPills.map((s) => (
                  <span key={s.label}
                    className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border"
                    style={{ color: s.color, borderColor: `${s.color}33`, background: `${s.color}14` }}>
                    <s.icon className="w-2.5 h-2.5" />
                    {s.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* composition rows — each shows sign, label, sub-breakdown (if any) and $ */}
          <div className="mt-4 pt-3 border-t border-white/[0.06] space-y-1.5" data-testid={`wallet-composition-${chatId}`}>
            {walletRows.map((r) => (
              <div key={r.key}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex items-center gap-2 text-[#A1A1AA]" title={r.hint}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: r.color }} />
                    {r.label}
                  </span>
                  <span className="font-mono tabular-nums" style={{ color: r.value ? r.color : '#3F3F46' }}>
                    {r.sign}{fmtUsd(r.value || 0)}
                  </span>
                </div>
                {r.sub && r.sub.length > 0 && r.value > 0 && (
                  <div className="ml-3.5 mt-0.5 space-y-0.5">
                    {r.sub.map((s) => (
                      <div key={s.label} className="flex items-center justify-between gap-2 text-[10.5px] font-mono">
                        <span className="text-[#71717A]">↳ {s.label}</span>
                        <span className="text-[#71717A] tabular-nums">{fmtUsd(s.value)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* quick facts (1/3 width on desktop) */}
        <div className="bg-[#121214] border border-white/[0.05] rounded-lg p-4 space-y-3">
          <div>
            <div className="text-[#71717A] text-[10px] uppercase tracking-[0.08em] font-medium">Orders</div>
            <div className="font-mono text-lg font-semibold text-[#FAFAFA] mt-0.5">{p.orders}</div>
          </div>
          <div>
            <div className="text-[#71717A] text-[10px] uppercase tracking-[0.08em] font-medium">Total spent</div>
            <div className="font-mono text-lg font-semibold text-[#00E599] mt-0.5">{fmtUsd(p.totalSpent)}</div>
          </div>
          <div>
            <div className="text-[#71717A] text-[10px] uppercase tracking-[0.08em] font-medium">Joined</div>
            <div className="font-mono text-xs text-[#A1A1AA] mt-0.5">{fmtDate(p.joinedAt)}</div>
          </div>
        </div>
      </div>

      {/* order history */}
      <div>
        <h4 className="text-sm font-heading font-semibold text-[#FAFAFA] mb-2 flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5 text-[#FFB800]" /> Order History
          <span className="text-[#71717A] font-normal font-mono text-xs">({orders.length})</span>
        </h4>
        {orders.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className={`${TH} border-b border-white/[0.06]`}>
                  <th className="text-left py-2 px-2">Date</th>
                  <th className="text-left py-2 px-2">Category</th>
                  <th className="text-left py-2 px-2">Product</th>
                  <th className="text-right py-2 px-2">Amount</th>
                  <th className="text-right py-2 px-2">Profit</th>
                  <th className="text-left py-2 px-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="py-2 px-2 text-[#A1A1AA] whitespace-nowrap font-mono text-xs">{fmtDate(o.date)}</td>
                    <td className="py-2 px-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ background: colorFor(o.category) }} />
                        {o.category}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-[#A1A1AA] max-w-[180px] truncate">{o.product}</td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums">{fmtUsd(o.amountUsd)}</td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums text-[#00E599]">{fmtUsd(o.profit)}</td>
                    <td className="py-2 px-2">
                      <span className={`font-mono text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${o.status === 'completed' ? 'bg-[#00E599]/10 text-[#00E599]' : 'bg-white/[0.05] text-[#A1A1AA]'}`}>{o.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-[#71717A] text-sm py-3">No purchases yet — this user has joined but hasn't ordered anything.</div>
        )}
      </div>

      {/* other wallet activity (deposits / bonuses / refunds / adjustments) */}
      {other.length > 0 && (
        <div>
          <h4 className="text-sm font-heading font-semibold text-[#FAFAFA] mb-2 flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5 text-[#00C2FF]" /> Wallet Activity
            <span className="text-[#71717A] font-normal font-mono text-xs">({other.length})</span>
          </h4>
          <div className="space-y-1">
            {other.map((o) => {
              const st = groupStyle(o.group);
              const isNegative = o.group === 'refund' && o.amountUsd < 0; // refund reversal
              const displaySign = o.group === 'adjustment' ? (o.amountUsd >= 0 ? '+' : '−') : st.sign;
              return (
                <div key={o.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-white/[0.04] last:border-0 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="font-mono text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border"
                      style={{ color: st.color, borderColor: `${st.color}33`, background: `${st.color}14` }}
                      title={st.desc}
                    >
                      {st.label}
                    </span>
                    <span className="text-[#A1A1AA] truncate" title={o.type}>{subgroupLabel(o.subgroup, o.type)}</span>
                    {o.status && o.status !== 'completed' && (
                      <span className="font-mono text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-white/[0.05] text-[#71717A]">{o.status}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[#71717A] font-mono text-xs whitespace-nowrap">{fmtDate(o.date)}</span>
                    <span className="font-mono tabular-nums" style={{ color: isNegative ? '#FF3366' : st.color }}>
                      {displaySign}{fmtUsd(Math.abs(o.amountUsd))}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Bot Users section — every user who joined the bot + order history
// ─────────────────────────────────────────────────────────────
function BotUsers({ authFetch, range }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('joinedAt');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);
  const searchTimer = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const q = new URLSearchParams({ range, page: String(page), limit: '25', sort, dir: 'desc', search });
      const res = await authFetch(`/users?${q.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setData(json);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [authFetch, range, page, sort, search]);

  useEffect(() => { load(); }, [load]);

  const onSearchChange = (v) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); setSearch(v); }, 400);
  };

  const rows = data?.rows || [];

  return (
    <div className={`${CARD} p-5 sm:p-6`} data-testid="sales-bot-users">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <h2 className="font-heading font-semibold tracking-tight flex items-center gap-2">
          <Users className="w-4 h-4 text-[#00C2FF]" /> Bot Users
          {data && <span className="text-[#71717A] font-mono text-xs font-normal">({fmtNum(data.totalUsers)} joined)</span>}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-[#71717A] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input placeholder="Search name or chat ID…" data-testid="user-search"
              onChange={(e) => onSearchChange(e.target.value)}
              className={`pl-8 pr-3 py-1.5 w-52 ${INPUT}`} />
          </div>
          <select value={sort} data-testid="user-sort"
            onChange={(e) => { setPage(1); setSort(e.target.value); }}
            className={`px-2.5 py-1.5 ${INPUT}`}>
            {USER_SORTS.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="text-[#FF3366] text-sm mb-3" data-testid="user-error">{error}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className={`${TH} border-b border-white/[0.06]`}>
              <th className="text-left py-2.5 px-2 w-8"></th>
              <th className="text-left py-2.5 px-2">User</th>
              <th className="text-left py-2.5 px-2">Chat ID</th>
              <th className="text-left py-2.5 px-2">Joined</th>
              <th className="text-left py-2.5 px-2">Lang</th>
              <th className="text-right py-2.5 px-2">Balance</th>
              <th className="text-right py-2.5 px-2">Orders</th>
              <th className="text-right py-2.5 px-2">Spent</th>
              <th className="text-left py-2.5 px-2">Last Order</th>
            </tr>
          </thead>
          <tbody className={loading ? 'opacity-50' : ''}>
            {rows.map((u) => {
              const isOpen = expanded === u.chatId;
              return (
                <React.Fragment key={u.chatId}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : u.chatId)}
                    data-testid={`user-row-${u.chatId}`}
                    className={`border-b border-white/[0.04] cursor-pointer hover:bg-white/[0.02] transition-colors ${isOpen ? 'bg-white/[0.02]' : ''}`}
                  >
                    <td className="py-3 px-2 text-[#71717A]">
                      {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </td>
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-md bg-[#00C2FF]/10 border border-[#00C2FF]/15 text-[#00C2FF] font-mono text-[10px] flex items-center justify-center shrink-0 font-medium">
                          {(u.name || u.chatId).slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-[#FAFAFA]">{u.name ? `@${u.name}` : `User ${u.chatId}`}</div>
                          {u.hasPurchased && <div className="font-mono text-[10px] uppercase tracking-wide text-[#00E599] flex items-center gap-1"><UserCheck className="w-3 h-3" /> Customer</div>}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-2 font-mono text-xs text-[#A1A1AA]">{u.chatId}</td>
                    <td className="py-3 px-2 text-[#A1A1AA] whitespace-nowrap font-mono text-xs">{fmtDate(u.joinedAt)}</td>
                    <td className="py-3 px-2 text-[#A1A1AA]">
                      <span className="inline-flex items-center gap-1 text-xs"><Globe className="w-3 h-3 text-[#71717A]" />{LANG_LABEL[u.lang] || u.lang || '—'}</span>
                    </td>
                    <td className="py-3 px-2 text-right font-mono tabular-nums text-[#FAFAFA]">
                      <div className={u.balance < 0 ? 'text-[#FF3366]' : ''}>{fmtUsd(u.balance)}</div>
                      <div className="mt-0.5 flex items-center justify-end gap-1 flex-wrap">
                        {u.bonusRemaining > 0 && (
                          <div
                            className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#FFB800]/10 text-[#FFB800] border border-[#FFB800]/20"
                            title={`Wallet is unspent promotional credit — ${fmtUsd(u.bonusRemaining)} welcome bonus, no real deposits yet`}
                            data-testid={`bonus-tag-${u.chatId}`}
                          >
                            <Gift className="w-2.5 h-2.5" />
                            Bonus
                          </div>
                        )}
                        {u.refunds > 0 && u.balance > 0 && u.deposits === 0 && !u.bonusRemaining && (
                          <div
                            className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#00C2FF]/10 text-[#00C2FF] border border-[#00C2FF]/20"
                            title={`Balance includes ${fmtUsd(u.refunds)} in refunds`}
                            data-testid={`refund-tag-${u.chatId}`}
                          >
                            <Undo2 className="w-2.5 h-2.5" />
                            Refund
                          </div>
                        )}
                        {u.adjustments !== 0 && u.balance > 0 && u.deposits === 0 && !u.bonusRemaining && (
                          <div
                            className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#A78BFA]/10 text-[#A78BFA] border border-[#A78BFA]/20"
                            title={`Balance includes ${fmtUsd(u.adjustments)} in admin adjustments`}
                            data-testid={`adjustment-tag-${u.chatId}`}
                          >
                            <Scale className="w-2.5 h-2.5" />
                            Adjusted
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right font-mono tabular-nums text-[#A1A1AA]">{u.orders}</td>
                    <td className="py-3 px-2 text-right font-mono tabular-nums text-[#00E599]">{u.totalSpent ? fmtUsd(u.totalSpent) : '—'}</td>
                    <td className="py-3 px-2 text-[#A1A1AA] whitespace-nowrap font-mono text-xs">{u.lastOrderDate ? fmtDate(u.lastOrderDate) : '—'}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={9} className="p-0">
                        <UserOrderHistory authFetch={authFetch} chatId={u.chatId} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {data && !rows.length && (
              <tr><td colSpan={9} className="text-center text-[#71717A] py-8">No bot users match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-[#71717A] font-mono text-xs">{fmtNum(data.total)} users · page {data.page}/{data.pages}</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
              data-testid="user-prev-btn"
              className={`${GHOST_BTN} disabled:opacity-30`}>Prev</button>
            <button disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}
              data-testid="user-next-btn"
              className={`${GHOST_BTN} disabled:opacity-30`}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main dashboard
// ─────────────────────────────────────────────────────────────
function Dashboard({ token, onLogout }) {
  const [range, setRange] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  // transactions table
  const [txns, setTxns] = useState(null);
  const [txnFilters, setTxnFilters] = useState({ group: 'sale', category: '', status: '', search: '' });
  const [txnPage, setTxnPage] = useState(1);
  const [txnLoading, setTxnLoading] = useState(false);
  const searchTimer = useRef(null);

  const authFetch = useCallback(async (path) => {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { onLogout(); throw new Error('Session expired — please log in again'); }
    return res;
  }, [token, onLogout]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`/overview?range=${range}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setData(json);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [authFetch, range]);

  const loadTxns = useCallback(async () => {
    setTxnLoading(true);
    try {
      const q = new URLSearchParams({
        range, page: String(txnPage), limit: '25',
        group: txnFilters.group, category: txnFilters.category,
        status: txnFilters.status, search: txnFilters.search,
      });
      const res = await authFetch(`/transactions?${q.toString()}`);
      const json = await res.json();
      if (res.ok) setTxns(json);
    } catch (err) { /* handled by overview */ }
    finally { setTxnLoading(false); }
  }, [authFetch, range, txnPage, txnFilters]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { loadTxns(); }, [loadTxns]);

  // auto refresh every 60s
  useEffect(() => {
    const id = setInterval(() => { loadOverview(); loadTxns(); }, 60000);
    return () => clearInterval(id);
  }, [loadOverview, loadTxns]);

  const onSearchChange = (v) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setTxnPage(1);
      setTxnFilters((f) => ({ ...f, search: v }));
    }, 400);
  };

  const exportCsv = async () => {
    try {
      const q = new URLSearchParams({
        range, group: txnFilters.group, category: txnFilters.category,
        status: txnFilters.status, search: txnFilters.search,
      });
      const res = await authFetch(`/export.csv?${q.toString()}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${brandSlug}-sales-${range}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) { /* noop */ }
  };

  const summary = data?.summary;
  const deltas = data?.deltas;

  return (
    <div className="app-root min-h-screen bg-[#09090B] text-[#FAFAFA]">
      <div className="grain-overlay" aria-hidden="true" />

      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-2xl bg-[#09090B]/75 border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#00E599] flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-[#09090B]" />
            </div>
            <div>
              <h1 className="font-heading font-bold tracking-tight leading-tight">Sales &amp; Profit</h1>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#71717A] leading-tight">{BRAND.name} {BRAND.tagline}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href="/" className="hidden sm:block text-[#A1A1AA] hover:text-[#FAFAFA] text-sm px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">Admin Home</a>
            <button onClick={() => { loadOverview(); loadTxns(); }} data-testid="sales-refresh-btn" className={GHOST_BTN}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={onLogout} data-testid="sales-logout-btn"
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-white/[0.08] bg-[#121214] text-[#A1A1AA] hover:text-[#FF3366] hover:border-[#FF3366]/30 hover:bg-[#FF3366]/5 transition-colors">
              <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Range selector */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="inline-flex items-center p-1 bg-[#121214] border border-white/[0.06] rounded-lg overflow-x-auto no-scrollbar" data-testid="sales-range-selector">
            {RANGES.map((r) => (
              <button key={r.k} onClick={() => setRange(r.k)} data-testid={`range-${r.k}`}
                className={`px-3.5 py-1.5 rounded-md font-mono text-xs whitespace-nowrap transition-colors ${range === r.k ? 'bg-[#FAFAFA] text-[#09090B] font-semibold shadow-sm' : 'text-[#A1A1AA] hover:text-[#FAFAFA]'}`}>
                {r.label}
              </button>
            ))}
          </div>
          {lastUpdated && (
            <span className="font-mono text-[11px] text-[#71717A]">Updated {lastUpdated.toLocaleTimeString()}</span>
          )}
        </div>

        {error && (
          <div className="bg-[#FF3366]/10 border border-[#FF3366]/25 text-[#FF3366] rounded-xl px-4 py-3 text-sm" data-testid="sales-error">{error}</div>
        )}

        {loading && !data ? (
          <div className="text-[#71717A] font-mono text-sm py-24 text-center animate-pulse">Loading sales data…</div>
        ) : summary ? (
          <>
            {/* Overview */}
            <Eyebrow>Overview</Eyebrow>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="sales-kpis">
              <Kpi icon={DollarSign} label="Gross Revenue" value={fmtUsd(summary.grossRevenue)} accent="mint" delta={deltas?.grossRevenue} sub="vs prev" testid="kpi-revenue" />
              <Kpi
                icon={PiggyBank}
                label="Profit"
                value={fmtUsd(summary.netProfit)}
                accent="cyan"
                delta={deltas?.netProfit}
                sub="revenue − cost"
                testid="kpi-profit"
                valueClassName={summary.netProfit < 0 ? 'text-[#FF3366]' : 'text-[#FAFAFA]'}
                footnote="excludes bonuses"
              />
              <Kpi
                icon={Banknote}
                label="Eligible Payout"
                value={fmtUsd(summary.eligiblePayout != null ? summary.eligiblePayout : (summary.payout != null ? summary.payout : summary.netProfit))}
                accent="violet"
                sub="all-time · safe to withdraw"
                testid="kpi-eligible-payout"
                valueClassName={(summary.eligiblePayout != null ? summary.eligiblePayout : summary.payout) < 0 ? 'text-[#FF3366]' : 'text-[#FAFAFA]'}
                footnote="since first sale · excludes deposits & bonuses"
              />
              <Kpi icon={ShoppingCart} label="Orders" value={fmtNum(summary.orders)} accent="amber" delta={deltas?.orders} sub={`AOV ${fmtUsd(summary.avgOrderValue)}`} testid="kpi-orders" />
            </div>

            {/* Wallet flow strip — money that moved in/out of user wallets */}
            <div className={`${CARD} grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06]`} data-testid="wallet-flow-strip">
              <MiniStat
                icon={Wallet}
                label="Wallet Deposits"
                value={fmtUsd(summary.deposits)}
                sub="customer funds — NOT profit/payout"
                accent="mint"
                testid="kpi-deposits"
                breakdown={[
                  { label: 'Crypto / top-up', value: fmtUsd(summary.cashDeposits != null ? summary.cashDeposits : ((summary.deposits || 0) - (summary.adminCredits || 0))), color: '#00E599' },
                  ...(summary.adminCredits ? [{ label: 'Admin credit (manual)', value: fmtUsd(summary.adminCredits), color: '#A78BFA' }] : []),
                ]}
              />
              <MiniStat
                icon={Gift}
                label="Promo Credit Issued"
                value={fmtUsd(summary.promoCreditIssued != null ? summary.promoCreditIssued : summary.bonuses)}
                sub="signup credit · NOT counted in profit"
                accent="amber"
                testid="kpi-bonuses"
                breakdown={[
                  { label: 'Welcome bonus', value: fmtUsd(summary.welcomeBonuses || 0), color: '#FFB800' },
                  ...(summary.firstDepositBonuses ? [{ label: 'First-deposit bonus', value: fmtUsd(summary.firstDepositBonuses), color: '#00E599' }] : []),
                  ...(summary.otherBonuses ? [{ label: 'Other bonuses', value: fmtUsd(summary.otherBonuses), color: '#71717A' }] : []),
                ]}
              />
              <MiniStat icon={Undo2} label="Refunds" value={fmtUsd(summary.refunds)} sub="returned to users" accent="rose" testid="kpi-refunds" />
              <MiniStat icon={Scale} label="Adjustments" value={fmtUsd(summary.adjustments || 0)} sub="over/under/corrections" accent="violet" testid="kpi-adjustments" />
            </div>

            {/* Pricing & Membership — discounts and tier breakdown */}
            <Eyebrow>Pricing &amp; Membership</Eyebrow>
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4" data-testid="sales-pricing">
              {/* Revenue after discounts (waterfall) */}
              <div className={`${CARD} xl:col-span-2 p-5 sm:p-6`} data-testid="revenue-waterfall">
                <h2 className="font-heading font-semibold tracking-tight flex items-center gap-2 mb-4"><Percent className="w-4 h-4 text-[#00E599]" /> Revenue after Discounts</h2>
                <div className="space-y-2.5 font-mono text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[#A1A1AA]">List sales</span>
                    <span className="text-[#FAFAFA] tabular-nums">{fmtUsd(summary.grossListSales || 0)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#71717A] flex items-center gap-1.5"><Award className="w-3.5 h-3.5 text-[#A78BFA]" /> Loyalty discounts</span>
                    <span className="text-[#A78BFA] tabular-nums">−{fmtUsd(summary.loyaltyDiscounts || 0)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#71717A] flex items-center gap-1.5"><Tag className="w-3.5 h-3.5 text-[#FFB800]" /> Coupon discounts</span>
                    <span className="text-[#FFB800] tabular-nums">−{fmtUsd(summary.couponDiscounts || 0)}</span>
                  </div>
                  <div className="border-t border-white/[0.08] pt-2.5 flex items-center justify-between">
                    <span className="text-[#FAFAFA]">Net revenue</span>
                    <span className="text-[#00E599] tabular-nums font-semibold">{fmtUsd(summary.grossRevenue || 0)}</span>
                  </div>
                </div>
                <p className="text-[#71717A] text-[10.5px] mt-3 leading-relaxed">Discounts come out of profit — supplier cost is based on the full list price.</p>
              </div>
              {/* Sales by membership tier */}
              <div className={`${CARD} xl:col-span-3 p-5 sm:p-6`} data-testid="sales-by-tier">
                <h2 className="font-heading font-semibold tracking-tight flex items-center gap-2 mb-4"><Users className="w-4 h-4 text-[#00E599]" /> Sales by Membership Tier</h2>
                {data?.byTier && data.byTier.length ? (
                  <table className="w-full text-sm font-mono">
                    <thead>
                      <tr className="text-[#71717A] text-[11px] uppercase tracking-[0.06em]">
                        <th className="text-left py-1.5">Tier</th>
                        <th className="text-right py-1.5">Orders</th>
                        <th className="text-right py-1.5">Net Rev</th>
                        <th className="text-right py-1.5">Discount</th>
                        <th className="text-right py-1.5">Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byTier.map((tr) => (
                        <tr key={tr.tier} className="border-t border-white/[0.05]">
                          <td className="py-2 text-[#FAFAFA]">{TIER_BADGE[tr.tier] || '•'} {tr.tierName}</td>
                          <td className="py-2 text-right text-[#A1A1AA] tabular-nums">{tr.orders}</td>
                          <td className="py-2 text-right text-[#FAFAFA] tabular-nums">{fmtUsd(tr.revenue)}</td>
                          <td className="py-2 text-right text-[#A78BFA] tabular-nums">{tr.discount > 0 ? '−' + fmtUsd(tr.discount) : '—'}</td>
                          <td className="py-2 text-right text-[#00E599] tabular-nums">{fmtUsd(tr.profit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-[#71717A] text-sm py-6 text-center">No sales yet — tier &amp; discount breakdown appears once customers start buying.</div>
                )}
              </div>
            </div>

            {/* Users & conversion */}
            <Eyebrow>Users &amp; Conversion</Eyebrow>
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
              <div className="xl:col-span-3">
                <ConversionFunnel funnel={data?.funnel} />
              </div>
              <div className="xl:col-span-2 grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-1 gap-4" data-testid="sales-user-kpis">
                <Kpi icon={Users} label="Total Bot Users" value={fmtNum(data?.userStats?.totalUsers || 0)} accent="cyan" sub="joined the bot" testid="kpi-total-users" />
                <Kpi icon={UserPlus} label="New Users" value={fmtNum(data?.userStats?.newUsers || 0)} accent="mint" sub="in selected range" testid="kpi-new-users" />
                <Kpi icon={UserCheck} label="Paying Users" value={fmtNum(data?.userStats?.purchasedUsers || 0)} accent="violet" sub="made a purchase" testid="kpi-paying-users" />
              </div>
            </div>

            {/* Trends */}
            <Eyebrow>Trends</Eyebrow>
            <div className={`${CARD} p-5 sm:p-6`} data-testid="sales-timeseries">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-heading font-semibold tracking-tight flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[#00E599]" /> Revenue &amp; Profit</h2>
                <div className="flex items-center gap-4 font-mono text-[11px] text-[#A1A1AA]">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#FAFAFA]" /> Revenue</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#00E599]" /> Profit</span>
                </div>
              </div>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <AreaChart data={data.timeseries} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#FAFAFA" stopOpacity={0.14} />
                        <stop offset="95%" stopColor="#FAFAFA" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00E599" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#00E599" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={(d) => (d || '').slice(5)} minTickGap={24} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS_TICK} tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} axisLine={false} tickLine={false} width={48} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="revenue" stroke="#FAFAFA" strokeWidth={1.5} fill="url(#gRev)" />
                    <Area type="monotone" dataKey="netProfit" stroke="#00E599" strokeWidth={2} fill="url(#gProfit)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Weekly Profit chart */}
            <div className={`${CARD} p-5 sm:p-6`} data-testid="sales-weekly">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-heading font-semibold tracking-tight flex items-center gap-2"><BarChart3 className="w-4 h-4 text-[#00E599]" /> Weekly Profit</h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#71717A]">Revenue − cost · excludes bonuses</span>
              </div>
              {data.weekly && data.weekly.length ? (
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={data.weekly} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 10 }} minTickGap={12} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={AXIS_TICK} tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : (v <= -1000 ? (v / 1000).toFixed(0) + 'k' : v)}`} axisLine={false} tickLine={false} width={48} />
                      <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={<WeeklyTooltip />} />
                      <Bar dataKey="netProfit" radius={[4, 4, 0, 0]} maxBarSize={44}>
                        {data.weekly.map((w, i) => (
                          <Cell key={i} fill={(w.netProfit || 0) < 0 ? '#FF3366' : '#00E599'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-[#71717A] text-sm py-10 text-center">No weekly data in this period.</div>
              )}
            </div>

            {/* Breakdown */}
            <Eyebrow>Breakdown</Eyebrow>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <div className={`lg:col-span-3 ${CARD} p-5 sm:p-6`} data-testid="sales-by-category">
                <h2 className="font-heading font-semibold tracking-tight flex items-center gap-2 mb-5"><Layers className="w-4 h-4 text-[#A78BFA]" /> Profit by Category</h2>
                <div style={{ width: '100%', height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart data={data.byCategory} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                      <XAxis type="number" tick={AXIS_TICK} tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="category" tick={{ fill: '#A1A1AA', fontSize: 12 }} width={100} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={<CategoryTooltip />} />
                      <Bar dataKey="profit" radius={[0, 4, 4, 0]} barSize={18}>
                        {data.byCategory.map((c) => <Cell key={c.category} fill={colorFor(c.category)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className={`lg:col-span-2 ${CARD} p-5 sm:p-6 overflow-hidden`}>
                <h2 className="font-heading font-semibold tracking-tight mb-3">Category Detail</h2>
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={`${TH} border-b border-white/[0.06]`}>
                        <th className="text-left py-2 px-1">Category</th>
                        <th className="text-right py-2 px-1">Revenue</th>
                        <th className="text-right py-2 px-1">Profit</th>
                        <th className="text-right py-2 px-1">Orders</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byCategory.map((c) => (
                        <tr key={c.category} className="border-b border-white/[0.04] last:border-0">
                          <td className="py-2 px-1">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ background: colorFor(c.category) }} />
                              {c.category}
                            </span>
                          </td>
                          <td className="text-right font-mono tabular-nums py-2 px-1">{fmtUsd0(c.revenue)}</td>
                          <td className="text-right font-mono tabular-nums py-2 px-1 text-[#00E599]">{fmtUsd0(c.profit)}</td>
                          <td className="text-right font-mono tabular-nums py-2 px-1 text-[#A1A1AA]">{c.orders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Top products + customers */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className={`${CARD} p-5 sm:p-6`} data-testid="sales-top-products">
                <h2 className="font-heading font-semibold tracking-tight flex items-center gap-2 mb-3"><Package className="w-4 h-4 text-[#FFB800]" /> Top Products</h2>
                <div className="space-y-1">
                  {(data.topProducts || []).map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
                      <div className="min-w-0">
                        <div className="truncate text-sm">{p.product}</div>
                        <div className="text-xs text-[#71717A]">{p.category} · {p.orders} orders</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-mono tabular-nums">{fmtUsd(p.revenue)}</div>
                        <div className="text-xs font-mono text-[#00E599] tabular-nums">+{fmtUsd(p.profit)}</div>
                      </div>
                    </div>
                  ))}
                  {(!data.topProducts || !data.topProducts.length) && <div className="text-[#71717A] text-sm py-4">No sales in this period.</div>}
                </div>
              </div>

              <div className={`${CARD} p-5 sm:p-6`} data-testid="sales-top-customers">
                <h2 className="font-heading font-semibold tracking-tight flex items-center gap-2 mb-3"><Users className="w-4 h-4 text-[#00C2FF]" /> Top Customers</h2>
                <div className="space-y-1">
                  {(data.topCustomers || []).map((c, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
                      <div className="min-w-0 flex items-center gap-2.5">
                        <span className="w-6 h-6 rounded-md bg-white/[0.04] border border-white/[0.06] font-mono text-[10px] flex items-center justify-center text-[#A1A1AA] shrink-0">{i + 1}</span>
                        <div className="min-w-0">
                          <div className="truncate text-sm">{c.name || `User ${c.chatId}`}</div>
                          <div className="text-xs text-[#71717A]">{c.orders} orders</div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-mono tabular-nums">{fmtUsd(c.revenue)}</div>
                        <div className="text-xs font-mono text-[#00E599] tabular-nums">+{fmtUsd(c.profit)}</div>
                      </div>
                    </div>
                  ))}
                  {(!data.topCustomers || !data.topCustomers.length) && <div className="text-[#71717A] text-sm py-4">No customers in this period.</div>}
                </div>
              </div>
            </div>

            {/* Records */}
            <Eyebrow>Records</Eyebrow>
            <BotUsers authFetch={authFetch} range={range} />

            {/* Transactions table */}
            <div className={`${CARD} p-5 sm:p-6`} data-testid="sales-transactions">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
                <h2 className="font-heading font-semibold tracking-tight flex items-center gap-2"><Receipt className="w-4 h-4 text-[#00E599]" /> Transactions</h2>
                <button onClick={exportCsv} data-testid="sales-export-btn"
                  className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-[#00E599]/10 text-[#00E599] border border-[#00E599]/20 hover:bg-[#00E599]/20 transition-colors">
                  <Download className="w-4 h-4" /> Export CSV
                </button>
              </div>

              {/* filters */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <div className="relative">
                  <Search className="w-4 h-4 text-[#71717A] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input placeholder="Search id, user, product…" data-testid="txn-search"
                    onChange={(e) => onSearchChange(e.target.value)}
                    className={`pl-8 pr-3 py-1.5 w-56 ${INPUT}`} />
                </div>
                <select value={txnFilters.group} data-testid="txn-group"
                  onChange={(e) => { setTxnPage(1); setTxnFilters((f) => ({ ...f, group: e.target.value })); }}
                  className={`px-2.5 py-1.5 ${INPUT}`}>
                  <option value="">All types</option>
                  <option value="sale">Sales</option>
                  <option value="deposit">Deposits</option>
                  <option value="bonus">Bonuses</option>
                  <option value="refund">Refunds</option>
                  <option value="adjustment">Adjustments</option>
                </select>
                <select value={txnFilters.category} data-testid="txn-category"
                  onChange={(e) => { setTxnPage(1); setTxnFilters((f) => ({ ...f, category: e.target.value })); }}
                  className={`px-2.5 py-1.5 ${INPUT}`}>
                  <option value="">All categories</option>
                  {(data.byCategory || []).map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
                </select>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className={`${TH} border-b border-white/[0.06]`}>
                      <th className="text-left py-2.5 px-2">Transaction</th>
                      <th className="text-left py-2.5 px-2">Date</th>
                      <th className="text-left py-2.5 px-2">Category</th>
                      <th className="text-left py-2.5 px-2">Product</th>
                      <th className="text-right py-2.5 px-2">Amount</th>
                      <th className="text-right py-2.5 px-2">Profit</th>
                      <th className="text-left py-2.5 px-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className={txnLoading ? 'opacity-50' : ''}>
                    {(txns?.rows || []).map((r) => {
                      const st = groupStyle(r.group);
                      const isNegative = r.group === 'sale' || (r.amountUsd < 0);
                      const sign = r.group === 'adjustment' ? (r.amountUsd >= 0 ? '+' : '−') : (isNegative ? '−' : '+');
                      const amtColor = r.group === 'sale' ? '#FAFAFA' : st.color;
                      return (
                        <tr key={r.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                          <td className="py-2.5 px-2 font-mono text-xs text-[#A1A1AA]">{r.id}</td>
                          <td className="py-2.5 px-2 text-[#A1A1AA] whitespace-nowrap font-mono text-xs">{r.date ? new Date(r.date).toLocaleDateString() : '—'}</td>
                          <td className="py-2.5 px-2">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="font-mono text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border"
                                style={{ color: st.color, borderColor: `${st.color}33`, background: `${st.color}14` }}
                                title={st.desc}
                              >
                                {st.label}
                              </span>
                              {r.group === 'sale' && (
                                <span className="inline-flex items-center gap-1">
                                  <span className="w-2 h-2 rounded-full" style={{ background: colorFor(r.category) }} />
                                  {r.category}
                                </span>
                              )}
                              {r.group !== 'sale' && (
                                <span className="text-[#A1A1AA] text-xs">{subgroupLabel(r.subgroup, r.type)}</span>
                              )}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 text-[#A1A1AA] max-w-[200px] truncate">{r.product}</td>
                          <td className="py-2.5 px-2 text-right font-mono tabular-nums" style={{ color: amtColor }}>{sign}{fmtUsd(Math.abs(r.amountUsd))}</td>
                          <td className="py-2.5 px-2 text-right font-mono tabular-nums text-[#00E599]">{r.group === 'sale' ? fmtUsd(r.profit) : '—'}</td>
                          <td className="py-2.5 px-2">
                            <span className={`font-mono text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${r.status === 'completed' ? 'bg-[#00E599]/10 text-[#00E599]' : r.status === 'refunded' || r.status === 'reversed' ? 'bg-[#FF3366]/10 text-[#FF3366]' : 'bg-white/[0.05] text-[#A1A1AA]'}`}>{r.status}</span>
                          </td>
                        </tr>
                      );
                    })}
                    {txns && !txns.rows.length && (
                      <tr><td colSpan={7} className="text-center text-[#71717A] py-8">No transactions match your filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* pagination */}
              {txns && txns.pages > 1 && (
                <div className="flex items-center justify-between mt-4 text-sm">
                  <span className="text-[#71717A] font-mono text-xs">{fmtNum(txns.total)} transactions · page {txns.page}/{txns.pages}</span>
                  <div className="flex items-center gap-2">
                    <button disabled={txnPage <= 1} onClick={() => setTxnPage((p) => Math.max(1, p - 1))}
                      className={`${GHOST_BTN} disabled:opacity-30`}>Prev</button>
                    <button disabled={txnPage >= txns.pages} onClick={() => setTxnPage((p) => p + 1)}
                      className={`${GHOST_BTN} disabled:opacity-30`}>Next</button>
                  </div>
                </div>
              )}
            </div>

            <div className="pb-6" />
          </>
        ) : null}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
export default function SalesDashboard() {
  const [token, setToken] = useState(() => localStorage.getItem('salesToken'));
  useEffect(() => { document.title = `${BRAND.name} — Sales & Profit`; }, []);
  const logout = () => { localStorage.removeItem('salesToken'); setToken(null); };
  if (!token) return <Login onLogin={setToken} />;
  return <Dashboard token={token} onLogout={logout} />;
}
