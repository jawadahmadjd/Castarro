package com.castarro.mobile.streaming

import android.app.Service
import android.content.Intent
import android.os.IBinder
import com.castarro.mobile.platform.NotificationFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.File
import java.time.Duration
import java.time.Instant

class StreamForegroundService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val runner = StreamProcessRunner()
    private lateinit var notifications: NotificationFactory
    private var startedAt: Instant? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        notifications = NotificationFactory(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action ?: ACTION_START) {
            ACTION_STOP -> stopStreaming()
            ACTION_START -> startStreaming(intent)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        runner.stop()
        scope.cancel()
        super.onDestroy()
    }

    private fun startStreaming(intent: Intent?) {
        val channelName = intent?.getStringExtra(EXTRA_CHANNEL_NAME) ?: "Castarro"
        val videoName = intent?.getStringExtra(EXTRA_VIDEO_NAME) ?: "Selected video"
        val command = intent?.getStringArrayListExtra(EXTRA_COMMAND).orEmpty()
        val logPath = intent?.getStringExtra(EXTRA_LOG_PATH)
        startedAt = Instant.now()

        startForeground(
            NOTIFICATION_ID,
            notifications.streamingNotification(channelName, videoName, "Connecting", "00:00"),
        )

        if (command.isEmpty()) {
            updateNotification(channelName, videoName, "Live")
            return
        }

        scope.launch {
            val logFile = logPath?.let { File(it) }
            val exitCode = runCatching {
                runner.run(command) { line ->
                    logFile?.appendText("$line\n")
                }
            }.getOrElse { error ->
                logFile?.appendText("${error.message}\n")
                -1
            }
            updateNotification(
                channelName,
                videoName,
                if (exitCode == 0) "Stopped" else "Failed",
            )
            if (exitCode == 0) stopSelf()
        }
    }

    private fun stopStreaming() {
        runner.stop()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun updateNotification(channelName: String, videoName: String, status: String) {
        val manager = getSystemService(android.app.NotificationManager::class.java)
        manager.notify(
            NOTIFICATION_ID,
            notifications.streamingNotification(channelName, videoName, status, elapsedText()),
        )
    }

    private fun elapsedText(): String {
        val start = startedAt ?: return "00:00"
        val elapsed = Duration.between(start, Instant.now()).coerceAtLeast(Duration.ZERO)
        val minutes = elapsed.toMinutes()
        val seconds = elapsed.minusMinutes(minutes).seconds
        return "%02d:%02d".format(minutes, seconds)
    }

    companion object {
        const val ACTION_START = "com.castarro.mobile.streaming.START"
        const val ACTION_STOP = "com.castarro.mobile.streaming.STOP"
        const val EXTRA_CHANNEL_NAME = "channelName"
        const val EXTRA_VIDEO_NAME = "videoName"
        const val EXTRA_COMMAND = "command"
        const val EXTRA_LOG_PATH = "logPath"
        private const val NOTIFICATION_ID = 4101
    }
}
