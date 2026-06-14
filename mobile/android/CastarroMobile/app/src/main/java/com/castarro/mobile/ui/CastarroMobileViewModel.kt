package com.castarro.mobile.ui

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.content.IntentSender
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.castarro.mobile.CastarroApp
import com.castarro.mobile.data.db.ChannelEntity
import com.castarro.mobile.data.db.StreamProfileEntity
import com.castarro.mobile.data.db.StreamSessionEntity
import com.castarro.mobile.data.db.VideoAssetEntity
import com.castarro.mobile.data.preferences.AppPreferences
import com.castarro.mobile.data.preferences.castarroDataStore
import com.castarro.mobile.data.sync.DesktopPairingRequest
import com.castarro.mobile.data.sync.DesktopRemoteStatus
import com.castarro.mobile.data.sync.DesktopVideoDownloadCoordinator
import com.castarro.mobile.data.sync.DesktopVideoDownloadForegroundService
import com.castarro.mobile.data.sync.DesktopVideoDownloadPhase
import com.castarro.mobile.data.sync.DesktopVideoDownloadTask
import com.castarro.mobile.data.youtube.CreateBroadcastRequest
import com.castarro.mobile.data.youtube.YoutubeAccount
import com.castarro.mobile.domain.model.CompatibilityStatus
import com.castarro.mobile.domain.model.StreamProfile
import com.castarro.mobile.domain.model.StreamProfileMode
import com.castarro.mobile.domain.model.StreamSession
import com.castarro.mobile.domain.model.StreamSessionStatus
import com.castarro.mobile.domain.model.VideoAsset
import com.castarro.mobile.domain.usecase.StartStreamUseCase
import com.castarro.mobile.platform.AppUsageSnapshot
import com.castarro.mobile.platform.NotificationFactory
import com.castarro.mobile.platform.StreamProtectionAction
import com.castarro.mobile.platform.StreamProtectionReport
import com.castarro.mobile.streaming.StreamForegroundService
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.MutablePreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.io.File
import java.time.Instant
import java.util.UUID

private val EmptyDesktopRemoteStatus = DesktopRemoteStatus(
    connected = false,
    desktopLabel = "Castarro Desktop",
    configName = "",
    generatedAt = "",
    alertsEnabled = false,
    schedulerEnabled = false,
    channels = emptyList(),
    recentAlerts = emptyList(),
    errorMessage = null,
)

data class MobileUiState(
    val channel: ChannelEntity? = null,
    val channels: List<ChannelEntity> = emptyList(),
    val videos: List<VideoAsset> = emptyList(),
    val profiles: List<StreamProfile> = emptyList(),
    val sessions: List<StreamSession> = emptyList(),
    val youtubeAccounts: List<YoutubeAccount> = emptyList(),
    val selectedVideoIds: List<String> = emptyList(),
    val videoSelectionEdited: Boolean = false,
    val selectedProfileId: String? = null,
    val rtmpServerUrl: String = "",
    val streamKeyDraft: String = "",
    val youtubeBroadcastTitle: String = "Mobile stream",
    val youtubeBroadcastDescription: String = "",
    val youtubeThumbnailUri: String? = null,
    val youtubePrivacyStatus: String = "unlisted",
    val loopEnabled: Boolean = false,
    val isImporting: Boolean = false,
    val isSavingProfile: Boolean = false,
    val isConnectingYoutube: Boolean = false,
    val isPreparingYoutubeBroadcast: Boolean = false,
    val isStartingStream: Boolean = false,
    val streamProtection: StreamProtectionReport = StreamProtectionReport.Empty,
    val appUsage: AppUsageSnapshot = AppUsageSnapshot(),
    val syncPairingUri: String = "",
    val syncIncludeVideos: Boolean = true,
    val isSyncingDesktop: Boolean = false,
    val syncMessage: String? = null,
    val desktopSyncLastCompletedAt: String? = null,
    val desktopSyncLastSummary: String? = null,
    val remoteStatus: DesktopRemoteStatus = EmptyDesktopRemoteStatus,
    val isRemoteActionBusy: Boolean = false,
    val selectedDesktopDownloadIds: List<String> = emptyList(),
    val desktopDownloadSelectionEdited: Boolean = false,
    val desktopVideoDownloadTask: DesktopVideoDownloadTask = DesktopVideoDownloadTask(),
    val errorMessage: String? = null,
) {
    val selectedVideos: List<VideoAsset> =
        selectedVideoIds.mapNotNull { selectedId -> videos.firstOrNull { it.id == selectedId } }
    val selectedVideo: VideoAsset? = selectedVideos.firstOrNull()
    val selectedProfile: StreamProfile? = profiles.firstOrNull { it.id == selectedProfileId } ?: profiles.firstOrNull()
    val selectedYoutubeAccount: YoutubeAccount? = youtubeAccounts.firstOrNull()
    val activeSession: StreamSession? = sessions.firstOrNull {
        it.status == StreamSessionStatus.Connecting ||
            it.status == StreamSessionStatus.Live ||
            it.status == StreamSessionStatus.Reconnecting
    }
    val isLive: Boolean = activeSession != null
    val isReady: Boolean =
        selectedVideos.isNotEmpty() &&
            selectedVideos.all {
                it.compatibilityStatus == CompatibilityStatus.Ready && it.localPath?.isNotBlank() == true
            } &&
            selectedProfile?.rtmpServerUrl?.isNotBlank() == true &&
            selectedProfile?.streamKeySecretRef?.isNotBlank() == true &&
            selectedProfile?.mode in setOf(StreamProfileMode.ManualKey, StreamProfileMode.YoutubeAccount)
}

class CastarroMobileViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as CastarroApp
    private val container = app.container
    private val notifications = NotificationFactory(application.applicationContext)
    private val channelDao = container.database.channelDao()
    private val videoDao = container.database.videoAssetDao()
    private val profileDao = container.database.streamProfileDao()
    private val sessionDao = container.database.streamSessionDao()
    private val startStreamUseCase = StartStreamUseCase()

    private val mutableUiState = MutableStateFlow(MobileUiState())
    val uiState: StateFlow<MobileUiState> = mutableUiState

    private var channelJob: Job? = null
    private var videoJob: Job? = null
    private var profileJob: Job? = null
    private var sessionJob: Job? = null
    private var youtubeJob: Job? = null
    private var channelSettingsJob: Job? = null
    private var usageJob: Job? = null
    private var syncStatusJob: Job? = null
    private var remoteStatusJob: Job? = null
    private var pendingYoutubeAction: PendingYoutubeAction? = null
    private var lastSelectedChannelId: String? = null

    init {
        viewModelScope.launch {
            lastSelectedChannelId = app.castarroDataStore.data.first()[AppPreferences.LastSelectedChannel]
            ensureWorkingChannel()
            observeChannels()
        }
        observeAppUsage()
        observeDesktopSyncStatus()
        observeDesktopVideoDownloads()
        observeDesktopRemoteStatus()
        refreshStreamProtection()
    }

    fun importVideos(uris: List<Uri>) {
        if (uris.isEmpty()) return
        val initialState = mutableUiState.value
        val channelId = initialState.channel?.id ?: return showError("Channel is still loading.")
        val baseSelectedIds = if (initialState.videoSelectionEdited) {
            initialState.selectedVideoIds
        } else {
            initialState.videos.map { it.id }
        }
        viewModelScope.launch {
            mutableUiState.update { it.copy(isImporting = true, errorMessage = null) }
            runCatching {
                val importedIds = uris.map { uri ->
                    val imported = container.videoImporter.importVideo(uri)
                    videoDao.upsert(imported.toEntity(channelId))
                    imported.id
                }
                persistVideoSelection(channelId, (baseSelectedIds + importedIds).distinct(), edited = true)
                mutableUiState.update { state ->
                    state.copy(
                        selectedVideoIds = (baseSelectedIds + importedIds).distinct(),
                        videoSelectionEdited = true,
                        errorMessage = null,
                    )
                }
            }.onFailure { error ->
                showError(error.message ?: "Could not import that video.")
            }
            mutableUiState.update { it.copy(isImporting = false) }
        }
    }

    fun deselectVideo(videoId: String) {
        val channelId = mutableUiState.value.channel?.id
        var updatedSelection: List<String>? = null
        mutableUiState.update { state ->
            updatedSelection = state.selectedVideoIds.filterNot { it == videoId }
            state.copy(
                selectedVideoIds = updatedSelection.orEmpty(),
                videoSelectionEdited = true,
                errorMessage = null,
            )
        }
        if (channelId != null) {
            viewModelScope.launch {
                persistVideoSelection(channelId, updatedSelection.orEmpty(), edited = true)
            }
        }
    }

    fun moveSelectedVideo(videoId: String, direction: Int) {
        if (direction == 0) return
        val channelId = mutableUiState.value.channel?.id
        var updatedSelection: List<String>? = null
        mutableUiState.update { state ->
            val currentIndex = state.selectedVideoIds.indexOf(videoId)
            if (currentIndex < 0) return@update state
            val targetIndex = (currentIndex + direction).coerceIn(0, state.selectedVideoIds.lastIndex)
            if (targetIndex == currentIndex) return@update state
            updatedSelection = state.selectedVideoIds.toMutableList().apply {
                val moved = removeAt(currentIndex)
                add(targetIndex, moved)
            }
            state.copy(
                selectedVideoIds = updatedSelection.orEmpty(),
                videoSelectionEdited = true,
                errorMessage = null,
            )
        }
        if (channelId != null && updatedSelection != null) {
            viewModelScope.launch {
                persistVideoSelection(channelId, updatedSelection.orEmpty(), edited = true)
            }
        }
    }

    fun updateRtmpServerUrl(value: String) {
        mutableUiState.update { it.copy(rtmpServerUrl = value, errorMessage = null) }
    }

    fun updateStreamKeyDraft(value: String) {
        mutableUiState.update { it.copy(streamKeyDraft = value, errorMessage = null) }
    }

    fun updateYoutubeBroadcastTitle(value: String) {
        mutableUiState.update { it.copy(youtubeBroadcastTitle = value, errorMessage = null) }
        persistChannelSetting { preferences, channelId ->
            preferences[AppPreferences.youtubeBroadcastTitle(channelId)] = value
        }
    }

    fun updateYoutubeBroadcastDescription(value: String) {
        mutableUiState.update { it.copy(youtubeBroadcastDescription = value, errorMessage = null) }
        persistChannelSetting { preferences, channelId ->
            preferences[AppPreferences.youtubeBroadcastDescription(channelId)] = value
        }
    }

    fun updateYoutubeThumbnailUri(value: String?) {
        mutableUiState.update { it.copy(youtubeThumbnailUri = value, errorMessage = null) }
        persistChannelSetting { preferences, channelId ->
            val key = AppPreferences.youtubeThumbnailUri(channelId)
            value?.takeIf { it.isNotBlank() }?.let { preferences[key] = it }
                ?: preferences.remove(key)
        }
    }

    fun updateYoutubePrivacyStatus(value: String) {
        mutableUiState.update { it.copy(youtubePrivacyStatus = value, errorMessage = null) }
        persistChannelSetting { preferences, channelId ->
            preferences[AppPreferences.youtubePrivacyStatus(channelId)] = value
        }
    }

    fun updateLoopEnabled(value: Boolean) {
        mutableUiState.update { it.copy(loopEnabled = value, errorMessage = null) }
        persistChannelSetting { preferences, channelId ->
            preferences[AppPreferences.defaultLoopEnabled(channelId)] = value
        }
    }

    fun saveManualProfile() {
        val state = mutableUiState.value
        val channelId = state.channel?.id ?: return showError("Channel is still loading.")
        viewModelScope.launch {
            mutableUiState.update { it.copy(isSavingProfile = true, errorMessage = null) }
            runCatching {
                container.streamProfiles.saveManualProfile(
                    channelId = channelId,
                    videoAssetId = state.selectedVideo?.id,
                    rtmpServerUrl = state.rtmpServerUrl,
                    streamKey = state.streamKeyDraft,
                    loopEnabled = state.loopEnabled,
                )
            }.onSuccess { profile ->
                mutableUiState.update {
                    it.copy(
                        selectedProfileId = profile.id,
                        streamKeyDraft = "",
                        loopEnabled = profile.loopEnabled,
                    )
                }
            }.onFailure { error ->
                showError(error.message ?: "Could not save the stream profile.")
            }
            mutableUiState.update { it.copy(isSavingProfile = false) }
        }
    }

    fun connectYoutubeAccount(activity: Activity, launchResolution: (IntentSender) -> Unit) {
        val channelId = mutableUiState.value.channel?.id ?: return showError("Channel is still loading.")
        pendingYoutubeAction = PendingYoutubeAction.ConnectAccount(channelId)
        mutableUiState.update { it.copy(isConnectingYoutube = true, errorMessage = null) }
        requestYoutubeAuthorization(
            activity = activity,
            launchResolution = launchResolution,
            onAccessToken = { accessToken -> saveConnectedYoutubeAccount(channelId, accessToken) },
        )
    }

    fun prepareYoutubeBroadcast(activity: Activity, launchResolution: (IntentSender) -> Unit) {
        val state = mutableUiState.value
        val channelId = state.channel?.id ?: return showError("Channel is still loading.")
        if (state.youtubeBroadcastTitle.isBlank()) {
            return showError("Broadcast title is required.")
        }
        val pendingAction = PendingYoutubeAction.PrepareBroadcast(
            channelId = channelId,
            videoAssetId = state.selectedVideo?.id,
            title = state.youtubeBroadcastTitle,
            description = state.youtubeBroadcastDescription,
            thumbnailUri = state.youtubeThumbnailUri,
            privacyStatus = state.youtubePrivacyStatus,
            loopEnabled = state.loopEnabled,
        )
        pendingYoutubeAction = pendingAction
        mutableUiState.update { it.copy(isPreparingYoutubeBroadcast = true, errorMessage = null) }
        requestYoutubeAuthorization(
            activity = activity,
            launchResolution = launchResolution,
            onAccessToken = { accessToken -> createYoutubeProfile(pendingAction, accessToken) },
        )
    }

    fun completeYoutubeAuthorization(intent: Intent?) {
        viewModelScope.launch {
            runCatching {
                val result = container.youtubeAuth.authorizationResultFromIntent(intent)
                val accessToken = result.accessToken ?: error("Google authorization did not return an access token.")
                when (val action = pendingYoutubeAction) {
                    is PendingYoutubeAction.PrepareBroadcast -> createYoutubeProfile(action, accessToken)
                    is PendingYoutubeAction.ConnectAccount -> saveConnectedYoutubeAccount(action.channelId, accessToken)
                    null -> saveConnectedYoutubeAccount(
                        mutableUiState.value.channel?.id ?: error("Channel is still loading."),
                        accessToken,
                    )
                }
            }.onFailure { error ->
                showError(error.message ?: "Could not connect the YouTube account.")
                mutableUiState.update {
                    it.copy(isConnectingYoutube = false, isPreparingYoutubeBroadcast = false)
                }
            }
            pendingYoutubeAction = null
        }
    }

    fun disconnectYoutubeAccount(activity: Activity) {
        val channelId = mutableUiState.value.channel?.id ?: return showError("Channel is still loading.")
        mutableUiState.update { it.copy(isConnectingYoutube = true, errorMessage = null) }
        container.youtubeAuth.revoke(activity)
            .addOnSuccessListener {
                viewModelScope.launch {
                    container.youtube.disconnectAccount(channelId)
                    mutableUiState.update { it.copy(isConnectingYoutube = false) }
                }
            }
            .addOnFailureListener { error ->
                showError(error.message ?: "Could not disconnect the YouTube account.")
                mutableUiState.update { it.copy(isConnectingYoutube = false) }
            }
    }

    fun startStream() {
        refreshStreamProtection()
        val state = mutableUiState.value
        val channel = state.channel ?: return showError("Channel is still loading.")
        val videos = state.selectedVideos
        if (videos.isEmpty()) return showError("Select at least one video first.")
        val profile = state.selectedProfile ?: return showError("Save or prepare a stream profile first.")
        val blockedVideo = videos.firstOrNull { it.compatibilityStatus != CompatibilityStatus.Ready }
        if (blockedVideo != null) {
            return showError(blockedVideo.compatibilityMessage)
        }
        val videoPaths = videos.map { video ->
            video.localPath ?: return showError("Imported video file is missing.")
        }
        val secretRef = profile.streamKeySecretRef ?: return showError("Saved stream key is missing.")

        viewModelScope.launch {
            mutableUiState.update { it.copy(isStartingStream = true, errorMessage = null) }
            runCatching {
                val streamKey = container.secrets.getSecret(secretRef)
                    ?: error("Saved stream key is missing.")
                val command = startStreamUseCase(profile, videoPaths, streamKey, streamPlaylistFile())
                val now = Instant.now().toString()
                val session = StreamSessionEntity(
                    id = "session-${UUID.randomUUID()}",
                    channelId = channel.id,
                    videoAssetId = videos.first().id,
                    status = StreamSessionStatus.Connecting.name,
                    startedAt = now,
                    endedAt = null,
                    exitCode = null,
                    bytesUploaded = 0,
                    averageBitrate = null,
                    failureReason = null,
                    logPath = streamLogFile().absolutePath,
                )
                sessionDao.upsert(session)
                app.startForegroundService(
                    Intent(app, StreamForegroundService::class.java).apply {
                        action = StreamForegroundService.ACTION_START
                        putExtra(StreamForegroundService.EXTRA_SESSION_ID, session.id)
                        putExtra(StreamForegroundService.EXTRA_CHANNEL_NAME, channel.displayName)
                        putExtra(
                            StreamForegroundService.EXTRA_VIDEO_NAME,
                            if (videos.size == 1) videos.first().displayName else "${videos.size} videos",
                        )
                        putExtra(StreamForegroundService.EXTRA_COMMAND, ArrayList(command))
                        putExtra(StreamForegroundService.EXTRA_LOG_PATH, session.logPath)
                    },
                )
            }.onFailure { error ->
                showError(error.message ?: "Could not start the stream.")
            }
            mutableUiState.update { it.copy(isStartingStream = false) }
        }
    }

    fun stopStream() {
        app.startService(
            Intent(app, StreamForegroundService::class.java).apply {
                action = StreamForegroundService.ACTION_STOP
            },
        )
    }

    fun refreshDesktopRemoteStatusNow() {
        viewModelScope.launch {
            runCatching {
                container.desktopSync.fetchRemoteStatus()
            }.onSuccess { status ->
                applyRemoteStatus(status)
            }.onFailure { error ->
                mutableUiState.update {
                    it.copy(
                        remoteStatus = EmptyDesktopRemoteStatus.copy(
                            errorMessage = error.message ?: "Desktop remote is unavailable.",
                        ),
                    )
                }
            }
        }
    }

    fun startDesktopRemoteStream() = runRemoteAction("start")

    fun stopDesktopRemoteStream() = runRemoteAction("stop")

    fun restartDesktopRemoteStream() = runRemoteAction("restart")

    fun refreshStreamProtection() {
        mutableUiState.update {
            it.copy(streamProtection = container.streamProtection.currentReport())
        }
    }

    fun openStreamProtectionAction(activity: Activity, action: StreamProtectionAction) {
        runCatching {
            activity.startActivity(container.streamProtection.intentFor(action))
        }.onFailure { error ->
            showError(error.message ?: "Could not open Android settings.")
        }
    }

    fun syncFromScannedPairingUri(value: String) {
        val pairingUri = value.trim()
        if (pairingUri.isBlank()) return showError("Scan the desktop QR code first.")
        mutableUiState.update { it.copy(syncPairingUri = pairingUri, errorMessage = null) }
        runDesktopPairingSync(pairingUri)
    }

    fun toggleDesktopVideoDownload(videoId: String, selected: Boolean) {
        mutableUiState.update { state ->
            val next = state.selectedDesktopDownloadIds.toMutableSet()
            if (selected) {
                next += videoId
            } else {
                next -= videoId
            }
            state.copy(
                selectedDesktopDownloadIds = next.toList(),
                desktopDownloadSelectionEdited = true,
                errorMessage = null,
            )
        }
    }

    fun startSelectedDesktopVideoDownloads() {
        val state = mutableUiState.value
        val selectedIds = state.selectedDesktopDownloadIds.distinct()
        if (selectedIds.isEmpty()) return showError("Select at least one synced desktop video first.")
        val channelName = state.channel?.displayName ?: "Desktop sync"
        app.startForegroundService(
            Intent(app, DesktopVideoDownloadForegroundService::class.java).apply {
                action = DesktopVideoDownloadForegroundService.ACTION_START
                putStringArrayListExtra(
                    DesktopVideoDownloadForegroundService.EXTRA_VIDEO_IDS,
                    ArrayList(selectedIds),
                )
                putExtra(DesktopVideoDownloadForegroundService.EXTRA_CHANNEL_NAME, channelName)
            },
        )
    }

    fun pauseDesktopVideoDownloads() {
        app.startService(
            Intent(app, DesktopVideoDownloadForegroundService::class.java).apply {
                action = DesktopVideoDownloadForegroundService.ACTION_PAUSE
            },
        )
    }

    fun resumeDesktopVideoDownloads() {
        app.startService(
            Intent(app, DesktopVideoDownloadForegroundService::class.java).apply {
                action = DesktopVideoDownloadForegroundService.ACTION_RESUME
            },
        )
    }

    fun cancelDesktopVideoDownloads() {
        app.startService(
            Intent(app, DesktopVideoDownloadForegroundService::class.java).apply {
                action = DesktopVideoDownloadForegroundService.ACTION_CANCEL
            },
        )
    }

    private fun runRemoteAction(action: String) {
        val state = mutableUiState.value
        val channelName = selectedRemoteChannelName(state)
            ?: return showError("Sync a desktop channel first to use remote control.")
        viewModelScope.launch {
            mutableUiState.update { it.copy(isRemoteActionBusy = true, errorMessage = null) }
            runCatching {
                container.desktopSync.sendRemoteControl(action, channelName)
            }.onSuccess { status ->
                applyRemoteStatus(status)
            }.onFailure { error ->
                showError(error.message ?: "Desktop remote control failed.")
            }
            mutableUiState.update { it.copy(isRemoteActionBusy = false) }
        }
    }

    private fun runDesktopPairingSync(pairingUriOverride: String? = null) {
        val state = mutableUiState.value
        val pairingUri = (pairingUriOverride ?: state.syncPairingUri ?: "").trim()
        if (pairingUri.isBlank()) return showError("Scan the desktop QR code first.")
        viewModelScope.launch {
            mutableUiState.update { it.copy(isSyncingDesktop = true, syncMessage = null, errorMessage = null) }
            runCatching {
                container.desktopSync.pairAndSync(
                    DesktopPairingRequest(
                        pairingUri = pairingUri,
                        includeVideos = true,
                    ),
                )
            }.onSuccess { result ->
                val summary = buildString {
                    append("Synced ${result.channelCount} channels and ${result.videoCount} videos.")
                    if (result.downloadableVideos.isNotEmpty()) {
                        append(" ${result.downloadableVideos.size} video files are ready to download.")
                    } else if (result.downloadedVideoCount > 0) {
                        append(" Downloaded ${result.downloadedVideoCount} video files.")
                    }
                }
                val completedAt = Instant.now().toString()
                app.castarroDataStore.edit { preferences ->
                    preferences[AppPreferences.DesktopSyncLastCompletedAt] = completedAt
                    preferences[AppPreferences.DesktopSyncLastSummary] = summary
                }
                mutableUiState.update {
                    it.copy(
                        isSyncingDesktop = false,
                        syncMessage = summary,
                        desktopSyncLastCompletedAt = completedAt,
                        desktopSyncLastSummary = summary,
                        selectedDesktopDownloadIds = emptyList(),
                        desktopDownloadSelectionEdited = false,
                        syncIncludeVideos = true,
                    )
                }
                refreshDesktopRemoteStatusNow()
            }.onFailure { error ->
                showError(error.message ?: "Desktop sync failed.")
                mutableUiState.update { it.copy(isSyncingDesktop = false, syncIncludeVideos = true) }
            }
        }
    }

    fun selectChannel(channelId: String) {
        val channel = mutableUiState.value.channels.firstOrNull { it.id == channelId }
            ?: return showError("That channel is not available.")
        setSelectedChannel(channel)
    }

    fun createChannel(displayName: String, logoUri: String?) {
        val currentChannels = mutableUiState.value.channels
        val name = uniqueChannelName(displayName.ifBlank { "New channel" }, currentChannels)
        val channel = ChannelEntity(
            id = "mobile-channel-${UUID.randomUUID()}",
            displayName = name,
            youtubeAccountId = null,
            logoUri = logoUri?.trim()?.takeIf { it.isNotBlank() },
        )
        viewModelScope.launch {
            channelDao.upsert(channel)
            setSelectedChannel(channel)
        }
    }

    fun updateChannel(channelId: String, displayName: String, logoUri: String?) {
        val channel = mutableUiState.value.channels.firstOrNull { it.id == channelId }
            ?: mutableUiState.value.channel?.takeIf { it.id == channelId }
            ?: return showError("That channel is not available.")
        val name = uniqueChannelName(
            baseName = displayName.ifBlank { channel.displayName },
            channels = mutableUiState.value.channels.filterNot { it.id == channelId },
        )
        val updated = channel.copy(
            displayName = name,
            logoUri = logoUri?.trim()?.takeIf { it.isNotBlank() },
        )
        viewModelScope.launch {
            channelDao.upsert(updated)
            if (mutableUiState.value.channel?.id == channelId) {
                setSelectedChannel(updated)
            }
        }
    }

    fun clearError() {
        mutableUiState.update { it.copy(errorMessage = null) }
    }

    private suspend fun ensureWorkingChannel() {
        if (channelDao.countChannels() > 0) return
        val channel = ChannelEntity(
            id = DEFAULT_CHANNEL_ID,
            displayName = "Mobile stream",
            youtubeAccountId = null,
            logoUri = null,
        )
        channelDao.upsert(channel)
    }

    private fun observeChannels() {
        channelJob?.cancel()
        channelJob = viewModelScope.launch {
            channelDao.observeChannels().collect { channels ->
                val current = mutableUiState.value.channel
                val selected = current?.let { selectedChannel ->
                    channels.firstOrNull { it.id == selectedChannel.id }
                } ?: lastSelectedChannelId?.let { selectedId ->
                    channels.firstOrNull { it.id == selectedId }
                } ?: channels.firstOrNull()

                mutableUiState.update { it.copy(channels = channels) }
                if (selected != null && selected.id != current?.id) {
                    setSelectedChannel(selected, persist = current != null)
                } else if (selected != null && selected != current) {
                    mutableUiState.update { it.copy(channel = selected) }
                }
            }
        }
    }

    private fun setSelectedChannel(channel: ChannelEntity, persist: Boolean = true) {
        val previousId = mutableUiState.value.channel?.id
        val isSwitch = previousId != channel.id
        lastSelectedChannelId = channel.id
        mutableUiState.update { state ->
            state.copy(
                channel = channel,
                errorMessage = null,
                videos = if (isSwitch) emptyList() else state.videos,
                profiles = if (isSwitch) emptyList() else state.profiles,
                sessions = if (isSwitch) emptyList() else state.sessions,
                selectedVideoIds = if (isSwitch) emptyList() else state.selectedVideoIds,
                videoSelectionEdited = if (isSwitch) false else state.videoSelectionEdited,
                selectedProfileId = if (isSwitch) null else state.selectedProfileId,
                rtmpServerUrl = if (isSwitch) "" else state.rtmpServerUrl,
                streamKeyDraft = if (isSwitch) "" else state.streamKeyDraft,
                loopEnabled = if (isSwitch) false else state.loopEnabled,
                youtubeAccounts = if (isSwitch) emptyList() else state.youtubeAccounts,
                youtubeBroadcastTitle = if (isSwitch) defaultYoutubeBroadcastTitle(channel) else state.youtubeBroadcastTitle,
                youtubeBroadcastDescription = if (isSwitch) "" else state.youtubeBroadcastDescription,
                youtubeThumbnailUri = if (isSwitch) null else state.youtubeThumbnailUri,
                youtubePrivacyStatus = if (isSwitch) "unlisted" else state.youtubePrivacyStatus,
            )
        }
        if (isSwitch) {
            observeChannelData(channel.id)
            observeChannelSettings(channel.id)
            observeYoutubeAccounts(channel.id)
        }
        if (persist) {
            viewModelScope.launch {
                app.castarroDataStore.edit { preferences ->
                    preferences[AppPreferences.LastSelectedChannel] = channel.id
                }
            }
        }
    }

    private fun observeChannelData(channelId: String) {
        videoJob?.cancel()
        profileJob?.cancel()
        sessionJob?.cancel()

        videoJob = viewModelScope.launch {
            videoDao.observeVideos(channelId)
                .combine(app.castarroDataStore.data) { entities, preferences -> entities to preferences }
                .collect { (entities, preferences) ->
                if (mutableUiState.value.channel?.id != channelId) return@collect
                val videos = entities.map { it.toDomain() }
                mutableUiState.update { state ->
                    val videoIds = videos.map { it.id }
                    val downloadableIds = videos
                        .filter { it.localPath.isNullOrBlank() && it.sourceUri.startsWith("http") }
                        .map { it.id }
                    val edited = preferences[AppPreferences.videoSelectionEdited(channelId)] ?: false
                    val savedSelection = preferences[AppPreferences.videoSelectionIds(channelId)]
                        ?.decodeStringList()
                        .orEmpty()
                        .filter { it in videoIds }
                    val selected = if (edited) {
                        savedSelection
                    } else {
                        videoIds
                    }
                    val selectedDesktopDownloads = if (state.desktopDownloadSelectionEdited) {
                        state.selectedDesktopDownloadIds.filter { it in downloadableIds }
                    } else {
                        downloadableIds
                    }
                    state.copy(
                        videos = videos,
                        selectedVideoIds = selected.distinct(),
                        videoSelectionEdited = edited,
                        selectedDesktopDownloadIds = selectedDesktopDownloads.distinct(),
                    )
                }
            }
        }
        profileJob = viewModelScope.launch {
            container.streamProfiles.observeProfiles(channelId).collect { profiles ->
                if (mutableUiState.value.channel?.id != channelId) return@collect
                mutableUiState.update { state ->
                    val selected = state.selectedProfileId?.takeIf { id -> profiles.any { it.id == id } }
                        ?: profiles.firstOrNull()?.id
                    val selectedProfile = profiles.firstOrNull { it.id == selected } ?: profiles.firstOrNull()
                    state.copy(
                        profiles = profiles,
                        selectedProfileId = selected,
                        rtmpServerUrl = state.rtmpServerUrl.ifBlank { selectedProfile?.rtmpServerUrl.orEmpty() },
                        loopEnabled = selectedProfile?.loopEnabled ?: state.loopEnabled,
                    )
                }
            }
        }
        sessionJob = viewModelScope.launch {
            sessionDao.observeSessions(channelId).collect { entities ->
                if (mutableUiState.value.channel?.id != channelId) return@collect
                mutableUiState.update { it.copy(sessions = entities.map { entity -> entity.toDomain() }) }
            }
        }
    }

    private fun showError(message: String) {
        mutableUiState.update { it.copy(errorMessage = message) }
    }

    private fun uniqueChannelName(baseName: String, channels: List<ChannelEntity>): String {
        val cleanBase = baseName.trim().ifBlank { "New channel" }
        val existing = channels.map { it.displayName.trim().lowercase() }.toSet()
        if (cleanBase.lowercase() !in existing) return cleanBase
        var index = 2
        while ("$cleanBase $index".lowercase() in existing) {
            index += 1
        }
        return "$cleanBase $index"
    }

    private fun streamLogFile(): File {
        val dir = File(app.filesDir, "stream-logs").apply { mkdirs() }
        return File(dir, "${System.currentTimeMillis()}.log")
    }

    private fun streamPlaylistFile(): File {
        val dir = File(app.filesDir, "stream-playlists").apply { mkdirs() }
        return File(dir, "${System.currentTimeMillis()}.ffconcat")
    }

    private fun requestYoutubeAuthorization(
        activity: Activity,
        launchResolution: (IntentSender) -> Unit,
        onAccessToken: (String) -> Unit,
    ) {
        container.youtubeAuth.authorize(activity)
            .addOnSuccessListener { result ->
                if (result.hasResolution()) {
                    val pendingIntent = result.pendingIntent ?: run {
                        showError("Google authorization needs consent, but no consent screen was returned.")
                        mutableUiState.update {
                            it.copy(isConnectingYoutube = false, isPreparingYoutubeBroadcast = false)
                        }
                        return@addOnSuccessListener
                    }
                    launchResolution(pendingIntent.intentSender)
                } else {
                    val accessToken = result.accessToken ?: run {
                        showError("Google authorization did not return an access token.")
                        mutableUiState.update {
                            it.copy(isConnectingYoutube = false, isPreparingYoutubeBroadcast = false)
                        }
                        return@addOnSuccessListener
                    }
                    onAccessToken(accessToken)
                    pendingYoutubeAction = null
                }
            }
            .addOnFailureListener { error ->
                showError(error.message ?: "Could not start Google authorization.")
                mutableUiState.update {
                    it.copy(isConnectingYoutube = false, isPreparingYoutubeBroadcast = false)
                }
                pendingYoutubeAction = null
            }
    }

    private fun saveConnectedYoutubeAccount(channelId: String, accessToken: String) {
        viewModelScope.launch {
            runCatching {
                container.youtube.saveAuthorizedAccount(channelId, accessToken)
            }.onFailure { error ->
                showError(error.message ?: "Could not save the YouTube account.")
            }
            mutableUiState.update { it.copy(isConnectingYoutube = false) }
        }
    }

    private fun createYoutubeProfile(pendingAction: PendingYoutubeAction.PrepareBroadcast, accessToken: String) {
        viewModelScope.launch {
            mutableUiState.update { it.copy(isPreparingYoutubeBroadcast = true, errorMessage = null) }
            runCatching {
                container.youtube.saveAuthorizedAccount(pendingAction.channelId, accessToken)
                val broadcast = container.youtube.createBroadcast(
                    accessToken = accessToken,
                    request = CreateBroadcastRequest(
                        title = pendingAction.title,
                        description = pendingAction.description,
                        privacyStatus = pendingAction.privacyStatus,
                    ),
                )
                val ingestUrl = broadcast.ingestionUrl ?: error("YouTube did not return an ingest URL.")
                val streamNameSecretRef = broadcast.streamNameSecretRef ?: error("YouTube did not return a stream name.")
                val profile = container.streamProfiles.saveYoutubeProfile(
                    channelId = pendingAction.channelId,
                    videoAssetId = pendingAction.videoAssetId,
                    rtmpServerUrl = ingestUrl,
                    streamKeySecretRef = streamNameSecretRef,
                    youtubeBroadcastId = broadcast.id,
                    loopEnabled = pendingAction.loopEnabled,
                )
                pendingAction.thumbnailUri?.let { thumbnailUri ->
                    runCatching {
                        val (imageData, contentType) = readYoutubeThumbnail(thumbnailUri)
                        container.youtube.uploadThumbnail(
                            accessToken = accessToken,
                            broadcastId = broadcast.id,
                            imageData = imageData,
                            contentType = contentType,
                        )
                    }.onFailure { error ->
                        showError(error.message ?: "YouTube Live stream was created, but the thumbnail upload failed.")
                    }
                }
                profile
            }.onSuccess { profile ->
                mutableUiState.update {
                    if (it.channel?.id != pendingAction.channelId) {
                        it
                    } else {
                        it.copy(
                            selectedProfileId = profile.id,
                            rtmpServerUrl = profile.rtmpServerUrl.orEmpty(),
                            loopEnabled = profile.loopEnabled,
                        )
                    }
                }
            }.onFailure { error ->
                showError(error.message ?: "Could not prepare the YouTube broadcast.")
            }
            mutableUiState.update {
                it.copy(isPreparingYoutubeBroadcast = false, isConnectingYoutube = false)
            }
        }
    }

    private suspend fun readYoutubeThumbnail(uriText: String): Pair<ByteArray, String> = withContext(Dispatchers.IO) {
        val uri = Uri.parse(uriText)
        val contentType = app.contentResolver.getType(uri)?.normalizeImageContentType()
            ?: uriText.substringAfterLast('.', "").normalizeImageContentType()
            ?: error("Thumbnail must be a JPEG or PNG image.")
        val imageData = app.contentResolver.openInputStream(uri)?.use { input -> input.readBytes() }
            ?: error("Could not read the selected thumbnail.")
        imageData to contentType
    }

    private fun observeChannelSettings(channelId: String) {
        channelSettingsJob?.cancel()
        channelSettingsJob = viewModelScope.launch {
            app.castarroDataStore.data.collect { preferences ->
                val channel = mutableUiState.value.channel?.takeIf { it.id == channelId }
                    ?: return@collect
                mutableUiState.update {
                    it.copy(
                        youtubeBroadcastTitle = preferences[AppPreferences.youtubeBroadcastTitle(channelId)]
                            ?: defaultYoutubeBroadcastTitle(channel),
                        youtubeBroadcastDescription = preferences[AppPreferences.youtubeBroadcastDescription(channelId)].orEmpty(),
                        youtubeThumbnailUri = preferences[AppPreferences.youtubeThumbnailUri(channelId)],
                        youtubePrivacyStatus = preferences[AppPreferences.youtubePrivacyStatus(channelId)]
                            ?.takeIf { privacy -> privacy in setOf("private", "unlisted", "public") }
                            ?: "unlisted",
                        loopEnabled = preferences[AppPreferences.defaultLoopEnabled(channelId)] ?: it.loopEnabled,
                    )
                }
            }
        }
    }

    private fun observeYoutubeAccounts(channelId: String) {
        youtubeJob?.cancel()
        youtubeJob = viewModelScope.launch {
            container.youtube.observeAccounts(channelId).collect { accounts ->
                mutableUiState.update {
                    if (it.channel?.id == channelId) it.copy(youtubeAccounts = accounts) else it
                }
            }
        }
    }

    private fun persistChannelSetting(block: (MutablePreferences, String) -> Unit) {
        val channelId = mutableUiState.value.channel?.id ?: return
        viewModelScope.launch {
            app.castarroDataStore.edit { preferences ->
                block(preferences, channelId)
            }
        }
    }

    private suspend fun persistVideoSelection(channelId: String, selectedVideoIds: List<String>, edited: Boolean) {
        app.castarroDataStore.edit { preferences ->
            preferences[AppPreferences.videoSelectionIds(channelId)] = selectedVideoIds.encodeStringList()
            preferences[AppPreferences.videoSelectionEdited(channelId)] = edited
        }
    }

    private fun defaultYoutubeBroadcastTitle(channel: ChannelEntity): String = "${channel.displayName} stream"

    private fun observeAppUsage() {
        usageJob?.cancel()
        usageJob = viewModelScope.launch {
            container.appUsage.snapshots().collect { usage ->
                mutableUiState.update { it.copy(appUsage = usage) }
            }
        }
    }

    private fun observeDesktopSyncStatus() {
        syncStatusJob?.cancel()
        syncStatusJob = viewModelScope.launch {
            app.castarroDataStore.data.collect { preferences ->
                mutableUiState.update {
                    it.copy(
                        desktopSyncLastCompletedAt = preferences[AppPreferences.DesktopSyncLastCompletedAt],
                        desktopSyncLastSummary = preferences[AppPreferences.DesktopSyncLastSummary],
                    )
                }
            }
        }
    }

    private fun observeDesktopRemoteStatus() {
        remoteStatusJob?.cancel()
        remoteStatusJob = viewModelScope.launch {
            while (true) {
                runCatching {
                    container.desktopSync.fetchRemoteStatus()
                }.onSuccess { status ->
                    applyRemoteStatus(status)
                }.onFailure { error ->
                    mutableUiState.update {
                        it.copy(
                            remoteStatus = EmptyDesktopRemoteStatus.copy(
                                errorMessage = error.message ?: "Desktop remote is unavailable.",
                            ),
                        )
                    }
                }
                delay(15000)
            }
        }
    }

    private suspend fun applyRemoteStatus(status: DesktopRemoteStatus) {
        mutableUiState.update { it.copy(remoteStatus = status) }
        notifyRemoteAlerts(status)
    }

    private fun selectedRemoteChannelName(state: MobileUiState): String? {
        val channelId = state.channel?.id ?: return null
        return state.remoteStatus.channels.firstOrNull { it.channelId == channelId }?.channelName
            ?: state.channel?.displayName
    }

    private suspend fun notifyRemoteAlerts(status: DesktopRemoteStatus) {
        if (!status.alertsEnabled) return
        val lastId = container.desktopSync.lastRemoteAlertId()
        val fresh = status.recentAlerts
            .filter { it.mobileEnabled && it.id > lastId }
            .sortedBy { it.id }
        if (fresh.isEmpty()) return
        val manager = app.getSystemService(android.app.NotificationManager::class.java)
        fresh.forEach { alert ->
            manager.notify(
                alert.id.toInt(),
                notifications.desktopRemoteAlertNotification(
                    channelName = alert.channelName.ifBlank { "Castarro Desktop" },
                    title = alert.title,
                    detail = alert.message,
                    severe = alert.severity.equals("danger", ignoreCase = true),
                ),
            )
        }
        container.desktopSync.rememberLastRemoteAlertId(fresh.maxOf { it.id })
    }

    private fun observeDesktopVideoDownloads() {
        viewModelScope.launch {
            DesktopVideoDownloadCoordinator.state.collect { task ->
                mutableUiState.update { state ->
                    val resetSelection = task.phase == DesktopVideoDownloadPhase.Completed
                    state.copy(
                        desktopVideoDownloadTask = task,
                        selectedDesktopDownloadIds = if (resetSelection) emptyList() else state.selectedDesktopDownloadIds,
                        desktopDownloadSelectionEdited = if (resetSelection) false else state.desktopDownloadSelectionEdited,
                    )
                }
            }
        }
    }

    companion object {
        private const val DEFAULT_CHANNEL_ID = "mobile-default-channel"

        fun factory(application: Application): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return CastarroMobileViewModel(application) as T
                }
            }
    }

    private sealed class PendingYoutubeAction {
        data class ConnectAccount(val channelId: String) : PendingYoutubeAction()
        data class PrepareBroadcast(
            val channelId: String,
            val videoAssetId: String?,
            val title: String,
            val description: String,
            val thumbnailUri: String?,
            val privacyStatus: String,
            val loopEnabled: Boolean,
        ) : PendingYoutubeAction()
    }
}

