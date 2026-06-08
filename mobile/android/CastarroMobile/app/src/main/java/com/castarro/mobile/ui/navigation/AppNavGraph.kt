package com.castarro.mobile.ui.navigation

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.castarro.mobile.data.db.ChannelEntity
import com.castarro.mobile.ui.MobileUiState
import com.castarro.mobile.ui.components.CastarroBottomNav
import com.castarro.mobile.ui.components.ChannelLogo
import com.castarro.mobile.platform.StreamProtectionAction
import com.castarro.mobile.ui.screens.HistoryScreen
import com.castarro.mobile.ui.screens.HomeScreen
import com.castarro.mobile.ui.screens.SettingsScreen
import com.castarro.mobile.ui.screens.VideoLibraryScreen
import com.castarro.mobile.ui.screens.YoutubeScreen
import com.castarro.mobile.ui.theme.CastarroColors as Colors

@Composable
fun AppNavGraph(
    uiState: MobileUiState,
    onImportVideos: (List<Uri>) -> Unit,
    onDeselectVideo: (String) -> Unit,
    onMoveVideo: (String, Int) -> Unit,
    onSelectChannel: (String) -> Unit,
    onCreateChannel: (String, String?) -> Unit,
    onUpdateChannel: (String, String, String?) -> Unit,
    onRtmpServerUrlChange: (String) -> Unit,
    onStreamKeyChange: (String) -> Unit,
    onYoutubeBroadcastTitleChange: (String) -> Unit,
    onYoutubeBroadcastDescriptionChange: (String) -> Unit,
    onYoutubeThumbnailUriChange: (String?) -> Unit,
    onYoutubePrivacyStatusChange: (String) -> Unit,
    onLoopEnabledChange: (Boolean) -> Unit,
    onSaveManualProfile: () -> Unit,
    onConnectYoutubeAccount: () -> Unit,
    onPrepareYoutubeBroadcast: () -> Unit,
    onDisconnectYoutubeAccount: () -> Unit,
    onStartStream: () -> Unit,
    onStopStream: () -> Unit,
    onStreamProtectionAction: (StreamProtectionAction) -> Unit,
    onClearError: () -> Unit,
) {
    var destination by remember { mutableStateOf(CastarroDestination.Home) }
    val cachedDestinations = remember { mutableStateListOf(CastarroDestination.Home) }
    LaunchedEffect(Unit) {
        withFrameNanos { }
        CastarroDestination.entries.forEach { cachedDestination ->
            if (cachedDestination !in cachedDestinations) {
                cachedDestinations += cachedDestination
            }
        }
    }
    var showChannelPicker by remember { mutableStateOf(false) }
    var showChannelEditor by remember { mutableStateOf(false) }
    var editingChannelId by remember { mutableStateOf<String?>(null) }
    var channelNameDraft by remember { mutableStateOf("") }
    var channelLogoDraft by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val youtubeThumbnailPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        }
        onYoutubeThumbnailUriChange(uri.toString())
    }
    val logoPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        }
        channelLogoDraft = uri.toString()
    }

    fun openEditor(channel: ChannelEntity?) {
        editingChannelId = channel?.id
        channelNameDraft = channel?.displayName ?: "New channel"
        channelLogoDraft = channel?.logoUri
        showChannelPicker = false
        showChannelEditor = true
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        bottomBar = {
            CastarroBottomNav(
                selected = destination,
                onSelected = { selectedDestination ->
                    if (selectedDestination == destination) return@CastarroBottomNav
                    if (selectedDestination !in cachedDestinations) {
                        cachedDestinations += selectedDestination
                    }
                    destination = selectedDestination
                },
            )
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            cachedDestinations.forEach { cachedDestination ->
                key(cachedDestination) {
                    val isSelected = cachedDestination == destination
                    val cachedModifier = Modifier
                        .fillMaxSize()
                        .zIndex(if (isSelected) 1f else 0f)
                        .graphicsLayer { alpha = if (isSelected) 1f else 0f }
                        .then(if (isSelected) Modifier else Modifier.clearAndSetSemantics {})

                    when (cachedDestination) {
                        CastarroDestination.Home -> HomeScreen(
                            state = uiState,
                            onStartStream = onStartStream,
                            onStopStream = onStopStream,
                            onStreamProtectionAction = onStreamProtectionAction,
                            onChannelHeaderClick = { showChannelPicker = true },
                            onClearError = onClearError,
                            modifier = cachedModifier,
                        )
                        CastarroDestination.Video -> VideoLibraryScreen(
                            state = uiState,
                            onImportVideos = onImportVideos,
                            onDeselectVideo = onDeselectVideo,
                            onMoveVideo = onMoveVideo,
                            onChannelHeaderClick = { showChannelPicker = true },
                            onClearError = onClearError,
                            modifier = cachedModifier,
                        )
                        CastarroDestination.Youtube -> YoutubeScreen(
                            state = uiState,
                            onRtmpServerUrlChange = onRtmpServerUrlChange,
                            onStreamKeyChange = onStreamKeyChange,
                            onYoutubeBroadcastTitleChange = onYoutubeBroadcastTitleChange,
                            onYoutubeBroadcastDescriptionChange = onYoutubeBroadcastDescriptionChange,
                            onPickYoutubeThumbnail = { youtubeThumbnailPicker.launch(arrayOf("image/jpeg", "image/png")) },
                            onClearYoutubeThumbnail = { onYoutubeThumbnailUriChange(null) },
                            onYoutubePrivacyStatusChange = onYoutubePrivacyStatusChange,
                            onLoopEnabledChange = onLoopEnabledChange,
                            onSaveManualProfile = onSaveManualProfile,
                            onConnectYoutubeAccount = onConnectYoutubeAccount,
                            onPrepareYoutubeBroadcast = onPrepareYoutubeBroadcast,
                            onDisconnectYoutubeAccount = onDisconnectYoutubeAccount,
                            onChannelHeaderClick = { showChannelPicker = true },
                            onClearError = onClearError,
                            modifier = cachedModifier,
                        )
                        CastarroDestination.History -> HistoryScreen(
                            state = uiState,
                            onChannelHeaderClick = { showChannelPicker = true },
                            modifier = cachedModifier,
                        )
                        CastarroDestination.Settings -> SettingsScreen(
                            state = uiState,
                            onChannelHeaderClick = { showChannelPicker = true },
                            onStreamProtectionAction = onStreamProtectionAction,
                            modifier = cachedModifier,
                        )
                    }
                }
            }
        }
    }

    if (showChannelPicker) {
        ChannelPickerDialog(
            channels = uiState.channels,
            selectedChannelId = uiState.channel?.id,
            onSelect = { channelId ->
                onSelectChannel(channelId)
                showChannelPicker = false
            },
            onEdit = { channel -> openEditor(channel) },
            onAdd = { openEditor(null) },
            onDismiss = { showChannelPicker = false },
        )
    }

    if (showChannelEditor) {
        ChannelEditorDialog(
            title = if (editingChannelId == null) "Add channel" else "Edit channel",
            channelName = channelNameDraft,
            logoUri = channelLogoDraft,
            onChannelNameChange = { channelNameDraft = it },
            onPickLogo = { logoPicker.launch(arrayOf("image/*")) },
            onClearLogo = { channelLogoDraft = null },
            onDismiss = { showChannelEditor = false },
            onSave = {
                val channelId = editingChannelId
                if (channelId == null) {
                    onCreateChannel(channelNameDraft, channelLogoDraft)
                } else {
                    onUpdateChannel(channelId, channelNameDraft, channelLogoDraft)
                }
                showChannelEditor = false
            },
        )
    }
}

