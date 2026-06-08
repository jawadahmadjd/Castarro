package com.castarro.mobile.streaming

import com.castarro.mobile.domain.model.StreamProfile
import java.io.File

class StreamCommandBuilder {
    fun copyModeCommand(
        profile: StreamProfile,
        videoPaths: List<String>,
        streamKey: String,
        playlistFile: File,
    ): List<String> {
        require(videoPaths.isNotEmpty()) { "Select at least one video first." }
        val server = requireNotNull(profile.rtmpServerUrl) { "Stream profile requires a server URL." }
        val destination = "${server.trimEnd('/')}/$streamKey"
        val inputArgs = if (videoPaths.size == 1) {
            listOf("-i", videoPaths.first())
        } else {
            playlistFile.writeText(
                buildString {
                    appendLine("ffconcat version 1.0")
                    videoPaths.forEach { path ->
                        appendLine("file '${path.replace("\\", "\\\\").replace("'", "\\'")}'")
                    }
                },
            )
            listOf("-f", "concat", "-safe", "0", "-i", playlistFile.absolutePath)
        }
        val command = mutableListOf(
            "ffmpeg",
            "-hide_banner",
            "-nostdin",
            "-re",
        )
        if (profile.loopEnabled) {
            command += listOf("-stream_loop", "-1")
        }
        command += inputArgs
        command += listOf(
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
            destination,
        )
        return command
    }
}
