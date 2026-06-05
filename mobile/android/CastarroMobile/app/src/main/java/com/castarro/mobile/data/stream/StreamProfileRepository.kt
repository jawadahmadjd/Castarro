package com.castarro.mobile.data.stream

import com.castarro.mobile.data.db.StreamProfileDao
import com.castarro.mobile.data.db.StreamProfileEntity
import com.castarro.mobile.data.secrets.SecretStore
import com.castarro.mobile.domain.model.StreamProfile
import com.castarro.mobile.domain.model.StreamProfileMode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.Instant
import java.util.UUID

class StreamProfileRepository(
    private val dao: StreamProfileDao,
    private val secrets: SecretStore,
) {
    fun observeProfiles(channelId: String): Flow<List<StreamProfile>> =
        dao.observeProfiles(channelId).map { profiles -> profiles.map { it.toDomain() } }

    suspend fun saveManualProfile(
        channelId: String,
        videoAssetId: String?,
        rtmpServerUrl: String,
        streamKey: String,
        loopEnabled: Boolean,
        restartOnExit: Boolean = true,
    ): StreamProfile {
        require(rtmpServerUrl.startsWith("rtmp://") || rtmpServerUrl.startsWith("rtmps://")) {
            "Manual profile requires an RTMP or RTMPS server URL."
        }
        require(streamKey.isNotBlank()) { "Stream key is required." }

        val now = Instant.now().toString()
        val profileId = "profile-${UUID.randomUUID()}"
        val secretRef = "stream-key:$profileId"
        secrets.putSecret(secretRef, streamKey.trim())

        val entity = StreamProfileEntity(
            id = profileId,
            channelId = channelId,
            videoAssetId = videoAssetId,
            mode = StreamProfileMode.ManualKey.name,
            rtmpServerUrl = rtmpServerUrl.trimEnd('/'),
            streamKeySecretRef = secretRef,
            youtubeBroadcastId = null,
            loopEnabled = loopEnabled,
            restartOnExit = restartOnExit,
            createdAt = now,
            updatedAt = now,
        )
        dao.upsert(entity)
        return entity.toDomain()
    }
}

private fun StreamProfileEntity.toDomain() = StreamProfile(
    id = id,
    channelId = channelId,
    videoAssetId = videoAssetId,
    mode = StreamProfileMode.valueOf(mode),
    rtmpServerUrl = rtmpServerUrl,
    streamKeySecretRef = streamKeySecretRef,
    youtubeBroadcastId = youtubeBroadcastId,
    loopEnabled = loopEnabled,
    restartOnExit = restartOnExit,
    createdAt = createdAt,
    updatedAt = updatedAt,
)
