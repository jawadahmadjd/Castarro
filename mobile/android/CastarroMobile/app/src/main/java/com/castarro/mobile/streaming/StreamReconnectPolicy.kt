package com.castarro.mobile.streaming

class StreamReconnectPolicy(
    private val maxAttempts: Int = 5,
    private val baseDelayMs: Long = 2_000,
) {
    fun delayForAttempt(attempt: Int): Long? {
        if (attempt <= 0 || attempt > maxAttempts) return null
        return baseDelayMs * attempt
    }
}
