package com.castarro.mobile.domain.model

enum class StreamProfileMode {
    ManualKey,
    YoutubeAccount,
}

data class StreamProfile(
    val id: String,
    val channelId: String,
    val videoAssetId: String?,
    val mode: StreamProfileMode,
    val rtmpServerUrl: String?,
    val streamKeySecretRef: String?,
    val youtubeBroadcastId: String?,
    val loopEnabled: Boolean,
    val restartOnExit: Boolean,
    val createdAt: String,
    val updatedAt: String,
)
