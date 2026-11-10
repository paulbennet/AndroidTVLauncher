package com.weblauncher.tv

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Debug
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import android.view.WindowManager
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom

/**
 * Exposed to page JS as `window.AndroidLauncher`. Methods run on a WebView binder thread.
 *
 * WebView injects this object into **every frame**, level 3 skin iframes included (plan revision R16). So every
 * method takes the page token first: LocalAssetClient puts a fresh token into each top-level page it serves
 * (main-frame requests only), and a call without the current token does nothing. A skin frame is cross-origin
 * and can't read the top page. core/bridge.js adds the token to every call.
 */
class LauncherBridge(
    private val activity: MainActivity,
    private val apps: AppRepository,
    private val skins: SkinStore,
) {

    @Volatile private var token = ""

    /** A new token for the top-level page being served; the previous page's token stops working. */
    fun newToken(): String {
        val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
        return bytes.joinToString("") { "%02x".format(it) }.also { token = it }
    }

    private fun ok(t: String?) = !t.isNullOrEmpty() && t == token

    /**
     * Text of a skin's JSON or CSS file, or null. Synchronous on purpose: boot reads the active skin with it
     * so the first frame already has content (awaiting fetch() lets the WebView paint an empty page first,
     * ~400 ms on the VU31). Same files and checks as `/skins/<id>/<path>` in LocalAssetClient.
     */
    @JavascriptInterface
    fun readSkinText(t: String, id: String, path: String): String? {
        if (!ok(t)) return null
        if (!path.endsWith(".json") && !path.endsWith(".css")) return null
        val bytes = skins.open(id, path) ?: return null
        return if (bytes.size > MAX_TEXT) null else String(bytes, Charsets.UTF_8)
    }

    @JavascriptInterface
    fun getApps(t: String): String {
        if (!ok(t)) return "[]"
        val arr = JSONArray()
        for (a in apps.list()) {
            arr.put(JSONObject()
                .put("pkg", a.pkg)
                .put("label", a.label)
                .put("hasBanner", a.hasBanner)
                .put("isTvApp", a.isTvApp))
        }
        return arr.toString()
    }

    @JavascriptInterface
    fun launch(t: String, pkg: String): Boolean {
        if (!ok(t)) return false
        val intent = apps.launchIntent(pkg) ?: return false
        activity.runOnUiThread { runCatching { activity.startActivity(intent) } }
        return true
    }

    @JavascriptInterface
    fun openAppInfo(t: String, pkg: String) = ok(t) && start(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
    )

    @JavascriptInterface
    fun openSettings(t: String) = ok(t) && start(Intent(Settings.ACTION_SETTINGS))

    @JavascriptInterface
    fun getDeviceInfo(t: String): String {
        if (!ok(t)) return "{}"
        val am = activity.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mi = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        return JSONObject()
            .put("model", Build.MODEL)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("availMemMb", mi.availMem / (1024 * 1024))
            .put("totalMemMb", mi.totalMem / (1024 * 1024))
            .put("lowMemory", mi.lowMemory)
            .put("version", BuildConfig.VERSION_NAME)
            .put("webview", LocalAssetClient.webViewMajor)
            .toString()
    }

    // ---------- probe support ----------

    /** Holds off the screensaver (Google TV Backdrop) while the probe runs; ADB input doesn't count as activity. */
    @JavascriptInterface
    fun keepScreenOn(t: String, on: Boolean) {
        if (!ok(t)) return
        activity.runOnUiThread {
            if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    // ------------------------------------------------------------ skin install (M2.3)

    /** "Install skin" is on screen: opens the LAN page. { lan: {url, pin} | null, picker, inbox } */
    @JavascriptInterface
    fun installOpen(t: String): String {
        if (!ok(t)) return "{}"
        val lan = runCatching { activity.lan.start() }.getOrNull()
        return JSONObject()
            .put("lan", lan ?: JSONObject.NULL)
            .put("dev", activity.lan.devMode)
            .put("picker", activity.hasFilePicker())
            .put("inbox", activity.getExternalFilesDir("inbox")?.absolutePath ?: JSONObject.NULL)
            .toString()
    }

    @JavascriptInterface
    fun installClose(t: String) { if (ok(t) && !activity.lan.devMode) activity.lan.stop() }

    /** "Live reload for lx dev" on or off (see LanInstallServer.devMode). */
    @JavascriptInterface
    fun installDevMode(t: String, on: Boolean) { if (ok(t)) activity.lan.devMode = on }

    /** Installs what is in the ADB inbox; results arrive through launcher.onSkinInstalled(). False: inbox empty. */
    @JavascriptInterface
    fun installInbox(t: String): Boolean = ok(t) && activity.installInbox()

    @JavascriptInterface
    fun installFromPicker(t: String): Boolean {
        if (!ok(t)) return false
        activity.runOnUiThread { activity.openFilePicker() }
        return true
    }

    /** The install-time lint result for a staged package (see SkinInstaller.check). */
    @JavascriptInterface
    fun stagedChecked(t: String, stage: String, json: String) { if (ok(t) && json.length < 200_000) activity.stagedChecked(stage, json) }

    @JavascriptInterface
    fun removeSkin(t: String, id: String): Boolean = ok(t) && activity.installer.remove(id)

    // ------------------------------------------------------------ skin gallery (M4, decision D7 b)

    /** Loads the gallery index at `url` in the background; the result arrives through launcher.onGallery(). */
    @JavascriptInterface
    fun galleryLoad(t: String, url: String): Boolean {
        if (!ok(t) || url.length > 500) return false
        background("gallery-load") { activity.callJs("onGallery(" + activity.gallery.load(url) + ")") }
        return true
    }

    /** Downloads a preview; launcher.onGalleryPreview(id, ok), then it is at /gallery/preview/<id>. */
    @JavascriptInterface
    fun galleryPreview(t: String, id: String): Boolean {
        if (!ok(t) || !SkinStore.SKIN_ID.matches(id)) return false
        background("gallery-preview") { activity.callJs("onGalleryPreview(" + JSONObject.quote(id) + ", " + activity.gallery.fetchPreview(id) + ")") }
        return true
    }

    /** Installs a gallery skin; the result arrives through launcher.onSkinInstalled(). */
    @JavascriptInterface
    fun galleryInstall(t: String, id: String): Boolean {
        if (!ok(t) || !SkinStore.SKIN_ID.matches(id)) return false
        background("gallery-install") { activity.notifyInstalled(activity.gallery.install(id)) }
        return true
    }

    private fun background(name: String, fn: () -> Unit) = Thread({ runCatching(fn) }, name).start()

    // ------------------------------------------------------------ open at TV start (M4, decision D6 a)

    /** { enabled, allowed }: allowed = "Display over other apps" granted (BootReceiver needs it). */
    @JavascriptInterface
    fun getBootOpen(t: String): String = if (!ok(t)) "{}" else JSONObject()
        .put("enabled", BootReceiver.enabled(activity)).put("allowed", BootReceiver.allowed(activity)).toString()

    @JavascriptInterface
    fun setBootOpen(t: String, on: Boolean) { if (ok(t)) BootReceiver.setEnabled(activity, on) }

    // ------------------------------------------------------------ Set up this TV (session 18, decision D10)

    /**
     * { googleTv, homeWatch, overlay, bootOpen }: what a non-engineer still has to turn on. googleTv: Google TV's
     * own home is installed (then this launcher can't be the Home app, and the setup steps matter).
     */
    @JavascriptInterface
    fun getSetup(t: String): String {
        if (!ok(t)) return "{}"
        val enabled = Settings.Secure.getString(activity.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
        val me = "${activity.packageName}/"
        val googleTv = runCatching { activity.packageManager.getPackageInfo(HomeWatchService.LAUNCHERX, 0) }.isSuccess
        return JSONObject()
            .put("googleTv", googleTv)
            .put("homeWatch", enabled.split(':').any { it.startsWith(me) && it.endsWith("HomeWatchService") })
            .put("overlay", BootReceiver.allowed(activity))
            .put("bootOpen", BootReceiver.enabled(activity))
            .toString()
    }

    /** Opens a TV Settings screen for a setup step: "accessibility" or "overlay". False if the TV has none. */
    @JavascriptInterface
    fun openSetupScreen(t: String, which: String): Boolean {
        if (!ok(t)) return false
        val pm = activity.packageManager
        val candidates = when (which) {
            "accessibility" -> listOf(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            "overlay" -> listOf(
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${activity.packageName}")),
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION),
            )
            else -> emptyList()
        }
        val intent = candidates.firstOrNull { it.resolveActivity(pm) != null } ?: return false
        return start(intent)
    }

    // ------------------------------------------------------------ TV inputs (M3.1)

    /** [{ id, label, kind: hdmi|av|tuner|other, connected }]; empty on devices without TV inputs. */
    @JavascriptInterface
    fun getInputs(t: String): String = if (!ok(t) || apps.referenceApps > 0) "[]" else activity.inputs.json() // none while benching

    /** Shows TV input `id` (it must be one getInputs() returned). */
    @JavascriptInterface
    fun openInput(t: String, id: String): Boolean {
        if (!ok(t)) return false
        val intent = activity.inputs.intentFor(id) ?: return false
        activity.runOnUiThread { runCatching { activity.startActivity(intent) } }
        return true
    }

    /** The page mounted skin `id` (runtime guard, M2.2). `measured`: false in safe mode and while benching. */
    @JavascriptInterface
    fun setActiveSkin(t: String, id: String, measured: Boolean) {
        if (!ok(t) || !SkinStore.SKIN_ID.matches(id)) return
        activity.runOnUiThread { activity.guard.setSkin(id, measured) }
    }

    @JavascriptInterface
    fun frameStatsStart(t: String) { if (ok(t)) activity.frameStats.start() }

    @JavascriptInterface
    fun frameStatsStop(t: String): String = if (ok(t)) activity.frameStats.stop().toString() else "{}"

    /** PSS of this app process only; the WebView renderer is a separate sandboxed process (see scripts/probe.sh). */
    @JavascriptInterface
    fun getAppMemory(t: String): String {
        if (!ok(t)) return "{}"
        val mi = Debug.MemoryInfo().also { Debug.getMemoryInfo(it) }
        return JSONObject()
            .put("appPssMb", mi.totalPss / 1024)
            .put("javaHeapMb", mi.getMemoryStat("summary.java-heap").toIntOrNull()?.div(1024))
            .put("nativeHeapMb", mi.getMemoryStat("summary.native-heap").toIntOrNull()?.div(1024))
            .put("graphicsMb", mi.getMemoryStat("summary.graphics").toIntOrNull()?.div(1024))
            .toString()
    }

    /** Uptime-based timestamps so JS can compute process start → first render. */
    @JavascriptInterface
    fun getStartup(t: String): String = if (!ok(t)) "{}" else JSONObject()
        .put("processStartMs", Process.getStartUptimeMillis())
        .put("activityCreateMs", activity.createdAtUptime)
        .put("webViewCreateMs", activity.webViewCreatedAtUptime)
        .put("nowMs", SystemClock.uptimeMillis())
        .toString()

    private fun start(intent: Intent): Boolean {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.runOnUiThread { runCatching { activity.startActivity(intent) } }
        return true
    }

    private companion object { const val MAX_TEXT = 256 * 1024 }
}
