package com.castarro.mobile.ui.screens

import android.net.Uri
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.castarro.mobile.domain.model.CompatibilityStatus
import com.castarro.mobile.domain.model.VideoAsset
import com.castarro.mobile.platform.rememberVideoFilePicker
import com.castarro.mobile.ui.MobileUiState
import com.castarro.mobile.ui.components.ChannelHeader
import com.castarro.mobile.ui.components.SurfaceCard
import com.castarro.mobile.ui.components.VideoAssetRow
import com.castarro.mobile.ui.theme.CastarroColors as Colors
import kotlin.math.roundToInt

@Composable
fun VideoLibraryScreen(
    state: MobileUiState,
    onImportVideos: (List<Uri>) -> Unit,
    onDeselectVideo: (String) -> Unit,
    onMoveVideo: (String, Int) -> Unit,
    onChannelHeaderClick: () -> Unit,
    onClearError: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val picker = rememberVideoFilePicker(onImportVideos)
    val selectedVideos = state.selectedVideos
    val dragShiftDistancePx = with(LocalDensity.current) { LiveVideoDragShiftDistance.toPx() }
    var activeVideoDrag by remember { mutableStateOf<VideoDragState?>(null) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Colors.Background),
    ) {
        ChannelHeader(
            title = "Video",
            channelName = state.channel?.displayName ?: "Castarro",
            status = videoHeaderStatus(state),
            logoUri = state.channel?.logoUri,
            onChannelClick = onChannelHeaderClick,
        )
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            state.errorMessage?.let { message ->
                SurfaceCard {
                    Text("Import issue", fontWeight = FontWeight.Bold, color = Colors.Danger)
                    Text(message, color = Colors.Muted)
                    OutlinedButton(onClick = onClearError) {
                        Text("Dismiss")
                    }
                }
            }

            SurfaceCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Phone videos", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    Button(
                        onClick = { picker.launch(arrayOf("video/mp4", "video/quicktime", "video/*")) },
                        enabled = !state.isImporting,
                        colors = ButtonDefaults.buttonColors(containerColor = Colors.Gold, contentColor = Colors.Ink),
                    ) {
                        Text(if (state.isImporting) "Importing" else "Select")
                    }
                }
                if (state.videos.isEmpty()) {
                    Text("Select videos from this phone to import and validate them.", color = Colors.Muted)
                } else if (selectedVideos.isEmpty()) {
                    Text("No videos selected for streaming.", color = Colors.Muted)
                } else {
                    selectedVideos.forEachIndexed { index, video ->
                        key(video.id) {
                            val rowOffsetY = dragPreviewOffsetY(activeVideoDrag, video.id, index)
                            val isDragged = activeVideoDrag?.videoId == video.id
                            val animatedOffsetY by animateFloatAsState(
                                targetValue = rowOffsetY,
                                animationSpec = tween(durationMillis = 140),
                                label = "video-row-drag-offset",
                            )
                            val visualOffsetY = if (isDragged) rowOffsetY else animatedOffsetY
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                VideoAssetRow(
                                    name = video.displayName,
                                    meta = videoAssetMeta(video),
                                    badge = compatibilityBadge(video),
                                    tone = compatibilityTone(video),
                                    thumbnailPath = video.localPath,
                                    thumbnailUri = video.sourceUri,
                                    modifier = Modifier
                                        .zIndex(if (isDragged) 1f else 0f)
                                        .graphicsLayer {
                                            translationY = visualOffsetY
                                            scaleX = if (isDragged) 1.01f else 1f
                                            scaleY = if (isDragged) 1.01f else 1f
                                        }
                                        .shadow(
                                            elevation = if (isDragged) 12.dp else 0.dp,
                                            shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
                                            clip = false,
                                        ),
                                    leading = {
                                        DragHandle(
                                            videoId = video.id,
                                            canMoveUp = index > 0,
                                            canMoveDown = index < selectedVideos.lastIndex,
                                            onDragStart = {
                                                activeVideoDrag = VideoDragState(
                                                    videoId = video.id,
                                                    originalIndex = index,
                                                    currentIndex = index,
                                                    offsetY = 0f,
                                                    shiftDistancePx = dragShiftDistancePx,
                                                )
                                            },
                                            onDrag = { dragAmountY ->
                                                activeVideoDrag = activeVideoDrag
                                                    ?.takeIf { it.videoId == video.id }
                                                    ?.let { drag ->
                                                        val nextOffsetY = drag.offsetY + dragAmountY
                                                        drag.copy(
                                                            offsetY = nextOffsetY,
                                                            currentIndex = dragTargetIndex(
                                                                originalIndex = drag.originalIndex,
                                                                offsetY = nextOffsetY,
                                                                shiftDistancePx = drag.shiftDistancePx,
                                                                itemCount = selectedVideos.size,
                                                            ),
                                                        )
                                                    }
                                            },
                                            onDragEnd = {
                                                activeVideoDrag?.takeIf { it.videoId == video.id }?.let { drag ->
                                                    onMoveVideo(video.id, drag.currentIndex - drag.originalIndex)
                                                }
                                                activeVideoDrag = null
                                            },
                                            onDragCancel = {
                                                activeVideoDrag = null
                                            },
                                        )
                                    },
                                    trailing = {
                                        TextButton(onClick = { onDeselectVideo(video.id) }) {
                                            Text("x", color = Colors.Danger, fontWeight = FontWeight.Bold)
                                        }
                                    },
                                )
                            }
                        }
                    }
                }
            }

            if (selectedVideos.any { it.compatibilityStatus != CompatibilityStatus.Ready }) {
                SurfaceCard {
                    Text("Video warning", fontWeight = FontWeight.Bold, color = Colors.Warning)
                    Text(
                        "Some selected videos are not YouTube-compatible. Encode them via the Castarro Desktop app before streaming.",
                        color = Colors.Muted,
                    )
                }
            }
        }
    }
}

