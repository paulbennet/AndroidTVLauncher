package com.weblauncher.tv

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.URL
import java.security.MessageDigest

/**
 * Plan M4, decision D7 (b): the TV side of a remote skin gallery. A gallery is a static `gallery.json` on any https
 * host (format in docs/skin-api.md; `lx gallery build` writes one). The URL is set by the user (Install skin page,
 * ADB, settings import); there is no built-in gallery yet.
 *
 * Everything here runs on a background thread and is native: the WebView has no network (R23). The page gets the
 * index as data, previews through `https://launcher.local/gallery/preview/<id>` (checked images only), and an install
 * ends in [SkinInstaller.install] with its usual checks and lint, after the package's SHA-256 matches the index.
 */
class SkinGallery(private val installer: SkinInstaller, private val skins: SkinStore) {

    private class Entry(val id: String, val json: JSONObject, val pkg: URL, val sha256: String, val preview: URL?)

    @Volatile private var entries: Map<String, Entry> = emptyMap()
    private val previews = object : LinkedHashMap<String, Pair<String, ByteArray>>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<String, ByteArray>>?) = size > MAX_CACHED_PREVIEWS
    }

    /** Downloads and checks the index. { ok, name, skins: [{id, name, version, level, author, description, size, preview, tier, score}] } or { ok: false, error } */
    fun load(url: String): JSONObject = try {
        val text = String(installer.download(url, MAX_INDEX, "application/json"), Charsets.UTF_8)
        val j = runCatching { JSONObject(text) }.getOrNull() ?: throw SkinInstaller.Rejected("the gallery is not valid JSON")
        if (j.optString("format") != FORMAT || j.optInt("version") != 1) throw SkinInstaller.Rejected("not a skin gallery ($FORMAT, version 1)")
        val base = URL(url.trim())
        val list = j.optJSONArray("skins") ?: throw SkinInstaller.Rejected("the gallery has no skins list")
        val map = LinkedHashMap<String, Entry>()
        var skipped = 0
        for (i in 0 until minOf(list.length(), MAX_SKINS)) {
            val e = list.optJSONObject(i)?.let { entry(base, it) }
            if (e == null || map.containsKey(e.id)) skipped++ else map[e.id] = e
        }
        entries = map
        synchronized(previews) { previews.clear() }
        Log.i(TAG, "GALLERY_LOAD skins=${map.size} skipped=$skipped")
        JSONObject().put("ok", true).put("name", j.optString("name").take(60)).put("skipped", skipped)
            .put("skins", JSONArray().apply { map.values.forEach { put(it.json) } })
    } catch (e: Exception) { // anything else too: the page waits for an answer ("Loading…")
        Log.w(TAG, "GALLERY_LOAD failed: $e")
        JSONObject().put("ok", false).put("error", (e as? SkinInstaller.Rejected)?.message ?: "unexpected error (${e.javaClass.simpleName})")
    }

    /** One index entry, or null when anything in it is wrong (the page never sees a bad entry). */
    private fun entry(base: URL, s: JSONObject): Entry? {
        val id = s.optString("id")
        if (!SkinStore.SKIN_ID.matches(id) || skins.isBundled(id)) return null
        val version = s.optString("version")
        if (!VERSION.matches(version)) return null
        val level = s.optInt("level", -1).takeIf { it in 0..3 } ?: return null
        val sha = s.optString("sha256").lowercase()
        if (!SHA256.matches(sha)) return null
        val pkg = runCatching { URL(base, s.getString("package")) }.getOrNull() ?: return null
        val preview = s.optString("preview").takeIf { it.isNotEmpty() }?.let { runCatching { URL(base, it) }.getOrNull() }
        val json = JSONObject()
            .put("id", id).put("version", version).put("level", level)
            .put("name", s.optString("name", id).take(60).ifEmpty { id })
            .put("author", s.optString("author").take(60))
            .put("description", s.optString("description").take(300))
            .put("size", s.optLong("size", 0).coerceIn(0, SkinInstaller.MAX_PACKAGE))
            .put("preview", preview != null)
            .put("tier", s.optString("tier").takeIf { it in TIERS } ?: JSONObject.NULL)
            .put("score", s.optInt("score", -1).takeIf { it in 0..100 } ?: JSONObject.NULL)
        return Entry(id, json, pkg, sha, preview)
    }

    /** Downloads `id`'s preview image into the cache. False when there is none or it isn't a PNG, JPEG or WebP. */
    fun fetchPreview(id: String): Boolean {
        val e = entries[id] ?: return false
        val url = e.preview ?: return false
        if (synchronized(previews) { previews.containsKey(id) }) return true
        return try {
            val bytes = installer.download(url.toString(), MAX_PREVIEW, "image/webp, image/png, image/jpeg")
            val mime = imageType(bytes) ?: throw SkinInstaller.Rejected("not a PNG, JPEG or WebP image")
            synchronized(previews) { previews[id] = mime to bytes }
            true
        } catch (x: Exception) {
            Log.w(TAG, "GALLERY_PREVIEW $id failed: $x")
            false
        }
    }

    /** For LocalAssetClient: `/gallery/preview/<id>`. */
    fun preview(id: String): Pair<String, ByteArray>? = synchronized(previews) { previews[id] }

    /** Downloads `id`'s package, checks its SHA-256 against the index, and installs it (source "gallery"). */
    fun install(id: String): SkinInstaller.Result {
        val e = entries[id] ?: return SkinInstaller.Result(false, error = "that skin is not in the gallery list", source = SOURCE)
        return try {
            val bytes = installer.download(e.pkg.toString(), SkinInstaller.MAX_PACKAGE, "application/zip, application/octet-stream")
            val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            if (sha != e.sha256) throw SkinInstaller.Rejected("the package does not match the gallery's checksum")
            installer.install(bytes, SOURCE, expectId = id)
        } catch (x: Exception) {
            Log.w(TAG, "GALLERY_INSTALL $id failed: $x")
            SkinInstaller.Result(false, error = (x as? SkinInstaller.Rejected)?.message ?: "unexpected error (${x.javaClass.simpleName})", source = SOURCE)
        }
    }

    companion object {
        private const val TAG = MainActivity.TAG
        const val FORMAT = "web-launcher-gallery"
        private const val SOURCE = "gallery"
        private const val MAX_INDEX = 256L * 1024
        private const val MAX_PREVIEW = 512L * 1024
        private const val MAX_SKINS = 200
        private const val MAX_CACHED_PREVIEWS = 6
        private val VERSION = Regex("^[0-9A-Za-z.+-]{1,20}$")
        private val SHA256 = Regex("^[0-9a-f]{64}$")
        private val TIERS = setOf("Lite", "Standard", "Rich", "Heavy")

        /** Magic bytes; the content type the server sent is not trusted. */
        fun imageType(b: ByteArray): String? = when {
            b.size > 8 && b[0] == 0x89.toByte() && b[1] == 'P'.code.toByte() && b[2] == 'N'.code.toByte() && b[3] == 'G'.code.toByte() -> "image/png"
            b.size > 3 && b[0] == 0xFF.toByte() && b[1] == 0xD8.toByte() && b[2] == 0xFF.toByte() -> "image/jpeg"
            b.size > 12 && String(b, 0, 4, Charsets.US_ASCII) == "RIFF" && String(b, 8, 4, Charsets.US_ASCII) == "WEBP" -> "image/webp"
            else -> null
        }
    }
}
