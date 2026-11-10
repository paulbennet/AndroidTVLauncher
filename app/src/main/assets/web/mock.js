// Desktop preview only: fakes window.AndroidLauncher when the page runs outside the Android shell.
// Launches are recorded in window.__launched (tests check that a skin can't launch what it wasn't given).
(function () {
  'use strict';
  if (window.AndroidLauncher) return;

  const apps = [
    ['com.netflix.ninja', 'Netflix', '#e50914'],
    ['com.google.android.youtube.tv', 'YouTube', '#ff0033'],
    ['com.amazon.amazonvideo.livingroom', 'Prime Video', '#1a98ff'],
    ['in.startv.hotstar', 'JioHotstar', '#0f1d6b'],
    ['com.google.android.youtube.tvkids', 'YouTube Kids', '#ff3d00'],
    ['com.android.vending', 'Play Store', '#01875f'],
    ['com.android.tv.settings', 'Settings', '#5f6368'],
    ['com.sony.dtv.tvx', 'TV', '#333366'],
    ['com.sony.dtv.timers', 'Timers & Clock', '#455a64'],
    ['com.tcl.browser', 'BrowseHere', '#1565c0'],
    ['com.sony.dtv.mediaplayer', 'Media Player', '#6a1b9a'],
    ['com.omeda.arc', 'Arc Launcher', '#37474f'],
    ['flar2.homebutton', 'Button Mapper', '#00897b'],
    ['com.google.android.play.games', 'Play Games', '#2e7d32'],
    ['com.sony.dtv.ecodashboard', 'Eco Dashboard', '#558b2f'],
  ];
  const withBanner = new Set(['com.netflix.ninja', 'com.google.android.youtube.tv',
    'com.amazon.amazonvideo.livingroom', 'in.startv.hotstar', 'com.google.android.youtube.tvkids']);

  // ?apps=N: deterministic reference data for lint and bench (plan: 50 apps). Every 4th extra app has a banner.
  const wantApps = Math.min(500, Number(new URLSearchParams(location.search).get('apps')) || 0);
  for (let i = apps.length; i < wantApps; i++) {
    const pkg = `com.example.ref${String(i).padStart(3, '0')}`;
    apps.push([pkg, `Reference App ${i}`, `hsl(${(i * 47) % 360} 55% 40%)`]);
    if (i % 4 === 0) withBanner.add(pkg);
  }

  function bannerSvg(label, color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">
      <rect width="320" height="180" fill="${color}"/>
      <text x="160" y="102" font-family="Segoe UI,Arial" font-size="30" font-weight="700"
        fill="#fff" text-anchor="middle">${label}</text></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  window.__mockImages = {};
  for (const [pkg, label, color] of apps) {
    if (withBanner.has(pkg)) window.__mockImages[pkg] = bannerSvg(label, color);
  }

  window.AndroidLauncher = {
    // Every method takes the page token first, like the real bridge (core/bridge.js adds it).
    getApps: _t => JSON.stringify(apps.map(([pkg, label]) => ({
      pkg, label, hasBanner: withBanner.has(pkg), isTvApp: true,
    }))),
    launch: (_t, pkg) => { console.log('[mock] launch', pkg); window.__launched.push(pkg); window.launcher.toast('Launch ' + pkg); return true; },
    openAppInfo: (_t, pkg) => window.launcher.toast('App info: ' + pkg),
    openSettings: _t => window.launcher.toast('Android settings'),
    setActiveSkin: (_t, id, measured) => { window.__activeSkin = { id, measured }; },
    // TV inputs (M3.1). None in bench mode, as on the TV (scores must not depend on the TV's inputs).
    getInputs: _t => JSON.stringify(new URLSearchParams(location.search).has('bench') ? [] : [
      { id: 'hdmi1', label: 'HDMI 1', kind: 'hdmi', connected: true },
      { id: 'hdmi2', label: 'HDMI 2', kind: 'hdmi', connected: false },
      { id: 'hdmi3', label: 'HDMI 3 / ARC', kind: 'hdmi', connected: false },
      { id: 'tuner', label: 'Channels', kind: 'tuner', connected: true },
    ]),
    openInput: (_t, id) => { (window.__inputs ||= []).push(id); return true; },
    // Skin gallery (M4). The desktop preview has no native downloads: tests put a result in window.__gallery.
    galleryLoad: (_t, url) => { window.__galleryLoads = (window.__galleryLoads || 0) + 1; setTimeout(() => window.launcher.onGallery(window.__gallery || { ok: false, error: 'the desktop preview has no gallery' }), 30); return true; },
    galleryPreview: (_t, id) => { setTimeout(() => window.launcher.onGalleryPreview(id, false), 30); return true; },
    galleryInstall: (_t, id) => { (window.__galleryInstalls ||= []).push(id); return true; },
    // Open at TV start (M4): never allowed on the desktop.
    getBootOpen: _t => JSON.stringify({ enabled: window.__bootOpen !== false, allowed: false }),
    setBootOpen: (_t, on) => { window.__bootOpen = on; },
    // Set up this TV: `?googletv` acts like a Google TV with nothing turned on; tests change it with window.__setup.
    getSetup: _t => JSON.stringify({ googleTv: /[?&]googletv\b/.test(location.search), homeWatch: false, overlay: false, bootOpen: window.__bootOpen !== false, ...(window.__setup || {}) }),
    openSetupScreen: (_t, which) => { (window.__setupOpened ||= []).push(which); return true; },
    // Install (M2.3): desktop preview only shows the screen; installs need the TV.
    installOpen: _t => { window.__installOpen = true; return JSON.stringify({ lan: { url: 'http://192.168.1.20:7190/', pin: '123456' }, picker: false, inbox: null, dev: !!window.__devMode }); },
    installClose: _t => { window.__installOpen = false; },
    installDevMode: (_t, on) => { window.__devMode = on; },
    installInbox: _t => false,
    installFromPicker: _t => false,
    removeSkin: (_t, id) => false,
    stagedChecked: (_t, stage, json) => { (window.__staged ||= {})[stage] = JSON.parse(json); },
    getDeviceInfo: _t => JSON.stringify({
      model: 'Desktop preview', sdk: 34, availMemMb: 512, totalMemMb: 1400, lowMemory: false, version: 'mock',
    }),
  };
  window.__launched = [];
  window.__isMock = true;
})();
