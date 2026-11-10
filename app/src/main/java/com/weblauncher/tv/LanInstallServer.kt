package com.weblauncher.tv

import android.util.Log
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * LAN install page (plan step M2.3). Open only while "Install skin" is on screen (and at most OPEN_MS), bound to the
 * TV's LAN address. A phone or computer on the same network opens `http://<tv>:<port>/`, picks a `.lxskin` file
 * (or pastes an https link) and enters the 6-digit PIN shown on the TV.
 *
 *   GET  /              the upload page (self-contained HTML)
 *   POST /install       body: the package; header X-LX-PIN
 *   POST /install-url   body: an https URL (text); header X-LX-PIN
 *   GET  /settings      the launcher settings as JSON (favourites, hidden apps, skin, options); header X-LX-PIN
 *   POST /settings      restore them; header X-LX-PIN
 *   POST /gallery-url   body: the skin gallery's https URL, or empty to clear it (M4); header X-LX-PIN
 *
 * Defences: the PIN (a new one after MAX_TRIES wrong ones, with a growing wait; after MAX_LOCKOUTS the page
 * closes, so at most 20 guesses per opening), a Host header check (DNS rebinding), a custom header (so another web
 * page in the phone's browser can't post without a CORS preflight, which is never answered), size limits, a
 * deadline per request, and one connection at a time.
 */
