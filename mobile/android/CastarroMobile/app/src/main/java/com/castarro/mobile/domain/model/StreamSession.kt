package com.castarro.mobile.domain.model

enum class StreamSessionStatus {
    Idle,
    Connecting,
    Live,
    Reconnecting,
    Stopped,
    Failed,
}

data class StreamSession(
    val id: String,
    val channelId: String,
    val videoAssetId: String,
    val startedAt: String,
    val endedAt: String?,
    val status: StreamSessionStatus,
    val exitCode: Int?,
    val bytesUploaded: Long,
    val averageBitrate: Double?,
    val failureReason: String?,
    val logPath: String?,
)
