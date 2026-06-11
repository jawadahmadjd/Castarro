package com.castarro.mobile.data.sync

import android.content.Context
import android.net.Uri
import androidx.datastore.preferences.core.edit
import com.castarro.mobile.data.db.CastarroDatabase
import com.castarro.mobile.data.db.ChannelEntity
import com.castarro.mobile.data.db.StreamProfileEntity
import com.castarro.mobile.data.db.VideoAssetEntity
import com.castarro.mobile.data.preferences.AppPreferences
import com.castarro.mobile.data.preferences.castarroDataStore
import com.castarro.mobile.data.secrets.SecretStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

data class DesktopPairingRequest(
    val pairingUri: String,
    val includeVideos: Boolean,
)

data class DesktopSyncResult(
    val channelCount: Int,
    val videoCount: Int,
    val downloadedVideoCount: Int,
    val downloadableVideos: List<DesktopDownloadableVideo>,
)

data class DesktopDownloadableVideo(
    val id: String,
    val displayName: String,
    val sizeBytes: Long,
)

class DesktopSyncRepository(
    private val context: Context,
    private val database: CastarroDatabase,
    private val secrets: SecretStore,
) {
    suspend fun pairAndSync(request: DesktopPairingRequest): DesktopSyncResult = withContext(Dispatchers.IO) {
        val pairing = DesktopPairingLink.parse(request.pairingUri)
        val response = postJson(
            url = "http://${pairing.host}:${pairing.port}/sync/pair/${pairing.token}",
            body = JSONObject()
                .put("code", pairing.code)
                .put("includeVideos", request.includeVideos)
                .put(
                    "device",
                    JSONObject()
                        .put("id", deviceId())
                        .put("name", android.os.Build.MODEL.ifBlank { "Android phone" })
                        .put("platform", "android"),
                ),
        )
        importBundle(response.getJSONObject("bundle"), request.includeVideos)
    }

    private suspend fun importBundle(bundle: JSONObject, includeVideos: Boolean): DesktopSyncResult {
        val channels = bundle.getJSONArray("channels")
        val profiles = bundle.getJSONArray("streamProfiles")
        val videos = bundle.getJSONArray("videos")
        val syncedSecrets = bundle.optJSONArray("secrets") ?: JSONArray()
        val downloadableVideos = mutableListOf<DesktopDownloadableVideo>()

        for (index in 0 until syncedSecrets.length()) {
            val item = syncedSecrets.getJSONObject(index)
            val ref = item.optString("ref")
            val value = item.optString("value")
            if (ref.isNotBlank()) {
                secrets.putSecret(ref, value)
            }
        }

        for (index in 0 until channels.length()) {
            val item = channels.getJSONObject(index)
            database.channelDao().upsert(
                ChannelEntity(
                    id = item.getString("id"),
                    displayName = item.getString("displayName"),
                    youtubeAccountId = item.optString("youtubeAccountId").ifBlank { null },
                    logoUri = item.optString("avatarUri").ifBlank { null },
                ),
            )
        }

        for (index in 0 until profiles.length()) {
            val item = profiles.getJSONObject(index)
            database.streamProfileDao().upsert(
                StreamProfileEntity(
                    id = item.getString("id"),
                    channelId = item.getString("channelId"),
                    videoAssetId = item.optString("videoAssetId").ifBlank { null },
                    mode = item.optString("mode").toMobileProfileMode(),
                    rtmpServerUrl = item.optString("rtmpServerUrl").ifBlank { null },
                    streamKeySecretRef = item.optString("streamKeySecretRef").ifBlank { null },
                    youtubeBroadcastId = item.optString("youtubeBroadcastId").ifBlank { null },
                    loopEnabled = item.optBoolean("loopEnabled", false),
                    restartOnExit = item.optBoolean("restartOnExit", false),
                    createdAt = item.optString("createdAt").ifBlank { Instant.now().toString() },
                    updatedAt = item.optString("updatedAt").ifBlank { Instant.now().toString() },
                ),
            )
        }

        for (index in 0 until videos.length()) {
            val item = videos.getJSONObject(index)
            val downloadUrl = if (includeVideos && item.optBoolean("syncFile", false)) {
                item.optString("downloadUrl").takeIf { it.isNotBlank() }
            } else {
                null
            }
            if (downloadUrl != null) {
                downloadableVideos += DesktopDownloadableVideo(
                    id = item.getString("id"),
                    displayName = item.getString("displayName"),
                    sizeBytes = item.optLongOrNull("sizeBytes") ?: 0L,
                )
            }
            database.videoAssetDao().upsert(initialVideoEntity(item, downloadUrl != null))
        }

        val firstChannelId = channels.optJSONObject(0)?.optString("id").orEmpty()
        if (firstChannelId.isNotBlank()) {
            context.castarroDataStore.edit { preferences ->
                preferences[AppPreferences.LastSelectedChannel] = firstChannelId
            }
        }

        return DesktopSyncResult(
            channelCount = channels.length(),
            videoCount = videos.length(),
            downloadedVideoCount = 0,
            downloadableVideos = downloadableVideos,
        )
    }

    private fun initialVideoEntity(item: JSONObject, willDownload: Boolean): VideoAssetEntity =
        VideoAssetEntity(
            id = item.getString("id"),
            channelId = item.getString("channelId"),
            displayName = item.getString("displayName"),
            sourceUri = item.optString("sourceUri").ifBlank { item.optString("desktopPath") },
            localPath = null,
            durationMs = 0L,
            sizeBytes = item.optLongOrNull("sizeBytes") ?: 0L,
            videoCodec = "",
            audioCodec = "",
            width = null,
            height = null,
            fps = null,
            audioSampleRate = null,
            compatibilityStatus = if (willDownload) "NeedsDesktopPrep" else "Unknown",
            compatibilityMessage = if (willDownload) {
                "Ready to download from desktop."
            } else {
                "Synced settings only. Sync the video file before streaming from mobile."
            },
        )

    private fun postJson(url: String, body: JSONObject): JSONObject {
        val connection = URL(url).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Accept", "application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val payload = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty().ifBlank { "{}" }
            if (connection.responseCode !in 200..299) {
                throw IllegalStateException(JSONObject(payload).optString("error").ifBlank { "Desktop sync failed." })
            }
            JSONObject(payload)
        } finally {
            connection.disconnect()
        }
    }

    private fun deviceId(): String {
        val file = File(context.filesDir, "sync-device-id.txt")
        if (file.exists()) {
            val existing = file.readText().trim()
            if (existing.isNotBlank()) return existing
        }
        val value = "android-${java.util.UUID.randomUUID()}"
        file.writeText(value)
        return value
    }
}

private data class DesktopPairingLink(
    val host: String,
    val port: Int,
    val token: String,
    val code: String,
) {
    companion object {
        fun parse(value: String): DesktopPairingLink {
            val uri = Uri.parse(value.trim())
            val host = uri.getQueryParameter("host") ?: error("Pairing link is missing host.")
            val port = uri.getQueryParameter("port")?.toIntOrNull() ?: error("Pairing link is missing port.")
            val token = uri.getQueryParameter("token") ?: error("Pairing link is missing token.")
            val code = uri.getQueryParameter("code").orEmpty()
            return DesktopPairingLink(host, port, token, code)
        }
    }
}

private fun JSONObject.optLongOrNull(name: String): Long? =
    if (has(name) && !isNull(name)) optLong(name) else null

private fun String.toMobileProfileMode(): String =
    when (trim()) {
        "youtubeAccount", "YoutubeAccount" -> "YoutubeAccount"
        else -> "ManualKey"
    }
