package com.castarro.mobile.streaming

import com.castarro.mobile.domain.model.StreamProfile

class StreamCommandBuilder {
    fun copyModeCommand(profile: StreamProfile, videoPath: String, streamKey: String): List<String> {
        val server = requireNotNull(profile.rtmpServerUrl) { "Manual RTMPS profile requires a server URL." }
        val destination = "${server.trimEnd('/')}/$streamKey"
        val command = mutableListOf(
            "ffmpeg",
            "-hide_banner",
            "-nostdin",
            "-re",
        )
        if (profile.loopEnabled) {
            command += listOf("-stream_loop", "-1")
        }
        command += listOf(
            "-i",
            videoPath,
            "-c",
            "copy",
            "-f",
            "flv",
            destination,
        )
        return command
    }
}
