package com.castarro.mobile

import com.castarro.mobile.streaming.StreamLogParser
import com.castarro.mobile.streaming.StreamReconnectPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StreamingReliabilityTest {
    @Test
    fun reconnectPolicyUsesBoundedLinearBackoff() {
        val policy = StreamReconnectPolicy(maxAttempts = 3, baseDelayMs = 1_000)

        assertNull(policy.delayForAttempt(0))
        assertEquals(1_000L, policy.delayForAttempt(1))
        assertEquals(2_000L, policy.delayForAttempt(2))
        assertEquals(3_000L, policy.delayForAttempt(3))
        assertNull(policy.delayForAttempt(4))
    }

    @Test
    fun logParserMapsCommonFfmpegErrorsToUserMessages() {
        val parser = StreamLogParser()

        assertEquals(
            "YouTube rejected the stream key.",
            parser.parse("rtmps server returned 401 Unauthorized")?.userMessage,
        )
        assertEquals(
            "Connection lost. Castarro will try to reconnect.",
            parser.parse("Network is unreachable")?.userMessage,
        )
        assertEquals(
            "This video needs desktop prep before mobile streaming.",
            parser.parse("codec not currently supported in flv")?.userMessage,
        )
    }
}
