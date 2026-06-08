package com.castarro.mobile

import com.castarro.mobile.domain.model.StreamProfile
import com.castarro.mobile.domain.model.StreamProfileMode
import com.castarro.mobile.streaming.StreamCommandBuilder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

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
                "fifo",
                "-fifo_format",
                "flv",
                "-queue_size",
                "180",
                "-attempt_recovery",
                "1",
                "-recover_any_error",
                "1",
                "-recovery_wait_time",
                "1",
                "-restart_with_keyframe",
                "1",
                "rtmps://a.rtmps.youtube.com/live2/STREAM_KEY",
            ),
            StreamCommandBuilder().copyModeCommand(profile, listOf("/app/video.mp4"), "STREAM_KEY", tempPlaylistFile()),
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
                "fifo",
                "-fifo_format",
                "flv",
                "-queue_size",
                "180",
                "-attempt_recovery",
                "1",
                "-recover_any_error",
                "1",
                "-recovery_wait_time",
                "1",
                "-restart_with_keyframe",
                "1",
                "rtmps://a.rtmps.youtube.com/live2/STREAM_KEY",
            ),
            StreamCommandBuilder().copyModeCommand(profile, listOf("/app/video.mp4"), "STREAM_KEY", tempPlaylistFile()),
        )
    }

    @Test
    fun buildsOrderedConcatPlaylistForMultipleVideos() {
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
        val playlistFile = tempPlaylistFile()

        assertEquals(
            listOf(
                "ffmpeg",
                "-hide_banner",
                "-nostdin",
                "-re",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                playlistFile.absolutePath,
                "-c",
                "copy",
                "-f",
                "fifo",
                "-fifo_format",
                "flv",
                "-queue_size",
                "180",
                "-attempt_recovery",
                "1",
                "-recover_any_error",
                "1",
                "-recovery_wait_time",
                "1",
                "-restart_with_keyframe",
                "1",
                "rtmps://a.rtmps.youtube.com/live2/STREAM_KEY",
            ),
            StreamCommandBuilder().copyModeCommand(
                profile,
                listOf("/app/first.mp4", "/app/second.mp4"),
                "STREAM_KEY",
                playlistFile,
            ),
        )
        assertTrue(playlistFile.readText().contains("file '/app/first.mp4'\nfile '/app/second.mp4'"))
    }

    private fun tempPlaylistFile(): File =
        File.createTempFile("castarro-stream", ".ffconcat").apply { deleteOnExit() }
}
