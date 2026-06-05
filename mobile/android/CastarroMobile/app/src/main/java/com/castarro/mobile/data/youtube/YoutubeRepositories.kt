package com.castarro.mobile.data.youtube

import com.castarro.mobile.domain.model.YoutubeBroadcast
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

data class YoutubeAccount(val id: String, val displayName: String, val status: String)
data class CreateBroadcastRequest(val title: String, val privacyStatus: String)

interface YoutubeRepository {
    fun observeAccounts(): Flow<List<YoutubeAccount>>
    suspend fun connectAccount()
    suspend fun createBroadcast(request: CreateBroadcastRequest): YoutubeBroadcast
}

class YoutubeAuthRepository

class YoutubeLiveRepository : YoutubeRepository {
    override fun observeAccounts(): Flow<List<YoutubeAccount>> = flowOf(emptyList())
    override suspend fun connectAccount() {
        error("Google OAuth is outside the manual-key MVP.")
    }
    override suspend fun createBroadcast(request: CreateBroadcastRequest): YoutubeBroadcast {
        error("YouTube account mode is outside the manual-key MVP.")
    }
}
