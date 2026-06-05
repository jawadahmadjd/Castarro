package com.castarro.mobile.data.files

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import com.castarro.mobile.domain.model.CompatibilityStatus
import com.castarro.mobile.domain.model.VideoAsset
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

class VideoImportRepository(private val context: Context) {
    suspend fun importVideo(uri: Uri): VideoAsset = withContext(Dispatchers.IO) {
        val name = displayNameFor(uri)
        val localFile = copyIntoAppStorage(uri, name)
        val metadata = readMediaMetadata(localFile.absolutePath)
        val videoCodec = metadata.videoMime?.substringAfterLast('/') ?: "unknown"
        val audioCodec = metadata.audioMime?.substringAfterLast('/') ?: "unknown"
        val isReady = videoCodec.equals("avc", ignoreCase = true) ||
            videoCodec.equals("h264", ignoreCase = true)
        val audioReady = audioCodec.equals("mp4a-latm", ignoreCase = true) ||
            audioCodec.equals("aac", ignoreCase = true)

        VideoAsset(
            id = "video-${UUID.randomUUID()}",
            displayName = name,
            sourceUri = uri.toString(),
            localPath = localFile.absolutePath,
            durationMs = metadata.durationMs,
            sizeBytes = localFile.length(),
            videoCodec = if (videoCodec == "avc") "h264" else videoCodec,
            audioCodec = if (audioCodec == "mp4a-latm") "aac" else audioCodec,
            width = metadata.width,
            height = metadata.height,
            fps = metadata.frameRate?.toDouble(),
            audioSampleRate = metadata.audioSampleRate,
            compatibilityStatus = if (isReady && audioReady) {
                CompatibilityStatus.Ready
            } else {
                CompatibilityStatus.NeedsDesktopPrep
            },
            compatibilityMessage = if (isReady && audioReady) {
                "Ready to stream"
            } else {
                "Open Castarro Desktop and normalize this video first."
            },
        )
    }

    private fun displayNameFor(uri: Uri): String {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) return cursor.getString(index)
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "selected-video.mp4"
    }

    private fun copyIntoAppStorage(uri: Uri, displayName: String): File {
        runCatching {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val videosDir = File(context.filesDir, "videos").apply { mkdirs() }
        val safeName = displayName.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val target = File(videosDir, "${System.currentTimeMillis()}-$safeName")
        context.contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "Unable to open selected video." }
            target.outputStream().use { output -> input.copyTo(output) }
        }
        return target
    }

    private fun readMediaMetadata(path: String): ImportedVideoMetadata {
        val retriever = MediaMetadataRetriever()
        val extractor = MediaExtractor()
        return try {
            retriever.setDataSource(path)
            extractor.setDataSource(path)
            var videoMime: String? = null
            var audioMime: String? = null
            var frameRate: Int? = null
            var audioSampleRate: Int? = null
            repeat(extractor.trackCount) { index ->
                val format = extractor.getTrackFormat(index)
                val mime = format.getString(MediaFormat.KEY_MIME)
                when {
                    mime?.startsWith("video/") == true -> {
                        videoMime = mime
                        if (format.containsKey(MediaFormat.KEY_FRAME_RATE)) {
                            frameRate = format.getInteger(MediaFormat.KEY_FRAME_RATE)
                        }
                    }
                    mime?.startsWith("audio/") == true -> {
                        audioMime = mime
                        if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                            audioSampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        }
                    }
                }
            }
            ImportedVideoMetadata(
                durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0,
                width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull(),
                height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull(),
                frameRate = frameRate,
                audioSampleRate = audioSampleRate,
                videoMime = videoMime,
                audioMime = audioMime,
            )
        } finally {
            extractor.release()
            retriever.release()
        }
    }
}

private data class ImportedVideoMetadata(
    val durationMs: Long,
    val width: Int?,
    val height: Int?,
    val frameRate: Int?,
    val audioSampleRate: Int?,
    val videoMime: String?,
    val audioMime: String?,
)
