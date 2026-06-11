package com.castarro.mobile.data.sync

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

enum class DesktopVideoDownloadPhase {
    Idle,
    Running,
    Paused,
    Completed,
    Cancelled,
    Failed,
}

data class DesktopVideoDownloadTask(
    val phase: DesktopVideoDownloadPhase = DesktopVideoDownloadPhase.Idle,
    val totalCount: Int = 0,
    val completedCount: Int = 0,
    val activeVideoName: String? = null,
    val message: String? = null,
) {
    val isActive: Boolean
        get() = phase == DesktopVideoDownloadPhase.Running || phase == DesktopVideoDownloadPhase.Paused
}

object DesktopVideoDownloadCoordinator {
    private val mutableState = MutableStateFlow(DesktopVideoDownloadTask())
    val state: StateFlow<DesktopVideoDownloadTask> = mutableState

    fun update(task: DesktopVideoDownloadTask) {
        mutableState.value = task
    }
}
