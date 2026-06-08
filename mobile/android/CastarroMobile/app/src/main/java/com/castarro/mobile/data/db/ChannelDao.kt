package com.castarro.mobile.data.db

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface ChannelDao {
    @Query("SELECT * FROM channels ORDER BY displayName")
    fun observeChannels(): Flow<List<ChannelEntity>>

    @Query("SELECT COUNT(*) FROM channels")
    suspend fun countChannels(): Int

    @Upsert
    suspend fun upsert(channel: ChannelEntity)
}