private fun String.normalizeImageContentType(): String? =
    when (lowercase().trim()) {
        "image/jpeg", "image/jpg", "jpg", "jpeg" -> "image/jpeg"
        "image/png", "png" -> "image/png"
        else -> null
    }

private fun List<String>.encodeStringList(): String {
    val json = JSONArray()
    distinct().forEach { value -> json.put(value) }
    return json.toString()
}

private fun String.decodeStringList(): List<String> =
    runCatching {
        val json = JSONArray(this)
        List(json.length()) { index -> json.optString(index) }
            .filter { it.isNotBlank() }
    }.getOrDefault(emptyList())

private fun VideoAsset.toEntity(channelId: String) = VideoAssetEntity(
    id = id,
    channelId = channelId,
    displayName = displayName,
    sourceUri = sourceUri,
    localPath = localPath,
    durationMs = durationMs,
    sizeBytes = sizeBytes,
    videoCodec = videoCodec,
    audioCodec = audioCodec,
    width = width,
    height = height,
    fps = fps,
    audioSampleRate = audioSampleRate,
    compatibilityStatus = compatibilityStatus.name,
    compatibilityMessage = compatibilityMessage,
)

private fun VideoAssetEntity.toDomain() = VideoAsset(
    id = id,
    displayName = displayName,
    sourceUri = sourceUri,
    localPath = localPath,
    durationMs = durationMs,
    sizeBytes = sizeBytes,
    videoCodec = videoCodec,
    audioCodec = audioCodec,
    width = width,
    height = height,
    fps = fps,
    audioSampleRate = audioSampleRate,
    compatibilityStatus = runCatching { CompatibilityStatus.valueOf(compatibilityStatus) }
        .getOrDefault(CompatibilityStatus.Unknown),
    compatibilityMessage = compatibilityMessage,
)

private fun StreamSessionEntity.toDomain() = StreamSession(
    id = id,
    channelId = channelId,
    videoAssetId = videoAssetId,
    startedAt = startedAt,
    endedAt = endedAt,
    status = runCatching { StreamSessionStatus.valueOf(status) }
        .getOrDefault(StreamSessionStatus.Failed),
    exitCode = exitCode,
    bytesUploaded = bytesUploaded,
    averageBitrate = averageBitrate,
    failureReason = failureReason,
    logPath = logPath,
)
