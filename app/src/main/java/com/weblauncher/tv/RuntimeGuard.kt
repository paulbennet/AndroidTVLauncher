package com.weblauncher.tv

import android.os.Build
import android.os.Debug
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.FrameMetrics
import android.view.Window
import android.webkit.WebView

/**
 * Runtime guard (plan step M2.2, revision R20). Watches the running skin and asks the activity to reload the
 * launcher with the default skin (`?guard=<reason>&culprit=<id>`) when it:
 *   hang    the page stops answering for HANG_MS (a busy loop in any frame blocks the core too: one renderer thread)
 *   crash   the renderer dies twice within CRASH_WINDOW_MS
 *   jank    3 input windows in a row are bad (janky frames per key press over JANK_LIMIT)
 *   memory  2 samples in a row over a limit: app process PSS (it holds the page's GPU and draw memory: WebView
 *           draws on our RenderThread), or the page's JS heap (all frames share one V8 heap). The renderer's own PSS
 *           can't be read here: it is an isolated process that Android hides from the app (measured, session 6).
 * Hang and crash are checked for every skin (a reload is the only way out either way). Jank and memory are skipped
 * for the default skin, in safe mode and while benching: there is nothing to fall back to, and the bench measures.
 * Everything runs only while the launcher is in front; timers are cheap (one evaluateJavascript every 2 s).
 */
class RuntimeGuard(private val activity: MainActivity, private val trip: (reason: String, culprit: String?) -> Unit) {

    private val main = Handler(Looper.getMainLooper())
    private val frameThread by lazy { Handler(HandlerThread("guard-frames").apply { start() }.looper) }
    private var web: WebView? = null
    private var running = false

    /** Active skin as the page reports it (LauncherBridge.setActiveSkin); jank and memory are checked only when true. */
    var skin: String? = null
        private set
    private var checked = false

    fun setSkin(id: String, measured: Boolean) {
        skin = id
        checked = measured && id != DEFAULT_SKIN
        badWindows = 0
        overMemory = 0
        Log.i(TAG, "GUARD skin=$id checked=$checked")
    }

    // ------------------------------------------------------------ lifecycle (called by MainActivity)

    fun attach(w: WebView) {
        web = w
        skin = null
        checked = false
        lastAnswer = SystemClock.uptimeMillis()
    }

    fun detach(w: WebView) { if (web === w) web = null; stopWindow() }

    fun resume() {
        if (running) return
        running = true
        lastAnswer = SystemClock.uptimeMillis()
        main.postDelayed(ping, PING_MS)
        main.postDelayed(memory, MEMORY_MS)
    }

    fun pause() {
        running = false
        main.removeCallbacks(ping)
        main.removeCallbacks(memory)
        stopWindow()
    }

    // ------------------------------------------------------------ hang: the page must answer a ping

    private var lastAnswer = 0L
    private val ping = object : Runnable {
        override fun run() {
            if (!running) return
            val w = web
            if (w != null && SystemClock.uptimeMillis() - lastAnswer > HANG_MS) { fire("hang"); return }
            w?.evaluateJavascript("0") { if (web === w) lastAnswer = SystemClock.uptimeMillis() }
            main.postDelayed(this, PING_MS)
        }
    }

    // ------------------------------------------------------------ crash: two renderer deaths in 10 min

    private val deaths = ArrayDeque<Long>()

    /** True when this death trips the guard (the caller then reloads with `?guard=crash`). */
    fun rendererGone(): Boolean {
        val now = SystemClock.uptimeMillis()
        deaths.addLast(now)
        while (deaths.isNotEmpty() && now - deaths.first() > CRASH_WINDOW_MS) deaths.removeFirst()
        if (deaths.size < CRASH_LIMIT) return false
        deaths.clear()
        Log.w(TAG, "GUARD_TRIP reason=crash culprit=$skin")
        return true
    }

    // ------------------------------------------------------------ jank: 10 s windows after input

    private class Frame(val at: Long, val janky: Boolean)
    private val frames = ArrayList<Frame>(1024)
    private var windowOpen = false
    private var badWindows = 0
    private val listener = Window.OnFrameMetricsAvailableListener { _, m, _ ->
        if (m.getMetric(FrameMetrics.FIRST_DRAW_FRAME) == 1L) return@OnFrameMetricsAvailableListener
        val janky = Build.VERSION.SDK_INT >= 31 && m.getMetric(FrameMetrics.TOTAL_DURATION) > m.getMetric(FrameMetrics.DEADLINE)
        val at = m.getMetric(FrameMetrics.INTENDED_VSYNC_TIMESTAMP) / 1_000_000L
        synchronized(frames) { frames.add(Frame(at, janky)) }
    }
    private val closeWindow = Runnable { endWindow() }

