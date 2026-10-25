import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertOctagon, Home, LifeBuoy, RotateCcw, WifiOff } from 'lucide-react';
import { cp } from './paths';

function CrashScreen({ error, onRetry, supportLink, inApp }) {
  const home = <><Home className="w-4 h-4" />Go to Overview</>;
  return (
    <div className={`civr-card p-8 max-w-xl ${inApp ? '' : 'mx-auto my-16'}`} role="alert" data-testid="crash-screen">
      <AlertOctagon className="w-8 h-8 text-[#fb7185] mb-4" />
      <div className="font-display text-2xl font-bold">This screen ran into a problem</div>
      <p className="text-sm text-[#a1a1aa] mt-2 leading-relaxed">Nothing you already saved is lost. Try again, or go back to the Overview. If it keeps happening, message support and say what you clicked just before.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" className="civr-btn civr-btn-primary" onClick={onRetry} data-testid="crash-retry-button"><RotateCcw className="w-4 h-4" />Try again</button>
        {inApp ? <Link to={cp('/app')} className="civr-btn civr-btn-ghost" data-testid="crash-home-link">{home}</Link>
          : <a href={cp('/app')} className="civr-btn civr-btn-ghost" data-testid="crash-home-link">{home}</a>}
        {supportLink && <a href={supportLink} target="_blank" rel="noopener noreferrer" className="civr-btn civr-btn-ghost" data-testid="crash-support-link"><LifeBuoy className="w-4 h-4" />Message support</a>}
      </div>
      {error?.message && (
        <details className="mt-5 text-xs text-[#a1a1aa]" data-testid="crash-details">
          <summary className="cursor-pointer">Details for support</summary>
          <code className="block mt-2 break-words" data-no-translate>{String(error.message).slice(0, 300)}</code>
        </details>
      )}
    </div>
  );
}

// A bug in one screen shows a recovery card instead of a blank app. `resetKey` (the page path) clears it when
// the user moves to another page; `inApp` = inside the signed-in shell (sidebar and menus keep working).
export class CrashGuard extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[CloudIVR] screen crashed:', error, info?.componentStack); }
  componentDidUpdate(prev) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    const retry = this.props.inApp ? () => this.setState({ error: null }) : () => window.location.reload();
    return <CrashScreen error={this.state.error} onRetry={retry} supportLink={this.props.supportLink} inApp={this.props.inApp} />;
  }
}

// Development builds only: add ?crashTest=1 to any app URL to see the recovery card.
export function CrashProbe() {
  if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && /[?&]crashTest=1(&|$)/.test(window.location.search)) {
    throw new Error('Crash test (development builds only)');
  }
  return null;
}

// Tells the user straight away when the connection drops, and when it is back.
export function OfflineBanner() {
  const [off, setOff] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const down = () => setOff(true);
    const up = () => { setOff(false); toast.success('Back online'); };
    window.addEventListener('offline', down);
    window.addEventListener('online', up);
    return () => { window.removeEventListener('offline', down); window.removeEventListener('online', up); };
  }, []);
  if (!off) return null;
  return (
    <div role="status" aria-live="polite" className="text-sm text-[#fecdd3] bg-[#fb7185]/10 border-b border-[#fb7185]/30 px-4 py-2 flex items-center justify-center gap-2 text-center" data-testid="offline-banner">
      <WifiOff className="w-4 h-4 shrink-0" />You’re offline. Changes won’t save until your connection is back.
    </div>
  );
}
