package com.castarro.mobile.ui.screens

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import com.castarro.mobile.ui.MobileUiState
import com.castarro.mobile.ui.components.ChannelHeader
import com.castarro.mobile.ui.components.ReadinessRow
import com.castarro.mobile.ui.components.SurfaceCard
import com.castarro.mobile.ui.theme.CastarroColors as Colors
import com.castarro.mobile.ui.theme.CastarroUiMaster as Ui

@Composable
fun YoutubeScreen(
    state: MobileUiState,
    onRtmpServerUrlChange: (String) -> Unit,
    onStreamKeyChange: (String) -> Unit,
    onYoutubeBroadcastTitleChange: (String) -> Unit,
    onYoutubeBroadcastDescriptionChange: (String) -> Unit,
    onPickYoutubeThumbnail: () -> Unit,
    onClearYoutubeThumbnail: () -> Unit,
    onYoutubePrivacyStatusChange: (String) -> Unit,
    onLoopEnabledChange: (Boolean) -> Unit,
    onSaveManualProfile: () -> Unit,
    onConnectYoutubeAccount: () -> Unit,
    onPrepareYoutubeBroadcast: () -> Unit,
    onDisconnectYoutubeAccount: () -> Unit,
    onChannelHeaderClick: () -> Unit,
    onClearError: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val youtubeProfile = state.selectedProfile?.takeIf { it.mode.name == "YoutubeAccount" }
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Colors.Background),
    ) {
        ChannelHeader(
            title = "YouTube",
            channelName = state.channel?.displayName ?: "Castarro",
            status = if (state.selectedYoutubeAccount == null) "Connect" else "Connected",
            logoUri = state.channel?.logoUri,
            onChannelClick = onChannelHeaderClick,
        )
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(Ui.Space.Page),
            verticalArrangement = Arrangement.spacedBy(Ui.Space.Xl),
        ) {
            state.errorMessage?.let { message ->
                SurfaceCard {
                    Text("Profile issue", fontWeight = FontWeight.Bold, color = Colors.Danger)
                    Text(message, color = Colors.Muted)
                    OutlinedButton(onClick = onClearError) {
                        Text("Dismiss")
                    }
                }
            }

            SurfaceCard {
                Text("YouTube account", fontWeight = FontWeight.Bold)
                val account = state.selectedYoutubeAccount
                if (account == null) {
                    Text("Connect a Google account with YouTube Live access.", color = Colors.Muted)
                    Button(
                        onClick = onConnectYoutubeAccount,
                        enabled = !state.isConnectingYoutube,
                        colors = ButtonDefaults.buttonColors(containerColor = Colors.Green),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (state.isConnectingYoutube) "Opening Google" else "Connect YouTube")
                    }
                } else {
                    ReadinessRow("Account", account.displayName, account.status)
                    account.email?.let { email -> ReadinessRow("Email", email, "Verified") }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(Ui.Space.Lg),
                    ) {
                        Button(
                            onClick = onConnectYoutubeAccount,
                            enabled = !state.isConnectingYoutube,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Switch")
                        }
                        OutlinedButton(
                            onClick = onDisconnectYoutubeAccount,
                            enabled = !state.isConnectingYoutube,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Disconnect")
                        }
                    }
                }
            }

            SurfaceCard {
                Text("YouTube Live profile", fontWeight = FontWeight.Bold)
                OutlinedTextField(
                    value = state.youtubeBroadcastTitle,
                    onValueChange = onYoutubeBroadcastTitleChange,
                    label = { Text("Broadcast title") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = state.youtubeBroadcastDescription,
                    onValueChange = onYoutubeBroadcastDescriptionChange,
                    label = { Text("Description") },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("Thumbnail", fontWeight = FontWeight.Bold)
                YoutubeThumbnailPreview(thumbnailUri = state.youtubeThumbnailUri)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Ui.Space.Lg),
                ) {
                    OutlinedButton(
                        onClick = onPickYoutubeThumbnail,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(if (state.youtubeThumbnailUri.isNullOrBlank()) "Select thumbnail" else "Change")
                    }
                    if (!state.youtubeThumbnailUri.isNullOrBlank()) {
                        OutlinedButton(
                            onClick = onClearYoutubeThumbnail,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Remove")
                        }
                    }
                }
                Text("Privacy", fontWeight = FontWeight.Bold)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Ui.Space.Md),
                ) {
                    listOf("private", "unlisted", "public").forEach { privacy ->
                        val selected = state.youtubePrivacyStatus == privacy
                        if (selected) {
                            Button(
                                onClick = { onYoutubePrivacyStatusChange(privacy) },
                                modifier = Modifier.weight(1f),
                            ) {
                                Text(privacy.replaceFirstChar { it.uppercase() })
                            }
                        } else {
                            OutlinedButton(
                                onClick = { onYoutubePrivacyStatusChange(privacy) },
                                modifier = Modifier.weight(1f),
                            ) {
                                Text(privacy.replaceFirstChar { it.uppercase() })
                            }
                        }
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Text("Loop video", fontWeight = FontWeight.Bold)
                        Text("Use the same playback setting for this event.", color = Colors.Muted)
                    }
                    Switch(checked = state.loopEnabled, onCheckedChange = onLoopEnabledChange)
                }
                Button(
                    onClick = onPrepareYoutubeBroadcast,
                    enabled = !state.isPreparingYoutubeBroadcast && state.youtubeBroadcastTitle.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(containerColor = Colors.Green),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (state.isPreparingYoutubeBroadcast) "Preparing" else "Create live stream")
                }
                if (youtubeProfile == null) {
                    Text("Creates a YouTube Live event and saves the RTMPS destination on this device.", color = Colors.Muted)
                } else {
                    ReadinessRow("Broadcast", youtubeProfile.youtubeBroadcastId.orEmpty(), "Ready")
                    ReadinessRow("Ingest", youtubeProfile.rtmpServerUrl.orEmpty(), "RTMPS")
                    ReadinessRow("Stream name", "Stored encrypted on this device", "Ready")
                }
            }

            SurfaceCard {
                Text("Manual RTMPS profile", fontWeight = FontWeight.Bold)
                OutlinedTextField(
                    value = state.rtmpServerUrl,
                    onValueChange = onRtmpServerUrlChange,
                    label = { Text("RTMP/RTMPS server URL") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = state.streamKeyDraft,
                    onValueChange = onStreamKeyChange,
                    label = { Text("Stream key") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Text("Loop video", fontWeight = FontWeight.Bold)
                        Text("Restart from the beginning after the file ends.", color = Colors.Muted)
                    }
                    Switch(checked = state.loopEnabled, onCheckedChange = onLoopEnabledChange)
                }
                Button(
                    onClick = onSaveManualProfile,
                    enabled = !state.isSavingProfile,
                    colors = ButtonDefaults.buttonColors(containerColor = Colors.Green),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (state.isSavingProfile) "Saving" else "Save profile")
                }
            }
        }
    }
}

@Composable
private fun YoutubeThumbnailPreview(thumbnailUri: String?) {
    val imageBitmap = rememberThumbnailBitmap(thumbnailUri)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(Ui.Aspect.Video)
            .clip(RoundedCornerShape(Ui.Radius.Control))
            .background(Colors.SurfaceSoft)
            .border(Ui.Space.Hairline, Colors.Line, RoundedCornerShape(Ui.Radius.Control)),
        contentAlignment = Alignment.Center,
    ) {
        if (imageBitmap == null) {
            Text("No thumbnail selected", color = Colors.Muted)
        } else {
            Image(
                bitmap = imageBitmap,
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        }
    }
}

@Composable
private fun rememberThumbnailBitmap(thumbnailUri: String?): ImageBitmap? {
    val context = LocalContext.current
    val image by produceState<ImageBitmap?>(initialValue = null, thumbnailUri) {
        value = thumbnailUri
            ?.takeIf { it.isNotBlank() }
            ?.let { uriText ->
                runCatching {
                    context.contentResolver.openInputStream(Uri.parse(uriText))?.use { input ->
                        BitmapFactory.decodeStream(input)?.asImageBitmap()
                    }
                }.getOrNull()
            }
    }
    return image
}
