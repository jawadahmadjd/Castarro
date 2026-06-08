package com.castarro.mobile.streaming

import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFmpegSession
import com.arthenica.ffmpegkit.ReturnCode
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import kotlin.coroutines.resume

class StreamProcessRunner {
    @Volatile
    private var activeSession: FFmpegSession? = null

    suspend fun run(
        command: List<String>,
        workingDirectory: File? = null,
        onLogLine: (String) -> Unit,
    ): Int = suspendCancellableCoroutine { continuation ->
        require(command.isNotEmpty()) { "Stream command cannot be empty." }
        onLogLine(command.joinToString(" "))

        val arguments = command.dropFfmpegExecutable()
        val session = runCatching {
            FFmpegKit.executeWithArgumentsAsync(
                arguments.toTypedArray(),
                { completedSession ->
                    activeSession = null
                    val exitCode = completedSession.toExitCode()
                    if (continuation.isActive) {
                        continuation.resume(exitCode)
                    }
                },
                { log ->
                    log.message?.trimEnd()?.takeIf { it.isNotBlank() }?.let(onLogLine)
                },
                null,
            )
        }.getOrElse { error ->
            onLogLine("Android FFmpeg runtime failed to start: ${error.message}")
            if (continuation.isActive) {
                continuation.resume(-1)
            }
            return@suspendCancellableCoroutine
        }
        activeSession = session
        continuation.invokeOnCancellation {
            FFmpegKit.cancel(session.sessionId)
            activeSession = null
        }

        if (workingDirectory != null) {
            onLogLine("Working directory ignored by Android FFmpegKit runtime: ${workingDirectory.absolutePath}")
        }
    }

    fun stop() {
        activeSession?.let { session ->
            FFmpegKit.cancel(session.sessionId)
            activeSession = null
        }
    }
}

internal fun List<String>.dropFfmpegExecutable(): List<String> =
    if (firstOrNull()?.substringAfterLast('/')?.substringAfterLast('\\') == "ffmpeg") {
        drop(1)
    } else {
        this
    }

private fun FFmpegSession.toExitCode(): Int {
    val code = returnCode
    return when {
        ReturnCode.isSuccess(code) -> 0
        ReturnCode.isCancel(code) -> 255
        code != null -> code.value
        else -> -1
    }
}
