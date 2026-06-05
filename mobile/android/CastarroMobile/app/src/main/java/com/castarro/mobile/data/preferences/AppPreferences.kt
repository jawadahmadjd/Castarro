package com.castarro.mobile.data.preferences

import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey

object AppPreferences {
    val LastSelectedChannel = stringPreferencesKey("last_selected_channel")
    val PreferredPrivacy = stringPreferencesKey("preferred_privacy")
    val DefaultLoopEnabled = booleanPreferencesKey("default_loop_enabled")
    val LastResolutionLabel = stringPreferencesKey("last_resolution_label")
}
