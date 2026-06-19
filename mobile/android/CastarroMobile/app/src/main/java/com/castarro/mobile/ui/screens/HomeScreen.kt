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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import com.castarro.mobile.domain.model.CompatibilityStatus
import com.castarro.mobile.domain.model.StreamProfile
import com.castarro.mobile.domain.model.VideoAsset
import com.castarro.mobile.data.sync.DesktopVideoDownloadPhase
import com.castarro.mobile.platform.AppUsageSnapshot
import com.castarro.mobile.platform.StreamProtectionAction
import com.castarro.mobile.ui.MobileUiState
import com.castarro.mobile.ui.components.ChannelHeader
import com.castarro.mobile.ui.components.StatusBand
import com.castarro.mobile.ui.components.StreamActionBar
import com.castarro.mobile.ui.components.StreamProtectionPanel
import com.castarro.mobile.ui.components.SurfaceCard
import com.castarro.mobile.ui.theme.CastarroColors as Colors
import com.castarro.mobile.ui.theme.CastarroUiMaster as Ui

@Composable
fun HomeScreen(
    state: MobileUiState,
    onStartStream: () -> Unit,
    onStopStream: () -> Unit,
    onStartDesktopRemoteStream: () -> Unit,
    onStopDesktopRemoteStream: () -> Unit,
    onRestartDesktopRemoteStream: () -> Unit,
    onRefreshDesktopRemoteStatus: () -> Unit,
    onStreamProtectionAction: (StreamProtectionAction) -> Unit,
    onScanSyncPairing: () -> Unit,
    onToggleDesktopVideoDownload: (String, Boolean) -> Unit,
    onStartDesktopVideoDownloads: () -> Unit,
    onPauseDesktopVideoDownloads: () -> Unit,
    onResumeDesktopVideoDownloads: () -> Unit,
    onCancelDesktopVideoDownloads: () -> Unit,
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
    val syncSummary = state.syncMessage ?: state.desktopSyncLastSummary
    val downloadableVideos = state.videos.filter { it.localPath.isNullOrBlank() && it.sourceUri.startsWith("http") }
    val downloadTask = state.desktopVideoDownloadTask
    val remoteChannel = state.remoteStatus.channels.firstOrNull { it.channelId == state.channel?.id }
    val remoteAlerts = state.remoteStatus.recentAlerts
        .filter { it.channelName.isBlank() || it.channelName == channelName }
        .take(3)

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
                .padding(Ui.Space.Page),
            verticalArrangement = Arrangement.spacedBy(Ui.Space.Xl),
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

            SurfaceCard {
                Text("Desktop sync", fontWeight = FontWeight.Bold)
                Text("Bring channels, YouTube settings, and selected videos from desktop.", color = Colors.Muted)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Ui.Space.Md),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Button(
                        onClick = onScanSyncPairing,
                        enabled = !state.isSyncingDesktop,
                        colors = ButtonDefaults.buttonColors(containerColor = Colors.Green),
                        modifier = Modifier.weight(1f),
                    ) {
                        if (state.isSyncingDesktop) {
                            CircularProgressIndicator(modifier = Modifier.padding(end = Ui.Space.Md))
                        }
                        Text(if (state.isSyncingDesktop) "Syncing" else "Scan desktop QR")
                    }
                }
                syncSummary?.let { summary ->
                    Text(summary, color = if (state.syncMessage != null) Colors.Green else Colors.Muted)
                }
                if (downloadableVideos.isNotEmpty()) {
                    Text("Desktop videos available", fontWeight = FontWeight.Bold)
                    downloadableVideos.forEach { video ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(Ui.Space.Xxs),
                            ) {
                                Text(video.displayName, fontWeight = FontWeight.Bold)
                                Text(formatBytes(video.sizeBytes), color = Colors.Muted)
                            }
                            Checkbox(
                                checked = video.id in state.selectedDesktopDownloadIds,
                                onCheckedChange = { checked ->
                                    onToggleDesktopVideoDownload(video.id, checked)
                                },
                                enabled = !downloadTask.isActive,
                            )
                        }
                    }
                    if (!downloadTask.isActive) {
                        Button(
                            onClick = onStartDesktopVideoDownloads,
                            enabled = state.selectedDesktopDownloadIds.isNotEmpty(),
                            colors = ButtonDefaults.buttonColors(containerColor = Colors.Green),
                        ) {
                            Text("Download selected videos")
                        }
                    }
                }
                if (downloadTask.phase != DesktopVideoDownloadPhase.Idle) {
                    Text(
                        downloadTask.message ?: "Desktop video download",
                        color = when (downloadTask.phase) {
                            DesktopVideoDownloadPhase.Failed -> Colors.Danger
                            DesktopVideoDownloadPhase.Cancelled -> Colors.Warning
                            DesktopVideoDownloadPhase.Completed -> Colors.Green
                            else -> Colors.Muted
                        },
                    )
                    if (downloadTask.isActive) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(Ui.Space.Md),
                        ) {
                            Button(
                                onClick = if (downloadTask.phase == DesktopVideoDownloadPhase.Paused) {
                                    onResumeDesktopVideoDownloads
                                } else {
                                    onPauseDesktopVideoDownloads
                                },
                                modifier = Modifier.weight(1f),
                            ) {
                                Text(if (downloadTask.phase == DesktopVideoDownloadPhase.Paused) "Resume" else "Pause")
                            }
                            Button(
                                onClick = onCancelDesktopVideoDownloads,
                                colors = ButtonDefaults.buttonColors(containerColor = Colors.Danger),
                                modifier = Modifier.weight(1f),
                            ) {
                                Text("Cancel")
                            }
                        }
                    }
                }
            }

            SurfaceCard {
                Text("Desktop remote control", fontWeight = FontWeight.Bold)
                Text(
                    state.remoteStatus.errorMessage
                        ?: if (state.remoteStatus.connected) {
                            "${state.remoteStatus.desktopLabel} is ready for health monitoring and channel control."
                        } else {
                            "Pair the desktop QR to monitor and control this channel from your phone."
                        },
                    color = Colors.Muted,
                )
                remoteChannel?.let { remote ->
                    Text(
                        "${remote.channelName} - ${if (remote.running) "Running" else "Idle"} - ${remote.healthLabel}",
                        fontWeight = FontWeight.Bold,
                    )
                    Text(remote.healthDetail.ifBlank {
                        if (remote.scheduleEnabled) {
                            if (remote.scheduleInWindow) "Inside the scheduled daily window." else "Outside the scheduled daily window."
                        } else {
                            "No desktop schedule is active for this channel."
                        }
                    }, color = Colors.Muted)
                }
                if (remoteAlerts.isNotEmpty()) {
                    remoteAlerts.forEach { alert ->
                        Text("${alert.title}: ${alert.message}", color = if (alert.severity == "danger") Colors.Danger else Colors.Muted)
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Ui.Space.Md),
                ) {
                    Button(
                        onClick = onRefreshDesktopRemoteStatus,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("Refresh")
                    }
                    Button(
                        onClick = if (remoteChannel?.running == true) onStopDesktopRemoteStream else onStartDesktopRemoteStream,
                        enabled = remoteChannel != null && !state.isRemoteActionBusy,
                        colors = ButtonDefaults.buttonColors(containerColor = if (remoteChannel?.running == true) Colors.Danger else Colors.Green),
                        modifier = Modifier.weight(1f),
                    ) {
                        if (state.isRemoteActionBusy) {
                            CircularProgressIndicator(modifier = Modifier.padding(end = Ui.Space.Md))
                        }
                        Text(if (remoteChannel?.running == true) "Stop desktop" else "Start desktop")
                    }
                    Button(
                        onClick = onRestartDesktopRemoteStream,
                        enabled = remoteChannel != null && !state.isRemoteActionBusy,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("Restart")
                    }
                }
            }

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
            horizontalArrangement = Arrangement.spacedBy(Ui.Space.Md),
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
            .clip(RoundedCornerShape(Ui.Radius.Control))
            .background(Colors.SurfaceSoft)
            .border(Ui.Space.Hairline, Colors.Line, RoundedCornerShape(Ui.Radius.Control))
            .padding(horizontal = Ui.Space.MetricHorizontal, vertical = Ui.Space.Md),
        verticalArrangement = Arrangement.spacedBy(Ui.Space.Xs),
    ) {
        Text(
            text = label,
            color = Colors.Ink,
            fontWeight = FontWeight.Bold,
            fontSize = Ui.TextSize.UsageLabel,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = value,
            color = Colors.Muted,
            fontSize = Ui.TextSize.UsageValue,
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
