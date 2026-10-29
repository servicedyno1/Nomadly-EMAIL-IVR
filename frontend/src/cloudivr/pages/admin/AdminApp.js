import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayoutDashboard, Users as UsersIcon, MessageSquareText, Phone, Store, ScrollText, LogOut, BadgeCheck } from 'lucide-react';
import { api } from '../../api';
import { Spinner } from '../../ui';
import AdminLogin from './AdminLogin';
import Overview from './Overview';
import Users from './Users';
import Texting from './Texting';
import Cloud, { Resellers, Audit } from './Cloud';
import CallerIdsAdmin from './CallerIds';

const TABS = [['overview', 'Overview', LayoutDashboard, Overview], ['users', 'Users & wallets', UsersIcon, Users], ['texting', 'Texting queue', MessageSquareText, Texting], ['cloudivr', 'CloudIVR', Phone, Cloud], ['caller-ids', 'Caller IDs', BadgeCheck, CallerIdsAdmin], ['resellers', 'Resellers', Store, Resellers], ['log', 'Admin log', ScrollText, Audit]];

// cloudivr.net/admin — the owner's dashboard (own sign-in; tabs live in ?tab=).
export default function AdminApp() {
  const [me, setMe] = useState(undefined);
  const [params, setParams] = useSearchParams();
  const tab = TABS.find(t => t[0] === params.get('tab')) || TABS[0];
  const check = () => api('/admin/me').then(setMe).catch(() => setMe(null));
  useEffect(() => { check(); }, []);
  useEffect(() => { document.title = 'CloudIVR admin'; }, []);
  if (me === undefined) return <div className="civr min-h-screen flex items-center justify-center"><Spinner /></div>;
  if (!me) return <div className="civr"><AdminLogin onIn={check} /></div>;
  const out = async () => { await api('/admin/logout', { method: 'POST' }).catch(() => {}); setMe(null); };
  const Cmp = tab[3];
  return (
    <div className="civr min-h-screen" data-testid="admin-app">
      <header className="sticky top-0 z-40 border-b border-[#1f1f1f] bg-[#0a0a0a]/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-14 flex items-center gap-4">
          <b className="whitespace-nowrap">CloudIVR admin</b>
          <nav className="flex gap-1 overflow-x-auto civr-no-scrollbar flex-1">{TABS.map(([k, l, Icon]) => (
            <button key={k} type="button" onClick={() => setParams({ tab: k })} className={`flex items-center gap-2 px-3 h-9 rounded-full text-sm whitespace-nowrap transition-colors ${tab[0] === k ? 'bg-[#818cf8]/15 text-[#c7d2fe]' : 'text-[#a1a1aa] hover:text-white'}`} data-testid={`admin-tab-${k}`}><Icon className="w-4 h-4" />{l}</button>
          ))}</nav>
          <span className="hidden md:inline text-xs text-[#a1a1aa]">{me.email}</span>
          <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={out} data-testid="admin-logout"><LogOut className="w-4 h-4" /></button>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <h1 className="text-2xl font-semibold mb-6" data-testid="admin-page-title">{tab[1]}</h1>
        <Cmp />
      </main>
    </div>
  );
}
