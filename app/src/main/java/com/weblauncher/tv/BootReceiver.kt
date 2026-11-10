package com.weblauncher.tv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log

/**
 * Plan M4, decision D6 (a): open this launcher after the TV boots.
 *
 * Google TV boots into its own home (`launcherx`, HOME priority 2). A normal app can't outrank it, the Home role and
 * `set-home-activity` are ignored, and disabling it brought up a recovery screen (reference repo, CHANGELOG). So this
 * receiver opens the launcher on top once boot is complete. Home *presses* still go to Google TV unless Button Mapper
 * points them here.
 *
 * Android 10+ blocks activity starts from the background. The exemption used here is "Display over other apps"
 * (SYSTEM_ALERT_WINDOW). The user grants it once, over ADB (TV Settings has no screen for it on the VU31):
 *   adb shell appops set com.weblauncher.tv SYSTEM_ALERT_WINDOW allow
 * Without it this receiver only logs BOOT_OPEN skipped.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!enabled(context)) { Log.i(TAG, "BOOT_OPEN skipped reason=off"); return }
        if (!allowed(context)) { Log.i(TAG, "BOOT_OPEN skipped reason=no-overlay-permission"); return }
        val start = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(MainActivity.EXTRA_FROM_BOOT, true)
        val ok = runCatching { context.startActivity(start) }.onFailure { Log.w(TAG, "BOOT_OPEN failed: $it") }.isSuccess
        Log.i(TAG, "BOOT_OPEN started=$ok")
    }

    companion object {
        private const val TAG = MainActivity.TAG
        private const val PREFS = "boot"
        private const val KEY = "openAtBoot"

        /** "Open at TV start" in Launcher settings; on by default (it does nothing until the permission is granted). */
        fun enabled(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, true)
        fun setEnabled(c: Context, on: Boolean) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).apply()
        fun allowed(c: Context) = Settings.canDrawOverlays(c)
    }
}
