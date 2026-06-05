package com.castarro.mobile.streaming

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

enum class ActiveStreamState {
    Idle,
    Connecting,
    Live,
    Reconnecting,
    Stopped,
    Failed,
}

class StreamController {
    private val mutableState = MutableStateFlow(ActiveStreamState.Idle)
    val state: StateFlow<ActiveStreamState> = mutableState

    suspend fun start() {
        mutableState.value = ActiveStreamState.Connecting
    }

    suspend fun markLive() {
        mutableState.value = ActiveStreamState.Live
    }

    suspend fun stop() {
        mutableState.value = ActiveStreamState.Stopped
    }
}
