import { UserAgent, Registerer, Inviter, SessionState, RegistererState } from 'sip.js';

// Browser phone over our own Kamailio (WSS) with WebRTC media — calls route through our engine to Bird,
// exactly like a desk softphone. Exposes the same shape rtc.js expects: a controller + call objects
// whose `ref` has answer(), hangup() and dtmf().

const peerOf = (session) => {
  try { return session.sessionDescriptionHandler?.peerConnection || null; } catch { return null; }
};

// Pipe the remote audio track into the shared <audio> element.
function attachMedia(session, audioEl) {
  const pc = peerOf(session);
  if (!pc || !audioEl) return;
  const play = () => {
    const stream = new MediaStream();
    pc.getReceivers().forEach((r) => r.track && stream.addTrack(r.track));
    audioEl.srcObject = stream;
    audioEl.play().catch(() => {});
  };
  pc.ontrack = play;
  play();
}

const prettyPeer = (uri) => {
  const u = `${uri?.user || ''}`;
  return /^\d{8,15}$/.test(u) ? `+${u}` : u || uri?.toString?.() || '';
};

// Wrap a SIP.js session as the { ref, state, inbound, peer } object the UI uses.
function wrap(session, inbound, audioEl, onState) {
  const ref = {
    answer: () => session.accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } }),
    hangup: () => {
      const s = session.state;
      if (s === SessionState.Initial || s === SessionState.Establishing) {
        return inbound ? session.reject().catch(() => {}) : session.cancel().catch(() => {});
      }
      if (s === SessionState.Established) return session.bye().catch(() => {});
      return Promise.resolve();
    },
    dtmf: (k) => { try { session.sessionDescriptionHandler?.sendDtmf(k); } catch { /* not ready */ } },
  };
  const peer = prettyPeer(inbound ? session.remoteIdentity?.uri : session.request?.to?.uri || session.remoteIdentity?.uri);
  const uiState = (s) => (s === SessionState.Established ? 'active' : s === SessionState.Terminated ? 'hangup' : inbound ? 'ringing' : 'trying');
  session.stateChange.addListener((s) => {
    if (s === SessionState.Established) attachMedia(session, audioEl);
    onState(s === SessionState.Terminated ? null : { ref, state: uiState(s), inbound, peer });
  });
  onState({ ref, state: uiState(session.state), inbound, peer });
  return ref;
}

// Start a WSS line. cfg = { username, password, domain, webrtc:{ wss, iceServers } }. onState(call|null), onStatus('ready'|'idle'|'error').
export async function startSipLine(cfg, audioEl, { onState, onStatus, onError }) {
  const domain = cfg.domain;
  const uri = UserAgent.makeURI(`sip:${cfg.username}@${domain}`);
  if (!uri) throw new Error('bad-sip-uri');
  const ua = new UserAgent({
    uri,
    transportOptions: { server: cfg.webrtc.wss },
    authorizationUsername: cfg.username,
    authorizationPassword: cfg.password,
    logLevel: 'error',
    sessionDescriptionHandlerFactoryOptions: {
      iceGatheringTimeout: 3000,
      peerConnectionConfiguration: { iceServers: cfg.webrtc.iceServers || [], bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' },
    },
    delegate: {
      onInvite: (invitation) => wrap(invitation, true, audioEl, onState),
      onDisconnect: () => onStatus('idle'),
    },
  });
  ua.stateChange.addListener((s) => { if (s === 'Stopped') onStatus('idle'); });
  const registerer = new Registerer(ua, { expires: 300 });
  registerer.stateChange.addListener((s) => {
    if (s === RegistererState.Registered) onStatus('ready');
    else if (s === RegistererState.Unregistered) onStatus('idle');
  });
  await ua.start();
  await registerer.register({ requestDelegate: { onReject: () => onError('signin') } });

  return {
    // Outgoing call. extraHeaders: [{name,value}]. Returns the session wrapper ref.
    call: (dest, extraHeaders = []) => {
      const target = UserAgent.makeURI(`sip:${dest}@${domain}`);
      if (!target) return null;
      const inviter = new Inviter(ua, target, {
        sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
        extraHeaders: extraHeaders.map((h) => `${h.name}: ${h.value}`),
      });
      const ref = wrap(inviter, false, audioEl, onState);
      inviter.invite().catch(() => onState(null));
      return ref;
    },
    stop: async () => { try { await registerer.unregister(); } catch { /* */ } try { await ua.stop(); } catch { /* */ } },
  };
}
