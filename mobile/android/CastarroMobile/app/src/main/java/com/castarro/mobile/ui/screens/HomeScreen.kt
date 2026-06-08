package com.castarro.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.castarro.mobile.domain.model.CompatibilityStatus
import com.castarro.mobile.domain.model.StreamProfile
import com.castarro.mobile.domain.model.VideoAsset
import com.castarro.mobile.platform.AppUsageSnapshot
import com.castarro.mobile.platform.StreamProtectionAction
import com.castarro.mobile.ui.MobileUiState
import com.castarro.mobile.ui.components.ChannelHeader
import com.castarro.mobile.ui.components.StatusBand
import com.castarro.mobile.ui.components.StreamActionBar
import com.castarro.mobile.ui.components.StreamProtectionPanel
import com.castarro.mobile.ui.components.SurfaceCard
import com.castarro.mobile.ui.theme.CastarroColors as Colors

@Composable
fun HomeScreen(
    state: MobileUiState,
    onStartStream: () -> Unit,
    onStopStream: () -> Unit,
    onStreamProtectionAction: (StreamProtectionAction) -> Unit,
    onChannelHeaderClick: () -> Unit,
    onClearError: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val channelName = state.channel?.displayName ?: "Castarro"
    val selectedVideos = state.selectedVideos
    val profile = state.selectedProfile
    val streamStatus = state.activeSession?.status?.name ?: "Idle"
    val showStreamProtection = state.streamProtection.warnings.isNotEmpty()
    val readinessIssues = readinessIssues(selectedVideos, profile)

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Colors.Background),
    ) {
        ChannelHeader(
            title = "Castarro",
            channelName = channelName,
            status = streamStatus,
            logoUri = state.channel?.logoUri,
            onChannelClick = onChannelHeaderClick,
        )
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            state.errorMessage?.let { message ->
                SurfaceCard {
                    Text("Action needed", fontWeight = FontWeight.Bold, color = Colors.Danger)
                    Text(message, color = Colors.Muted)
                    Button(
                        onClick = onClearError,
                        colors = ButtonDefaults.buttonColors(containerColor = Colors.Danger),
                    ) {
                        Text("Dismiss")
                    }
                }
            }

            StatusBand(
                video = videoStatus(selectedVideos),
                youtube = if (profile == null) "Missing" else "Manual",
                stream = streamStatus,
            )

            AppUsagePanel(state.appUsage)

            readinessIssues.forEach { issue ->
                SurfaceCard {
                    Text(issue.title, fontWeight = FontWeight.Bold, color = Colors.Danger)
                    Text(issue.message, color = Colors.Muted)
                }
            }

            if (showStreamProtection) {
                StreamProtectionPanel(
                    title = "Stream protection",
                    items = state.streamProtection.warnings,
                    emptyText = "",
                    onAction = onStreamProtectionAction,
                )
            }

            if (selectedVideos.isNotEmpty()) {
                SurfaceCard {
                    Text("Selected videos", fontWeight = FontWeight.Bold)
                    selectedVideos.forEachIndexed { index, selectedVideo ->
                        Text("${index + 1}. ${selectedVideo.displayName}", fontWeight = FontWeight.Bold)
                        Text(videoMeta(selectedVideo), color = Colors.Muted)
                    }
                }
            }

            StreamActionBar(
                isLive = state.isLive,
                isReady = state.isReady && !state.isStartingStream,
                onPrimary = if (state.isLive) onStopStream else onStartStream,
            )
        }
    }
}

@Composable
private fun AppUsagePanel(usage: AppUsageSnapshot) {
    SurfaceCard {
        Text("App usage", fontWeight = FontWeight.Bold)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            UsageMetric("CPU", formatCpu(usage.cpuPercent))
            UsageMetric("RAM", formatBytes(usage.ramBytes))
            UsageMetric("Data", formatBytes(usage.dataTransferredTodayBytes))
            UsageMetric("Battery", usage.batteryTodayLabel)
        }
    }
}

@Composable
private fun RowScope.UsageMetric(label: String, value: String) {
    Column(
        modifier = Modifier
            .weight(1f)
            .clip(RoundedCornerShape(8.dp))
            .background(Colors.SurfaceSoft)
            .border(1.dp, Colors.Line, RoundedCornerShape(8.dp))
            .padding(horizontal = 6.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(
            text = label,
            color = Colors.Ink,
            fontWeight = FontWeight.Bold,
            fontSize = 11.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = value,
            color = Colors.Muted,
            fontSize = 12.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private data class ReadinessIssue(
    val title: String,
    val message: String,
)

private fun readinessIssues(videos: List<VideoAsset>, profile: StreamProfile?): List<ReadinessIssue> {
    val issues = mutableListOf<ReadinessIssue>()
    if (videos.isEmpty()) {
        issues += ReadinessIssue(
            title = "Video file",
            message = "Select at least one phone video before going live.",
        )
    } else {
        val blockedVideo = videos.firstOrNull {
            it.compatibilityStatus != CompatibilityStatus.Ready || it.localPath.isNullOrBlank()
        }
        if (blockedVideo != null) {
            issues += ReadinessIssue(
                title = "Copy-mode compatibility",
                message = if (blockedVideo.localPath.isNullOrBlank()) {
                    "The imported video file is missing on this device."
                } else {
                    blockedVideo.compatibilityMessage
                },
            )
        }
    }

    destinationIssueText(profile).takeIf { it.isNotBlank() }?.let { message ->
        issues += ReadinessIssue(
            title = "Destination",
            message = message,
        )
    }
    return issues
}

private fun videoStatus(videos: List<VideoAsset>): String =
    when {
        videos.isEmpty() -> "None"
        videos.all { it.compatibilityStatus == CompatibilityStatus.Ready } -> "Ready"
        videos.any { it.compatibilityStatus == CompatibilityStatus.Blocked } -> "Blocked"
        videos.any { it.compatibilityStatus == CompatibilityStatus.NeedsDesktopPrep } -> "Prep"
        else -> "Unknown"
    }

private fun destinationIssueText(profile: StreamProfile?): String =
    when {
        profile == null -> "Set up a YouTube or manual RTMPS profile before going live."
        profile.rtmpServerUrl.isNullOrBlank() -> "The saved stream profile is missing its RTMP/RTMPS server URL."
        profile.streamKeySecretRef.isNullOrBlank() -> "The saved stream profile is missing its stream key."
        else -> ""
    }

private fun videoMeta(video: VideoAsset): String {
    val dimensions = when {
        video.width != null && video.height != null -> "${video.width}x${video.height}"
        else -> "Unknown size"
    }
    val fps = video.fps?.let { "${it.toInt()} fps" } ?: "Unknown fps"
    return "$dimensions | $fps | ${video.videoCodec.uppercase()} | ${video.audioCodec.uppercase()}"
}

private fun formatCpu(value: Double): String =
    if (value >= 10.0) "${value.toInt()}%" else "%.1f%%".format(value.coerceAtLeast(0.0))

private fun formatBytes(value: Long): String {
    val units = listOf("B", "KB", "MB", "GB", "TB")
    var amount = value.coerceAtLeast(0).toDouble()
    var unitIndex = 0
    while (amount >= 1024.0 && unitIndex < units.lastIndex) {
        amount /= 1024.0
        unitIndex += 1
    }
    return if (unitIndex == 0) {
        "${amount.toLong()} ${units[unitIndex]}"
    } else {
        val pattern = if (amount >= 10.0) "%.1f" else "%.2f"
        "${pattern.format(amount)} ${units[unitIndex]}"
    }
}