class LanInstallServer(
    private val installer: SkinInstaller,
    private val onInstalled: (SkinInstaller.Result, Boolean) -> Unit,
    private val onPinChanged: (String) -> Unit,
    private val exportSettings: () -> String?,
    private val importSettings: (String) -> String?,
    /** Sets the gallery URL in the page; returns { ok, error? } as JSON text, or null when the page did not answer. */
    private val setGalleryUrl: (String) -> String? = { null },
    /** The page closed itself after too many wrong PINs. */
    private val onLocked: () -> Unit = {},
) {
    @Volatile private var socket: ServerSocket? = null
    @Volatile var pin: String = ""
        private set
    @Volatile private var wrong = 0
    @Volatile private var lockouts = 0
    private var deadline = 0L
    @Volatile private var openedAt = 0L
    /**
     * "Live reload for lx dev" (turned on on the TV, in Install skin): the page stays open when the screen closes
     * (for DEV_OPEN_MS at most, and never while another app is in front), the PIN does not change after an install,
     * and the launcher shows each installed version as a preview at once.
     */
    @Volatile var devMode = false
    @Volatile private var hostHeader = ""

    /** Starts (or keeps) the server. Returns { url, pin } or null when there is no LAN address. */
    @Synchronized
    fun start(): JSONObject? {
        val addr = lanAddress() ?: return null
        openedAt = System.currentTimeMillis() // before the thread starts: serve() checks it
        val s = socket ?: run {
            val ss = try {
                ServerSocket().apply { reuseAddress = true; bind(InetSocketAddress(addr, PORT)) }
            } catch (e: IOException) {
                ServerSocket().apply { bind(InetSocketAddress(addr, 0)) } // PORT is taken: any free port
            }
            ss.soTimeout = 1000
            socket = ss
            pin = newPin()
            wrong = 0
            lockouts = 0
            hostHeader = "${addr.hostAddress}:${ss.localPort}"
            Thread({ serve(ss) }, "lan-install").start()
            Log.i(TAG, "LAN_INSTALL open ${addr.hostAddress}:${ss.localPort}")
            ss
        }
        return JSONObject().put("url", "http://$hostHeader/").put("pin", pin)
    }

    @Synchronized
    fun stop() {
        val s = socket ?: return
        socket = null
        runCatching { s.close() }
        Log.i(TAG, "LAN_INSTALL closed")
    }

    private fun serve(ss: ServerSocket) {
        while (socket === ss) {
            if (System.currentTimeMillis() - openedAt > (if (devMode) DEV_OPEN_MS else OPEN_MS)) { devMode = false; stop(); break }
            val c = try { ss.accept() } catch (e: java.net.SocketTimeoutException) { continue } catch (e: IOException) { break }
            runCatching { c.use { handle(it) } }.onFailure { Log.w(TAG, "LAN_INSTALL request failed: $it") }
        }
    }

    // ------------------------------------------------------------ minimal HTTP/1.1

    private fun handle(c: Socket) {
        c.soTimeout = 15_000
        deadline = System.currentTimeMillis() + REQUEST_MS // a slow client can't hold the page (one connection at a time)
        val input = BufferedInputStream(c.getInputStream())
        val out = c.getOutputStream()
        val requestLine = readLine(input) ?: return
        val headers = HashMap<String, String>()
        while (true) {
            val line = readLine(input) ?: return
            if (line.isEmpty()) break
            val i = line.indexOf(':')
            if (i > 0) headers[line.substring(0, i).trim().lowercase()] = line.substring(i + 1).trim()
            if (headers.size > 50) return respond(out, 431, "text/plain", "too many headers")
        }
        val parts = requestLine.split(' ')
        if (parts.size < 3) return respond(out, 400, "text/plain", "bad request")
        val (method, path) = parts
        if (headers["host"] != hostHeader) return respond(out, 421, "text/plain", "wrong host")

        when {
            method == "GET" && (path == "/" || path == "/index.html") -> respond(out, 200, "text/html; charset=utf-8", PAGE)
            (method == "GET" && path == "/settings") || (method == "POST" && path == "/settings") -> {
                if (!pinOk(headers["x-lx-pin"])) return wrongPin(out)
                if (method == "GET") {
                    val s = exportSettings() ?: return json(out, 503, JSONObject().put("ok", false).put("error", "the launcher did not answer"))
                    return respond(out, 200, "application/json", s)
                }
                val len = headers["content-length"]?.toLongOrNull() ?: 0L
                if (len <= 0 || len > 262_144) return json(out, 413, JSONObject().put("ok", false).put("error", "a settings file is at most 256 KB"))
                val r = importSettings(String(readBody(input, len.toInt()), Charsets.UTF_8))
                    ?: return json(out, 503, JSONObject().put("ok", false).put("error", "the launcher did not answer"))
                respond(out, 200, "application/json", r)
            }
            method == "POST" && path == "/gallery-url" -> {
                if (!pinOk(headers["x-lx-pin"])) return wrongPin(out)
                val len = headers["content-length"]?.toLongOrNull() ?: 0L
                if (len < 0 || len > 600) return json(out, 413, JSONObject().put("ok", false).put("error", "the link is at most 500 characters"))
                val r = setGalleryUrl(String(readBody(input, len.toInt()), Charsets.UTF_8).trim())
                    ?: return json(out, 503, JSONObject().put("ok", false).put("error", "the launcher did not answer"))
                respond(out, 200, "application/json", r)
            }
            method == "POST" && (path == "/install" || path == "/install-url") -> {
                if (!pinOk(headers["x-lx-pin"])) return wrongPin(out)
                val len = headers["content-length"]?.toLongOrNull() ?: return json(out, 411, JSONObject().put("ok", false).put("error", "length required"))
                val max = if (path == "/install") SkinInstaller.MAX_PACKAGE else 2048L
                if (len <= 0 || len > max) return json(out, 413, JSONObject().put("ok", false).put("error", "the package must be at most ${SkinInstaller.MAX_PACKAGE / 1_048_576} MB"))
                val body = readBody(input, len.toInt())
                val r = if (path == "/install") installer.install(body, "lan") else installer.installFromUrl(String(body, Charsets.UTF_8))
                if (r.ok && !devMode) { pin = newPin(); wrong = 0; onPinChanged(pin) } // one install per PIN
                onInstalled(r, devMode)
                json(out, if (r.ok) 200 else 422, r.json())
            }
            else -> respond(out, 404, "text/plain", "not found")
        }
    }

    private fun wrongPin(out: OutputStream) {
        wrong++
        if (wrong >= MAX_TRIES) {
            wrong = 0
            lockouts++
            if (lockouts >= MAX_LOCKOUTS) {
                Log.w(TAG, "LAN_INSTALL closed: too many wrong PINs")
                json(out, 403, JSONObject().put("ok", false).put("error", "too many wrong PINs: the TV closed the install page"))
                devMode = false
                stop()
                onLocked()
                return
            }
            pin = newPin()
            onPinChanged(pin)
            Thread.sleep(2000L shl (lockouts - 1)) // 2, 4, 8 s
        }
        json(out, 403, JSONObject().put("ok", false).put("error", "wrong PIN: check the TV"))
    }

    private fun pinOk(given: String?): Boolean =
        given != null && MessageDigest.isEqual(given.trim().toByteArray(), pin.toByteArray())

    private fun readLine(input: InputStream): String? {
        val buf = ByteArrayOutputStream()
        while (true) {
            if (System.currentTimeMillis() > deadline) throw IOException("request too slow")
            val b = input.read()
            if (b < 0) return if (buf.size() == 0) null else buf.toString("ISO-8859-1")
            if (b == '\n'.code) return buf.toString("ISO-8859-1").trimEnd('\r')
            if (buf.size() > 8192) throw IOException("line too long")
            buf.write(b)
        }
    }

    private fun readBody(input: InputStream, len: Int): ByteArray {
        val body = ByteArray(len)
        var off = 0
        while (off < len) {
            if (System.currentTimeMillis() > deadline) throw IOException("request too slow")
            val n = input.read(body, off, len - off)
            if (n < 0) throw IOException("body ended early")
            off += n
        }
        return body
    }

    private fun json(out: OutputStream, status: Int, body: JSONObject) = respond(out, status, "application/json", body.toString())

    private fun respond(out: OutputStream, status: Int, type: String, body: String) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        val head = "HTTP/1.1 $status ${REASONS[status] ?: "Status"}\r\nContent-Type: $type\r\nContent-Length: ${bytes.size}\r\n" +
            "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n" +
            "Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'\r\n" +
            "Connection: close\r\n\r\n"
        out.write(head.toByteArray(Charsets.ISO_8859_1))
        out.write(bytes)
        out.flush()
    }

    private fun newPin(): String = (SecureRandom().nextInt(900_000) + 100_000).toString()

    companion object {
        private const val TAG = MainActivity.TAG
        /** Fixed so the address is easy to type; a free one is used if it is taken. */
        const val PORT = 7190
        private const val OPEN_MS = 10 * 60_000L
        private const val DEV_OPEN_MS = 60 * 60_000L
        private const val MAX_TRIES = 5
        private const val MAX_LOCKOUTS = 4
        /** A 5 MB package over Wi-Fi takes a few seconds. */
        private const val REQUEST_MS = 30_000L
        private val REASONS = mapOf(200 to "OK", 400 to "Bad Request", 403 to "Forbidden", 404 to "Not Found", 411 to "Length Required",
            413 to "Payload Too Large", 421 to "Misdirected Request", 422 to "Unprocessable Content", 431 to "Request Header Fields Too Large")

        /** The TV's IPv4 address on the local network (Ethernet or Wi-Fi), or null. */
        fun lanAddress(): InetAddress? = runCatching {
            NetworkInterface.getNetworkInterfaces().toList()
                .filter { it.isUp && !it.isLoopback && !it.isVirtual }
                .flatMap { it.inetAddresses.toList() }
                .filterIsInstance<Inet4Address>()
                .firstOrNull { it.isSiteLocalAddress }
        }.getOrNull()

        private val PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install a launcher skin</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { max-width: 34rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.45; }
  h1 { font-size: 1.4rem; } label { display: block; margin: 1rem 0 .3rem; font-weight: 600; }
  input { font: inherit; padding: .5rem; width: 100%; box-sizing: border-box; }
  button { font: inherit; padding: .6rem 1.2rem; margin-top: 1rem; }
  #status { margin-top: 1rem; font-weight: 600; } .hint { opacity: .7; font-size: .9rem; }
</style></head><body>
<h1>Install a launcher skin</h1>
<p class="hint">Keep <b>Install skin</b> open on the TV. It shows the PIN.</p>
<label for="pin">PIN on the TV</label><input id="pin" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="123456">
<label for="file">Skin package (.lxskin)</label><input id="file" type="file" accept=".lxskin,.zip">
<label for="url">or an https:// link to one</label><input id="url" type="url" placeholder="https://example.com/my-skin.lxskin">
<button id="go">Install</button>
<div id="status" role="status"></div>
<h1>Skin gallery</h1>
<p class="hint">A gallery is a gallery.json file on an https:// site. The TV lists its skins in Install skin → Skin gallery. Leave the link empty to remove the gallery.</p>
<label for="gallery">Gallery link</label><input id="gallery" type="url" placeholder="https://example.com/gallery.json">
<button id="setg">Set gallery</button>
<div id="status3" role="status"></div>
<h1>Launcher settings</h1>
<p class="hint">Favourites, hidden apps, the skin and its options. Uses the same PIN.</p>
<button id="save">Save settings to this device</button>
<label for="restore">Restore from a saved file</label><input id="restore" type="file" accept=".json,application/json">
<button id="load">Restore settings</button>
<div id="status2" role="status"></div>
<script>
  const ${'$'} = id => document.getElementById(id);
  ${'$'}('go').onclick = async () => {
    const pin = ${'$'}('pin').value.trim(), file = ${'$'}('file').files[0], url = ${'$'}('url').value.trim();
    const say = t => { ${'$'}('status').textContent = t; };
    if (!/^\d{6}${'$'}/.test(pin)) return say('Enter the 6-digit PIN shown on the TV.');
    if (!file && !url) return say('Choose a file or paste a link.');
    say('Installing…');
    try {
      const r = await fetch(file ? '/install' : '/install-url', { method: 'POST', headers: { 'X-LX-PIN': pin,
        'Content-Type': file ? 'application/octet-stream' : 'text/plain' }, body: file || url });
      const j = await r.json();
      say(j.ok ? 'Installed "' + j.name + '" ' + j.version + '. Choose Use it now on the TV. To install another, choose Install another there: it shows a new PIN.' : 'Not installed: ' + j.error);
    } catch (e) { say('The TV did not answer. Is Install skin still open?'); }
  };
  const pin2 = () => { const p = ${'$'}('pin').value.trim(); if (!/^\d{6}${'$'}/.test(p)) { ${'$'}('status2').textContent = 'Enter the 6-digit PIN shown on the TV (above).'; return null; } return p; };
  ${'$'}('save').onclick = async () => {
    const pin = pin2(); if (!pin) return;
    try {
      const r = await fetch('/settings', { headers: { 'X-LX-PIN': pin } });
      if (!r.ok) { ${'$'}('status2').textContent = 'Not saved: ' + (await r.json()).error; return; }
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: 'launcher-settings.json' });
      a.click(); ${'$'}('status2').textContent = 'Saved launcher-settings.json.';
    } catch (e) { ${'$'}('status2').textContent = 'The TV did not answer.'; }
  };
  ${'$'}('setg').onclick = async () => {
    const p = ${'$'}('pin').value.trim(), say = t => { ${'$'}('status3').textContent = t; };
    if (!/^\d{6}${'$'}/.test(p)) return say('Enter the 6-digit PIN shown on the TV (above).');
    try {
      const j = await (await fetch('/gallery-url', { method: 'POST', headers: { 'X-LX-PIN': p, 'Content-Type': 'text/plain' }, body: ${'$'}('gallery').value.trim() })).json();
      say(j.ok ? (j.url ? 'Gallery set. Open Install skin → Skin gallery on the TV.' : 'Gallery removed.') : 'Not set: ' + j.error);
    } catch (e) { say('The TV did not answer.'); }
  };
  ${'$'}('load').onclick = async () => {
    const pin = pin2(), file = ${'$'}('restore').files[0]; if (!pin) return;
    if (!file) { ${'$'}('status2').textContent = 'Choose a saved settings file.'; return; }
    try {
      const j = await (await fetch('/settings', { method: 'POST', headers: { 'X-LX-PIN': pin, 'Content-Type': 'application/json' }, body: file })).json();
      ${'$'}('status2').textContent = j.ok ? 'Restored. The TV reloads the launcher.' : 'Not restored: ' + j.error;
    } catch (e) { ${'$'}('status2').textContent = 'The TV did not answer.'; }
  };
</script></body></html>"""
    }
}
