package com.castarro.mobile.data.preferences

import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey

object AppPreferences {
    val LastSelectedChannel = stringPreferencesKey("last_selected_channel")
    val LastResolutionLabel = stringPreferencesKey("last_resolution_label")
    val DesktopSyncLastCompletedAt = stringPreferencesKey("desktop_sync_last_completed_at")
    val DesktopSyncLastSummary = stringPreferencesKey("desktop_sync_last_summary")
    val DesktopRemoteBaseUrl = stringPreferencesKey("desktop_remote_base_url")
    val DesktopRemoteSyncToken = stringPreferencesKey("desktop_remote_sync_token")
    val DesktopRemoteConfigName = stringPreferencesKey("desktop_remote_config_name")
    val DesktopRemoteDeviceName = stringPreferencesKey("desktop_remote_device_name")
    val DesktopRemoteExpiresAt = stringPreferencesKey("desktop_remote_expires_at")
    val DesktopRemoteLastAlertId = stringPreferencesKey("desktop_remote_last_alert_id")

    fun videoSelectionIds(channelId: String) = stringPreferencesKey(channelKey(channelId, "video_selection_ids"))
    fun videoSelectionEdited(channelId: String) = booleanPreferencesKey(channelKey(channelId, "video_selection_edited"))
    fun youtubeBroadcastTitle(channelId: String) = stringPreferencesKey(channelKey(channelId, "youtube_broadcast_title"))
    fun youtubeBroadcastDescription(channelId: String) = stringPreferencesKey(channelKey(channelId, "youtube_broadcast_description"))
    fun youtubeThumbnailUri(channelId: String) = stringPreferencesKey(channelKey(channelId, "youtube_thumbnail_uri"))
    fun youtubePrivacyStatus(channelId: String) = stringPreferencesKey(channelKey(channelId, "youtube_privacy_status"))
    fun defaultLoopEnabled(channelId: String) = booleanPreferencesKey(channelKey(channelId, "default_loop_enabled"))
    fun youtubeAccountId(channelId: String) = stringPreferencesKey(channelKey(channelId, "youtube_account_id"))
    fun youtubeAccountName(channelId: String) = stringPreferencesKey(channelKey(channelId, "youtube_account_name"))
    fun youtubeAccountEmail(channelId: String) = stringPreferencesKey(channelKey(channelId, "youtube_account_email"))
    fun youtubeAccountStatus(channelId: String) = stringPreferencesKey(channelKey(channelId, "youtube_account_status"))

    private fun channelKey(channelId: String, setting: String): String = "channel.$channelId.$setting"
}
