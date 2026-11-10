package com.weblauncher.tv

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.zip.ZipInputStream

/**
 * Installs `.lxskin` packages (zip) into `files/skins/<id>/` (plan step M2.3). Every install path ends here:
 * the ADB inbox, the LAN upload page, a URL, and USB through the system file picker.
 *
 * Checks here are about the package as an archive: size, file count and names, a manifest with a valid,
 * non-bundled id (R4). Then the package is unpacked to a staging folder, served at `/staged/<stage>/…`, and the page
 * runs the static lint on it (`lint.js` lintStatic, plan decision 3, M2.4) through [check]. Lint errors reject it.
 * The new version is swapped in with renames, so a failed install changes nothing. The lint result and the
 * package's `score.json` claims are kept in `files/skin-meta/<id>.json` for the badge in the Skin menu.
 */
class SkinInstaller(private val skins: SkinStore, private val metaDir: File) {

    class Result(val ok: Boolean, val id: String? = null, val name: String? = null, val version: String? = null,
                 val level: Int? = null, val error: String? = null, val source: String = "", val lint: JSONObject? = null) {
        fun json(): JSONObject = JSONObject().put("ok", ok).put("source", source).apply {
            if (id != null) put("id", id)
            if (name != null) put("name", name)
            if (version != null) put("version", version)
            if (level != null) put("level", level)
            if (error != null) put("error", error)
            if (lint != null) put("lint", lint)
        }
    }

    /**
     * The install-time lint: given a stage id and its files ([{path, size}]), returns the lint result
     * ({ ok, errors: [{rule, message, where?}], warnings: [...] }) or null if the page did not answer. Blocks.
     */
    @Volatile var check: ((stage: String, files: JSONArray) -> JSONObject?)? = null

    private val stages = java.util.concurrent.ConcurrentHashMap<String, File>()

    /** A file of a package being checked (`/staged/<stage>/<path>` in LocalAssetClient), or null. */
    fun stagedFile(stage: String, path: String): ByteArray? {
        val dir = stages[stage] ?: return null
        if (!SkinStore.SAFE_PATH.matches(path) || path.contains("..")) return null
        val f = File(dir, path).canonicalFile
        if (!f.path.startsWith(dir.canonicalPath + File.separator) || !f.isFile) return null
        return runCatching { f.readBytes() }.getOrNull()
    }

    /** `files/skin-meta/<id>.json`: { source, installedAt, lint: { errors, warnings }, score } or null. */
    fun meta(id: String): JSONObject? = runCatching { JSONObject(File(metaDir, "$id.json").readText()) }.getOrNull()

    class Rejected(msg: String) : Exception(msg)

    /** Reads at most MAX_PACKAGE bytes from `input` and installs them. Never throws. */
    fun install(input: InputStream, source: String): Result = try {
        install(readLimited(input, MAX_PACKAGE), source)
    } catch (e: Rejected) {
        fail(source, e.message ?: "rejected")
    } catch (e: IOException) {
        fail(source, "could not read the package (${e.message})")
    }

    /** `expectId`: the gallery entry's id; a package with another manifest id is rejected. */
    @Synchronized
    fun install(bytes: ByteArray, source: String, expectId: String? = null): Result {
        var staging: File? = null
        return try {
            val files = unzip(bytes)
            val manifest = files["manifest.json"] ?: throw Rejected("no manifest.json at the top of the package")
            val m = runCatching { JSONObject(String(manifest, Charsets.UTF_8)) }.getOrNull() ?: throw Rejected("manifest.json is not valid JSON")
            val id = m.optString("id")
            if (!SkinStore.SKIN_ID.matches(id)) throw Rejected("manifest id \"${id.take(40)}\" is not a valid skin id")
            if (expectId != null && id != expectId) throw Rejected("the package is \"$id\", not \"$expectId\"")
            if (skins.isBundled(id)) throw Rejected("\"$id\" is a built-in skin id")
            if (m.optInt("apiVersion", -1) != 1) throw Rejected("apiVersion ${m.opt("apiVersion")} is not supported (1)")
            val level = m.optInt("level", -1)
            if (level !in 0..3) throw Rejected("level ${m.opt("level")} is not 0–3")

            val root = skins.installedDir.apply { mkdirs() }
            val stage = random()
            staging = File(root, ".staging-$stage").apply { mkdirs() }
            for ((path, data) in files) {
                val f = File(staging, path)
                f.parentFile?.mkdirs()
                f.writeBytes(data)
            }

            // Install-time lint in the page (needs CSSOM and image decoding, so it can't run here).
            val list = JSONArray()
            for ((path, data) in files) list.put(JSONObject().put("path", path).put("size", data.size))
            stages[stage] = staging
            val lint = try { check?.invoke(stage, list) } finally { stages.remove(stage) }
                ?: throw Rejected("the launcher did not check the skin (is it on screen?)")
            val errors = lint.optJSONArray("errors") ?: JSONArray()
            if (errors.length() > 0) {
                val first = errors.optJSONObject(0)
                val what = first?.let { "${it.optString("message")}${it.optString("where").takeIf { w -> w.isNotEmpty() }?.let { w -> " [$w]" } ?: ""}" } ?: ""
                return fail(source, "${errors.length()} lint error${if (errors.length() == 1) "" else "s"}: $what", lint)
            }

            val target = File(root, id)
            val old = File(root, ".old-" + random())
            if (target.exists() && !target.renameTo(old)) throw Rejected("could not replace the installed version")
            if (!staging.renameTo(target)) { old.renameTo(target); throw Rejected("could not move the package into place") }
            staging = null
            old.deleteRecursively()
            writeMeta(id, source, lint, files["score.json"])
            val r = Result(true, id, m.optString("name", id).take(80), m.optString("version").take(20), level, source = source, lint = lint)
            Log.i(TAG, "SKIN_INSTALL " + r.json())
            r
        } catch (e: Rejected) {
            fail(source, e.message ?: "rejected")
        } catch (e: IOException) {
            fail(source, "could not write the skin (${e.message})")
        } finally {
            staging?.deleteRecursively()
        }
    }

