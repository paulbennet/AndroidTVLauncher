# Troubleshooting (known problems, by symptom)

First run the read-only check (needs ADB to the TV): `bash scripts/tv-doctor.sh <tv-ip>:5555` from this skill's
folder. It prints versions, the two setup switches, the screen in front, and the recent `WebLauncher` log lines.

## Google TV and the Home screen
| Symptom | Cause | Fix |
|---|---|---|
| Google TV home after boot, wake or Home | "Web Launcher home" is off | Doctor: `homeWatch: off`. Owner turns it on (Set up this TV → step 1), see `develop.md` for ADB. |
| It was on and is off now | The app was force-stopped (Settings → Apps → Force stop, `am force-stop`, `lx bench --tv`, probe scripts) | Turn it on again. An update (`install -r`) keeps it. |
| Google TV home flashes ~1 s before Web Launcher | Normal: Web Launcher covers Google TV home, it can't replace it | Key mapper app for the Home button (Home → Web Launcher). |
| After boot Web Launcher comes 10–30 s late | The TV is busy starting; `BOOT_COMPLETED` arrives late | With "Web Launcher home" on it comes ~2 s after Google TV home. Normal on 2 GB TVs. |
| A Google profile or account screen appears | Google TV's own screens (launcherx) | Web Launcher leaves non-home launcherx screens alone on purpose. Finish or Back out of them. |
| `HOME_WATCH paused reason=loop` | Web Launcher couldn't stay in front 3 times in 30 s (crash loop?) | Look for crashes: `adb logcat -d -b crash`; safe mode; reinstall. |
| Home key over ADB does nothing or goes to Google TV | ADB keys skip key mapper apps | Test Home with the real remote. |

## Install
| Symptom | Cause | Fix |
|---|---|---|
| "App not installed", `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Installed copy has another signing key | Export settings (`lx settings export --tv`), uninstall, install. |
| Downloader can't open the link | Typo/capitals, or no network | `paulbennet.github.io/AndroidTVLauncher/apk`; or the release page link `…/releases/latest`. |
| Install blocked | "Install unknown apps" off for the downloading app | Owner allows it for that app only. |

## The launcher itself
| Symptom | Cause | Fix |
|---|---|---|
| Default skin with a message "turned off: …" | Runtime guard: `GUARD_TRIP reason=hang\|crash\|jank\|memory culprit=<skin>` | Fix the skin (`skins.md` → Debug), or pick another skin. |
| Broken screen, can't navigate | A skin broke the page | Hold **Back** 5 s (safe mode), or `am start -n com.weblauncher.tv/.MainActivity --ez safeMode true`. |
| Black screen for a few seconds after a long time away | Cold start: the process ends 2 min after it is hidden | Normal (page in ~1.5 s, longer just after boot or install). Tune: `--el exitDelayMs 0` (never exit) — costs memory. |
| No `STARTUP` log, nothing drawn | The Google TV screensaver (`dreamx`) is in front | `adb shell input keyevent KEYCODE_WAKEUP`. |
| Apps missing | Hidden, or the list is stale | Launcher settings → Show hidden apps / Reload app list. |
| Long press OK also opens the app | Old version (< 1.0.2) | Update. |
| Install skin page unreachable from the phone | Phone on another network, or the page is closed | Same Wi-Fi; keep **Install skin** on screen (the server runs only then); use the PIN shown. |
| Gallery says it can't load | Only public **https** hosts; limits 256 KB index, 5 MB package; checksum mismatch | Fix the host or rebuild with `lx gallery build`. |

## ADB and measuring
| Symptom | Cause | Fix |
|---|---|---|
| `adb` "offline" or timeouts | TV in standby (network ADB stops) | Press Power on the remote, `adb connect` again. |
| `unauthorized` | Prompt not accepted | Accept "Allow network debugging" on the TV. |
| Bench numbers jump | Debug build, screensaver, first run after install, another bench running | Release build, wake first, 3+ runs, one bench at a time. |
| Long-press tests behave oddly over ADB | `input keyevent --longpress/--duration` send no key repeats | Test with the real remote. |
| `lx` says Chrome for Testing not found | Browser not installed | `npx playwright-core install chromium` or set `LX_CHROME`. |
| `npm test` "no test files" | Folder given instead of the glob | `node --test "tools/test/*.test.mjs"` (`npm test` does it). |

More: `docs/gotchas.md` in the repo. Not listed here → [new-problems.md](new-problems.md).
