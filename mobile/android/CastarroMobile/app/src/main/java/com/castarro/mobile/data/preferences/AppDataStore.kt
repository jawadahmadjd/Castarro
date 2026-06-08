package com.castarro.mobile.data.preferences

import android.content.Context
import androidx.datastore.preferences.preferencesDataStore

val Context.castarroDataStore by preferencesDataStore(name = "castarro_preferences")
