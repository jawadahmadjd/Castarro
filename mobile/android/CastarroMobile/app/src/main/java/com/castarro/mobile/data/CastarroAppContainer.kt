package com.castarro.mobile.data

import android.content.Context
import androidx.room.Room
import com.castarro.mobile.data.db.CastarroDatabase
import com.castarro.mobile.data.files.VideoImportRepository
import com.castarro.mobile.data.preferences.castarroDataStore
import com.castarro.mobile.data.secrets.EncryptedSecretStore
import com.castarro.mobile.data.secrets.SecretStore
import com.castarro.mobile.data.stream.StreamProfileRepository
import com.castarro.mobile.data.youtube.YoutubeAuthorizationGateway
import com.castarro.mobile.data.youtube.YoutubeLiveRepository
import com.castarro.mobile.platform.AppUsageMonitor
import com.castarro.mobile.platform.StreamProtectionMonitor

class CastarroAppContainer(context: Context) {
    val database: CastarroDatabase = Room.databaseBuilder(
        context.applicationContext,
        CastarroDatabase::class.java,
        "castarro_mobile.db",
    )
        .addMigrations(CastarroDatabase.MIGRATION_1_2)
        .build()

    val secrets: SecretStore = EncryptedSecretStore(context.applicationContext)
    val videoImporter = VideoImportRepository(context.applicationContext)
    val streamProfiles = StreamProfileRepository(database.streamProfileDao(), secrets)
    val youtube = YoutubeLiveRepository(context.applicationContext.castarroDataStore, secrets)
    val youtubeAuth = YoutubeAuthorizationGateway(context.applicationContext)
    val streamProtection = StreamProtectionMonitor(context.applicationContext)
    val appUsage = AppUsageMonitor(context.applicationContext)
}
