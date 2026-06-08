package com.castarro.mobile

import com.castarro.mobile.streaming.dropFfmpegExecutable
import org.junit.Assert.assertEquals
import org.junit.Test

class StreamProcessRunnerTest {
    @Test
    fun dropsDesktopFfmpegExecutableBeforeCallingAndroidRuntime() {
        assertEquals(
            listOf("-hide_banner", "-nostdin"),
            listOf("ffmpeg", "-hide_banner", "-nostdin").dropFfmpegExecutable(),
        )
    }

    @Test
    fun keepsArgumentsWhenCommandHasNoExecutablePrefix() {
        assertEquals(
            listOf("-hide_banner", "-nostdin"),
            listOf("-hide_banner", "-nostdin").dropFfmpegExecutable(),
        )
    }
}
