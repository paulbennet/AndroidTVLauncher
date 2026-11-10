package com.weblauncher.tv

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException

/**
 * Where skins live and how `/skins/…` is resolved (plan step M1.3, revisions R4 and R6):
 *   bundled    assets/web/skins/<id>/                    ids are reserved: nothing can shadow them
 *   installed  files/skins/<id>/                          (filled by the M2 install paths)
 *   dev        Android/data/<pkg>/files/skins/<id>/      debug builds, or any build while benching; written by `lx push`
 * Validation of the content itself happens in the page (core/validate.js); this class only lists and serves files.
 */
class SkinStore(private val ctx: Context) {

    /** Installed skins (SkinInstaller writes here). */
    val installedDir = File(ctx.filesDir, "skins")
    private val externalDir by lazy { ctx.getExternalFilesDir("skins") }
    /** Set by `--es bench <skin>`: timings are only valid on release builds, so the bench needs dev skins there too.
     *  Only ADB (or this app) can write Android/data on Android 11+, and skins are untrusted content anyway. */
    @Volatile var benchDevSkins = false
    /** Install metadata (SkinInstaller.meta): lint result and score claims, for the badge in the Skin menu. */
    @Volatile var meta: ((String) -> JSONObject?)? = null
    private val devDir: File? get() = if (BuildConfig.DEBUG || benchDevSkins) externalDir else null

    fun isBundled(id: String) = id in bundledIds()

    private fun bundledIds(): List<String> =
        (runCatching { ctx.assets.list(BUNDLED) }.getOrNull() ?: emptyArray()).filter { SKIN_ID.matches(it) }

    private fun dirIds(dir: File?): List<String> =
        dir?.listFiles()?.filter { it.isDirectory && SKIN_ID.matches(it.name) }?.map { it.name } ?: emptyList()

    /** `/skins/index.json`: [{ id, name, version, level, author, source }], bundled first. */
    fun index(): String {
        val out = JSONArray()
        val seen = HashSet<String>()
        fun add(id: String, source: String, manifest: ByteArray?) {
            if (!seen.add(id) || manifest == null) return
            val m = runCatching { JSONObject(String(manifest)) }.getOrNull() ?: return
            if (m.optString("id") != id) return
            out.put(JSONObject()
                .put("id", id)
                .put("name", m.optString("name", id).take(80))
                .put("version", m.optString("version").take(20))
                .put("level", m.opt("level") ?: JSONObject.NULL)
                .put("author", m.optString("author").take(80))
                .put("source", source)
                .put("badge", badge(id, source)))
        }
        for (id in bundledIds()) add(id, "bundled", readAsset("$BUNDLED/$id/manifest.json"))
        for (id in dirIds(installedDir)) add(id, "installed", readFile(installedDir, id, "manifest.json"))
        for (id in dirIds(devDir)) add(id, "dev", readFile(devDir, id, "manifest.json"))
        return out.toString()
    }

    /**
     * { tier, estimate, score, device, warnings } for the Skin menu, or null. The tier is what the package's
     * `score.json` (written by `lx pack`) claims; installed skins also carry the TV's own install-time lint result.
     */
    private fun badge(id: String, source: String): Any {
        if (source == "bundled") return JSONObject.NULL
        val stored = if (source == "installed") meta?.invoke(id) else null
        val claim = stored?.optJSONObject("score") ?: open(id, "score.json")?.let { bytes ->
            runCatching { JSONObject(String(bytes)) }.getOrNull()?.let { sc ->
                JSONObject().put("tier", sc.opt("tier") ?: JSONObject.NULL).put("estimate", sc.optBoolean("tierEstimate", true))
                    .put("score", sc.optJSONObject("bench")?.opt("score") ?: JSONObject.NULL)
                    .put("device", sc.optJSONObject("bench")?.optJSONObject("device")?.optString("model") ?: JSONObject.NULL)
                    .put("lintOk", sc.optJSONObject("lint")?.optBoolean("ok", false) ?: false)
            }
        }
        if (claim == null && stored == null) return JSONObject.NULL
        val out = claim?.let { JSONObject(it.toString()) } ?: JSONObject()
        stored?.optJSONObject("lint")?.optJSONArray("warnings")?.let { out.put("warnings", it.length()) }
        return out
    }

    /** Bytes of `/skins/<id>/<path>`, or null. Bundled ids always resolve to the APK's copy. */
    fun open(id: String, path: String): ByteArray? {
        if (!SKIN_ID.matches(id) || !SAFE_PATH.matches(path) || path.contains("..")) return null
        if (id in bundledIds()) return readAsset("$BUNDLED/$id/$path")
        return readFile(installedDir, id, path) ?: readFile(devDir, id, path)
    }

    private fun readAsset(path: String): ByteArray? =
        try { ctx.assets.open(path).use { it.readBytes() } } catch (e: IOException) { null }

    private fun readFile(root: File?, id: String, path: String): ByteArray? {
        root ?: return null
        val base = File(root, id).canonicalFile
        val f = File(base, path).canonicalFile
        if (!f.path.startsWith(base.path + File.separator) || !f.isFile || f.length() > MAX_FILE) return null
        return runCatching { f.readBytes() }.getOrNull()
    }

    companion object {
        private const val BUNDLED = "web/skins"
        const val MAX_FILE = 8L * 1024 * 1024
        val SKIN_ID = Regex("^[a-z0-9][a-z0-9-]{0,39}$")
        val SAFE_PATH = Regex("^[A-Za-z0-9._/-]{1,160}$")
    }
}
