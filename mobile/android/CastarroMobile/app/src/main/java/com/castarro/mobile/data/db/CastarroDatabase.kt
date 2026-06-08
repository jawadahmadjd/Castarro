package com.castarro.mobile.data.db

import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Entity(tableName = "channels")
data class ChannelEntity(
    @PrimaryKey val id: String,
    val displayName: String,
    val youtubeAccountId: String?,
    val logoUri: String?,
)

@Entity(tableName = "video_assets")
data class VideoAssetEntity(
    @PrimaryKey val id: String,
    val channelId: String,
    val displayName: String,
    val sourceUri: String,
    val localPath: String?,
    val durationMs: Long,
    val sizeBytes: Long,
    val videoCodec: String,
    val audioCodec: String,
    val width: Int?,
    val height: Int?,
    val fps: Double?,
    val audioSampleRate: Int?,
    val compatibilityStatus: String,
    val compatibilityMessage: String,
)

@Entity(tableName = "stream_profiles")
data class StreamProfileEntity(
    @PrimaryKey val id: String,
    val channelId: String,
    val videoAssetId: String?,
    val mode: String,
    val rtmpServerUrl: String?,
    val streamKeySecretRef: String?,
    val youtubeBroadcastId: String?,
    val loopEnabled: Boolean,
    val restartOnExit: Boolean,
    val createdAt: String,
    val updatedAt: String,
)

@Entity(tableName = "stream_sessions")
data class StreamSessionEntity(
    @PrimaryKey val id: String,
    val channelId: String,
    val videoAssetId: String,
    val status: String,
    val startedAt: String,
    val endedAt: String?,
    val exitCode: Int?,
    val bytesUploaded: Long,
    val averageBitrate: Double?,
    val failureReason: String?,
    val logPath: String?,
)

@Database(
    entities = [
        ChannelEntity::class,
        VideoAssetEntity::class,
        StreamProfileEntity::class,
        StreamSessionEntity::class,
    ],
    version = 2,
    exportSchema = true,
)
abstract class CastarroDatabase : RoomDatabase() {
    abstract fun channelDao(): ChannelDao
    abstract fun videoAssetDao(): VideoAssetDao
    abstract fun streamProfileDao(): StreamProfileDao
    abstract fun streamSessionDao(): StreamSessionDao

    companion object {
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE channels ADD COLUMN logoUri TEXT")
            }
        }
    }
}
