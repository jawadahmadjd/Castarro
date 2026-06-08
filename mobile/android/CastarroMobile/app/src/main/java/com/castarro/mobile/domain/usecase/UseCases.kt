package com.castarro.mobile.domain.usecase

import android.net.Uri
import com.castarro.mobile.data.stream.StreamProfileRepository
import com.castarro.mobile.data.youtube.CreateBroadcastRequest
import com.castarro.mobile.data.youtube.YoutubeRepository
import com.castarro.mobile.domain.model.CompatibilityReport
import com.castarro.mobile.domain.model.StreamProfile
import com.castarro.mobile.domain.model.StreamProfileMode
import com.castarro.mobile.domain.model.VideoAsset
import com.castarro.mobile.domain.model.YoutubeBroadcast
import com.castarro.mobile.streaming.StreamCommandBuilder
import com.castarro.mobile.streaming.VideoCompatibilityProbe
import java.io.File

class PickVideoUseCase {
    suspend operator fun invoke(uri: Uri): Uri = uri
}

class ValidateVideoUseCase(
    private val probe: VideoCompatibilityProbe = VideoCompatibilityProbe(),
) {
    suspend operator fun invoke(video: VideoAsset): CompatibilityReport = probe.probe(video)
}

class StartStreamUseCase(
    private val commandBuilder: StreamCommandBuilder = StreamCommandBuilder(),
) {
    operator fun invoke(
        profile: StreamProfile,
        videoPaths: List<String>,
        streamKey: String,
        playlistFile: File,
    ): List<String> {
        require(profile.mode == StreamProfileMode.ManualKey || profile.mode == StreamProfileMode.YoutubeAccount) {
            "This stream profile mode is not supported on mobile."
        }
        return commandBuilder.copyModeCommand(profile, videoPaths, streamKey, playlistFile)
    }
}

class StopStreamUseCase {
    operator fun invoke(channelId: String): String = channelId
}

class CreateYoutubeBroadcastUseCase(
    private val youtubeRepository: YoutubeRepository,
) {
    suspend operator fun invoke(accessToken: String, request: CreateBroadcastRequest): YoutubeBroadcast =
        youtubeRepository.createBroadcast(accessToken, request)
}

class SaveStreamProfileUseCase(
    private val repository: StreamProfileRepository,
) {
    suspend operator fun invoke(
        channelId: String,
        videoAssetId: String?,
        rtmpServerUrl: String,
        streamKey: String,
        loopEnabled: Boolean,
    ): StreamProfile = repository.saveManualProfile(
        channelId = channelId,
        videoAssetId = videoAssetId,
        rtmpServerUrl = rtmpServerUrl,
        streamKey = streamKey,
        loopEnabled = loopEnabled,
    )
}