    /** A remote key reached the launcher: open a measuring window if none is open. */
    fun onInput() {
        if (!checked || !running || windowOpen || Build.VERSION.SDK_INT < 31) return
        windowOpen = true
        synchronized(frames) { frames.clear() }
        activity.window.addOnFrameMetricsAvailableListener(listener, frameThread)
        main.postDelayed(closeWindow, WINDOW_MS)
    }

    private fun stopWindow() {
        if (!windowOpen) return
        windowOpen = false
        main.removeCallbacks(closeWindow)
        runCatching { activity.window.removeOnFrameMetricsAvailableListener(listener) }
    }

    private fun endWindow() {
        stopWindow()
        val list = synchronized(frames) { ArrayList(frames) }
        val perInput = jankPerInput(list.map { it.at }, list.map { it.janky }) ?: return // too few inputs: no verdict
        val bad = perInput > JANK_LIMIT
        badWindows = if (bad) badWindows + 1 else 0
        Log.i(TAG, "GUARD_WINDOW perInput=$perInput bad=$bad inRow=$badWindows")
        if (badWindows >= JANK_WINDOWS && checked) fire("jank")
    }

    // ------------------------------------------------------------ memory: every 60 s while visible

    private var overMemory = 0
    private val memory = object : Runnable {
        override fun run() {
            if (!running) return
            val w = web
            if (!checked || w == null) { main.postDelayed(this, MEMORY_MS); return }
            val appMb = Debug.MemoryInfo().also { Debug.getMemoryInfo(it) }.totalPss / 1024
            // usedJSHeapSize is coarse (Blink rounds it and refreshes it about every 20 min) but costs nothing.
            w.evaluateJavascript("performance.memory ? performance.memory.usedJSHeapSize : -1") { v ->
                if (!running || web !== w) return@evaluateJavascript
                val heapMb = (v?.toDoubleOrNull() ?: -1.0).let { if (it < 0) null else (it / 1_048_576).toInt() }
                val over = appMb > APP_PSS_LIMIT_MB || (heapMb != null && heapMb > JS_HEAP_LIMIT_MB)
                overMemory = if (over) overMemory + 1 else 0
                Log.i(TAG, "GUARD_MEMORY appPssMb=$appMb jsHeapMb=$heapMb inRow=$overMemory")
                if (overMemory >= MEMORY_SAMPLES && checked) fire("memory") else main.postDelayed(this, MEMORY_MS)
            }
        }
    }

    // ------------------------------------------------------------

    private fun fire(reason: String) {
        val culprit = skin
        Log.w(TAG, "GUARD_TRIP reason=$reason culprit=$culprit")
        pause()
        badWindows = 0
        overMemory = 0
        trip(reason, culprit)
    }

    companion object {
        private const val TAG = MainActivity.TAG
        const val DEFAULT_SKIN = "default"
        private const val PING_MS = 2_000L
        const val HANG_MS = 8_000L
        private const val CRASH_WINDOW_MS = 10 * 60_000L
        private const val CRASH_LIMIT = 2
        private const val WINDOW_MS = 10_000L
        private const val JANK_WINDOWS = 3
        /** 2× the bench gate (1.5, R14): the default skin measures ~1.2 and minimal up to ~1.6, so leave room. */
        const val JANK_LIMIT = 3.0
        private const val MIN_INPUTS = 3
        /** Debug builds sample every 15 s so the guard can be tested quickly. */
        private val MEMORY_MS = if (BuildConfig.DEBUG) 15_000L else 60_000L
        private const val MEMORY_SAMPLES = 2
        /** The default skin's app process is ~90–100 MB on the VU31 (release, 50 apps). */
        const val APP_PSS_LIMIT_MB = 150
        /** The default skin's JS heap is ~2 MB; a skin holding 64 MB of script data is far outside the budget. */
        const val JS_HEAP_LIMIT_MB = 64

        /** Same as jankPerInput() in tools/lib/bench.mjs: janky frames per burst (frames < 100 ms apart = one key). */
        fun jankPerInput(at: List<Long>, janky: List<Boolean>): Double? {
            var bursts = 0
            var bad = 0
            var last = Long.MIN_VALUE / 2
            for (i in at.indices) {
                if (at[i] - last > 100) bursts++
                if (janky[i]) bad++
                last = at[i]
            }
            if (bursts < MIN_INPUTS) return null
            return Math.round(bad * 100.0 / bursts) / 100.0
        }
    }
}
