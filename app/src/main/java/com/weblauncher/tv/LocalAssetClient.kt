package com.weblauncher.tv

import android.content.Context
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream
import java.io.IOException

/**
 * Serves the UI from fake https origins so pages get normal web semantics (localStorage, no file:// quirks)
 * without any network:
 *   https://launcher.local/<path>       -> assets/web/<path> (top-level pages get the bridge token, see LauncherBridge)
 *   https://launcher.local/icon/<pkg>   -> app banner/icon rendered by AppRepository
 *   https://launcher.local/skins/…      -> skin packages (SkinStore: bundled, installed, dev)
 *   https://launcher.local/staged/<stage>/<path>  -> a package being installed, for the install-time lint (M2.4).
 *                                          Never as a page: HTML comes back as text/plain, with a sandbox CSP.
 *   https://skin.local/<id>/<path>      -> level 3 skin pages, only inside the core's sandboxed iframe (plan M2.1).
 *                                          The entry page gets the CSP and the SDK shim put first.
 *   https://skin.local/__lx/sdk.js|nav.js, /__icon/<pkg>   -> the SDK, the shared focus geometry, app images
 * Any other host gets 403; the desktop server (tools/lib/server.mjs) mirrors all of this.
 */
class LocalAssetClient(
    private val ctx: Context,
    private val apps: AppRepository,
    private val skins: SkinStore,
    private val bridge: LauncherBridge,
    private val installer: SkinInstaller,
    private val onRendererGone: (WebView, Boolean) -> Unit,
) : WebViewClient() {

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        onRendererGone(view, detail.didCrash())
        return true // handled: the activity destroys this WebView and builds a new one
    }

    companion object {
        /**
         * Major version of the system WebView (Chromium), or 0 if unknown. Old TVs that get no WebView updates can be
         * far behind: the Android TV 12 emulator ships 91 (M4, other TVs). `@layer` needs 99, so on older engines
         * core.css is served without its layer and skins.js adds none (the skin still comes later and wins equal
         * selectors, but a more specific core selector now beats it).
         */
        val webViewMajor: Int by lazy {
            runCatching { if (android.os.Build.VERSION.SDK_INT >= 26) WebView.getCurrentWebViewPackage()?.versionName?.substringBefore('.')?.toInt() else null }
                .getOrNull() ?: 0
        }
        val cascadeLayers get() = webViewMajor == 0 || webViewMajor >= 99

        /** core.css without `@layer core, skin;` and the `@layer core { … }` around everything. */
        fun unlayer(css: String): String {
            val open = css.indexOf("@layer core {")
            val close = css.lastIndexOf('}')
            if (open < 0 || close < open) return css
            return css.substring(0, open).replace("@layer core, skin;", "") + css.substring(open + "@layer core {".length, close)
        }

        const val HOST = "launcher.local"
        const val ORIGIN = "https://$HOST"
        const val SKIN_HOST = "skin.local"
        private const val SKIN_BASE = "https://$SKIN_HOST/"
        private val MIME = mapOf(
            "html" to "text/html", "js" to "text/javascript", "mjs" to "text/javascript", "css" to "text/css",
            "svg" to "image/svg+xml", "png" to "image/png", "webp" to "image/webp",
            "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "avif" to "image/avif", "json" to "application/json",
            "woff2" to "font/woff2",
        )
        /** Same policy as skinPageCsp() in tools/lib/server.mjs. No network, no inline script, nothing but the skin host. */
        private const val SKIN_CSP = "default-src 'none'; script-src $SKIN_BASE; style-src $SKIN_BASE 'unsafe-inline'; " +
            "img-src $SKIN_BASE data: blob:; font-src $SKIN_BASE; media-src $SKIN_BASE; connect-src 'none'; frame-src 'none'; " +
            "worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'"
        private val SKIN_HEADERS = mapOf(
            "Content-Security-Policy" to "$SKIN_CSP; frame-ancestors $ORIGIN",
            "Access-Control-Allow-Origin" to "*", // the frame's origin is opaque ("null"); its module scripts need CORS
            "X-Content-Type-Options" to "nosniff",
            "X-DNS-Prefetch-Control" to "off", // no DNS lookups for names a skin chooses (R21)
        )
        private val STAGED_HEADERS = mapOf("Content-Security-Policy" to "sandbox; default-src 'none'", "X-Content-Type-Options" to "nosniff")
        private val LEADING_DOCTYPE = Regex("^﻿?\\s*<!doctype[^>]*>", RegexOption.IGNORE_CASE)
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val host = request.url.host
        return !(host == HOST || (host == SKIN_HOST && !request.isForMainFrame))
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        val path = url.path ?: "/"
        if (url.host == SKIN_HOST) return skinHost(path)
        if (url.host != HOST) return respond(403, "text/plain", ByteArray(0))

        if (path.startsWith("/icon/")) {
            val img = apps.image(path.removePrefix("/icon/")) ?: return respond(404, "text/plain", ByteArray(0))
            return respond(200, img.first, img.second)
        }

        if (path.startsWith("/staged/")) {
            val rest = path.removePrefix("/staged/")
            val bytes = installer.stagedFile(rest.substringBefore('/'), rest.substringAfter('/', ""))
                ?: return respond(404, "text/plain", ByteArray(0))
            val mime = if (rest.endsWith(".html") || rest.endsWith(".htm")) "text/plain" else mimeOf(rest)
            return respond(200, mime, bytes, STAGED_HEADERS)
        }
        if (path.startsWith("/gallery/preview/")) { // M4: images SkinGallery downloaded and checked
            val img = (ctx as? MainActivity)?.gallery?.preview(path.removePrefix("/gallery/preview/"))
                ?: return respond(404, "text/plain", ByteArray(0))
            return respond(200, img.first, img.second, STAGED_HEADERS)
        }
        if (path == "/skins/index.json")return respond(200, "application/json", skins.index().toByteArray())
        if (path.startsWith("/skins/")) {
            val rest = path.removePrefix("/skins/")
            val bytes = skins.open(rest.substringBefore('/'), rest.substringAfter('/', ""))
                ?: return respond(404, "text/plain", ByteArray(0))
            // Skin files are data for the core page (CSS, JSON, images); never a document on the core's origin.
            return respond(200, mimeOf(rest), bytes, STAGED_HEADERS)
        }

        val assetPath = "web" + (if (path == "/") "/index.html" else path)
        if (assetPath.contains("..")) return respond(400, "text/plain", ByteArray(0))
        val html = assetPath.endsWith(".html")
        // Core pages only load as the top-level page: that is where the bridge token goes (LauncherBridge).
        if (html && !request.isForMainFrame) return respond(403, "text/plain", ByteArray(0))
        return try {
            var bytes = ctx.assets.open(assetPath).use { it.readBytes() }
            if (assetPath == "web/core/core.css" && !cascadeLayers) bytes = unlayer(String(bytes, Charsets.UTF_8)).toByteArray()
            if (!html) return respond(200, mimeOf(assetPath), bytes)
            val page = String(bytes, Charsets.UTF_8)
                .replaceFirst("<head>", "<head>\n  <meta name=\"lx-token\" content=\"${bridge.newToken()}\">")
            respond(200, "text/html", page.toByteArray())
        } catch (e: IOException) {
            respond(404, "text/plain", ByteArray(0))
        }
    }

    /** https://skin.local/: level 3 skin pages (sandboxed iframe), the SDK shim, and app images for them. */
    private fun skinHost(path: String): WebResourceResponse {
        fun no(code: Int) = respond(code, "text/plain", ByteArray(0), SKIN_HEADERS)
        if (path == "/__lx/sdk.js" || path == "/__lx/nav.js") {
            val bytes = runCatching { ctx.assets.open("web/core/" + path.removePrefix("/__lx/")).use { it.readBytes() } }.getOrNull()
                ?: return no(404)
            return respond(200, "text/javascript", bytes, SKIN_HEADERS)
        }
        if (path.startsWith("/__icon/")) {
            val img = apps.image(path.removePrefix("/__icon/")) ?: return no(404)
            return respond(200, img.first, img.second, SKIN_HEADERS)
        }
        val rest = path.removePrefix("/")
        val bytes = skins.open(rest.substringBefore('/'), rest.substringAfter('/', "")) ?: return no(404)
        if (!rest.endsWith(".html")) return respond(200, mimeOf(rest), bytes, SKIN_HEADERS)
        val body = String(bytes, Charsets.UTF_8).replaceFirst(LEADING_DOCTYPE, "")
        val page = "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"$SKIN_CSP\">" +
            "<script src=\"${SKIN_BASE}__lx/sdk.js\"></script>\n$body"
        return respond(200, "text/html", page.toByteArray(), SKIN_HEADERS)
    }

    private fun mimeOf(path: String) = MIME[path.substringAfterLast('.').lowercase()] ?: "application/octet-stream"

    private fun respond(code: Int, mime: String, body: ByteArray, extra: Map<String, String> = emptyMap()) = WebResourceResponse(
        mime, "utf-8", code, if (code == 200) "OK" else "Error",
        mapOf("Cache-Control" to "no-cache") + extra, ByteArrayInputStream(body),
    )
}
