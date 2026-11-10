package com.weblauncher.tv

import android.app.Activity
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.view.FrameMetrics
import android.view.Window
import org.json.JSONObject

/**
 * Records real per-frame render data (same source as `dumpsys gfxinfo`) via FrameMetrics.
 * WebView content draws on the app's RenderThread, so these frames include the page.
 *
 * Jank is deadline-based on Android 12+ (frame finished after its deadline, like gfxinfo "Janky frames").
 * Pipelined frames can take longer than one vsync and still be on time, so "slow" (> 16.6 ms) is reported
 * separately for comparison with other launchers.
 */
class FrameStats(private val activity: Activity) {

    /** stagesMs: input, animation, layout+measure, draw, sync, command issue, swap (FrameMetrics), for the breakdown. */
    private class Frame(val totalMs: Float, val deadlineMs: Float, val gpuMs: Float, val atMs: Long, val stagesMs: FloatArray)

    private val handler by lazy { Handler(HandlerThread("frame-stats").apply { start() }.looper) }
    private val frames = ArrayList<Frame>(4096)
    @Volatile private var recording = false
    private var attached = false

    private val listener = Window.OnFrameMetricsAvailableListener { _, m, _ ->
        if (!recording || m.getMetric(FrameMetrics.FIRST_DRAW_FRAME) == 1L) return@OnFrameMetricsAvailableListener
        val total = m.getMetric(FrameMetrics.TOTAL_DURATION) / NS
        val deadline = if (Build.VERSION.SDK_INT >= 31) m.getMetric(FrameMetrics.DEADLINE) / NS else Float.NaN
        val gpu = if (Build.VERSION.SDK_INT >= 31) m.getMetric(FrameMetrics.GPU_DURATION) / NS else Float.NaN
        val at = m.getMetric(FrameMetrics.INTENDED_VSYNC_TIMESTAMP) / 1_000_000L
        val stages = FloatArray(STAGES.size) { m.getMetric(STAGES[it]) / NS }
        synchronized(frames) { frames.add(Frame(total, deadline, gpu, at, stages)) }
    }

    fun start() {
        synchronized(frames) { frames.clear() }
        if (!attached) {
            attached = true
            activity.runOnUiThread { activity.window.addOnFrameMetricsAvailableListener(listener, handler) }
        }
        recording = true
    }

    fun stop(): JSONObject {
        recording = false
        val list = synchronized(frames) { ArrayList(frames) }
        val out = JSONObject().put("frames", list.size)
        if (list.isEmpty()) return out

        val total = list.map { it.totalMs }.sorted()
        out.put("medianMs", pct(total, 0.50)).put("p90Ms", pct(total, 0.90))
            .put("p95Ms", pct(total, 0.95)).put("p99Ms", pct(total, 0.99))
            .put("maxMs", total.last().toDouble())
            .put("slowPct", list.count { it.totalMs > 16.6f } * 100.0 / list.size)

        val withDeadline = list.filter { !it.deadlineMs.isNaN() && it.deadlineMs > 0f }
        if (withDeadline.isNotEmpty()) {
            out.put("jankPct", withDeadline.count { it.totalMs > it.deadlineMs } * 100.0 / withDeadline.size)
                .put("deadlineMedianMs", pct(withDeadline.map { it.deadlineMs }.sorted(), 0.5))
        }
        val gpu = list.map { it.gpuMs }.filter { !it.isNaN() }.sorted()
        if (gpu.isNotEmpty()) out.put("gpuMedianMs", pct(gpu, 0.5)).put("gpuP95Ms", pct(gpu, 0.95))
        // Bench breakdown: every frame as [ms since first, total, deadline, gpu, stages…] (rounded to 0.1 ms).
        if (detail) {
            val t0 = list.first().atMs
            val arr = org.json.JSONArray()
            for (f in list) {
                val row = org.json.JSONArray().put(f.atMs - t0).put(r1(f.totalMs)).put(r1(f.deadlineMs)).put(r1(f.gpuMs))
                for (s in f.stagesMs) row.put(r1(s))
                arr.put(row)
            }
            out.put("frameRows", arr).put("frameCols", "at,total,deadline,gpu,input,anim,layout,draw,sync,issue,swap")
        }
        return out
    }

    /** Next stop() also lists every frame (bench breakdown, `--es frameStats stopDetail`). */
    @Volatile var detail = false

    private fun r1(x: Float): Double = if (x.isNaN()) -1.0 else Math.round(x * 10) / 10.0

    private fun pct(sorted: List<Float>, p: Double) = sorted[((sorted.size - 1) * p).toInt()].toDouble()

    private companion object {
        const val NS = 1_000_000f
        val STAGES = intArrayOf(
            FrameMetrics.INPUT_HANDLING_DURATION, FrameMetrics.ANIMATION_DURATION, FrameMetrics.LAYOUT_MEASURE_DURATION,
            FrameMetrics.DRAW_DURATION, FrameMetrics.SYNC_DURATION, FrameMetrics.COMMAND_ISSUE_DURATION,
            FrameMetrics.SWAP_BUFFERS_DURATION,
        )
    }
}
