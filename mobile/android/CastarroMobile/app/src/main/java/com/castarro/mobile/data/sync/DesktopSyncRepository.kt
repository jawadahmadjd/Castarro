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
import kotlinx.coroutines.flow.first
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

data class DesktopRemoteSession(
    val baseUrl: String,
    val syncToken: String,
    val configName: String,
    val deviceName: String,
    val expiresAt: String?,
)

data class DesktopRemoteAlert(
    val id: Long,
    val channelName: String,
    val severity: String,
    val title: String,
    val message: String,
    val createdAt: String,
    val mobileEnabled: Boolean,
)

data class DesktopRemoteChannelStatus(
    val channelId: String,
    val channelName: String,
    val running: Boolean,
    val healthLabel: String,
    val healthDetail: String,
    val transferredBytes: Long,
    val bitrateBps: Long,
    val scheduleEnabled: Boolean,
    val scheduleInWindow: Boolean,
    val nextStartAt: String?,
    val nextStopAt: String?,
)

data class DesktopRemoteStatus(
    val connected: Boolean,
    val desktopLabel: String,
    val configName: String,
    val generatedAt: String,
    val alertsEnabled: Boolean,
    val schedulerEnabled: Boolean,
    val channels: List<DesktopRemoteChannelStatus>,
    val recentAlerts: List<DesktopRemoteAlert>,
    val errorMessage: String? = null,
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
        persistRemoteSession(pairing, response)
        importBundle(response.getJSONObject("bundle"), request.includeVideos)
    }

    suspend fun currentRemoteSession(): DesktopRemoteSession? = withContext(Dispatchers.IO) {
        val preferences = context.castarroDataStore.data.first()
        val baseUrl = preferences[AppPreferences.DesktopRemoteBaseUrl].orEmpty().trim()
        val syncToken = preferences[AppPreferences.DesktopRemoteSyncToken].orEmpty().trim()
        if (baseUrl.isBlank() || syncToken.isBlank()) return@withContext null
        DesktopRemoteSession(
            baseUrl = baseUrl,
            syncToken = syncToken,
            configName = preferences[AppPreferences.DesktopRemoteConfigName].orEmpty(),
            deviceName = preferences[AppPreferences.DesktopRemoteDeviceName].orEmpty().ifBlank { "Castarro Desktop" },
            expiresAt = preferences[AppPreferences.DesktopRemoteExpiresAt],
        )
    }

    suspend fun fetchRemoteStatus(): DesktopRemoteStatus = withContext(Dispatchers.IO) {
        val session = currentRemoteSession() ?: return@withContext DesktopRemoteStatus(
            connected = false,
            desktopLabel = "Castarro Desktop",
            configName = "",
            generatedAt = "",
            alertsEnabled = false,
            schedulerEnabled = false,
            channels = emptyList(),
            recentAlerts = emptyList(),
            errorMessage = "Pair with the desktop first.",
        )
        val payload = getJson("${session.baseUrl}/sync/status?syncToken=${Uri.encode(session.syncToken)}")
        payload.toRemoteStatus()
    }

    suspend fun sendRemoteControl(action: String, channelName: String): DesktopRemoteStatus = withContext(Dispatchers.IO) {
        val session = currentRemoteSession() ?: error("Pair with the desktop first.")
        val payload = postJson(
            "${session.baseUrl}/sync/control?syncToken=${Uri.encode(session.syncToken)}",
            JSONObject()
                .put("action", action)
                .put("channelName", channelName),
        )
        payload.getJSONObject("status").toRemoteStatus()
    }

    suspend fun rememberLastRemoteAlertId(alertId: Long) {
        context.castarroDataStore.edit { preferences ->
            preferences[AppPreferences.DesktopRemoteLastAlertId] = alertId.toString()
        }
    }

    suspend fun lastRemoteAlertId(): Long = withContext(Dispatchers.IO) {
        context.castarroDataStore.data.first()[AppPreferences.DesktopRemoteLastAlertId]?.toLongOrNull() ?: 0L
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

    private fun getJson(url: String): JSONObject {
        val connection = URL(url).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "GET"
            connection.setRequestProperty("Accept", "application/json")
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val payload = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty().ifBlank { "{}" }
            if (connection.responseCode !in 200..299) {
                throw IllegalStateException(JSONObject(payload).optString("error").ifBlank { "Desktop remote status failed." })
            }
            JSONObject(payload)
        } finally {
            connection.disconnect()
        }
    }

    private suspend fun persistRemoteSession(pairing: DesktopPairingLink, response: JSONObject) {
        val syncToken = response.optString("syncToken").trim()
        if (syncToken.isBlank()) return
        val deviceName = response.optJSONObject("device")?.optString("deviceName").orEmpty()
            .ifBlank { response.optJSONObject("account")?.optString("displayName").orEmpty() }
            .ifBlank { "Castarro Desktop" }
        context.castarroDataStore.edit { preferences ->
            preferences[AppPreferences.DesktopRemoteBaseUrl] = "http://${pairing.host}:${pairing.port}"
            preferences[AppPreferences.DesktopRemoteSyncToken] = syncToken
            preferences[AppPreferences.DesktopRemoteConfigName] = response.optJSONObject("bundle")?.optString("configName").orEmpty()
            preferences[AppPreferences.DesktopRemoteDeviceName] = deviceName
            preferences[AppPreferences.DesktopRemoteLastAlertId] = "0"
            response.optString("expiresAt").takeIf { it.isNotBlank() }?.let {
                preferences[AppPreferences.DesktopRemoteExpiresAt] = it
            }
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

private fun JSONObject.toRemoteStatus(): DesktopRemoteStatus {
    val channels = optJSONArray("channels") ?: JSONArray()
    val alerts = optJSONObject("alerts")
    val recentAlerts = alerts?.optJSONArray("recent") ?: JSONArray()
    return DesktopRemoteStatus(
        connected = optBoolean("ok", true),
        desktopLabel = optString("desktopLabel").ifBlank { "Castarro Desktop" },
        configName = optString("configName"),
        generatedAt = optString("generatedAt"),
        alertsEnabled = alerts?.optBoolean("mobile_notifications_enabled", false) == true,
        schedulerEnabled = optJSONObject("scheduler")?.optBoolean("enabled", false) == true,
        channels = List(channels.length()) { index ->
            val item = channels.getJSONObject(index)
            val schedule = item.optJSONObject("scheduler")
            DesktopRemoteChannelStatus(
                channelId = item.optString("channelId"),
                channelName = item.optString("channelName"),
                running = item.optBoolean("running", false),
                healthLabel = item.optString("healthLabel").ifBlank { if (item.optBoolean("running", false)) "Live" else "Idle" },
                healthDetail = item.optString("healthDetail"),
                transferredBytes = item.optLongOrNull("transferredBytes") ?: 0L,
                bitrateBps = item.optLongOrNull("bitrateBps") ?: 0L,
                scheduleEnabled = schedule?.optBoolean("enabled", false) == true,
                scheduleInWindow = schedule?.optBoolean("in_window", false) == true,
                nextStartAt = schedule?.optString("next_start_at")?.ifBlank { null },
                nextStopAt = schedule?.optString("next_stop_at")?.ifBlank { null },
            )
        },
        recentAlerts = List(recentAlerts.length()) { index ->
            val item = recentAlerts.getJSONObject(index)
            DesktopRemoteAlert(
                id = item.optLong("id"),
                channelName = item.optString("channel_name"),
                severity = item.optString("severity").ifBlank { "info" },
                title = item.optString("title"),
                message = item.optString("message"),
                createdAt = item.optString("created_at"),
                mobileEnabled = item.optBoolean("mobile_enabled", true),
            )
        },
        errorMessage = optString("errorMessage").ifBlank { null },
    )
}

private fun String.toMobileProfileMode(): String =
    when (trim()) {
        "youtubeAccount", "YoutubeAccount" -> "YoutubeAccount"
        else -> "ManualKey"
    }
