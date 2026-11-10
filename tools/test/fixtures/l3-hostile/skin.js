// Sandbox test skin: every attempt is recorded in window.__results (the test reads it from the frame).
const results = window.__results = {};
const attempt = async (name, fn) => {
  try { results[name] = 'allowed: ' + String(await fn()).slice(0, 80); } catch (e) { results[name] = 'blocked: ' + e.name + (e.message ? ' ' + String(e.message).slice(0, 60) : ''); }
};

attempt('parentDocument', () => parent.document.title);
attempt('topLocation', () => top.location.href);
attempt('localStorage', () => { localStorage.setItem('x', '1'); return localStorage.getItem('x'); });
attempt('cookie', () => { document.cookie = 'x=1'; return document.cookie || 'none set'; });
attempt('bridge', () => (window.AndroidLauncher ? 'present' : (() => { throw new ReferenceError('absent'); })()));
// On the TV, WebView puts the bridge object in every frame (R16): calls without the page token must do nothing.
attempt('bridgeCall', () => {
  const b = window.AndroidLauncher;
  if (!b) throw new ReferenceError('absent');
  const apps = b.getApps('guess'), launched = b.launch('guess', 'com.google.android.youtube.tv');
  if (apps !== '[]' || launched !== false) return `apps=${String(apps).slice(0, 20)} launched=${launched}`;
  throw new Error('refused');
});
attempt('openWindow', () => { const w = window.open('about:blank'); if (!w) throw new Error('null'); return 'opened'; });

lx.on('data', d => {
  const row = document.querySelector('.row');
  row.replaceChildren(...d.apps.slice(0, 5).map(a => {
    const t = document.createElement('div');
    t.dataset.nav = ''; t.dataset.item = a.id; t.textContent = a.label;
    t.style.cssText = 'display:inline-block;width:150px;height:80px;margin:8px;background:#335';
    return t;
  }));
  // After the SDK reports the real focus, claim an app the core never sent, and ask for launches directly.
  setTimeout(() => {
    parent.postMessage({ lx: 1, type: 'focused', itemId: 'com.evil.app', action: null }, '*');
    parent.postMessage({ lx: 1, type: 'activate', itemId: d.apps[0].id }, '*');
    parent.postMessage({ lx: 1, type: 'focused', itemId: null, action: 'install' }, '*');
    results.claimed = true;
  }, 50);
});

addEventListener('load', () => {
  attempt('fetchCore', () => fetch('/index.html').then(r => r.status));
  attempt('fetchExternal', () => fetch('https://example.com/').then(r => r.status));
  attempt('imageExternal', () => new Promise((ok, fail) => {
    const i = new Image(); i.onload = () => ok('loaded'); i.onerror = () => fail(new Error('error')); i.src = 'https://example.com/x.png';
  }));
  attempt('focusSteal', () => { document.getElementById('grab').focus(); window.focus(); return 'called'; });
  attempt('topNavigate', () => { top.location.href = 'https://example.com/'; return 'set'; });
});

// For the TV (no DevTools needed): the frame's console reaches logcat through the core's WebChromeClient.
setTimeout(() => console.log('L3_HOSTILE ' + JSON.stringify(results)), 2000);

// With the INTERNET permission (M2.3), WebRTC is a way out that CSP connect-src doesn't cover (R21).
const rtcProbe = Ctor => new Promise((ok, fail) => {
  if (typeof Ctor !== 'function') return fail(new ReferenceError('absent'));
  let pc;
  try { pc = new Ctor({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); } catch (e) { return fail(e); }
  const seen = [];
  pc.onicecandidate = e => { if (e.candidate) seen.push(e.candidate.type || / typ (\w+)/.exec(e.candidate.candidate)?.[1]); };
  pc.createDataChannel('x');
  pc.createOffer().then(o => pc.setLocalDescription(o)).catch(fail);
  setTimeout(() => { pc.close(); seen.includes('srflx') ? ok('reached STUN: ' + seen.join(',')) : fail(new Error('no srflx: ' + seen.join(','))); }, 3000);
});
attempt('webrtc', () => rtcProbe(window.RTCPeerConnection));
addEventListener('load', () => attempt('webrtcBlankFrame', () => {
  const f = document.createElement('iframe');
  document.body.append(f);
  const w = f.contentWindow || window[0];
  if (!w) throw new ReferenceError('no child window');
  results.blankFrameCtor = typeof w.RTCPeerConnection;
  return rtcProbe(w.RTCPeerConnection);
}));
attempt('webSocket', () => new Promise((ok, fail) => {
  try { const ws = new WebSocket('wss://echo.websocket.events/'); ws.onopen = () => ok('open'); ws.onerror = () => fail(new Error('error')); } catch (e) { fail(e); }
}));
setTimeout(() => console.log('L3_HOSTILE_NET ' + JSON.stringify({ webrtc: results.webrtc, webrtcBlankFrame: results.webrtcBlankFrame, blankFrameCtor: results.blankFrameCtor, webSocket: results.webSocket })), 4500);
