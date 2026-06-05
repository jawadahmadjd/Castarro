package com.castarro.mobile.data.secrets

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

interface SecretStore {
    suspend fun putSecret(reference: String, value: String)
    suspend fun getSecret(reference: String): String?
    suspend fun clearSecret(reference: String)
}

class EncryptedSecretStore(context: Context) : SecretStore {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val preferences = EncryptedSharedPreferences.create(
        context,
        "castarro_stream_secrets",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override suspend fun putSecret(reference: String, value: String) {
        preferences.edit().putString(reference, value).apply()
    }

    override suspend fun getSecret(reference: String): String? = preferences.getString(reference, null)

    override suspend fun clearSecret(reference: String) {
        preferences.edit().remove(reference).apply()
    }
}
