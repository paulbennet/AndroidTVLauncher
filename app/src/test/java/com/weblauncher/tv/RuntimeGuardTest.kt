package com.weblauncher.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * RuntimeGuard.jankPerInput must give the same numbers as jankPerInput() in tools/lib/bench.mjs
 * (the same cases are in tools/test/bench.test.mjs): frames less than 100 ms apart are one key press.
 */
class RuntimeGuardTest {

    private fun perInput(vararg frames: Pair<Long, Boolean>) =
        RuntimeGuard.jankPerInput(frames.map { it.first }, frames.map { it.second })

    @Test fun threeKeysOneJankyFrameEach() {
        // 3 bursts (0, 500, 1000 ms), each with a janky first frame and 2 on-time frames.
        val f = listOf(0L, 500L, 1000L).flatMap { t -> listOf(t to true, t + 16 to false, t + 33 to false) }
        assertEquals(1.0, perInput(*f.toTypedArray())!!, 0.001)
    }

    @Test fun framesUnder100msApartAreOneBurst() {
        // 99 ms gaps chain into one burst; a 101 ms gap starts the next one: 3 bursts, 4 janky frames.
        val r = perInput(0L to true, 99L to true, 198L to false, 299L to true, 600L to true, 700L to false)
        assertEquals(1.33, r!!, 0.001)
    }

    @Test fun noJank() {
        assertEquals(0.0, perInput(0L to false, 300L to false, 600L to false)!!, 0.001)
    }

    @Test fun fewerThanThreeKeysGiveNoVerdict() {
        assertNull(perInput(0L to true, 500L to true))
        assertNull(perInput())
    }

    @Test fun limitIsTwiceTheBenchGate() {
        assertEquals(3.0, RuntimeGuard.JANK_LIMIT, 0.0)
    }
}