@Composable
private fun DragHandle(
    videoId: String,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    onDragStart: () -> Unit,
    onDrag: (Float) -> Unit,
    onDragEnd: () -> Unit,
    onDragCancel: () -> Unit,
) {
    val isEnabled = canMoveUp || canMoveDown
    Box(
        modifier = Modifier
            .padding(end = 8.dp)
            .pointerInput(videoId, canMoveUp, canMoveDown) {
                detectDragGestures(
                    onDragStart = {
                        if (isEnabled) onDragStart()
                    },
                    onDragEnd = {
                        if (isEnabled) onDragEnd()
                    },
                    onDragCancel = {
                        if (isEnabled) onDragCancel()
                    },
                    onDrag = { change, dragAmount ->
                        if (isEnabled) {
                            change.consume()
                            onDrag(dragAmount.y)
                        }
                    },
                )
            }
            .padding(horizontal = 4.dp, vertical = 10.dp),
    ) {
        Text("::", color = Colors.Muted, fontWeight = FontWeight.Bold)
    }
}

private val LiveVideoDragShiftDistance: Dp = 70.dp

private data class VideoDragState(
    val videoId: String,
    val originalIndex: Int,
    val currentIndex: Int,
    val offsetY: Float,
    val shiftDistancePx: Float,
)

private fun dragPreviewOffsetY(drag: VideoDragState?, videoId: String, index: Int): Float {
    if (drag == null) return 0f
    if (drag.videoId == videoId) return drag.offsetY
    return when {
        drag.currentIndex > drag.originalIndex && index > drag.originalIndex && index <= drag.currentIndex ->
            -drag.shiftDistancePx
        drag.currentIndex < drag.originalIndex && index >= drag.currentIndex && index < drag.originalIndex ->
            drag.shiftDistancePx
        else -> 0f
    }
}

private fun dragTargetIndex(
    originalIndex: Int,
    offsetY: Float,
    shiftDistancePx: Float,
    itemCount: Int,
): Int {
    if (itemCount <= 0 || shiftDistancePx <= 0f) return originalIndex
    return (originalIndex + (offsetY / shiftDistancePx).roundToInt())
        .coerceIn(0, itemCount - 1)
}

private fun videoHeaderStatus(state: MobileUiState): String =
    when {
        state.selectedVideos.isEmpty() -> "Empty"
        state.selectedVideos.all { it.compatibilityStatus == CompatibilityStatus.Ready } -> "Ready"
        state.selectedVideos.any { it.compatibilityStatus == CompatibilityStatus.Blocked } -> "Blocked"
        state.selectedVideos.any { it.compatibilityStatus == CompatibilityStatus.NeedsDesktopPrep } -> "Prep"
        else -> "Unknown"
    }

private fun compatibilityBadge(video: VideoAsset): String =
    when (video.compatibilityStatus) {
        CompatibilityStatus.Ready -> "Ready"
        CompatibilityStatus.NeedsDesktopPrep -> "Prep"
        CompatibilityStatus.Blocked -> "Blocked"
        CompatibilityStatus.Unknown -> "Unknown"
    }

private fun compatibilityTone(video: VideoAsset): String =
    if (video.compatibilityStatus == CompatibilityStatus.Ready) "good" else "warn"

private fun videoAssetMeta(video: VideoAsset): String {
    val dimensions = when {
        video.width != null && video.height != null -> "${video.width}x${video.height}"
        else -> "Unknown size"
    }
    val fps = video.fps?.let { "${it.toInt()} fps" } ?: "Unknown fps"
    return "$dimensions | $fps | ${video.videoCodec.uppercase()} | ${video.audioCodec.uppercase()}"
}
