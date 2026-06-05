package com.castarro.mobile.domain.model

enum class CompatibilityStatus {
    Ready,
    NeedsDesktopPrep,
    Blocked,
    Unknown,
}

data class VideoAsset(
    val id: String,
    val displayName: String,
    val sourceUri: String,
    val localPath: String? = null,
    val durationMs: Long,
    val sizeBytes: Long,
    val videoCodec: String,
    val audioCodec: String,
    val width: Int? = null,
    val height: Int? = null,
    val fps: Double? = null,
    val audioSampleRate: Int? = null,
    val compatibilityStatus: CompatibilityStatus,
    val compatibilityMessage: String,
)
