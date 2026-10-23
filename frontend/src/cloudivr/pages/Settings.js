import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, LogOut } from 'lucide-react';
import { api, day } from '../api';
import { useCivrAuth } from '../AuthContext';
import { PageHeader, Field } from '../ui';
import { cp } from '../paths';

function Profile({ account, setAccount }) {
  const [name, setName] = useState(account.name || '');
  const [busy, setBusy] = useState(false);
  const save = async (e) => { e.preventDefault(); setBusy(true); try { const d = await api('/auth/profile', { method: 'PATCH', body: { name } }); setAccount(d.account); toast.success('Profile saved'); } catch (err) { toast.error(err.message); } finally { setBusy(false); } };
  return (
    <form onSubmit={save} className="civr-card p-6 space-y-5" data-testid="settings-profile-form">
      <div className="font-display text-2xl font-bold">Profile</div>
      <Field label="Email"><input className="civr-input" value={account.email} disabled data-testid="settings-email" /></Field>
      <Field label="Name"><input className="civr-input" value={name} onChange={e => setName(e.target.value)} data-testid="settings-name-input" /></Field>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="civr-pill" data-testid="settings-member-since">member since {day(account.createdAt)}</span>
        {account.google && <span className="civr-pill civr-pill-on" data-testid="settings-google-linked">Google linked</span>}
        {account.hasPassword && <span className="civr-pill" data-testid="settings-password-set">password set</span>}
      </div>
      <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="settings-profile-save-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save profile</button>
    </form>
  );
}

function Password({ account, refresh }) {
  const [f, setF] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api('/auth/change-password', { method: 'POST', body: f }); toast.success('Password updated — other sessions were signed out'); setF({ currentPassword: '', newPassword: '' }); refresh(); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="civr-card p-6 space-y-5" data-testid="settings-password-form">
      <div className="font-display text-2xl font-bold">{account.hasPassword ? 'Change password' : 'Set a password'}</div>
      {account.hasPassword && <Field label="Current password"><input type="password" required className="civr-input" value={f.currentPassword} onChange={e => setF({ ...f, currentPassword: e.target.value })} data-testid="settings-current-password-input" /></Field>}
      <Field label="New password" hint="At least 8 characters."><input type="password" required minLength={8} className="civr-input" value={f.newPassword} onChange={e => setF({ ...f, newPassword: e.target.value })} data-testid="settings-new-password-input" /></Field>
      <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="settings-password-save-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save password</button>
    </form>
  );
}

export default function Settings() {
  const { account, setAccount, refresh, logout } = useCivrAuth();
  const nav = useNavigate();
  return (
    <div data-testid="settings-page">
      <PageHeader label="Account" title="Settings" sub="This web account is separate from any Telegram bot account." testid="settings-header">
        <button className="civr-btn civr-btn-ghost civr-btn-sm" onClick={async () => { await logout(); nav(cp()); }} data-testid="settings-logout-button"><LogOut className="w-4 h-4" />Sign out</button>
      </PageHeader>
      <div className="grid lg:grid-cols-2 gap-4 max-w-5xl"><Profile account={account} setAccount={setAccount} /><Password account={account} refresh={refresh} /></div>
    </div>
  );
}