    /** Removes an installed skin. Bundled and dev skins are not touched. */
    @Synchronized
    fun remove(id: String): Boolean {
        if (!SkinStore.SKIN_ID.matches(id)) return false
        val dir = File(skins.installedDir, id)
        if (!dir.isDirectory) return false
        val gone = File(skins.installedDir, ".old-" + random())
        val ok = dir.renameTo(gone) && gone.deleteRecursively()
        File(metaDir, "$id.json").delete()
        Log.i(TAG, "SKIN_REMOVE id=$id ok=$ok")
        return ok
    }

    /** Installs and deletes every `.lxskin` / `.zip` in the ADB inbox (`Android/data/<pkg>/files/inbox`). */
    fun installInbox(inbox: File?): List<Result> {
        val files = inbox?.listFiles()?.filter { it.isFile && (it.name.endsWith(".lxskin") || it.name.endsWith(".zip")) }
            ?.sortedBy { it.lastModified() } ?: return emptyList()
        return files.map { f ->
            val r = if (f.length() > MAX_PACKAGE) fail("adb", "${f.name} is larger than ${MAX_PACKAGE / 1_048_576} MB")
            else runCatching { f.inputStream().use { install(it, "adb") } }.getOrElse { fail("adb", "could not read ${f.name}") }
            f.delete()
            r
        }
    }

    /**
     * Downloads a package from an https URL (the LAN page can send one, so nothing is typed on the TV).
     * Only the core downloads: skins themselves have no network (plan decision 10, R21).
     */
    fun installFromUrl(url: String): Result = try {
        install(download(url, MAX_PACKAGE, "application/zip, application/octet-stream"), "url")
    } catch (e: Rejected) {
        fail("url", e.message ?: "rejected")
    }

    /**
     * Downloads at most `max` bytes from an https URL on a public host (also the skin gallery's index, previews and
     * packages). Redirects are followed by hand (at most 3), and every hop gets the same checks, so a public link
     * can't redirect the TV to a device on the home network. Throws [Rejected].
     */
    fun download(url: String, max: Long, accept: String): ByteArray {
        var u = checkUrl(runCatching { URL(url.trim()) }.getOrNull())
        repeat(MAX_REDIRECTS + 1) {
            var c: HttpURLConnection? = null
            try {
                c = (u.openConnection() as HttpURLConnection).apply {
                    connectTimeout = 10_000
                    readTimeout = 20_000
                    instanceFollowRedirects = false
                    setRequestProperty("Accept", accept)
                }
                val code = c.responseCode
                if (code in 300..399) {
                    val to = c.getHeaderField("Location") ?: throw Rejected("the server answered $code without a Location")
                    u = checkUrl(runCatching { URL(u, to) }.getOrNull(), redirect = true)
                    return@repeat
                }
                if (code != HttpURLConnection.HTTP_OK) throw Rejected("the server answered $code")
                if (c.contentLengthLong > max) throw Rejected("larger than ${sizeText(max)}")
                return c.inputStream.use { readLimited(it, max) }
            } catch (e: IOException) {
                throw Rejected("download failed (${e.javaClass.simpleName})")
            } finally {
                c?.disconnect()
            }
        }
        throw Rejected("too many redirects")
    }

