package com.weblauncher.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature

/**
 * Hosts the HTML/JS/CSS launcher UI in a single full-screen WebView.
 * Everything visual lives in assets/web; this class only wires lifecycle and keys to JS.
 *
 * Memory: the WebView renderer keeps what heavy pages allocated (measured 62 -> 98 MiB). While another app
 * is in front, the WebView is destroyed after the release delay (default 60 s), or at once on TRIM_MEMORY_BACKGROUND,
 * which frees the renderer process. After the exit delay (default 2 min) the whole process ends too.
 * Both are rebuilt when the launcher comes back.
 */
class MainActivity : Activity() {

    private lateinit var root: FrameLayout
    private lateinit var apps: AppRepository
    private lateinit var skins: SkinStore
    private var web: WebView? = null
    private var safeModeFired = false // Back held for SAFE_MODE_HOLD_MS during the current press
    private var started = false
    private val handler = Handler(Looper.getMainLooper())
    private val releaseWhenHidden = Runnable { releaseWebView("hidden ${releaseDelayMs / 1000}s") }
    private val exitWhenHidden = Runnable { exitProcess("hidden ${exitDelayMs / 1000}s") }
    private val safeModeOnHold = Runnable {
        safeModeFired = true
        Log.i(TAG, "SAFE_MODE back held")
        web?.loadUrl(LocalAssetClient.ORIGIN + SAFE_PAGE) ?: buildWebView(SAFE_PAGE)
    }
    private var exiting = false

    // Tunable for measurement (scripts/return-test.sh): `am start ... --el releaseDelayMs N --el exitDelayMs N`.
    private val tuning by lazy { getSharedPreferences("tuning", MODE_PRIVATE) }
    private val releaseDelayMs get() = tuning.getLong(KEY_RELEASE, DEFAULT_RELEASE_DELAY_MS)
    private val exitDelayMs get() = tuning.getLong(KEY_EXIT, DEFAULT_EXIT_DELAY_MS)

    val frameStats = FrameStats(this)
    /** Plan M2.2: reloads with the default skin when the running skin hangs, crashes, janks or uses too much memory. */
    val guard = RuntimeGuard(this, ::onGuardTrip)
    /** Plan M2.3: every install path (ADB inbox, LAN page, URL, USB picker) ends in [installer]. */
    lateinit var installer: SkinInstaller
        private set
    /** Plan M4 (decision D7 b): the remote skin gallery client. */
    val gallery by lazy { SkinGallery(installer, skins) }
    /** Plan M3.1: HDMI and other TV inputs. */
    val inputs by lazy { InputRepository(this) { callJs("onInputsChanged()") } }
    val lan by lazy {
        LanInstallServer(installer, { r, dev -> notifyInstalled(r, dev) }, { pin -> callJs("onInstallPin(" + org.json.JSONObject.quote(pin) + ")") },
            exportSettings = { evalJs("launcher.exportSettings()") },
            importSettings = { text -> evalJs("launcher.importSettings(" + org.json.JSONObject.quote(text) + ")") },
            setGalleryUrl = { url -> evalJs("launcher.setGalleryUrl(" + org.json.JSONObject.quote(url) + ")") },
            onLocked = { callJs("onInstallLocked()") })
    }
    var createdAtUptime = 0L
        private set
    var webViewCreatedAtUptime = 0L
        private set

    private val packageReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            apps.invalidate()
            callJs("onAppsChanged()")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createdAtUptime = SystemClock.uptimeMillis()
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        blockWebViewNetwork()

