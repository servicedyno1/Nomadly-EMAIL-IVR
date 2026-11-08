import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Eye, LogOut, Monitor, Moon, Settings, Sun, BookOpen } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '../components/ui/dropdown-menu';
import { useCivrAuth } from './AuthContext';
import { useTheme, THEME_OPTIONS } from './theme';
import { LANGS, useLang } from './i18n';
import { usePrivacy } from './privacy';
import { confirmLeave } from './guard';
import { cp } from './paths';

const MENU = 'civr !min-h-0 !bg-[var(--c-card)] !text-[var(--c-text)] !border-[var(--c-border)] shadow-xl z-[100] rounded-xl p-1.5 font-[\'DM_Sans\',sans-serif]';
const ITEM = 'min-h-[40px] rounded-lg px-3 text-sm font-medium cursor-pointer gap-2.5 focus:!bg-[var(--c-accent-soft)] focus:!text-[var(--c-text)]';
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };

// Top bar (laptop+): avatar → who you are, theme, language, private mode, settings, help, sign out.
export function AccountMenu({ className = '' }) {
  const { account, logout } = useCivrAuth();
  const nav = useNavigate();
  const { pref, theme, setPref } = useTheme();
  const { lang, setLang } = useLang();
  const { on, toggle } = usePrivacy();
  const who = account?.email || account?.phone || '';
  const first = account?.name?.trim().split(' ')[0] || who.split('@')[0] || 'Account';
  const initial = (first[0] || '?').toUpperCase();
  const ThemeIcon = THEME_ICON[theme] || Sun;
  const signOut = async () => { if (!(await confirmLeave())) return; nav(cp(), { replace: true }); await logout(); };
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={`group inline-flex items-center gap-2 h-11 pl-1.5 pr-2.5 rounded-full text-[#d4d4d8] hover:text-white hover:bg-white/5 data-[state=open]:bg-white/5 data-[state=open]:text-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#818cf8]/50 ${className}`}
          aria-label={`Account menu — ${who}`} title={who} data-testid="topbar-account-menu" data-private={on ? 'on' : 'off'} data-theme={theme}>
          <span className="w-8 h-8 rounded-full bg-[var(--c-accent-strong,#6366f1)] text-white text-sm font-bold grid place-items-center" aria-hidden="true" data-testid="topbar-account-avatar">{initial}</span>
          <span className="text-sm font-medium max-w-[9rem] truncate" data-testid="topbar-account-name" data-no-translate>{first}</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-70 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className={`${MENU} min-w-[15rem]`} data-testid="topbar-account-menu-content">
        <DropdownMenuLabel className="px-3 py-2">
          <div className="text-sm font-semibold truncate" data-no-translate>{account?.name || first}</div>
          <div className="text-xs font-normal text-[var(--c-muted)] truncate" data-no-translate data-testid="topbar-account-email">{who}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="!bg-[var(--c-border)]" />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={ITEM} data-testid="topbar-theme-button"><ThemeIcon className="w-4 h-4" /><span className="flex-1">Appearance</span><span className="text-xs text-[var(--c-muted)] mr-1">{THEME_OPTIONS.find(([v]) => v === pref)?.[1]}</span></DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={MENU} sideOffset={6}>
            {THEME_OPTIONS.map(([v, label]) => { const I = THEME_ICON[v]; return (
              <DropdownMenuItem key={v} onSelect={() => setPref(v)} className={ITEM} aria-current={pref === v ? 'true' : undefined} data-testid={`topbar-theme-${v}`}><I className="w-4 h-4" /><span className="flex-1">{label}</span>{pref === v && <Check className="w-4 h-4 text-[var(--c-accent)]" />}</DropdownMenuItem>
            ); })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={ITEM} data-testid="topbar-lang-switcher"><span className="w-4 text-center text-xs font-bold uppercase" data-no-translate>{lang}</span><span className="flex-1">Language</span><span className="text-xs text-[var(--c-muted)] mr-1" data-no-translate>{LANGS.find(([c]) => c === lang)?.[1]}</span></DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={MENU} sideOffset={6} data-no-translate>
            {LANGS.map(([c, name]) => (
              <DropdownMenuItem key={c} onSelect={() => setLang(c)} className={ITEM} aria-current={c === lang ? 'true' : undefined} data-testid={`topbar-lang-switcher-option-${c}`}><span className="w-4 text-center text-xs font-bold uppercase">{c}</span><span className="flex-1">{name}</span>{c === lang && <Check className="w-4 h-4 text-[var(--c-accent)]" />}</DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); toggle(); }} className={ITEM} role="menuitemcheckbox" aria-checked={on} data-testid="topbar-private-mode-button" data-private={on ? 'on' : 'off'}>
          <Eye className={`w-4 h-4 ${on ? 'text-[#c4b5fd]' : ''}`} /><span className="flex-1">Private mode<span className="block text-xs font-normal text-[var(--c-muted)]">Hide numbers and messages</span></span>
          <span className={`relative w-9 h-5 shrink-0 rounded-full transition-colors ${on ? 'bg-[#a78bfa]' : 'bg-[#52525b]'}`} aria-hidden="true"><span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} /></span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="!bg-[var(--c-border)]" />
        <DropdownMenuItem asChild className={ITEM}><Link to={cp('/app/settings')} data-testid="topbar-settings-link"><Settings className="w-4 h-4" />Settings</Link></DropdownMenuItem>
        <DropdownMenuItem asChild className={ITEM}><Link to={cp('/app/help')} data-testid="topbar-help-link"><BookOpen className="w-4 h-4" />Help center</Link></DropdownMenuItem>
        <DropdownMenuSeparator className="!bg-[var(--c-border)]" />
        <DropdownMenuItem onSelect={signOut} className={`${ITEM} !text-[#fb7185]`} data-testid="topbar-logout-button"><LogOut className="w-4 h-4" />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
