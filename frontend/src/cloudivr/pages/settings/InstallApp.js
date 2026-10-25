import React from 'react';
import { toast } from 'sonner';
import { Smartphone, Download, Share, SquarePlus, CheckCircle2 } from 'lucide-react';
import { usePwa } from '../../pwa';
import { BRAND } from '../../Brand';

function IosSteps() {
  return (
    <ol className="space-y-2 text-sm" data-testid="install-ios-steps">
      <li className="flex items-center gap-2"><span className="font-mono text-xs text-[#a1a1aa]">1</span>Open CloudIVR in Safari.</li>
      <li className="flex items-center gap-2"><span className="font-mono text-xs text-[#a1a1aa]">2</span>Tap <Share className="w-4 h-4 text-[#38bdf8]" aria-label="Share" /> Share.</li>
      <li className="flex items-center gap-2"><span className="font-mono text-xs text-[#a1a1aa]">3</span>Tap <SquarePlus className="w-4 h-4 text-[#38bdf8]" aria-label="Add" /> Add to Home Screen.</li>
    </ol>
  );
}

// "Install the app": the browser's install prompt, iPhone steps, or a note that it is already installed.
export function InstallApp() {
  const { canInstall, installed, ios, install } = usePwa();
  const go = async () => { if (await install()) toast.success('CloudIVR is on your home screen'); };
  return (
    <div className="civr-card p-6 space-y-4" data-testid="settings-install-card">
      <div className="flex items-center gap-3">
        <img src={BRAND.notifyIcon} alt="" className="w-12 h-12 rounded-xl" />
        <div><div className="font-display text-2xl font-bold flex items-center gap-2"><Smartphone className="w-5 h-5 text-[#34d399]" />Install the app</div><p className="text-sm text-[#a1a1aa]">Open CloudIVR from your home screen, full screen like a normal app.</p></div>
      </div>
      {installed ? <div className="text-sm text-[#34d399] flex items-center gap-2" data-testid="install-done"><CheckCircle2 className="w-4 h-4" />You’re using the installed app.</div>
        : canInstall ? <button className="civr-btn civr-btn-primary" onClick={go} data-testid="install-app-button"><Download className="w-4 h-4" />Install CloudIVR</button>
          : ios ? <IosSteps />
            : <p className="text-sm text-[#a1a1aa]" data-testid="install-hint">On Android, open this page in Chrome and use the menu → Install app (or Add to Home screen). On a computer, use the install icon in Chrome or Edge’s address bar.</p>}
    </div>
  );
}
