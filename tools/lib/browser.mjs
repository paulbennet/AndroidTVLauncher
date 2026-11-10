// Launches Google Chrome for Testing for `lx` (never another browser; see the user's playwright rule).
// Uses LX_CHROME if set, else the newest Chrome for Testing installed by Playwright (ms-playwright/chromium-*).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

export function chromeForTesting() {
  if (process.env.LX_CHROME) return process.env.LX_CHROME;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
    || (platform() === 'win32' ? join(process.env.LOCALAPPDATA || '', 'ms-playwright')
      : platform() === 'darwin' ? join(homedir(), 'Library', 'Caches', 'ms-playwright')
        : join(homedir(), '.cache', 'ms-playwright'));
  const candidates = {
    win32: ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'],
    darwin: ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'],
    linux: ['chrome-linux64/chrome', 'chrome-linux/chrome'],
  }[platform()] || [];
  let dirs = [];
  try { dirs = readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1]); } catch { /* none */ }
  for (const d of dirs) for (const c of candidates) { const p = join(root, d, c); if (existsSync(p)) return p; }
  throw new Error('Chrome for Testing not found. Run `playwright-cli install-browser chrome-for-testing` or set LX_CHROME.');
}

/** Opens a page at 1280×720 (layout scales with width, so this matches the TV's 960×540 css px). */
export async function openPage({ headless = true } = {}) {
  const { chromium } = await import('playwright-core');
  // One renderer for the page and a level 3 skin frame, as in Android WebView (no site isolation there), so the
  // bench measures the frame the way the TV runs it.
  const args = ['--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process,IsolateSandboxedIframes'];
  const browser = await chromium.launch({ executablePath: chromeForTesting(), headless, args });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  return { browser, page };
}
