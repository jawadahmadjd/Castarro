package com.castarro.mobile.data.db

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface StreamSessionDao {
    @Query("SELECT * FROM stream_sessions WHERE channelId = :channelId ORDER BY startedAt DESC")
    fun observeSessions(channelId: String): Flow<List<StreamSessionEntity>>

    @Upsert
    suspend fun upsert(session: StreamSessionEntity)
}