    private fun checkUrl(u: URL?, redirect: Boolean = false): URL {
        if (u == null || u.host.isNullOrEmpty() || !(u.protocol == "https" || testLoopback(u)))
            throw Rejected(if (redirect) "the link redirected away from https" else "only https:// links can be used")
        if (!testLoopback(u) && !publicHost(u.host)) throw Rejected("only links to public internet hosts can be used")
        return u
    }

    private fun sizeText(n: Long) = if (n >= 1_048_576) "${n / 1_048_576} MB" else "${n / 1024} KB"

    /**
     * Debug builds only: `http://127.0.0.1:<port>/` (a computer's server through `adb reverse`), so the download
     * path can be tested without publishing a package. Cleartext is allowed for 127.0.0.1 in src/debug only.
     */
    fun testLoopback(u: URL) = BuildConfig.DEBUG && u.protocol == "http" && u.host == "127.0.0.1"

    /**
     * The LAN page sends links on behalf of anyone with the PIN: don't let it probe the home network (router pages,
     * other devices) through the TV. Every address the name resolves to must be public.
     */
    private fun publicHost(host: String): Boolean = runCatching {
        java.net.InetAddress.getAllByName(host).all { a ->
            !(a.isLoopbackAddress || a.isSiteLocalAddress || a.isLinkLocalAddress || a.isAnyLocalAddress || a.isMulticastAddress ||
                (a is java.net.Inet6Address && (a.address[0].toInt() and 0xfe) == 0xfc)) // IPv6 unique local fc00::/7
        }
    }.getOrDefault(false)

    // ------------------------------------------------------------ archive checks

    private fun unzip(bytes: ByteArray): Map<String, ByteArray> {
        val out = LinkedHashMap<String, ByteArray>()
        var total = 0L
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val e = zip.nextEntry ?: break
                if (e.isDirectory) continue
                val name = e.name
                if (!SkinStore.SAFE_PATH.matches(name) || name.startsWith("/") || name.split('/').any { it.isEmpty() || it == "." || it == ".." })
                    throw Rejected("unsupported file name \"${name.take(60)}\"")
                if (out.size >= MAX_FILES) throw Rejected("more than $MAX_FILES files")
                if (out.containsKey(name)) throw Rejected("\"$name\" is in the package twice")
                val data = readLimited(zip, SkinStore.MAX_FILE)
                total += data.size
                if (total > MAX_UNPACKED) throw Rejected("more than ${MAX_UNPACKED / 1_048_576} MB unpacked")
                out[name] = data
            }
        }
        if (out.isEmpty()) throw Rejected("not a skin package (no files)")
        return out
    }

    private fun readLimited(input: InputStream, max: Long): ByteArray {
        val buf = ByteArrayOutputStream()
        val chunk = ByteArray(16 * 1024)
        while (true) {
            val n = input.read(chunk)
            if (n < 0) break
            if (buf.size() + n > max) throw Rejected("larger than ${sizeText(max)}")
            buf.write(chunk, 0, n)
        }
        return buf.toByteArray()
    }

    private fun writeMeta(id: String, source: String, lint: JSONObject, scoreJson: ByteArray?) {
        val score = scoreJson?.let { runCatching { JSONObject(String(it, Charsets.UTF_8)) }.getOrNull() }
        val claim = score?.let { sc ->
            val bench = sc.optJSONObject("bench")
            JSONObject().put("tier", sc.opt("tier") ?: JSONObject.NULL).put("estimate", sc.optBoolean("tierEstimate", true))
                .put("score", bench?.opt("score") ?: JSONObject.NULL)
                .put("device", bench?.optJSONObject("device")?.optString("model")?.take(60) ?: JSONObject.NULL)
                .put("lintOk", sc.optJSONObject("lint")?.optBoolean("ok", false) ?: false)
        }
        val meta = JSONObject().put("source", source).put("installedAt", System.currentTimeMillis())
            .put("lint", JSONObject().put("errors", lint.optJSONArray("errors") ?: JSONArray()).put("warnings", lint.optJSONArray("warnings") ?: JSONArray()))
            .put("score", claim ?: JSONObject.NULL)
        runCatching { metaDir.mkdirs(); File(metaDir, "$id.json").writeText(meta.toString()) }
    }

    private fun fail(source: String, error: String, lint: JSONObject? = null): Result {
        val r = Result(false, error = error, source = source, lint = lint)
        Log.w(TAG, "SKIN_INSTALL " + r.json())
        return r
    }

    private fun random(): String = ByteArray(6).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }

    companion object {
        private const val TAG = MainActivity.TAG
        /** Plan budget: package ≤ 5 MB. */
        const val MAX_PACKAGE = 5L * 1024 * 1024
        private const val MAX_UNPACKED = 16L * 1024 * 1024
        private const val MAX_FILES = 400
        private const val MAX_REDIRECTS = 3
    }
}
