package com.weblauncher.tv

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Build
import java.io.ByteArrayOutputStream

/**
 * Fixed reference data for the skin bench (`lx bench --tv`, plan step M1.6): the same apps, labels and banners
 * as the desktop mock (`assets/web/mock.js` with `?apps=N`), so every TV and the desktop bench draw the same page.
 * Banners are flat colour plus the label, drawn here; apps without a banner get no image (the core shows initials).
 */
object ReferenceApps {
    private val NAMED = listOf(
        Triple("com.netflix.ninja", "Netflix", "#e50914"),
        Triple("com.google.android.youtube.tv", "YouTube", "#ff0033"),
        Triple("com.amazon.amazonvideo.livingroom", "Prime Video", "#1a98ff"),
        Triple("in.startv.hotstar", "JioHotstar", "#0f1d6b"),
        Triple("com.google.android.youtube.tvkids", "YouTube Kids", "#ff3d00"),
        Triple("com.android.vending", "Play Store", "#01875f"),
        Triple("com.android.tv.settings", "Settings", "#5f6368"),
        Triple("com.sony.dtv.tvx", "TV", "#333366"),
        Triple("com.sony.dtv.timers", "Timers & Clock", "#455a64"),
        Triple("com.tcl.browser", "BrowseHere", "#1565c0"),
        Triple("com.sony.dtv.mediaplayer", "Media Player", "#6a1b9a"),
        Triple("com.omeda.arc", "Arc Launcher", "#37474f"),
        Triple("flar2.homebutton", "Button Mapper", "#00897b"),
        Triple("com.google.android.play.games", "Play Games", "#2e7d32"),
        Triple("com.sony.dtv.ecodashboard", "Eco Dashboard", "#558b2f"),
    )
    private const val NAMED_BANNERS = 5 // the first five named apps have banners

    private class Ref(val info: AppInfo, val color: Int)

    @Volatile private var cache: Pair<Int, Map<String, Ref>>? = null

    private fun build(n: Int): Map<String, Ref> {
        cache?.let { if (it.first == n) return it.second }
        val out = LinkedHashMap<String, Ref>()
        NAMED.forEachIndexed { i, (pkg, label, hex) ->
            if (i < n) out[pkg] = Ref(AppInfo(pkg, label, i < NAMED_BANNERS, true), Color.parseColor(hex))
        }
        for (i in NAMED.size until n) {
            val pkg = "com.example.ref" + i.toString().padStart(3, '0')
            out[pkg] = Ref(AppInfo(pkg, "Reference App $i", i % 4 == 0, true), hsl((i * 47) % 360f, 0.55f, 0.40f))
        }
        cache = n to out
        return out
    }

    fun list(n: Int): List<AppInfo> = build(n).values.map { it.info }

    /** Encoded banner for a reference app with a banner, else null. */
    fun banner(n: Int, pkg: String): ByteArray? {
        val ref = build(n)[pkg]?.takeIf { it.info.hasBanner } ?: return null
        val bmp = Bitmap.createBitmap(320, 180, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(ref.color)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE; textSize = 30f; textAlign = Paint.Align.CENTER; typeface = Typeface.DEFAULT_BOLD
        }
        c.drawText(ref.info.label, 160f, 102f, p)
        val out = ByteArrayOutputStream(8 * 1024)
        @Suppress("DEPRECATION")
        val format = if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.PNG
        bmp.compress(format, 90, out)
        bmp.recycle()
        return out.toByteArray()
    }

    private fun hsl(h: Float, s: Float, l: Float): Int {
        val a = s * minOf(l, 1 - l)
        fun f(k0: Float): Int {
            val k = (k0 + h / 30f) % 12f
            return Math.round(255 * (l - a * maxOf(-1f, minOf(k - 3, 9 - k, 1f))))
        }
        return Color.rgb(f(0f), f(8f), f(4f))
    }
}
