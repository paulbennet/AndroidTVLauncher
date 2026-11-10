package com.weblauncher.tv

import android.content.Context
import android.content.Intent
import android.media.tv.TvContract
import android.media.tv.TvInputInfo
import android.media.tv.TvInputManager
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject

/**
 * TV inputs (plan step M3.1): HDMI, AV and the tuner, from TvInputManager. No permission is needed to list them or
 * to open one (an ACTION_VIEW of the input's passthrough or channels URI starts the TV app on that input).
 * On a device without TV inputs (phones, the desktop mock) the list is empty and skins hide the row.
 */
class InputRepository(private val ctx: Context, private val onChanged: () -> Unit) {

    private val tim: TvInputManager? = runCatching { ctx.getSystemService(Context.TV_INPUT_SERVICE) as? TvInputManager }.getOrNull()

    private val callback = object : TvInputManager.TvInputCallback() {
        override fun onInputStateChanged(inputId: String, state: Int) = onChanged()
        override fun onInputAdded(inputId: String) = onChanged()
        override fun onInputRemoved(inputId: String) = onChanged()
        override fun onInputUpdated(inputId: String) = onChanged()
    }
    private var listening = false

    fun listen(on: Boolean) {
        val t = tim ?: return
        if (on == listening) return
        listening = on
        if (on) t.registerCallback(callback, Handler(Looper.getMainLooper())) else t.unregisterCallback(callback)
    }

    private fun visible(): List<TvInputInfo> = runCatching {
        tim?.tvInputList.orEmpty().filter { !it.isHidden(ctx) && it.parentId == null }
    }.getOrDefault(emptyList())

    /**
     * [{ id, label, kind: hdmi|av|tuner|other, connected }]: HDMI first in number order (the VU31 lists them in
     * reverse), then AV and others, the tuner last. `connected` means INPUT_STATE_CONNECTED: the VU31 reports
     * "connected standby" for every input, cable or not, so standby is not shown as connected.
     */
    fun json(): String {
        val t = tim ?: return "[]"
        val order = mapOf("hdmi" to 0, "av" to 1, "other" to 2, "tuner" to 3)
        val rows = visible().map { i ->
            val label = (i.loadCustomLabel(ctx) ?: i.loadLabel(ctx)).toString().take(40)
            Triple(i, label, kind(i.type))
        }.sortedWith(compareBy({ order[it.third] }, { it.second.filter(Char::isDigit).toIntOrNull() ?: 99 }, { it.second }))
        val arr = JSONArray()
        for ((i, label, kind) in rows) {
            val state = runCatching { t.getInputState(i.id) }.getOrDefault(TvInputManager.INPUT_STATE_DISCONNECTED)
            arr.put(JSONObject().put("id", i.id).put("label", label).put("kind", kind)
                .put("connected", state == TvInputManager.INPUT_STATE_CONNECTED))
        }
        return arr.toString()
    }

    /** The intent that shows input `id`, or null if it is not a visible input of this TV. */
    fun intentFor(id: String): Intent? {
        val i = visible().firstOrNull { it.id == id } ?: return null
        val uri = if (i.isPassthroughInput) TvContract.buildChannelUriForPassthroughInput(i.id) else TvContract.buildChannelsUriForInput(i.id)
        return Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    private fun kind(type: Int) = when (type) {
        TvInputInfo.TYPE_HDMI -> "hdmi"
        TvInputInfo.TYPE_COMPOSITE, TvInputInfo.TYPE_COMPONENT, TvInputInfo.TYPE_SVIDEO, TvInputInfo.TYPE_SCART, TvInputInfo.TYPE_VGA, TvInputInfo.TYPE_DVI -> "av"
        TvInputInfo.TYPE_TUNER -> "tuner"
        else -> "other"
    }
}