        applyTuning(intent)
        apps = AppRepository(this)
        // Querying PackageManager takes ~300 ms on the VU31; do it while the WebView renderer starts (~1 s)
        // so the page's first getApps() is served from the cache.
        Thread({ runCatching { apps.list() } }, "apps-prefetch").start()
        skins = SkinStore(this)
        installer = SkinInstaller(skins, java.io.File(filesDir, "skin-meta")).also { it.check = ::checkStaged }
        skins.meta = installer::meta
        applyBench(intent)
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        setContentView(root)
        buildWebView(pageFor(intent))
        if (intent?.getBooleanExtra(EXTRA_FROM_BOOT, false) == true) Log.i(TAG, "BOOT_OPEN shown")
        if (intent?.getBooleanExtra(EXTRA_FROM_HOME_WATCH, false) == true) Log.i(TAG, "HOME_WATCH shown")

        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addAction(Intent.ACTION_PACKAGE_CHANGED)
            addDataScheme("package")
        }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(packageReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else registerReceiver(packageReceiver, filter)
    }

    // ---------------------------------------------------------------- WebView lifecycle

    /**
     * Plan revision R23. Every page the WebView shows is served by LocalAssetClient, so it needs no network. With the
     * INTERNET permission (M2.3) a skin frame could still open connections that CSP doesn't cover: measured on the
     * VU31, `<link rel=preconnect>` reached another host. A proxy that refuses every connection stops all of them.
     */
    private fun blockWebViewNetwork() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) { Log.w(TAG, "PROXY_OVERRIDE not supported"); return }
        val config = ProxyConfig.Builder().addProxyRule(DEAD_PROXY).build()
        ProxyController.getInstance().setProxyOverride(config, { it.run() }) { Log.i(TAG, "WEBVIEW_PROXY $DEAD_PROXY") }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildWebView(page: String) {
        webViewCreatedAtUptime = SystemClock.uptimeMillis()
        val w = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            isFocusable = true
            isFocusableInTouchMode = true
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true // localStorage holds favourites / hidden apps
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = true
            val bridge = LauncherBridge(this@MainActivity, apps, skins)
            webViewClient = LocalAssetClient(this@MainActivity, apps, skins, bridge, installer, ::onRendererGone)
            webChromeClient = object : WebChromeClient() {
                // Page console -> logcat (tag WebLauncher); scripts/probe.sh collects results from here.
                override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                    Log.i(TAG, m.message())
                    return true
                }
                // Allow DRM (EME / Widevine) checks for our own origin only.
                override fun onPermissionRequest(request: PermissionRequest) {
                    val ours = request.origin.host == LocalAssetClient.HOST
                    val drm = PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID
                    if (ours && drm in request.resources) request.grant(arrayOf(drm)) else request.deny()
                }
            }
            addJavascriptInterface(bridge, "AndroidLauncher") // calls need the page token (LauncherBridge)
        }
        root.addView(w, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        w.requestFocus()
        w.loadUrl(LocalAssetClient.ORIGIN + page)
        web = w
        guard.attach(w)
        if (started) guard.resume()
        Log.i(TAG, "WEBVIEW_BUILT page=$page")
    }

    private fun releaseWebView(reason: String) {
        handler.removeCallbacks(releaseWhenHidden)
        val w = web ?: return
        web = null
        guard.detach(w)
        root.removeView(w)
        w.stopLoading()
        // destroy() alone leaves Chromium's renderer process alive (measured: same pid, ~70 MB kept).
        // Terminating it frees that memory; onRendererGone ignores it because `web` is already null.
        val killed = Build.VERSION.SDK_INT >= 29 && (w.webViewRenderProcess?.terminate() ?: false)
        w.destroy()
        apps.trimIcons()
        Log.i(TAG, "WEBVIEW_RELEASED reason=$reason rendererTerminated=$killed")
    }

    /**
     * Long hidden (e.g. watching a film): end the whole process, which frees Chromium's browser side (~75 MB) as well.
     * Opening the launcher again is then a cold start. The task is removed so nothing tries to restore it.
     */
    private fun exitProcess(reason: String) {
        if (started) return
        Log.i(TAG, "PROCESS_EXIT reason=$reason")
        exiting = true
        releaseWebView("process exit")
        finishAndRemoveTask()
    }

    private fun applyTuning(intent: Intent?) {
        intent ?: return
        if (intent.getBooleanExtra(KEY_RESET, false)) { tuning.edit().clear().apply(); Log.i(TAG, "TUNING reset to defaults") }
        val e = tuning.edit()
        if (intent.hasExtra(KEY_RELEASE)) e.putLong(KEY_RELEASE, intent.getLongExtra(KEY_RELEASE, DEFAULT_RELEASE_DELAY_MS).coerceIn(5_000L, 3_600_000L))
        if (intent.hasExtra(KEY_EXIT)) intent.getLongExtra(KEY_EXIT, DEFAULT_EXIT_DELAY_MS).let { e.putLong(KEY_EXIT, if (it <= 0L) 0L else it.coerceIn(30_000L, 86_400_000L)) }
        e.apply()
        if (intent.hasExtra(KEY_RELEASE) || intent.hasExtra(KEY_EXIT)) Log.i(TAG, "TUNING releaseDelayMs=$releaseDelayMs exitDelayMs=$exitDelayMs")
    }

    /** The system killed or crashed the renderer: without this the whole app would crash with it. */
    private fun onRendererGone(view: WebView, crashed: Boolean) {
        if (view !== web) return
        // The WebView built right after a guard trip can share the renderer the trip terminated: it dies too.
        // Load the same guard page again, and don't count it as a crash.
        val echo = guardReload?.takeIf { SystemClock.uptimeMillis() - guardReloadAt < GUARD_ECHO_MS }
        guardReload = null
        val culprit = guard.skin
        val tripped = echo == null && started && guard.rendererGone()
        releaseWebView(if (crashed) "renderer crashed" else "renderer killed")
        if (started) { endBench(); buildWebView(echo ?: if (tripped) guardPage("crash", culprit) else "/index.html") }
    }

    /** Runtime guard tripped: a new WebView (and renderer: a hung one can't load a page) with the default skin. */
    private fun onGuardTrip(reason: String, culprit: String?) {
        releaseWebView("guard $reason")
        endBench()
        val page = guardPage(reason, culprit)
        guardReload = page
        guardReloadAt = SystemClock.uptimeMillis()
        buildWebView(page)
    }
    private var guardReload: String? = null
    private var guardReloadAt = 0L

    private fun guardPage(reason: String, culprit: String?): String =
        "/index.html?guard=$reason" + (culprit?.takeIf { SkinStore.SKIN_ID.matches(it) }?.let { "&culprit=$it" } ?: "")

    // ---------------------------------------------------------------- intents & keys

    /** Home pressed while we are already on top: let the UI reset focus. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(EXTRA_FROM_HOME_WATCH, false)) Log.i(TAG, "HOME_WATCH shown")
        // Bench over ADB (works on release builds): `--es frameStats start|stop`; stop logs FRAME_STATS {json}.
        when (intent.getStringExtra(EXTRA_FRAME_STATS)) {
            "start" -> { frameStats.start(); Log.i(TAG, "FRAME_STATS started"); return }
            "stop" -> { Log.i(TAG, "FRAME_STATS " + frameStats.stop()); callJs("benchReport?.()"); return }
            // Per-frame rows are too long for logcat: written to Android/data/<pkg>/files/frames.json for `adb pull`.
            "stopDetail" -> {
                frameStats.detail = true
                val json = frameStats.stop()
                frameStats.detail = false
                runCatching { java.io.File(getExternalFilesDir(null), "frames.json").writeText(json.toString()) }
                json.remove("frameRows")
                Log.i(TAG, "FRAME_STATS " + json)
                callJs("benchReport?.()")
                return
            }
        }
        // Debug builds: `--ez crashRenderer true` crashes the WebView renderer (runtime guard test, M2.2).
        if (BuildConfig.DEBUG && intent.getBooleanExtra(EXTRA_CRASH, false)) { web?.loadUrl("chrome://crash"); return }
        // Debug builds: `--ez probeContent true` logs which content sources this app can read (src/debug ContentProbe).
        if (BuildConfig.DEBUG && intent.getBooleanExtra("probeContent", false)) {
            Thread({ runCatching {
                val probe = Class.forName("com.weblauncher.tv.ContentProbe")
                probe.getMethod("run", Context::class.java).invoke(probe.getField("INSTANCE").get(null), this)
            }.onFailure { Log.w(TAG, "CONTENT_PROBE failed: $it") } }, "content-probe").start()
            return
        }
        applyTuning(intent)
        applyBench(intent)
        if (intent.getBooleanExtra(EXTRA_INBOX, false)) { installInbox(); return }
        if (intent.getBooleanExtra(EXTRA_EXPORT, false)) { exportSettingsFile(); return }
        if (intent.getBooleanExtra(EXTRA_IMPORT, false)) { importSettingsFile(); return }
        // `--es galleryUrl <url>` sets the skin gallery (`lx gallery set`); an empty value clears it.
        intent.getStringExtra(EXTRA_GALLERY)?.let { callJs("setGalleryUrl(" + org.json.JSONObject.quote(it) + ")"); return }
        when {
            web == null -> buildWebView(pageFor(intent))
            intent.hasExtra(EXTRA_PAGE) || intent.hasExtra(EXTRA_SAFE) || intent.hasExtra(EXTRA_SKIN) || intent.hasExtra(EXTRA_BENCH) ->
                web?.loadUrl(LocalAssetClient.ORIGIN + pageFor(intent))
            else -> callJs("onHome()")
        }
    }

    /**
     * Skin bench (`lx bench --tv`): `--es bench <skin>` serves [ReferenceApps] and opens that skin with `?bench`
     * (the page keeps favourites and settings in memory, so the user's own are neither read nor changed).
     * Any other page request ends reference mode.
     */
    private fun applyBench(intent: Intent?) {
        intent ?: return
        val bench = intent.getStringExtra(EXTRA_BENCH)
        if (bench != null && SkinStore.SKIN_ID.matches(bench)) {
            apps.referenceApps = BENCH_APPS
            skins.benchDevSkins = true
        } else if (apps.referenceApps > 0 && (intent.hasExtra(EXTRA_PAGE) || intent.hasExtra(EXTRA_SAFE) || intent.hasExtra(EXTRA_SKIN))) {
            endBench()
        }
    }

    private fun endBench() {
        apps.referenceApps = 0
        skins.benchDevSkins = false
    }

    /**
     * `adb shell am start -n com.weblauncher.tv/.MainActivity --es page probe.html` opens a bundled page;
     * `--ez safeMode true` opens the launcher with the bundled default skin (plan revision R1);
     * `--es skin <id>` previews a skin for one load (`lx push --open`).
     */
    private fun pageFor(intent: Intent?): String {
        if (intent?.getBooleanExtra(EXTRA_SAFE, false) == true) return SAFE_PAGE
        val bench = intent?.getStringExtra(EXTRA_BENCH)
        if (bench != null && SkinStore.SKIN_ID.matches(bench)) return "/index.html?skin=$bench&bench"
        // `lx push --open`: preview a skin for this load only (the page does not save it).
        val skin = intent?.getStringExtra(EXTRA_SKIN)
        if (skin != null && SkinStore.SKIN_ID.matches(skin)) return "/index.html?skin=$skin"
        val page = intent?.getStringExtra(EXTRA_PAGE)
        return if (page != null && PAGE_NAME.matches(page)) "/$page" else "/index.html"
    }

    /** Back and Menu never reach page JS from a WebView, so forward them. */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) guard.onInput()
        when (event.keyCode) {
            KeyEvent.KEYCODE_BACK -> {
                // Holding Back is the escape hatch from a broken skin: handled natively, so no skin can block it.
                // A timer, not key repeats: injected keys and some remotes send no repeats while held.
                if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                    safeModeFired = false
                    handler.removeCallbacks(safeModeOnHold)
                    handler.postDelayed(safeModeOnHold, SAFE_MODE_HOLD_MS)
                }
                if (event.action == KeyEvent.ACTION_UP) {
                    handler.removeCallbacks(safeModeOnHold)
                    if (!safeModeFired) callJs("onBack()")
                }
                return true // a launcher never finishes on Back
            }
            KeyEvent.KEYCODE_MENU -> {
                if (event.action == KeyEvent.ACTION_UP) callJs("onMenu()")
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    // ---------------------------------------------------------------- activity lifecycle

    override fun onStart() {
        super.onStart()
        started = true
        inputs.listen(true)
        handler.removeCallbacks(releaseWhenHidden)
        handler.removeCallbacks(exitWhenHidden)
        if (web == null) { endBench(); buildWebView("/index.html") }
        installInbox()
    }

    // ---------------------------------------------------------------- skin install (M2.3)

    /** ADB inbox: `adb push my.lxskin /sdcard/Android/data/<pkg>/files/inbox/` (`lx install` does this). */
    fun installInbox(): Boolean {
        val dir = getExternalFilesDir("inbox") ?: return false
        if (dir.listFiles().isNullOrEmpty()) return false
        Thread({ installer.installInbox(dir).forEach(::notifyInstalled) }, "install-inbox").start()
        return true
    }

    private val pendingChecks = java.util.concurrent.ConcurrentHashMap<String, java.util.concurrent.CompletableFuture<String>>()

    /** Runs on an install thread: asks the page to lint `/staged/<stage>/`, re-asking every 3 s (it may be booting). */
    private fun checkStaged(stage: String, files: org.json.JSONArray): org.json.JSONObject? {
        val done = java.util.concurrent.CompletableFuture<String>()
        pendingChecks[stage] = done
        val call = "checkStaged(" + org.json.JSONObject().put("id", stage).put("files", files) + ")"
        try {
            repeat(CHECK_TRIES) {
                callJs(call)
                val r = runCatching { done.get(3, java.util.concurrent.TimeUnit.SECONDS) }.getOrNull()
                if (r != null) return runCatching { org.json.JSONObject(r) }.getOrNull()
            }
            return null
        } finally {
            pendingChecks.remove(stage)
        }
    }

    /** LauncherBridge.stagedChecked: the page's lint result for `stage`. */
    fun stagedChecked(stage: String, json: String) { pendingChecks[stage]?.complete(json) }

    /**
     * Evaluates `expr` in the page and returns its string result (null on timeout or a non-string). Background threads
     * only: it blocks until the page answers.
     */
    fun evalJs(expr: String, timeoutMs: Long = 5_000): String? {
        val done = java.util.concurrent.CompletableFuture<String?>()
        runOnUiThread {
            val w = web
            if (w == null) done.complete(null)
            else w.evaluateJavascript("(() => { try { const r = window.launcher && $expr; return typeof r === 'string' ? r : null; } catch (e) { return null; } })()") { done.complete(it) }
        }
        val raw = runCatching { done.get(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS) }.getOrNull() ?: return null
        if (raw == "null") return null
        return runCatching { org.json.JSONArray("[$raw]").getString(0) }.getOrNull() // the result comes JSON-encoded
    }

    /** ADB: `--ez exportSettings true` writes Android/data/<pkg>/files/settings-export.json (`lx settings export`). */
    private fun exportSettingsFile() = Thread({
        val json = evalJs("launcher.exportSettings()")
        val f = java.io.File(getExternalFilesDir(null), "settings-export.json")
        val ok = json != null && runCatching { f.writeText(json) }.isSuccess
        Log.i(TAG, "SETTINGS_EXPORT ok=$ok path=${f.absolutePath}")
    }, "settings-export").start()

    /** ADB: `--ez importSettings true` applies files/inbox/settings.json and deletes it (`lx settings import`). */
    private fun importSettingsFile() = Thread({
        val f = java.io.File(getExternalFilesDir("inbox"), "settings.json")
        val text = runCatching { if (f.length() in 1..262_144) f.readText() else null }.getOrNull()
        f.delete()
        val r = if (text == null) "{\"ok\":false,\"error\":\"no settings.json in the inbox\"}"
            else evalJs("launcher.importSettings(" + org.json.JSONObject.quote(text) + ")") ?: "{\"ok\":false,\"error\":\"the launcher did not answer\"}"
        Log.i(TAG, "SETTINGS_IMPORT $r")
    }, "settings-import").start()

    fun notifyInstalled(r: SkinInstaller.Result, dev: Boolean = false) = callJs("onSkinInstalled(" + r.json().put("dev", dev) + ")")

    /** True when this TV has a system file picker (many TVs, the VU31 included, have none). */
    fun hasFilePicker(): Boolean = packageManager.queryIntentActivities(pickerIntent(), 0)
        .any { !it.activityInfo.packageName.contains("frameworkpackagestubs") } // Android TV's "not supported" stub

    private fun pickerIntent() = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")

    fun openFilePicker(): Boolean = runCatching { startActivityForResult(pickerIntent(), REQ_PICK); true }.getOrDefault(false)

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        if (requestCode != REQ_PICK || resultCode != RESULT_OK || uri == null) return
        Thread({
            val r = runCatching { contentResolver.openInputStream(uri)!!.use { installer.install(it, "usb") } }
                .getOrElse { SkinInstaller.Result(false, error = "could not open the file", source = "usb") }
            notifyInstalled(r)
        }, "install-usb").start()
    }

    // Stop JS timers and rendering while another app is in front: the TV is RAM/CPU starved.
    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(safeModeOnHold)
        guard.pause()
        lan.devMode = false
        lan.stop() // the LAN page is open only while "Install skin" is on screen
        web?.onPause()
        web?.pauseTimers()
    }

    override fun onResume() {
        super.onResume()
        HomeWatchService.lastActivity = null
        web?.resumeTimers()
        web?.onResume()
        guard.resume()
        callJs("onResume()")
    }

    override fun onStop() {
        super.onStop()
        started = false
        inputs.listen(false)
        if (exiting) return
        handler.postDelayed(releaseWhenHidden, releaseDelayMs)
        if (exitDelayMs > 0) handler.postDelayed(exitWhenHidden, exitDelayMs)
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        apps.trimIcons()
        if (!started && level >= ComponentCallbacks2.TRIM_MEMORY_BACKGROUND) releaseWebView("trim level $level")
    }

    override fun onDestroy() {
        handler.removeCallbacks(exitWhenHidden)
        unregisterReceiver(packageReceiver)
        releaseWebView("activity destroyed")
        super.onDestroy()
        if (exiting) Process.killProcess(Process.myPid())
    }

    fun callJs(expr: String) {
        runOnUiThread { web?.evaluateJavascript("window.launcher && launcher.$expr", null) }
    }

    companion object {
        const val TAG = "WebLauncher"
        private const val EXTRA_PAGE = "page"
        private const val EXTRA_SAFE = "safeMode"
        private const val EXTRA_SKIN = "skin"
        private const val EXTRA_FRAME_STATS = "frameStats"
        private const val EXTRA_BENCH = "bench"
        private const val EXTRA_CRASH = "crashRenderer"
        /** Port 9 (discard) on loopback: nothing listens, so every WebView connection fails at once. */
        private const val DEAD_PROXY = "http://127.0.0.1:9"
        private const val EXTRA_INBOX = "installInbox"
        private const val EXTRA_EXPORT = "exportSettings"
        private const val EXTRA_IMPORT = "importSettings"
        private const val EXTRA_GALLERY = "galleryUrl"
        /** Set by BootReceiver (M4): this start came from the TV's boot. */
        const val EXTRA_FROM_BOOT = "fromBoot"
        const val EXTRA_FROM_HOME_WATCH = "fromHomeWatch"
        private const val REQ_PICK = 1
        /** × 3 s: how long an install waits for the page's lint. */
        private const val CHECK_TRIES = 10
        private const val GUARD_ECHO_MS = 5_000L
        /** Reference data size for the bench (plan: 50 apps), same as `lx lint`/`lx bench` on the desktop. */
        private const val BENCH_APPS = 50
        private const val SAFE_PAGE = "/index.html?safe=1"
        private const val SAFE_MODE_HOLD_MS = 5_000L
        private val PAGE_NAME = Regex("^[a-z0-9-]+\\.html$")
        private const val KEY_RELEASE = "releaseDelayMs"
        private const val KEY_EXIT = "exitDelayMs"
        private const val KEY_RESET = "resetTuning"
        /** Hidden this long: destroy the WebView and terminate its renderer (rebuild ~1 s). */
        const val DEFAULT_RELEASE_DELAY_MS = 60_000L
        /** Hidden this long: end the process too. 0 = never. From scripts/return-test.sh: a cold return (~1.5 s) is only
         *  0.2–0.7 s slower than a WebView rebuild but frees another 70–94 MB, so exit early. */
        const val DEFAULT_EXIT_DELAY_MS = 120_000L
    }
}
