package com.weblauncher.tv

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import android.view.accessibility.AccessibilityEvent

/**
 * Session 17, decision D2 (b): open this launcher whenever Google TV's own home comes to the front.
 *
 * BootReceiver alone is not enough on the VU31. After a reboot, BOOT_COMPLETED arrives ~26 s after Google TV home is
 * shown, and a wake from standby sends no broadcast at all: the TV shows Google TV home until the user presses Home.
 * An accessibility service is bound by the system early and stays bound across standby, and the system lets it start
 * activities from the background.
 *
 * Kept narrow on purpose (res/xml/home_watch.xml): it gets only window-state events from `launcherx`, and it can't
 * read window content. Only HomeActivity counts: launcherx also shows profile, account and settings screens, and those
 * must stay usable. The user turns it on once (TV Settings → Accessibility, or over ADB; see README).
 */
class HomeWatchService : AccessibilityService() {
    private val recent = ArrayDeque<Long>()

    override fun onServiceConnected() { Log.i(TAG, "HOME_WATCH connected") }

    override fun onAccessibilityEvent(e: AccessibilityEvent?) {
        if (e?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        if (e.packageName?.toString() != LAUNCHERX) return
        // When launcherx starts an activity, the event names it. When an activity that already exists comes back to
        // the front (wake from standby, Back from a profile screen), the event names only a view class such as
        // android.widget.FrameLayout. So remember the last launcherx activity, and treat a view-class event as
        // "that activity again". Unknown (null) counts as home: after a wake, home is the screen Google TV shows.
        val cls = e.className?.toString()
        // DispatchActivity: Google TV's "power on behaviour" step. It comes to the front at sleep and at wake, then
        // hands over to home or to the last app. It is not a screen of its own, so it must not change lastActivity.
        if (cls == DISPATCH_ACTIVITY) { Log.i(TAG, "HOME_WATCH ignored class=dispatch"); return }
        if (cls != null && cls.startsWith("$LAUNCHERX.")) lastActivity = cls
        val home = lastActivity == null || lastActivity == HOME_ACTIVITY
        if (!home) { Log.i(TAG, "HOME_WATCH ignored class=$cls last=$lastActivity"); return }
        // Loop guard: if the launcher can't stay in front (crash, safe mode trouble), stop after 3 tries in 30 s.
        val now = SystemClock.elapsedRealtime()
        while (recent.isNotEmpty() && now - recent.first() > 30_000) recent.removeFirst()
        if (recent.isNotEmpty() && now - recent.last() < 2_000) return
        if (recent.size >= 3) { Log.w(TAG, "HOME_WATCH paused reason=loop"); return }
        recent.addLast(now)
        val start = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(MainActivity.EXTRA_FROM_HOME_WATCH, true)
        val ok = runCatching { startActivity(start) }.onFailure { Log.w(TAG, "HOME_WATCH failed: $it") }.isSuccess
        Log.i(TAG, "HOME_WATCH opened=$ok")
    }

    override fun onInterrupt() {}

    companion object {
        private const val TAG = MainActivity.TAG
        const val LAUNCHERX = "com.google.android.apps.tv.launcherx"
        const val HOME_ACTIVITY = "$LAUNCHERX.home.HomeActivity"
        const val DISPATCH_ACTIVITY = "$LAUNCHERX.coreservices.bootmode.DispatchActivity"

        /** Last launcherx activity seen. MainActivity clears it on resume: launcherx is then no longer in front. */
        @Volatile var lastActivity: String? = null
    }
}
