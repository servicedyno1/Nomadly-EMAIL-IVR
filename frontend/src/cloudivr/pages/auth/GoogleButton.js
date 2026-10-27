import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { toast } from 'sonner';
import { api } from '../../api';
import { useCivrAuth } from '../../AuthContext';

const G_LOGO = (
  <svg viewBox="0 0 48 48" className="w-[18px] h-[18px]" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

// Same size and look as Google's filled_black pill; sits under Google's button until it has painted.
function GooglePill({ hide }) {
  return (
    <div aria-hidden="true" data-testid="google-signin-placeholder"
      className={`absolute left-1/2 top-0 -translate-x-1/2 h-10 w-[320px] max-w-full rounded-[20px] bg-[#202124] flex items-center pl-[2px] pr-3 pointer-events-none transition-opacity duration-200 ${hide ? 'opacity-0' : 'opacity-100'}`}>
      <span className="w-9 h-9 rounded-full bg-white flex items-center justify-center shrink-0">{G_LOGO}</span>
      <span className="flex-1 text-center text-sm font-medium text-[#e8eaed]" style={{ fontFamily: '"Google Sans", Roboto, Arial, sans-serif' }}>Continue with Google</span>
    </div>
  );
}

// Google's button is an iframe: mark it ready once that iframe has loaded.
function useIframeReady(ref) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const onLoad = () => setTimeout(() => setReady(true), 60);
    const hook = () => { const f = box.querySelector('iframe'); if (f && !f.dataset.civrHooked) { f.dataset.civrHooked = '1'; f.addEventListener('load', onLoad); } };
    hook();
    const mo = new MutationObserver(hook);
    mo.observe(box, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [ref]);
  return ready;
}

// REMINDER: Google sign-in uses the owner's own OAuth client id (GOOGLE_OAUTH_CLIENT_ID, served by /auth/config).
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
// One Tap: Google's small "Continue as …" prompt appears on its own for visitors already signed in to Google.
// Space is reserved from the first paint (no jump when Google's script arrives).
export function GoogleButton({ dest, signup, refCode, onMfa }) {
  const { config, setAccount } = useCivrAuth();
  const nav = useNavigate();
  const box = useRef(null);
  const ready = useIframeReady(box);
  const [failed, setFailed] = useState(false);
  const clientId = config?.googleClientId;
  if (failed || (config?.loaded && !clientId)) return null;
  return (
    <>
      <div className="relative h-10" data-testid="google-signin-button" data-ready={ready ? 'true' : 'false'}>
        <GooglePill hide={ready} />
        <div ref={box} className={`relative flex justify-center transition-opacity duration-200 ${ready ? 'opacity-100' : 'opacity-0'}`}>
          {clientId && (
            <GoogleOAuthProvider clientId={clientId} onScriptLoadError={() => setFailed(true)}>
              <GoogleLogin theme="filled_black" shape="pill" width="320" text="continue_with"
                context={signup ? 'signup' : 'signin'} useOneTap use_fedcm_for_prompt cancel_on_tap_outside={false}
                onSuccess={async (r) => {
                  try { const d = await api('/auth/google', { method: 'POST', body: { credential: r.credential, ref: refCode || undefined } }); if (d.twoFactor) { onMfa(d.twoFactor); return; } setAccount(d.account); nav(dest); } catch (e) { toast.error(e.message); }
                }}
                onError={() => toast.error('Google sign-in was cancelled or failed.')} />
            </GoogleOAuthProvider>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 my-6 text-xs text-[#a1a1aa] font-mono uppercase tracking-widest"><span className="flex-1 h-px bg-[#222]" />or<span className="flex-1 h-px bg-[#222]" /></div>
    </>
  );
}
