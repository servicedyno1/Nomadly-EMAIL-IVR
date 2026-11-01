import { useCallback, useEffect, useState } from 'react';

// Microphone permission: 'granted' | 'prompt' | 'denied' | 'nomic' | 'unsupported' | 'unknown'.
export async function micState() {
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try { return (await navigator.permissions.query({ name: 'microphone' })).state; } catch { return 'unknown'; }
}

// Opens the browser's "Allow microphone?" prompt (or confirms it's allowed), then releases the mic.
export async function askMic() {
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
    return 'granted';
  } catch (e) {
    if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'nomic';
    // Prompt closed without a choice: still askable, not blocked.
    return (await micState()) === 'prompt' ? 'prompt' : 'denied';
  }
}

export const MIC_TEXT = {
  granted: 'Microphone allowed',
  prompt: 'Microphone not allowed yet. Tap Allow microphone, then choose Allow in your browser.',
  unknown: 'Microphone not allowed yet',
  denied: 'Microphone blocked. Click the lock icon next to the web address, set Microphone to Allow, then reload this page.',
  nomic: 'No microphone found. Plug one in or pick one in your computer’s sound settings.',
  unsupported: 'This browser can’t use a microphone here. Try Chrome, Edge, Safari or Firefox.',
};

export function useMic() {
  const [state, setState] = useState('unknown');
  useEffect(() => {
    let perm = null;
    const sync = () => setState(perm.state);
    micState().then(s => setState(s));
    navigator.permissions?.query({ name: 'microphone' }).then(p => { perm = p; p.addEventListener('change', sync); }).catch(() => {});
    return () => perm?.removeEventListener('change', sync);
  }, []);
  const ask = useCallback(async () => { const s = await askMic(); setState(s); return s; }, []);
  return { state, ask };
}
