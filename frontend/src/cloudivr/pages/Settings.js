import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, LogOut } from 'lucide-react';
import { api, day } from '../api';
import { useCivrAuth } from '../AuthContext';
import { PageHeader, Field } from '../ui';
import { LANGS, useLang } from '../i18n';
import { useVoices, VoiceSelect } from '../VoiceMaker';
import { cp } from '../paths';

function Profile({ account, setAccount }) {
  const [name, setName] = useState(account.name || '');
  const [busy, setBusy] = useState(false);
  const save = async (e) => { e.preventDefault(); setBusy(true); try { const d = await api('/auth/profile', { method: 'PATCH', body: { name } }); setAccount(d.account); toast.success('Profile saved'); } catch (err) { toast.error(err.message); } finally { setBusy(false); } };
  return (
    <form onSubmit={save} className="civr-card p-6 space-y-6" data-testid="settings-profile-form">
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
    <form onSubmit={save} className="civr-card p-6 space-y-6" data-testid="settings-password-form">
      <div className="font-display text-2xl font-bold">{account.hasPassword ? 'Change password' : 'Set a password'}</div>
      {account.hasPassword && <Field label="Current password"><input type="password" required className="civr-input" value={f.currentPassword} onChange={e => setF({ ...f, currentPassword: e.target.value })} data-testid="settings-current-password-input" /></Field>}
      <Field label="New password" hint="At least 8 characters."><input type="password" required minLength={8} className="civr-input" value={f.newPassword} onChange={e => setF({ ...f, newPassword: e.target.value })} data-testid="settings-new-password-input" /></Field>
      <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="settings-password-save-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save password</button>
    </form>
  );
}

function Language() {
  const { lang, setLang } = useLang();
  return (
    <div className="civr-card p-6 space-y-4" data-testid="settings-language-card">
      <div className="font-display text-2xl font-bold">Language</div>
      <p className="text-sm text-[#888]">The whole app, including the home page. We start with your browser’s language.</p>
      <div className="flex flex-wrap gap-2" data-no-translate>{LANGS.map(([c, name]) => <button key={c} type="button" onClick={() => setLang(c)} aria-pressed={lang === c} className={`civr-pill cursor-pointer !normal-case !tracking-normal !text-sm h-10 ${lang === c ? 'civr-pill-on' : ''}`} data-testid={`settings-lang-${c}`}>{name}</button>)}</div>
    </div>
  );
}

function DefaultVoice() {
  const { voices, speeds, def, canSave } = useVoices();
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const cur = v || def;
  const save = async () => { setBusy(true); try { await api('/prefs/voice', { method: 'PUT', body: cur }); toast.success('Default voice saved'); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  return (
    <div className="civr-card p-6 space-y-4" data-testid="settings-voice-card">
      <div className="font-display text-2xl font-bold">Default AI voice</div>
      <p className="text-sm text-[#888]">Used for every new script and AI voice message so your calls always sound the same.</p>
      {canSave ? <>
        <div className="flex flex-wrap gap-2"><VoiceSelect value={cur.voice} onChange={(x) => setV({ ...cur, voice: x })} voices={voices} testid="settings-voice-select" />
          <select className="civr-input !w-24" value={cur.speed} onChange={e => setV({ ...cur, speed: Number(e.target.value) })} data-testid="settings-speed-select" aria-label="Speed">{speeds.map(s => <option key={s} value={s}>{s}×</option>)}</select></div>
        <button className="civr-btn civr-btn-primary" disabled={busy} onClick={save} data-testid="settings-voice-save-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save voice</button>
      </> : <div className="text-sm text-[#fbbf24]" data-testid="settings-voice-locked">A saved default voice is on the Business plan.</div>}
    </div>
  );
}

export default function Settings() {
  const { account, setAccount, refresh, logout } = useCivrAuth();
  const nav = useNavigate();
  return (
    <div data-testid="settings-page">
      <PageHeader label="Account" title="Settings" sub="This web account is separate from any Telegram bot account." testid="settings-header">
        <button className="civr-btn civr-btn-ghost civr-btn-sm" onClick={async () => { nav(cp(), { replace: true }); await logout(); }} data-testid="settings-logout-button"><LogOut className="w-4 h-4" />Sign out</button>
      </PageHeader>
      <div className="grid lg:grid-cols-2 gap-4 max-w-5xl"><Profile account={account} setAccount={setAccount} /><Password account={account} refresh={refresh} /><Language /><DefaultVoice /></div>
    </div>
  );
}
