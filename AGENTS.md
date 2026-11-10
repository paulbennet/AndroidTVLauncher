# Agent guide

Read `skills/web-tv-launcher/SKILL.md` first: it routes TV setup, development, troubleshooting and skin work, and
its rules apply here too (TV security settings belong to the TV's owner; never force-stop the app on a TV in daily
use; private pictures never go into public skins or this repo).

## Working in this repo
- Tests: `npm test` (Node `--test` with the glob `tools/test/*.test.mjs`; Playwright drives Chrome for Testing:
  `npx playwright-core install chromium`). Add a test that fails without your change.
- Desktop preview: `node tools/serve.mjs` → `http://localhost:5173/?apps=50` (`&skin=<id>`, `&safe=1`, `&googletv`).
  The native bridge is mocked in `app/src/main/assets/web/mock.js`: mock every new bridge method.
- Every `LauncherBridge` method takes the page token first; skins must stay without network.
- APK: `. scripts/env.sh && ./gradlew assembleRelease testReleaseUnitTest` (JDK 17, Android SDK 34). Local paths and
  the TV address go in the git-ignored `scripts/env.local.sh`.
- Measure speed only on a real TV with a release build (`lx bench --tv`); desktop numbers are estimates.
- Docs to keep current: `README.md`, `docs/` (`gotchas.md` for every new generic trap), and the skill in
  `skills/web-tv-launcher/` (its references and `scripts/tv-doctor.sh`). Keep the version in `app/build.gradle.kts`,
  `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugin.json`, `.codex-plugin/plugin.json` and
  the skill's `metadata.version` the same (a test checks it).
- Line endings LF. Contributions are issues only (pull requests are off).
