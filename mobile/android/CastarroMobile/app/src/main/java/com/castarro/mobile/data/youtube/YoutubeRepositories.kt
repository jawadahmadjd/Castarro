package com.castarro.mobile.data.youtube

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import com.castarro.mobile.data.preferences.AppPreferences
import com.castarro.mobile.data.secrets.SecretStore
import com.castarro.mobile.domain.model.YoutubeBroadcast
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

data class YoutubeAccount(
    val id: String,
    val displayName: String,
    val email: String?,
    val status: String,
)

data class CreateBroadcastRequest(
    val title: String,
    val description: String,
    val privacyStatus: String,
    val scheduledStartTime: String = Instant.now().plusSeconds(60).toString(),
)

interface YoutubeRepository {
    fun observeAccounts(channelId: String): Flow<List<YoutubeAccount>>
    suspend fun saveAuthorizedAccount(channelId: String, accessToken: String): YoutubeAccount
    suspend fun disconnectAccount(channelId: String)
    suspend fun createBroadcast(accessToken: String, request: CreateBroadcastRequest): YoutubeBroadcast
    suspend fun uploadThumbnail(
        accessToken: String,
        broadcastId: String,
        imageData: ByteArray,
        contentType: String,
    ): JSONObject
}

class YoutubeLiveRepository(
    private val dataStore: DataStore<Preferences>,
    private val secrets: SecretStore,
) : YoutubeRepository {
    override fun observeAccounts(channelId: String): Flow<List<YoutubeAccount>> =
        dataStore.data.map { preferences ->
            val id = preferences[AppPreferences.youtubeAccountId(channelId)].orEmpty()
            if (id.isBlank()) {
                emptyList()
            } else {
                listOf(
                    YoutubeAccount(
                        id = id,
                        displayName = preferences[AppPreferences.youtubeAccountName(channelId)].orEmpty().ifBlank { "YouTube account" },
                        email = preferences[AppPreferences.youtubeAccountEmail(channelId)],
                        status = preferences[AppPreferences.youtubeAccountStatus(channelId)].orEmpty().ifBlank { "Connected" },
                    ),
                )
            }
        }

    override suspend fun saveAuthorizedAccount(channelId: String, accessToken: String): YoutubeAccount {
        require(channelId.isNotBlank()) { "Channel is still loading." }
        require(accessToken.isNotBlank()) { "Google authorization did not return an access token." }
        val userInfo = getJson("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", accessToken)
        val account = YoutubeAccount(
            id = userInfo.optString("id").ifBlank { userInfo.optString("email") },
            displayName = userInfo.optString("name").ifBlank { userInfo.optString("email").ifBlank { "YouTube account" } },
            email = userInfo.optString("email").takeIf { it.isNotBlank() },
            status = "Connected",
        )
        require(account.id.isNotBlank()) { "Google account details did not include an account id." }
        dataStore.edit { preferences ->
            preferences[AppPreferences.youtubeAccountId(channelId)] = account.id
            preferences[AppPreferences.youtubeAccountName(channelId)] = account.displayName
            account.email?.let { preferences[AppPreferences.youtubeAccountEmail(channelId)] = it }
                ?: preferences.remove(AppPreferences.youtubeAccountEmail(channelId))
            preferences[AppPreferences.youtubeAccountStatus(channelId)] = account.status
        }
        return account
    }

    override suspend fun disconnectAccount(channelId: String) {
        require(channelId.isNotBlank()) { "Channel is still loading." }
        dataStore.edit { preferences ->
            preferences.remove(AppPreferences.youtubeAccountId(channelId))
            preferences.remove(AppPreferences.youtubeAccountName(channelId))
            preferences.remove(AppPreferences.youtubeAccountEmail(channelId))
            preferences.remove(AppPreferences.youtubeAccountStatus(channelId))
        }
    }

    override suspend fun createBroadcast(accessToken: String, request: CreateBroadcastRequest): YoutubeBroadcast {
        require(accessToken.isNotBlank()) { "Google authorization did not return an access token." }
        require(request.title.isNotBlank()) { "Broadcast title is required." }
        require(request.privacyStatus in setOf("private", "unlisted", "public")) {
            "Privacy must be private, unlisted, or public."
        }

        val broadcast = postJson(
            url = "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails",
            accessToken = accessToken,
            body = JSONObject()
                .put(
                    "snippet",
                    JSONObject()
                        .put("title", request.title.trim())
                        .put("description", request.description.trim())
                        .put("scheduledStartTime", request.scheduledStartTime),
                )
                .put(
                    "status",
                    JSONObject()
                        .put("privacyStatus", request.privacyStatus)
                        .put("selfDeclaredMadeForKids", false),
                )
                .put(
                    "contentDetails",
                    JSONObject()
                        .put("enableAutoStart", true)
                        .put("enableAutoStop", true),
                ),
        )
        val broadcastId = broadcast.getString("id")

        val stream = postJson(
            url = "https://www.googleapis.com/youtube/v3/liveStreams?part=snippet,cdn,status",
            accessToken = accessToken,
            body = JSONObject()
                .put(
                    "snippet",
                    JSONObject().put("title", "${request.title.trim()} ingest"),
                )
                .put(
                    "cdn",
                    JSONObject()
                        .put("ingestionType", "rtmp")
                        .put("resolution", "variable")
                        .put("frameRate", "variable"),
                ),
        )
        val streamId = stream.getString("id")
        postJson(
            url = "https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?id=$broadcastId&streamId=$streamId&part=id,snippet,contentDetails,status",
            accessToken = accessToken,
            body = JSONObject(),
        )

        val ingestionInfo = stream.getJSONObject("cdn").getJSONObject("ingestionInfo")
        val ingestUrl = ingestionInfo.optString("rtmpsIngestionAddress")
            .ifBlank { ingestionInfo.optString("ingestionAddress") }
        val streamName = ingestionInfo.getString("streamName")
        val secretRef = "youtube-stream-name:$broadcastId:$streamId"
        secrets.putSecret(secretRef, streamName)

        return YoutubeBroadcast(
            id = broadcastId,
            title = broadcast.getJSONObject("snippet").optString("title").ifBlank { request.title.trim() },
            status = broadcast.getJSONObject("status").optString("lifeCycleStatus").ifBlank { "created" },
            ingestionUrl = ingestUrl,
            streamNameSecretRef = secretRef,
        )
    }

    override suspend fun uploadThumbnail(
        accessToken: String,
        broadcastId: String,
        imageData: ByteArray,
        contentType: String,
    ): JSONObject {
        require(accessToken.isNotBlank()) { "Google authorization did not return an access token." }
        require(broadcastId.isNotBlank()) { "YouTube broadcast id is required." }
        require(imageData.isNotEmpty()) { "Thumbnail file is empty." }
        require(contentType in setOf("image/jpeg", "image/png")) {
            "Thumbnail must be a JPEG or PNG image."
        }
        return requestJson(
            url = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=$broadcastId",
            method = "POST",
            accessToken = accessToken,
            contentType = contentType,
            bodyBytes = imageData,
        )
    }

    private suspend fun getJson(url: String, accessToken: String): JSONObject =
        requestJson(url = url, method = "GET", accessToken = accessToken, body = null)

    private suspend fun postJson(url: String, accessToken: String, body: JSONObject): JSONObject =
        requestJson(url = url, method = "POST", accessToken = accessToken, body = body)

    private suspend fun requestJson(
        url: String,
        method: String,
        accessToken: String,
        body: JSONObject? = null,
        contentType: String = "application/json; charset=utf-8",
        bodyBytes: ByteArray? = body?.toString()?.toByteArray(Charsets.UTF_8),
    ): JSONObject = withContext(Dispatchers.IO) {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            setRequestProperty("Authorization", "Bearer $accessToken")
            setRequestProperty("Accept", "application/json")
            if (bodyBytes != null) {
                doOutput = true
                setRequestProperty("Content-Type", contentType)
                outputStream.use { output -> output.write(bodyBytes) }
            }
        }
        try {
            val responseCode = connection.responseCode
            val payload = readBody(
                if (responseCode in 200..299) connection.inputStream else connection.errorStream,
            )
            if (responseCode !in 200..299) {
                throw IllegalStateException(youtubeApiError(payload, responseCode))
            }
            JSONObject(payload)
        } finally {
            connection.disconnect()
        }
    }

    private fun readBody(stream: InputStream?): String {
        if (stream == null) return "{}"
        return BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { reader ->
            reader.readText()
        }.ifBlank { "{}" }
    }

    private fun youtubeApiError(payload: String, responseCode: Int): String {
        val message = runCatching {
            JSONObject(payload)
                .getJSONObject("error")
                .optString("message")
        }.getOrNull()
        return message?.takeIf { it.isNotBlank() } ?: "YouTube API request failed with HTTP $responseCode."
    }
}
