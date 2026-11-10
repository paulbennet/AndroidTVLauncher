// The native bridge (window.AndroidLauncher), with this page's token added to every call (plan revision R16).
// Android WebView injects addJavascriptInterface objects into every frame, L3 skin iframes included, so the
// bridge alone can't tell the core from a skin. The shell puts a fresh random token into the top page's HTML
// (main-frame requests only, never into a frame or fetch) and rejects calls without it. A skin frame is
// cross-origin and can't read it.
const raw = window.AndroidLauncher || null;
const meta = document.querySelector('meta[name="lx-token"]');
const token = meta ? meta.content : '';
if (meta) meta.remove();

export const bridge = raw && new Proxy(raw, {
  get(target, key) {
    // Called as target[key](…): Java bridge methods need their own object as `this`.
    return typeof target[key] === 'function' ? (...args) => target[key](token, ...args) : target[key];
  },
});
