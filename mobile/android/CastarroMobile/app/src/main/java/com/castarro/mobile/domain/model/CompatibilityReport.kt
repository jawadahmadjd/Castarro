package com.castarro.mobile.domain.model

data class CompatibilityReport(
    val isReady: Boolean,
    val videoCodec: String,
    val audioCodec: String,
    val container: String,
    val warnings: List<String>,
    val blockingIssues: List<String>,
    val recommendedFix: String?,
) {
    val statusLabel: String = if (isReady) "Ready" else "Needs desktop prep"
}
