package com.castarro.mobile

import com.castarro.mobile.domain.model.StreamProfile
import com.castarro.mobile.domain.model.StreamProfileMode
import com.castarro.mobile.streaming.StreamCommandBuilder
import org.junit.Assert.assertEquals
import org.junit.Test

class StreamCommandBuilderTest {
    @Test
    fun buildsDesktopCompatibleCopyModeCommand() {
        val profile = StreamProfile(
            id = "profile",
            channelId = "channel",
            videoAssetId = "video",
            mode = StreamProfileMode.ManualKey,
            rtmpServerUrl = "rtmps://a.rtmps.youtube.com/live2",
            streamKeySecretRef = "secret://key",
            youtubeBroadcastId = null,
            loopEnabled = false,
            restartOnExit = true,
            createdAt = "2026-06-04T00:00:00Z",
            updatedAt = "2026-06-04T00:00:00Z",
        )

        assertEquals(
            listOf(
                "ffmpeg",
                "-hide_banner",
                "-nostdin",
                "-re",
                "-i",
                "/app/video.mp4",
                "-c",
                "copy",
                "-f",
                "flv",
                "rtmps://a.rtmps.youtube.com/live2/STREAM_KEY",
            ),
            StreamCommandBuilder().copyModeCommand(profile, "/app/video.mp4", "STREAM_KEY"),
        )
    }

    @Test
    fun includesLoopFlagWhenEnabled() {
        val profile = StreamProfile(
            id = "profile",
            channelId = "channel",
            videoAssetId = "video",
            mode = StreamProfileMode.ManualKey,
            rtmpServerUrl = "rtmps://a.rtmps.youtube.com/live2/",
            streamKeySecretRef = "secret://key",
            youtubeBroadcastId = null,
            loopEnabled = true,
            restartOnExit = true,
            createdAt = "2026-06-04T00:00:00Z",
            updatedAt = "2026-06-04T00:00:00Z",
        )

        assertEquals(
            listOf(
                "ffmpeg",
                "-hide_banner",
                "-nostdin",
                "-re",
                "-stream_loop",
                "-1",
                "-i",
                "/app/video.mp4",
                "-c",
                "copy",
                "-f",
                "flv",
                "rtmps://a.rtmps.youtube.com/live2/STREAM_KEY",
            ),
            StreamCommandBuilder().copyModeCommand(profile, "/app/video.mp4", "STREAM_KEY"),
        )
    }
}
