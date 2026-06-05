package com.castarro.mobile.streaming

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

class StreamProcessRunner {
    @Volatile
    private var process: Process? = null

    suspend fun run(
        command: List<String>,
        workingDirectory: File? = null,
        onLogLine: (String) -> Unit,
    ): Int = withContext(Dispatchers.IO) {
        require(command.isNotEmpty()) { "Stream command cannot be empty." }
        onLogLine(command.joinToString(" "))
        val builder = ProcessBuilder(command)
            .redirectErrorStream(true)
        if (workingDirectory != null) builder.directory(workingDirectory)

        val running = builder.start()
        process = running
        try {
            running.inputStream.bufferedReader().useLines { lines ->
                lines.forEach(onLogLine)
            }
            running.waitFor()
        } finally {
            process = null
        }
    }

    fun stop() {
        process?.destroy()
    }
}
