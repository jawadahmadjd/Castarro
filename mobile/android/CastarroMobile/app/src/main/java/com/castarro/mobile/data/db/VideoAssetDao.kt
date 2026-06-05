package com.castarro.mobile.data.db

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface VideoAssetDao {
    @Query("SELECT * FROM video_assets WHERE channelId = :channelId ORDER BY displayName")
    fun observeVideos(channelId: String): Flow<List<VideoAssetEntity>>

    @Upsert
    suspend fun upsert(video: VideoAssetEntity)
}
