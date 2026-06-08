package com.castarro.mobile.data.db

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface StreamSessionDao {
    @Query("SELECT * FROM stream_sessions WHERE channelId = :channelId ORDER BY startedAt DESC")
    fun observeSessions(channelId: String): Flow<List<StreamSessionEntity>>

    @Query("UPDATE stream_sessions SET status = :status WHERE id = :sessionId")
    suspend fun updateStatus(sessionId: String, status: String)

    @Query("UPDATE stream_sessions SET bytesUploaded = :bytesUploaded WHERE id = :sessionId")
    suspend fun updateBytesUploaded(sessionId: String, bytesUploaded: Long)

    @Query(
        "UPDATE stream_sessions SET status = :status, endedAt = :endedAt, exitCode = :exitCode, " +
            "failureReason = :failureReason WHERE id = :sessionId",
    )
    suspend fun finishSession(
        sessionId: String,
        status: String,
        endedAt: String,
        exitCode: Int?,
        failureReason: String?,
    )

    @Upsert
    suspend fun upsert(session: StreamSessionEntity)
}
