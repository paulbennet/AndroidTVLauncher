// Desktop server for the launcher UI (mock bridge) — used by tools/serve.mjs and `lx dev/lint`.
// Serves app/src/main/assets/web, generates /skins/index.json like the Android SkinStore (bundled ids win),
// and can inject a live-reload client into index.html.
// /__skin/… stands in for the TV's https://skin.local/ host (level 3 skin pages, plan M2.1); see LocalAssetClient.kt.
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, extname, normalize, resolve, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'app', 'src', 'main', 'assets', 'web');
export const BUNDLED_SKINS = join(WEB_ROOT, 'skins');
export const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.mjs': 'text/javascript',
};

/** CSP of a level 3 skin page (same as LocalAssetClient.kt). base: the skin host URL; parent: the core origin. */
export function skinPageCsp(base, parent) {
  const meta = `default-src 'none'; script-src ${base}; style-src ${base} 'unsafe-inline'; img-src ${base} data: blob:; `
    + `font-src ${base}; media-src ${base}; connect-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; `
    + `form-action 'none'; base-uri 'none'`;
  return { meta, header: parent ? `${meta}; frame-ancestors ${parent}` : meta };
}

/** A skin's entry page with the CSP and the SDK shim put first (the SDK must run before the skin's scripts). */
export function skinPage(html, base, csp) {
  const body = String(html).replace(/^﻿?\s*<!doctype[^>]*>/i, '');
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script src="${base}__lx/sdk.js"></script>\n${body}`;
}

/** The skin host is the other loopback name, so the skin frame is cross-site like https://skin.local on the TV. */
export const otherLoopback = host => (/^localhost(:|$)/.test(host) ? host.replace('localhost', '127.0.0.1') : host.replace(/^127\.0\.0\.1/, 'localhost'));

const RELOAD_CLIENT = `// lx dev live reload (desktop only)
const es = new EventSource('/__lx/events');
es.onmessage = () => location.reload();
`;

/**
 * options.skinFolders: [{ dir, source }]  folders whose subfolders are skins
 * options.skins:       [{ dir, source }]  single skin folders (id = folder name)
 * options.staged:      { <stage id>: dir }  served at /staged/<stage>/ like SkinInstaller (install-time lint tests)
 */
export function startServer({ port = 0, skinFolders = [], skins = [], liveReload = false, staged = {} } = {}) {
  const clients = new Set();

  async function skinDirs() {
    const out = new Map([]); // id -> { dir, source }
    const add = (id, dir, source) => { if (SKIN_ID.test(id) && !out.has(id)) out.set(id, { dir, source }); };
    let bundled = [];
    try { bundled = await readdir(BUNDLED_SKINS); } catch { /* none */ }
    for (const id of bundled) add(id, join(BUNDLED_SKINS, id), 'bundled');
    for (const { dir, source = 'dev' } of skins) add(basename(resolve(dir)), resolve(dir), source);
    for (const { dir, source = 'dev' } of skinFolders) {
      let names = [];
      try { names = await readdir(dir); } catch { continue; }
      for (const id of names) add(id, join(resolve(dir), id), source);
    }
    return out;
  }

  /** Same as SkinStore.badge on the TV for dev skins: what the package's score.json claims. */
  async function badge(dir, source) {
    if (source === 'bundled') return null;
    try {
      const sc = JSON.parse(await readFile(join(dir, 'score.json'), 'utf8'));
      return { tier: sc.tier ?? null, estimate: sc.tierEstimate !== false, score: sc.bench?.score ?? null,
        device: sc.bench?.device?.model ?? null, lintOk: sc.lint?.ok === true };
    } catch { return null; }
  }

  async function skinIndex() {
    const list = [];
    for (const [id, { dir, source }] of await skinDirs()) {
      try {
        const m = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
        if (m.id !== id) continue;
        list.push({ id, name: String(m.name || id), version: String(m.version || ''), level: m.level, author: String(m.author || ''), source, badge: await badge(dir, source) });
      } catch { /* skip invalid skins */ }
    }
    const rank = s => (s.source === 'bundled' ? 0 : 1);
    return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }

  const send = (res, code, type, body, extra = {}) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
    res.end(body);
  };

  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/\\/g, '/').replace(/^\/+/, '');
    if (path.includes('..')) return send(res, 400, 'text/plain', '');
    try {
      if (liveReload && path === '__lx/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (liveReload && path === '__lx/reload.js') return send(res, 200, TYPES['.js'], RELOAD_CLIENT);
      if (path === 'skins/index.json') return send(res, 200, TYPES['.json'], JSON.stringify(await skinIndex()));

      // Level 3 skin host: sandboxed iframe pages, the SDK, and nav.js for the SDK (opaque origin, so CORS *).
      const h = path.match(/^__skin\/(.+)$/);
      if (h) {
        const base = `http://${req.headers.host}/__skin/`;
        const csp = skinPageCsp(base, `http://${otherLoopback(req.headers.host)}`);
        const extra = { 'Content-Security-Policy': csp.header, 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff', 'X-DNS-Prefetch-Control': 'off' };
        let file, sdk = h[1].match(/^__lx\/(sdk|nav)\.js$/);
        if (sdk) file = join(WEB_ROOT, 'core', sdk[1] + '.js');
        else {
          const sm = h[1].match(/^([^/]+)\/(.+)$/);
          const skin = sm && (await skinDirs()).get(sm[1]);
          if (!skin) return send(res, 404, 'text/plain', 'no such skin', extra);
          file = resolve(skin.dir, sm[2]);
          if (!file.startsWith(skin.dir + sep)) return send(res, 400, 'text/plain', '', extra);
        }
        let body = await readFile(file);
        if (extname(file).toLowerCase() === '.html') body = Buffer.from(skinPage(body, base, csp.meta));
        return send(res, 200, TYPES[extname(file).toLowerCase()] || 'application/octet-stream', body, extra);
      }

      const st = path.match(/^staged\/([0-9a-f]{12})\/(.+)$/);
      if (st) {
        const dir = staged[st[1]] && resolve(staged[st[1]]);
        const f = dir && resolve(dir, st[2]);
        if (!f || !f.startsWith(dir + sep)) return send(res, 404, 'text/plain', '');
        const type = /\.html?$/i.test(f) ? 'text/plain' : TYPES[extname(f).toLowerCase()] || 'application/octet-stream';
        return send(res, 200, type, await readFile(f), { 'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Content-Type-Options': 'nosniff' });
      }

      let file;
      const m = path.match(/^skins\/([^/]+)\/(.+)$/);
      if (m) {
        const skin = (await skinDirs()).get(m[1]);
        if (!skin) return send(res, 404, 'text/plain', 'no such skin');
        file = resolve(skin.dir, m[2]);
        if (!file.startsWith(skin.dir + sep)) return send(res, 400, 'text/plain', '');
      } else {
        file = join(WEB_ROOT, path || 'index.html');
      }
      let body = await readFile(file);
      if (file === join(WEB_ROOT, 'index.html')) {
        // index.html carries no desktop-only script (a classic script there cost ~550 ms of parser time on the
        // VU31), so the mock bridge is added here. It must run before the core module, so it goes first.
        let html = String(body).replace('<link rel="stylesheet"', '<script src="/mock.js"></script>\n  <link rel="stylesheet"')
          .replace('frame-src https://skin.local', `frame-src http://${otherLoopback(req.headers.host)}/__skin/`);
        if (liveReload) html = html.replace('</body>', '<script type="module" src="/__lx/reload.js"></script></body>');
        body = Buffer.from(html);
      }
      send(res, 200, TYPES[extname(file).toLowerCase()] || 'application/octet-stream', body);
    } catch { send(res, 404, 'text/plain', 'not found'); }
  });

  return new Promise(ok => server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${server.address().port}`;
    ok({
      server, url, skinDirs,
      reload() { for (const c of clients) c.write('data: reload\n\n'); },
      // server.close() waits for every keep-alive connection, and a browser page still open on this server can
      // hold one for longer than a test's timeout: drop them.
      close() {
        for (const c of clients) c.end();
        const closed = new Promise(done => server.close(done));
        server.closeAllConnections?.();
        return closed;
      },
    });
  }));
}
