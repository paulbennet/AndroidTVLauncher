package com.weblauncher.tv

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.LruCache
import java.io.ByteArrayOutputStream

data class AppInfo(val pkg: String, val label: String, val hasBanner: Boolean, val isTvApp: Boolean)

/** Lists launchable apps and renders their banners/icons to small encoded images for the WebView. */
class AppRepository(private val ctx: Context) {

    private val pm: PackageManager = ctx.packageManager
    @Volatile private var cached: List<AppInfo>? = null

    // Encoded images, ~4 MB cap. Cleared on memory pressure.
    private val images = object : LruCache<String, ByteArray>(4 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ByteArray) = value.size
    }

    fun invalidate() {
        cached = null
        images.evictAll()
    }

    fun trimIcons() = images.evictAll()

    /** > 0: serve [ReferenceApps] instead of the installed apps (skin bench, `--es bench <skin>`). Process lifetime. */
    @Volatile var referenceApps = 0
        set(n) { field = n; invalidate() }

    fun list(): List<AppInfo> {
        if (referenceApps > 0) return ReferenceApps.list(referenceApps)
        cached?.let { return it }
        val seen = LinkedHashMap<String, AppInfo>()
        for (category in listOf(Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER)) {
            val query = Intent(Intent.ACTION_MAIN).addCategory(category)
            for (ri in pm.queryIntentActivities(query, 0)) {
                val ai = ri.activityInfo
                if (ai.packageName == ctx.packageName || seen.containsKey(ai.packageName)) continue
                val hasBanner = ai.banner != 0 || ai.applicationInfo.banner != 0
                seen[ai.packageName] = AppInfo(
                    pkg = ai.packageName,
                    label = ri.loadLabel(pm).toString(),
                    hasBanner = hasBanner,
                    isTvApp = category == Intent.CATEGORY_LEANBACK_LAUNCHER,
                )
            }
        }
        return seen.values.sortedBy { it.label.lowercase() }.also { cached = it }
    }

    fun launchIntent(pkg: String): Intent? =
        (pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg))
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)

    /** Banner (16:9) if the app has one, else its icon. Returns (mime, bytes). */
    fun image(pkg: String): Pair<String, ByteArray>? {
        val mime = if (Build.VERSION.SDK_INT >= 30) "image/webp" else "image/png"
        images.get(pkg)?.let { return mime to it }
        if (referenceApps > 0) return ReferenceApps.banner(referenceApps, pkg)?.let { images.put(pkg, it); mime to it }
        val (drawable, isBanner) = loadDrawable(pkg) ?: return null
        val bytes = encode(drawable, isBanner)
        images.put(pkg, bytes)
        return mime to bytes
    }

    private fun loadDrawable(pkg: String): Pair<Drawable, Boolean>? = try {
        val activityBanner = launchIntent(pkg)?.let { pm.resolveActivity(it, 0) }?.activityInfo?.loadBanner(pm)
        val banner = activityBanner ?: pm.getApplicationBanner(pkg)
        if (banner != null) banner to true else pm.getApplicationIcon(pkg) to false
    } catch (e: PackageManager.NameNotFoundException) {
        null
    }

    private fun encode(d: Drawable, isBanner: Boolean): ByteArray {
        val (w, h) = if (isBanner) 320 to 180 else 160 to 160
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        d.setBounds(0, 0, w, h)
        d.draw(Canvas(bmp))
        val out = ByteArrayOutputStream(16 * 1024)
        @Suppress("DEPRECATION")
        val format = if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.PNG
        bmp.compress(format, 90, out)
        bmp.recycle()
        return out.toByteArray()
    }
}
