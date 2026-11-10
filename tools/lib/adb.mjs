// Thin ADB wrapper for `lx push` (and `lx bench --tv` in M1.6). No shell in between, so paths are passed as-is.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const PKG = 'com.weblauncher.tv';
/** Dev skins folder, read by debug builds only (plan revision R6). */
export const DEV_SKINS = `/sdcard/Android/data/${PKG}/files/skins`;

export function adbPath() {
  if (process.env.ADB) return process.env.ADB;
  // D:\Android: the Claude desktop app is an MSIX package, so its writes to %LOCALAPPDATA% go to a private
  // per-app folder that the user's own shell can't see. Tools live outside AppData so both can use them.
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const sdks = [process.env.ANDROID_HOME, process.platform === 'win32' && 'D:\\Android\\Sdk',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk')];
  for (const p of sdks.filter(Boolean).map(s => join(s, 'platform-tools', exe))) {
    if (p && existsSync(p)) return p;
  }
  return 'adb';
}

/** serial: "host:port" (connected first), a USB serial, or empty for the only attached device. */
export function device(serial = process.env.TV || '') {
  const bin = adbPath();
  if (serial.includes(':')) execFileSync(bin, ['connect', serial], { stdio: 'ignore' });
  const run = (args, opts = {}) => execFileSync(bin, [...(serial ? ['-s', serial] : []), ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let state = '';
  try { state = run(['get-state']).trim(); } catch { /* not connected */ }
  if (state !== 'device') {
    throw new Error(`no ADB device${serial ? ` at ${serial}` : ''} (state: ${state || 'offline'}). Wake the TV and check that network debugging is on.`);
  }
  return {
    run,
    shell: cmd => run(['shell', cmd]),
    push: (local, remote) => run(['push', local, remote]),
  };
}
