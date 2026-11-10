# Solving a problem nobody has documented yet

Use this when `troubleshooting.md` and `docs/gotchas.md` don't cover what you see. Work like an engineer: evidence
first, the smallest test that tells hypotheses apart, then a fix, then a record.

## 1. Collect evidence (read-only)
```bash
bash scripts/tv-doctor.sh <tv-ip>:5555 > doctor.txt          # versions, switches, front screen, recent logs
adb logcat -d -v time -s WebLauncher > launcher.log           # this app only
adb logcat -d -v time | grep -E "ActivityTaskManager: START|PowerManagerService: (Waking|Going)|AndroidRuntime|FATAL" > system.log
adb logcat -d -b crash > crash.log
adb shell dumpsys activity activities | grep -E "topResumedActivity|ResumedActivity"
adb shell dumpsys meminfo com.weblauncher.tv | head -40
```
- Note the exact time the problem happened and line up the logs with it (`-v time`).
- `uptime` tells a reboot (minutes) from a wake from standby (hours).
- Ask the person what they pressed, in order. Ask for the TV model and the Android/WebView version
  (Launcher settings → About).
- Prefer logs to screenshots: a screenshot of someone's launcher can show private photos. If you need one, keep it
  local and delete it afterwards.

## 2. Place the problem in the model
Use SKILL.md → "How it works". Ask which part owns the symptom:
- **Who is in front, and who started it?** `START u0 … from uid <uid>`: uid of `com.weblauncher.tv`, the system
  (1000), Google TV home, a key mapper. Map uids: `adb shell pm list packages -U | grep <uid>`.
- **Did our code run?** Markers: `HOME_WATCH …`, `BOOT_OPEN …`, `STARTUP`, `SKIN`, `GUARD_*`.
- **Is it the page or the shell?** The page logs through the WebView console (also tag `WebLauncher`); a missing
  marker after `WEBVIEW_BUILT` points to the page, a missing `WEBVIEW_BUILT` to the shell.
- **Is it the skin?** Try safe mode (default skin). If it goes away, it is the skin → `skins.md` → Debug.
- **Is it this TV?** Other brands change Settings screens, Google TV home's activity names
  (`com.google.android.apps.tv.launcherx/.home.HomeActivity`, `…/.coreservices.bootmode.DispatchActivity`),
  standby behaviour and package visibility.

## 3. Test one hypothesis at a time
- Change one thing, then repeat the exact steps. Read logs between steps.
- Things ADB can't model: a held key (no repeats), the Home key through a key mapper app, a real wake from standby
  (ADB is off while the TV sleeps; ask the person to press Power).
- Don't use `am force-stop` on a TV in daily use (it turns "Web Launcher home" off). To restart the page, open
  another app for 2+ minutes, or use `adb install -r` of the same APK.
- Ask before any change to the TV's settings (SKILL.md rule 1).

## 4. Fix
- On the TV: settings the owner changes, a different skin, an update.
- In the repo: follow `develop.md`. Add a test in `tools/test/` that fails without the fix. Keep fixes generic (no
  TV- or person-specific values in code or docs).

## 5. Record it (so the next agent knows)
Pull requests are off; contributions are **issues**. With the person's OK, open an issue at
https://github.com/paulbennet/AndroidTVLauncher/issues/new (or `gh issue create -R paulbennet/AndroidTVLauncher`)
with:
```
Title: <symptom> on <TV model> (<Android version>, WebView <version>, Web Launcher <version>)

What happened:        <steps and what the person saw>
Expected:             <what should happen>
Evidence:             <the doctor output and the relevant log lines, trimmed; no personal data>
Cause (if known):     <which part, why>
Fix or workaround:    <what worked>
Suggested doc change: <a line for docs/gotchas.md or the skill's troubleshooting table>
```
Remove anything personal first: names, account e-mails, Wi-Fi names, IP addresses beyond the local range, photos.
For a security problem, open an issue titled "Security contact" without details (see `SECURITY.md`).
