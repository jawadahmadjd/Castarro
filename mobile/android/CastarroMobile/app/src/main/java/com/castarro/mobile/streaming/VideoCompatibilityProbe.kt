package com.castarro.mobile.streaming

import com.castarro.mobile.domain.model.CompatibilityReport
import com.castarro.mobile.domain.model.VideoAsset

class VideoCompatibilityProbe {
    suspend fun probe(video: VideoAsset): CompatibilityReport {
        val videoOk = video.videoCodec.equals("h264", ignoreCase = true)
        val audioOk = video.audioCodec.equals("aac", ignoreCase = true)
        val blocking = buildList {
            if (!videoOk) add("${video.videoCodec.uppercase()} video cannot be sent with RTMP copy mode.")
            if (!audioOk) add("${video.audioCodec.uppercase()} audio cannot be sent with RTMP copy mode.")
        }
        return CompatibilityReport(
            isReady = blocking.isEmpty(),
            videoCodec = video.videoCodec,
            audioCodec = video.audioCodec,
            container = "mp4",
            warnings = emptyList(),
            blockingIssues = blocking,
            recommendedFix = if (blocking.isEmpty()) null else "Open Castarro Desktop and normalize this video first.",
        )
    }
}
