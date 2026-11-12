# Security

Skins are untrusted code by design: see "Serving and isolation" in [docs/launcher-v1-plan.md](docs/launcher-v1-plan.md)
and [docs/skin-api.md](docs/skin-api.md). A skin has no network, can't call the native bridge, and can launch only
apps the core gave it, and only when the user presses OK.

## Reporting a problem
Open an issue titled "Security contact" and give no details in it. A private way to send the details
will follow in the issue.

## Known limits
- **DNS rebinding:** fixed in 1.3.1. Gallery and URL downloads check the host name before connecting, and the TLS
  layer checks the address the TV really connected to (`PublicNet.Guard`), so a rebinding name can't reach a LAN
  address. Through a system proxy only the name check applies, because the proxy resolves the name.
- The LAN install page (`http://<tv>:7190/`) is plain http on the home network, protected by a 6-digit PIN, and open
  only while **Install skin** is on screen.
- **Accessibility service (optional):** `HomeWatchService` gets only window-state events from Google TV home
  (`com.google.android.apps.tv.launcherx`). It can't read window content or keys.
