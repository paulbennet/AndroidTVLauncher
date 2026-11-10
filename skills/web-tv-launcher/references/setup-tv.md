# Set up Web TV Launcher on a TV (for people who aren't engineers)

Use this when the person has only the TV and its remote, maybe a phone. No computer, no ADB.
The public, illustrated version is `docs/setup-guide.md` in the repo
(https://github.com/paulbennet/AndroidTVLauncher/blob/main/docs/setup-guide.md): send them that link too.

## How to guide
- **One step at a time.** Say what to press and what they will see next. Ask "What do you see now?" after each step.
- Use the words on the TV screen, in **bold**. Remote keys: arrows, **OK** (the centre button), **Back**, **Home**.
- If what they see differs, ask them to read the screen to you (or send a phone photo), then adapt.
- Don't rush the security prompts. Explain each one in one sentence (below) and let them decide.

## Before you start (check together)
- The TV runs **Google TV** or **Android TV** (Settings → System → About shows "Android TV OS" and a version).
  Android 7 or newer. Fire TV, Roku, webOS, Tizen: not supported.
- The TV is online and signed in to the Play Store.
- About 5 minutes.

## Step 1: install the app
1. **Play Store** → search **Downloader** (by AFTVnews) → **Install** → **Open**.
2. In Downloader's address box type `paulbennet.github.io/AndroidTVLauncher/apk` → **Go**.
   Capitals matter in `AndroidTVLauncher`. The download is about 170 KB.
3. The TV says Downloader may not install apps → **Settings** → turn **Downloader** on → **Back**.
   Why: Android only installs apps from outside the Play Store when the person allows the app that downloads them.
   Other names: "Unknown sources", "Install unknown apps" (Settings → Apps → Security & restrictions).
4. **Install** → **Done**. Downloader may offer to delete the file: **Delete** is fine.
   - "App not installed": an older Web Launcher signed with another key is on the TV. It must be uninstalled first
     (Settings → Apps → Web Launcher → Uninstall); that removes its favourites.
   - "There was a problem parsing the package": the download broke. Try step 2 again.
   - If Downloader opens a web page instead, pick the **web-launcher.apk** link on it.

## Step 2: turn on "Web Launcher home"
1. Open **Web Launcher**: Home → Apps (or "Your apps") → **Web Launcher**. On Google TV it shows
   **Set up this TV** by itself the first time.
2. Pick **1. Open instead of Google TV home**. The TV's **Accessibility** settings open.
3. Go down to **Services** → **Web Launcher home** → **Enable** on. If the TV asks, **OK** / **Allow**.
   Why, in one sentence for them: "Google TV always keeps its own home screen; this switch lets Web Launcher notice
   when Google TV home opens and show itself instead. It can't read the screen or what you type."
   Android shows a strong general warning for every accessibility service; that is normal.
4. **Back** until Web Launcher is on screen. Step 1 now says **On**.

If **Set up this TV** didn't appear: hold **OK** on any app → **Launcher settings** → **Set up this TV**.
If the TV has no Accessibility screen there: Settings → System → Accessibility (or Settings → Device Preferences →
Accessibility) → Services.

## Step 3: optional
- **2. Faster start after the TV starts:** pick it → **Web Launcher** → allow **Display over other apps**. Then Web
  Launcher also opens by itself right after boot. Not needed when step 1 is on.
- **The Home button:** with step 1 on, Home shows Google TV home for about a second, then Web Launcher. To skip that:
  install **Button Mapper** (Play Store), give it its accessibility permission, and set Home → single press →
  open app → **Web Launcher**. Some Home options may be paid in Button Mapper.

## Check it works
- Press **Home**: Web Launcher is back within about a second.
- Turn the TV off with the remote and on again: Web Launcher shows after Google TV home flashes.
- Optional: unplug the TV for 30 s and start it: Web Launcher appears after start-up (it can take 10–30 s on slow
  TVs while the TV is busy starting).

## Everyday use (tell them)
Arrows move, **OK** opens, **hold OK** opens the app menu (favourite, move, hide, app info, **Launcher settings**).
**Launcher settings → Skin** changes the look. **Install skin** shows a QR code and a PIN to add skins from a phone.

## When it goes wrong
| What they see | What to do |
|---|---|
| Google TV home stays | **Set up this TV**: step 1 must say On. If it says Off, turn it on again (Android turns it off after **Force stop** in Settings → Apps). |
| Web Launcher looks broken or slow | Hold **Back** 5 seconds: safe mode with the default skin. Then **Launcher settings → Skin**. |
| A skin they chose was replaced | The guard found it too slow or broken and switched to the default skin; the message says why. |
| Apps are missing | Hold **OK** → **Launcher settings** → **Show hidden apps** or **Reload app list**. |
| They want Google TV home back for good | Settings → Apps → **Web Launcher** → **Uninstall**. |

## When you need more than the remote
If the problem needs logs, ask whether an engineer (or they, with your step-by-step help) can connect a computer
with ADB. Turning on developer options and network debugging is a security change for their TV: explain it and
let them decide. Steps: Settings → System → About → press **OK** on **Android TV OS build** 7 times → Settings →
System → **Developer options** → **Network debugging** (or **USB debugging**) on → note the IP address
(Settings → Network & Internet → their network). Then follow `develop.md` → "Connect to a TV" and run
`scripts/tv-doctor.sh`. Suggest turning network debugging off again afterwards.
