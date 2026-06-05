package com.castarro.mobile.data.db

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface StreamProfileDao {
    @Query("SELECT * FROM stream_profiles WHERE channelId = :channelId ORDER BY updatedAt DESC")
    fun observeProfiles(channelId: String): Flow<List<StreamProfileEntity>>

    @Query("SELECT * FROM stream_profiles WHERE id = :profileId LIMIT 1")
    suspend fun getProfile(profileId: String): StreamProfileEntity?

    @Upsert
    suspend fun upsert(profile: StreamProfileEntity)
}
