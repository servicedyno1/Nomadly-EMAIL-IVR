import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRightLeft, LayoutDashboard, Users as UsersIcon, MessageSquareText, Phone, Store, ScrollText, LogOut, FileText, BadgeCheck, Smartphone, Mail, ShieldCheck, Globe2, LineChart, Printer, CreditCard, PhoneCall } from 'lucide-react';
import { api } from '../../api';
import { Spinner } from '../../ui';
import AdminLogin from './AdminLogin';
import Overview from './Overview';
import Users from './Users';
import Texting from './Texting';
import EsimAdmin from './Esim';
import Cloud, { Resellers, Audit } from './Cloud';
import CallerIdsAdmin from './CallerIds';
import InboxAdmin from './InboxAdmin';
import ComplianceAdmin, { CardChecks } from './ComplianceAdmin';
import AddonsAdmin from './AddonsAdmin';
import Insights from './Insights';
import InvoicesAdmin from './InvoicesAdmin';
import FaxSales from './FaxSales';
import Softphones from './Softphones';
import MovePlan from './MovePlan';

const TABS = [['overview', 'Overview', LayoutDashboard, Overview], ['card-checks', 'Card ID checks', CreditCard, CardChecks], ['insights', 'Signup insights', LineChart, Insights], ['inbox', 'Inbox', Mail, InboxAdmin], ['users', 'Users & wallets', UsersIcon, Users], ['move-plan', 'Move bot plan', ArrowRightLeft, MovePlan], ['invoices', 'Invoices', FileText, InvoicesAdmin], ['fax-sales', 'Fax sales', Printer, FaxSales], ['compliance', 'Compliance', ShieldCheck, ComplianceAdmin], ['addons', 'Country prices', Globe2, AddonsAdmin], ['texting', 'Texting queue', MessageSquareText, Texting], ['esim', 'CloudIVR eSIM', Smartphone, EsimAdmin], ['cloudivr', 'CloudIVR', Phone, Cloud], ['caller-ids', 'Caller IDs', BadgeCheck, CallerIdsAdmin], ['softphones', 'Softphones', PhoneCall, Softphones], ['resellers', 'Resellers', Store, Resellers], ['log', 'Admin log', ScrollText, Audit]];

// cloudivr.net/admin — the owner's dashboard (own sign-in; tabs live in ?tab=).
export default function AdminApp() {
  const [me, setMe] = useState(undefined);
  const [params, setParams] = useSearchParams();
  const tab = TABS.find(t => t[0] === params.get('tab')) || TABS[0];
  const check = () => api('/admin/me').then(setMe).catch(() => setMe(null));
  useEffect(() => { check(); }, []);
  useEffect(() => { document.title = 'CloudIVR admin'; }, []);
  const [open, setOpen] = useState(0);
  useEffect(() => {
    if (!me) return undefined;
    const load = () => api('/admin/card-checks/count').then(d => setOpen(d.open || 0)).catch(() => {});
    load(); const t = setInterval(load, 30000);
    window.addEventListener('civr-card-checks', load);
    return () => { clearInterval(t); window.removeEventListener('civr-card-checks', load); };
  }, [me, params]);
  if (me === undefined) return <div className="civr min-h-screen flex items-center justify-center"><Spinner /></div>;
  if (!me) return <div className="civr"><AdminLogin onIn={check} /></div>;
  const out = async () => { await api('/admin/logout', { method: 'POST' }).catch(() => {}); setMe(null); };
  const Cmp = tab[3];
  return (
    <div className="civr min-h-screen" data-testid="admin-app">
      <header className="sticky top-0 z-40 border-b border-[#1f1f1f] bg-[#0a0a0a]/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-14 flex items-center gap-4">
          <b className="whitespace-nowrap">CloudIVR admin</b>
          <nav className="flex gap-1 flex-1 min-w-0 overflow-x-auto">{TABS.map(([k, l, Icon]) => (
            <button key={k} type="button" onClick={() => setParams({ tab: k })} className={`flex items-center gap-2 px-3 h-9 rounded-full text-sm whitespace-nowrap transition-colors ${tab[0] === k ? 'bg-[#818cf8]/15 text-[#c7d2fe]' : 'text-[#a1a1aa] hover:text-white'}`} data-testid={`admin-tab-${k}`}><Icon className="w-4 h-4" />{l}{k === 'card-checks' && open > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#f59e0b] text-black text-xs font-bold flex items-center justify-center" data-testid="admin-card-checks-count">{open}</span>}</button>
          ))}</nav>
          <span className="hidden md:inline text-xs text-[#a1a1aa]">{me.email}</span>
          <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={out} data-testid="admin-logout"><LogOut className="w-4 h-4" /></button>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        {open > 0 && tab[0] !== 'card-checks' && <button type="button" onClick={() => setParams({ tab: 'card-checks' })} className="w-full text-left mb-6 civr-card p-4 flex items-center gap-3 border border-[#f59e0b]/40 text-sm" data-testid="admin-card-checks-alert"><CreditCard className="w-5 h-5 text-[#f59e0b] shrink-0" /><span className="flex-1"><b>{open} card payment{open === 1 ? '' : 's'}</b> on hold for an ID check — approve or refund.</span><span className="civr-btn civr-btn-primary civr-btn-sm">Review</span></button>}
        <h1 className="text-2xl font-semibold mb-6" data-testid="admin-page-title">{tab[1]}</h1>
        <Cmp />
      </main>
    </div>
  );
}