@Composable
private fun ChannelPickerDialog(
    channels: List<ChannelEntity>,
    selectedChannelId: String?,
    onSelect: (String) -> Unit,
    onEdit: (ChannelEntity) -> Unit,
    onAdd: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Channels") },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (channels.isEmpty()) {
                    Text("No channels yet.", color = Colors.Muted)
                }
                channels.forEach { channel ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedButton(
                            onClick = { onSelect(channel.id) },
                            modifier = Modifier.weight(1f),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                ChannelLogo(channel.displayName, channel.logoUri)
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(channel.displayName, fontWeight = FontWeight.Bold)
                                    if (channel.id == selectedChannelId) {
                                        Text("Selected", color = Colors.Green)
                                    }
                                }
                            }
                        }
                        TextButton(onClick = { onEdit(channel) }) {
                            Text("Edit")
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = onAdd) {
                Text("Add Channel")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Close")
            }
        },
    )
}

@Composable
private fun ChannelEditorDialog(
    title: String,
    channelName: String,
    logoUri: String?,
    onChannelNameChange: (String) -> Unit,
    onPickLogo: () -> Unit,
    onClearLogo: () -> Unit,
    onDismiss: () -> Unit,
    onSave: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    ChannelLogo(channelName, logoUri)
                    Column(modifier = Modifier.weight(1f)) {
                        OutlinedButton(
                            onClick = onPickLogo,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(if (logoUri.isNullOrBlank()) "Select logo" else "Change logo")
                        }
                        if (!logoUri.isNullOrBlank()) {
                            TextButton(onClick = onClearLogo) {
                                Text("Remove logo")
                            }
                        }
                    }
                }
                OutlinedTextField(
                    value = channelName,
                    onValueChange = onChannelNameChange,
                    label = { Text("Channel name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = onSave,
                enabled = channelName.isNotBlank(),
            ) {
                Text("Save")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}
