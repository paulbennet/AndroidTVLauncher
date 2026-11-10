package com.weblauncher.tv

import android.content.Context
import android.media.tv.TvInputManager
import android.net.Uri
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * Debug builds only (plan M3, risk check, session 12): which TV content sources can this app read on this TV?
 * (Usage stats and media sessions were probed too; M3.3 was then dropped by the user, so those parts are gone.)
 * `adb shell am start -n com.weblauncher.tv/.MainActivity --ez probeContent true` logs CONTENT_PROBE {json}.
 */
object ContentProbe {
    fun run(ctx: Context) {
        val out = JSONObject()
        for ((name, uri) in listOf(
            "watchNext" to "content://android.media.tv/watch_next_program",
            "previewPrograms" to "content://android.media.tv/preview_program",
            "channels" to "content://android.media.tv/channel",
            "programs" to "content://android.media.tv/program",
        )) {
            out.put(name, runCatching {
                ctx.contentResolver.query(Uri.parse(uri), null, null, null, null)?.use { c ->
                    val pkgs = HashSet<String>()
                    val col = c.getColumnIndex("package_name")
                    while (c.moveToNext() && col >= 0) pkgs.add(c.getString(col) ?: "?")
                    JSONObject().put("rows", c.count).put("packages", JSONArray(pkgs.toList()))
                } ?: "null cursor"
            }.getOrElse { "${it.javaClass.simpleName}: ${it.message}" })
        }
        out.put("tvInputs", runCatching {
            val tim = ctx.getSystemService(Context.TV_INPUT_SERVICE) as TvInputManager
            JSONArray(tim.tvInputList.map { i ->
                JSONObject().put("id", i.id).put("type", i.type).put("label", i.loadLabel(ctx).toString())
                    .put("passthrough", i.isPassthroughInput).put("hidden", i.isHidden(ctx))
                    .put("state", tim.getInputState(i.id))
            })
        }.getOrElse { "${it.javaClass.simpleName}: ${it.message}" })
        Log.i(MainActivity.TAG, "CONTENT_PROBE $out")
    }
}
